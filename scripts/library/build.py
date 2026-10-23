"""Teilebibliothek (Auftrag 05C.1): erzeugt die Bibliotheksindizes aus den festgelegten Quellpaketen.

Aufruf:  npm run library:import   (bzw. python -I scripts/library/build.py)
Voraussetzung: npm run library:fetch (füllt data-cache/ gemäß data/library/sources.json)

Ausgaben (versioniert, je Quelle/Lizenz getrennt):
  data/library/parts.json               Katalogidentität + Geometrie-Kennwerte aus LDraw (CC BY 4.0)
  data/library/connectors-ldcad.json    Anschlüsse aus der LDCad Shadow Library (CC BY-SA 4.0)
  data/library/connectors-bricknet.json Anschlüsse aus BrickNet-Katalog v1 (MIT)
  data/library/build-info.json          Quellenversionen, Prüfsummen der Ausgaben, Zählungen
Nur lokal (git-ignoriert, nie im öffentlichen Build), falls data-raw/rebrickable/ vorhanden ist:
  data/library/private/rebrickable-colors.json  Farbbelege und Referenzmenge aus Rebrickable-Inventaren

Die Ausgabe ist deterministisch (sortiert, gerundet); ein zweiter Lauf auf denselben Quellen ergibt identische Dateien.
Heruntergeladener Code wird nicht ausgeführt; gelesen werden nur Daten.
"""
import csv
import hashlib
import json
import lzma
import math
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, 'data-cache')
OUT = os.path.join(ROOT, 'data', 'library')
PRIVATE = os.path.join(OUT, 'private')
RAW_RB = os.path.join(ROOT, 'data-raw', 'rebrickable')
BUILDER = 'library-import@1.0.0'


def load_registry():
    with open(os.path.join(OUT, 'sources.json'), encoding='utf8') as fh:
        return {s['id']: s for s in json.load(fh)['sources']}


def source_root(src):
    marker = os.path.join(CACHE, src['id'], '.fetched.json')
    if not os.path.exists(marker):
        raise SystemExit(f"Quelle {src['id']} fehlt in data-cache/. Zuerst: npm run library:fetch")
    with open(marker, encoding='utf8') as fh:
        m = json.load(fh)
    if m.get('sha256') != src.get('sha256'):
        raise SystemExit(f"Quelle {src['id']} in data-cache/ passt nicht zum Quellenregister. Zuerst: npm run library:fetch")
    return os.path.join(CACHE, src['id'], m['root'])


def read_lines(path):
    with open(path, encoding='utf8', errors='replace') as fh:
        return fh.read().splitlines()


def r2(x, nd=2):
    v = round(x, nd)
    return 0 if v == 0 else (int(v) if v == int(v) else v)


# ---------------------------------------------------------------- LDraw: Dateisuche
class Library:
    def __init__(self, root, dirs):
        self.root = root
        self.index = {}
        for d in dirs:  # Reihenfolge = Suchreihenfolge (wie LDraw-Programme)
            base = os.path.join(root, *d.split('/'))
            if not os.path.isdir(base):
                continue
            for f in os.listdir(base):
                full = os.path.join(base, f)
                if os.path.isfile(full):
                    # Unterdateien werden als "s\\name.dat" referenziert, Primitive in 48/ als "48\\name.dat"
                    self.index.setdefault(self._key(d, f), full)

    @staticmethod
    def _key(d, f):
        sub = {'parts': '', 'p': '', 'parts/s': 's/', 'p/48': '48/', 'p/8': '8/', 'parts/textures': 'textures/'}
        return (sub.get(d, '') + f).lower()

    def find(self, ref):
        return self.index.get(ref.replace('\\', '/').lower().strip())


LDRAW_DIRS = ['parts', 'parts/s', 'p', 'p/48', 'p/8']
SHADOW_DIRS = ['parts', 'parts/s', 'p', 'p/48', 'p/8']


# ---------------------------------------------------------------- Matrizen (3x3 + Translation)
def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def mat_vec(a, v):
    return [a[0][0] * v[0] + a[0][1] * v[1] + a[0][2] * v[2],
            a[1][0] * v[0] + a[1][1] * v[1] + a[1][2] * v[2],
            a[2][0] * v[0] + a[2][1] * v[1] + a[2][2] * v[2]]


def compose(outer, inner):
    (Ra, ta), (Rb, tb) = outer, inner
    return mat_mul(Ra, Rb), [x + y for x, y in zip(mat_vec(Ra, tb), ta)]


def cofactor(m):
    """cof(M) = det(M)·M^-T – bildet Flächenvektoren unter M ab."""
    a, b, c = m[0]
    d, e, f = m[1]
    g, h, i = m[2]
    return [[e * i - f * h, f * g - d * i, d * h - e * g],
            [c * h - b * i, a * i - c * g, b * g - a * h],
            [b * f - c * e, c * d - a * f, a * e - b * d]]


def axis_aligned(m):
    return all(sum(1 for x in row if abs(x) > 1e-9) == 1 for row in m)


IDENT = ([[1.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0]], [0.0, 0, 0])


def parse_type1(tok):
    v = [float(x) for x in tok[2:14]]
    return ([v[3:6], v[6:9], v[9:12]], v[0:3]), ' '.join(tok[14:])


# ---------------------------------------------------------------- LDraw: Kopfdaten
UPDATE_RE = re.compile(r'UPDATE\s+(\d{4}-\d{2})')


def header(path):
    title, org, cat, kws, lic, update = '', '', None, [], '', None
    for i, line in enumerate(read_lines(path)):
        s = line.strip()
        if i == 0 and s.startswith('0'):
            title = s[1:].strip()
            continue
        if not s.startswith('0') and s:
            break
        if s.startswith('0 !LDRAW_ORG'):
            org = s[len('0 !LDRAW_ORG'):].strip()
            m = UPDATE_RE.search(org)
            update = m.group(1) if m else ('ORIGINAL' if 'ORIGINAL' in org else None)
        elif s.startswith('0 !CATEGORY '):
            cat = s[len('0 !CATEGORY '):].strip()
        elif s.startswith('0 !KEYWORDS '):
            kws += [k.strip() for k in s[len('0 !KEYWORDS '):].split(',') if k.strip()]
        elif s.startswith('0 !LICENSE'):
            m = re.search(r'CC BY(?:-SA)? \d\.\d|CCAL|Redistributable', s)
            lic = m.group(0) if m else s[len('0 !LICENSE'):].strip()
    return title, org, cat, kws, lic, update


PRINT_RE = re.compile(r'^(.+?)(p[0-9a-z]{2,4}|pr\d{3,4}|d\d{2,3})$')


def classify(stem, title, org, cat, stems):
    kind = (org.split()[0] if org else '?')
    if title.startswith('~Moved to') or title.startswith('~Moved To'):
        return 'moved', title.split()[-1].lower(), None
    if 'Alias' in org:
        return 'alias', None, None
    if title.startswith('~'):
        return 'hidden', None, None
    t = kind.lower()
    if t not in ('part', 'shortcut'):
        t = 'other'
    base = None
    m = PRINT_RE.match(stem)
    if m and m.group(1) in stems and re.search(r'Pattern|Sticker|Decorated', title, re.I):
        base = m.group(1)
    return ('print' if base else t), None, base


def category_of(title, cat):
    if cat:
        return cat
    t = re.sub(r'^[~=_|]+', '', title).strip()
    return t.split(' ')[0] if t else ''


# ---------------------------------------------------------------- LDraw: Geometrie-Kennwerte
def canon(v):
    """Vorzeichenfreie Normalenrichtung (Wicklung in LDraw nicht verlässlich): erste nennenswerte Komponente in y, x, z positiv."""
    for k in (1, 0, 2):
        if abs(v[k]) > 1e-6:
            return v if v[k] > 0 else [-v[0], -v[1], -v[2]]
    return v


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def add_area(areas, u, area, pts, nd=3):
    """Fläche je (vorzeichenfreier) Normalenrichtung, dazu die Punkte mit größtem/kleinstem Ebenenabstand –
    daraus wird später erkannt, ob Flächen dieser Richtung außen liegen (Hüllquader) oder innen (Röhren, Rippen)."""
    k = (round(u[0], nd), round(u[1], nd), round(u[2], nd))
    e = areas.get(k)
    cand = pts + ([e[1], e[2]] if e else [])
    pmax = max(cand, key=lambda p: dot(u, p))
    pmin = min(cand, key=lambda p: dot(u, p))
    areas[k] = [(e[0] if e else 0.0) + area, pmax, pmin]


# 26 Richtungen (Achsen, Flächen- und Raumdiagonalen): Extrempunkte je Richtung ersetzen den Hüllquader der Unterdatei.
# Bei achsparallelen Drehungen ist der Quader daraus exakt, bei schiefen höchstens leicht zu klein (statt wie
# transformierte Quaderecken deutlich zu groß).
DIRS26 = [[x / math.sqrt(x * x + y * y + z * z), y / math.sqrt(x * x + y * y + z * z), z / math.sqrt(x * x + y * y + z * z)]
          for x in (-1, 0, 1) for y in (-1, 0, 1) for z in (-1, 0, 1) if (x, y, z) != (0, 0, 0)]
N26 = len(DIRS26)


_PERM_CACHE = {}


def dir_permutation(R):
    """Für achsparallele Matrizen (Vorzeichen-Permutation, positive Skalierung je Achse erlaubt): Index-Abbildung der
    26 Richtungen; sonst None."""
    key = tuple(round(x, 6) for row in R for x in row)
    if key in _PERM_CACHE:
        return _PERM_CACHE[key]
    perm = None
    if axis_aligned(R):
        sign = [[(1 if x > 0 else -1) if abs(x) > 1e-9 else 0 for x in row] for row in R]
        perm = []
        for d in DIRS26:
            img = mat_vec(sign, d)
            n = math.sqrt(dot(img, img))
            img = [x / n for x in img]
            perm.append(min(range(len(DIRS26)), key=lambda i: -dot(DIRS26[i], img)))
    _PERM_CACHE[key] = perm
    return perm


def bbox_of(ext):
    pts = [p for p in ext if p is not None]
    return [min(p[k] for p in pts) for k in range(3)], [max(p[k] for p in pts) for k in range(3)]


class GeometryStats:
    """Hüllquader und Flächenrichtungs-Histogramm je Datei, rekursiv mit Zwischenspeicher.
    Anschluss-Primitive (Noppen, Röhren, Pin-/Achslöcher) werden aus Hüllquader und Flächen herausgehalten,
    damit Kennwerte den Körper beschreiben; sie gehen über die Anschlussdaten in die Bibliothek ein."""

    def __init__(self, lib, connector_prims):
        self.lib = lib
        self.conn = connector_prims
        self.cache = {}
        self.missing = defaultdict(set)  # Datei -> nicht auflösbare Unterdateien (direkt oder tiefer)

    def is_connector(self, ref):
        name = ref.replace('\\', '/').lower().split('/')[-1]
        return name in self.conn

    def stats(self, ref, depth=0):
        key = ref.replace('\\', '/').lower().strip()
        if key in self.cache:
            return self.cache[key]
        path = self.lib.find(key)
        res = None
        if path and depth < 24:
            ext, extv, exact, areas, verts = [None] * N26, [-math.inf] * N26, True, {}, set()

            def offer(i, p):
                d = DIRS26[i]
                v = d[0] * p[0] + d[1] * p[1] + d[2] * p[2]
                if v > extv[i]:
                    ext[i], extv[i] = p, v

            def take(p):
                x, y, z = p
                for i, d in enumerate(DIRS26):
                    v = d[0] * x + d[1] * y + d[2] * z
                    if v > extv[i]:
                        ext[i], extv[i] = p, v
            for line in read_lines(path):
                tok = line.split()
                if not tok:
                    continue
                if tok[0] == '1' and len(tok) >= 15:
                    M, sub = parse_type1(tok)
                    if self.is_connector(sub):
                        continue
                    child = self.stats(sub, depth + 1)
                    sub_key = sub.replace('\\', '/').lower().strip()
                    self.missing[key] |= self.missing.get(sub_key, set())
                    if not child:
                        self.missing[key].add(sub_key)
                        continue
                    cext, cexact, careas = child
                    R, t = M
                    if any(cext):
                        perm = dir_permutation(R)
                        if perm:  # achsparallel (auch skaliert): Extrempunkt je Richtung bleibt Extrempunkt der Bildrichtung
                            for j, q in enumerate(cext):
                                if q is not None:
                                    p = mat_vec(R, q)
                                    offer(perm[j], [p[k] + t[k] for k in range(3)])
                        else:
                            for q in {tuple(q) for q in cext if q is not None}:
                                p = mat_vec(R, q)
                                take([p[k] + t[k] for k in range(3)])
                        exact = exact and cexact and perm is not None
                    if careas:
                        C = cofactor(R)
                        for d, (a, pmax, pmin) in careas.items():
                            w = mat_vec(C, [d[0] * a, d[1] * a, d[2] * a])
                            n = math.sqrt(w[0] ** 2 + w[1] ** 2 + w[2] ** 2)
                            if n > 1e-9:
                                u = canon([w[0] / n, w[1] / n, w[2] / n])
                                pts = [[q[k] + t[k] for k in range(3)] for q in (mat_vec(R, pmax), mat_vec(R, pmin))]
                                add_area(areas, u, n, pts)
                elif tok[0] in ('3', '4') and len(tok) >= (11 if tok[0] == '3' else 14):
                    pts = [[float(x) for x in tok[2 + 3 * j:5 + 3 * j]] for j in range(int(tok[0]))]
                    for p in pts:
                        verts.add((p[0], p[1], p[2]))
                    tris = [(pts[0], pts[1], pts[2])] + ([(pts[0], pts[2], pts[3])] if len(pts) == 4 else [])
                    for a, b, c in tris:
                        u = [b[k] - a[k] for k in range(3)]
                        v = [c[k] - a[k] for k in range(3)]
                        w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
                        n = math.sqrt(w[0] ** 2 + w[1] ** 2 + w[2] ** 2)
                        if n > 1e-9:
                            add_area(areas, canon([w[0] / n, w[1] / n, w[2] / n]), n / 2, [a, b, c])
            for v in verts:
                take(list(v))
            res = (ext, exact, areas)
        self.cache[key] = res
        return res


def shape_features(areas, bmin, bmax):
    """Kennwerte aus dem Flächenrichtungs-Histogramm (Anteile an der Körperoberfläche, Anschlüsse ausgenommen).
    h: waagrecht · va: senkrecht achsparallel · ov: senkrecht schräg (eben) · i: geneigt eben · cv: gekrümmt (viele kleine Richtungen)
    sd: Richtungen (Azimut in 45°-Stufen) großer geneigter Flächen – zwei verschiedene = Eck-Neigung."""
    total = sum(v[0] for v in areas.values())
    if total <= 0:
        return None
    buckets = {}
    for d, (a, pmax, pmin) in areas.items():  # gröber bündeln (≈2°), damit Facetten derselben Ebene zusammenfallen
        add_area(buckets, list(d), a, [pmax, pmin], nd=2)
    # Eckpunkte aller Flächenrichtungen: daraus die Stützfunktion der Hülle (untere Schranke der echten Hülle)
    extreme = [p for v in buckets.values() for p in (v[1], v[2])]
    f = Counter()
    sd = set()
    oblique = []
    for (x, y, z), (a, pmax, pmin) in buckets.items():
        share = a / total
        if abs(y) > 0.995:
            f['h'] += share
        elif abs(y) < 0.03 and (abs(x) > 0.995 or abs(z) > 0.995):
            f['va'] += share
        elif share >= 0.0005:
            # außen = eine Fläche dieser Richtung ist Stützebene der Hülle (kein Eckpunkt liegt jenseits, Toleranz 1 LDU)
            u = (x, y, z)
            proj = [dot(u, p) for p in extreme]
            if dot(u, pmax) >= max(proj) - 1.0 or dot(u, pmin) <= min(proj) + 1.0:
                oblique.append((x, y, z, share))
            else:
                f['in'] += share  # schräg/gekrümmt, aber innenliegend (Röhren, Rippen, Hohlräume)

    def az180(b):
        return math.degrees(math.atan2(b[0], b[2])) % 180.0

    for b in oblique:
        x, y, z, share = b
        # Gekrümmt = Teil eines Fächers: viele Richtungen gleicher Neigung (Zylinder, Kegel) oder gleicher
        # Himmelsrichtung mit wechselnder Neigung (Bögen, gewölbte Schrägen). Ebene Schrägen bilden keinen Fächer.
        same_level = sum(1 for o in oblique if o is not b and abs(abs(o[1]) - abs(y)) < 0.03)
        same_az = sum(1 for o in oblique if o is not b and abs(abs(o[1]) - abs(y)) >= 0.03
                      and min(abs(az180(o) - az180(b)), 180 - abs(az180(o) - az180(b))) < 3)
        if same_level >= 4 or same_az >= 3:
            f['cv'] += share
            if abs(y) < 0.03:
                f['cvv'] += share  # davon senkrecht (runde Wände, Zylinder)
        elif abs(y) < 0.03:
            f['ov'] += share
        else:
            f['i'] += share
            if share >= 0.04:
                sd.add(int(round(math.degrees(math.atan2(x, z)) / 45.0)) % 8)
    out = {k: r2(v, 3) for k, v in sorted(f.items()) if v >= 0.0005}
    if sd:
        out['sd'] = sorted(sd)
    return out


# ---------------------------------------------------------------- LDCad: Anschlüsse
META_RE = re.compile(r'^0\s+!LDCAD\s+(SNAP_\w+)\s*(.*)$')
ARG_RE = re.compile(r'\[(\w+)=([^\]]*)\]')


def parse_grid(spec):
    """LDCad-Raster: "[C] nx [C] nz sx sz" (x/z) oder "[C] nx [C] ny [C] nz sx sy sz" (3D); C = zentriert.
    Liefert Versätze (x, y, z) im Anschlussrahmen."""
    nums, centered, pending = [], [], False
    for t in spec.split():
        if t.upper() == 'C':
            pending = True
            continue
        nums.append(float(t))
        centered.append(pending)
        pending = False
    dims = len(nums) // 2
    if dims not in (2, 3) or len(nums) != 2 * dims:
        return [(0.0, 0.0, 0.0)]
    counts, steps = [int(n) for n in nums[:dims]], nums[dims:]
    axes = [[k * steps[d] - ((counts[d] - 1) * steps[d] / 2 if centered[d] else 0) for k in range(max(counts[d], 1))]
            for d in range(dims)]
    if dims == 2:
        return [(x, 0.0, z) for x in axes[0] for z in axes[1]]
    return [(x, y, z) for x in axes[0] for y in axes[1] for z in axes[2]]


def cyl_class(gender, secs):
    """Grobe Einordnung eines LDCad-Zylinderanschlusses. Rohform bleibt im Feld 'sub' erhalten."""
    tok = secs.split()
    shapes = [(tok[i].upper(), float(tok[i + 1]), float(tok[i + 2])) for i in range(0, len(tok) - 2, 3)
              if tok[i].upper() in ('R', 'A', 'S', '_L', 'L_')]
    if not shapes:
        return 'other'
    radii = {s[1] for s in shapes}
    length = sum(s[2] for s in shapes)
    if any(s[0] == 'A' for s in shapes):
        return 'axle' if gender == 'M' else 'axlehole'
    if gender == 'M':
        if radii <= {6.0} and length <= 6:
            return 'stud'
        if radii <= {4.0}:
            return 'bar'
        if 6.0 in radii and length >= 10:
            return 'pin'
        return 'other'
    # Technic-Lochprofil: Senkung (R 8) an den Enden um R 6 – sonst ist ein R/S-6-Hohlraum eine Noppenaufnahme,
    # auch wenn LDCad ihn über die ganze Bauteilhöhe modelliert (z. B. 3001: "R 6 20" im Raster).
    if 8.0 in radii and 6.0 in radii and shapes[0][1] == 8.0 and shapes[-1][1] == 8.0:
        return 'pinhole'
    if radii <= {6.0}:
        return 'antistud'
    if radii <= {4.0}:
        return 'barhole'
    if radii <= {6.0, 8.0}:
        return 'antistud'
    return 'other'


class Shadow:
    def __init__(self, ldraw, shadow_root):
        self.ld = ldraw
        self.sh = Library(shadow_root, SHADOW_DIRS)
        self.cache = {}

    def own(self, key):
        path = self.sh.find(key)
        snaps, clears, incls = [], [], []
        if not path:
            return snaps, clears, incls
        for line in read_lines(path):
            m = META_RE.match(line.strip())
            if not m:
                continue
            kind, args = m.group(1), dict((k.lower(), v.strip()) for k, v in ARG_RE.findall(m.group(2)))
            if kind == 'SNAP_CLEAR':
                clears.append(args.get('id'))
            elif kind == 'SNAP_INCL':
                incls.append(args)
            else:
                snaps.append((kind, args))
        return snaps, clears, incls

    @staticmethod
    def frame(args):
        pos = [float(x) for x in args.get('pos', '0 0 0').split()[:3]]
        o = [float(x) for x in args.get('ori', '1 0 0 0 1 0 0 0 1').split()[:9]]
        return [o[0:3], o[3:6], o[6:9]], pos

    def resolve(self, ref, depth=0):
        """Liste (cls, sub, id, pos, achse) im lokalen Koordinatensystem von ref."""
        key = ref.replace('\\', '/').lower().strip()
        if key in self.cache:
            return self.cache[key]
        out = []
        snaps, clears, incls = self.own(key)
        for kind, args in snaps:
            R, pos = self.frame(args)
            gender = args.get('gender', 'M').upper()[:1]
            if kind == 'SNAP_CYL':
                cls, sub = cyl_class(gender, args.get('secs', '')), 'cyl:' + gender + ':' + args.get('secs', '').strip()
            elif kind == 'SNAP_CLP':
                cls, sub = 'clip', 'clp'
            elif kind == 'SNAP_FGR':
                cls, sub = 'finger', 'fgr:' + args.get('genderofs', args.get('group', ''))
            else:
                cls, sub = 'generic', 'gen:' + args.get('group', '') + ':' + gender
            axis = mat_vec(R, [0.0, -1.0, 0.0])  # Zylinderachse = lokale y; Steckrichtung nach −y (oben)
            for g in (parse_grid(args['grid']) if args.get('grid') else [(0.0, 0.0, 0.0)]):
                off = mat_vec(R, list(g))
                out.append((cls, sub, args.get('id', ''), [pos[k] + off[k] for k in range(3)], axis))
        for args in incls:
            R, pos = self.frame(args)
            for g in (parse_grid(args['grid']) if args.get('grid') else [(0.0, 0.0, 0.0)]):
                off = mat_vec(R, list(g))
                M =(R, [pos[k] + off[k] for k in range(3)])
                for c in self.resolve(args.get('ref', ''), depth + 1):
                    out.append(self.transform(c, M))
        clear_all = any(c is None for c in clears)
        clear_ids = {c.lower() for c in clears if c}
        path = self.ld.find(key)
        if path and depth < 24 and not clear_all:
            for line in read_lines(path):
                tok = line.split()
                if len(tok) >= 15 and tok[0] == '1':
                    M, sub = parse_type1(tok)
                    for c in self.resolve(sub, depth + 1):
                        if c[2] and c[2].lower() in clear_ids:
                            continue
                        out.append(self.transform(c, M))
        self.cache[key] = out
        return out

    @staticmethod
    def transform(c, M):
        R, t = M
        p = mat_vec(R, c[3])
        a = mat_vec(R, c[4])
        n = math.sqrt(sum(x * x for x in a)) or 1.0
        return (c[0], c[1], c[2], [p[k] + t[k] for k in range(3)], [x / n for x in a])


def rows_out(items):
    seen, rows = set(), []
    for cls, sub, _id, p, a in items:
        row = [cls, sub, r2(p[0], 1), r2(p[1], 1), r2(p[2], 1), r2(a[0], 2), r2(a[1], 2), r2(a[2], 2)]
        k = json.dumps(row)
        if k not in seen:
            seen.add(k)
            rows.append(row)
    rows.sort(key=lambda r: (r[0], r[1], r[3], r[2], r[4]))
    return rows


# ---------------------------------------------------------------- BrickNet: Anschlüsse
BN_CLASS = {('stud', 'stud'): 'stud', ('stud', 'open'): 'stud', ('hole', 'hole'): 'antistud', ('hole', 'tube'): 'antistud',
            ('hole', 'post'): 'antistud', ('axle', 'bar'): 'bar', ('axle', 'clip'): 'clip', ('axle', 'socket'): 'barhole',
            ('axle', 'pin'): 'pin', ('axle', 'cross'): 'axlehole', ('axle', 'axle'): 'axle'}


def bn_axis(pitch, roll, yaw=0.0):
    sx, cx = math.sin(math.radians(pitch)), math.cos(math.radians(pitch))
    sz, cz = math.sin(math.radians(roll)), math.cos(math.radians(roll))
    sy, cy = math.sin(math.radians(yaw)), math.cos(math.radians(yaw))
    col1 = [-cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz]  # Rahmen-y (data.py von BrickNet)
    return [-col1[0], -col1[1], -col1[2]]  # Steckachse = −y des Rahmens


def bricknet_rows(kinds):
    items = []
    for kind, subs in kinds.items():
        for sub, rows in subs.items():
            groups = rows.items() if isinstance(rows, dict) else [('', rows)]
            for pol, rr in groups:
                for r in rr:
                    yaw = r[5] if kind in ('fixed', 'hinge') and len(r) > 5 else 0.0
                    cls = BN_CLASS.get((kind, sub), kind)
                    axis = bn_axis(r[3], r[4], yaw) if len(r) >= 5 else [0.0, 0.0, 0.0]  # Kugel: nur Mittelpunkt
                    items.append((cls, f'{kind}:{sub}' + (f':{pol}' if pol else ''), '', r[0:3], axis))
    return rows_out(items)


# ---------------------------------------------------------------- Rebrickable (privat, optional)
# Ausgeschlossen: Duplo/Technic-Mechanik/Minifiguren/Figuren und Tiere/Sticker/Fremdsysteme sowie biegsame Teile (Schläuche, Schnüre)
SYSTEM_EXCLUDED_CATS = {4, 12, 13, 17, 22, 25, 26, 27, 28, 30, 31, 40, 41, 42, 43, 45, 46, 48, 50, 51, 52, 53, 54, 55, 56,
                        57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 70, 71, 72, 73, 75, 77, 78}
RB_PRINT_RE = re.compile(r'^(.+?)(?:pat\d+)?(?:pr\d+)?$')
RECENT_FROM = 2016


def rebrickable(index):
    if not os.path.isdir(RAW_RB):
        return None
    def rows(name):
        with open(os.path.join(RAW_RB, name), encoding='utf8', newline='') as fh:
            yield from csv.DictReader(fh)
    colors = {int(r['id']): [r['name'], r['rgb'], r['is_trans'] in ('t', 'True', 'true')] for r in rows('colors.csv')}
    parts = {r['part_num']: (r['name'], int(r['part_cat_id'])) for r in rows('parts.csv')}
    print_parent = {}
    alt = defaultdict(set)
    for r in rows('part_relationships.csv'):
        if r['rel_type'] == 'P':
            print_parent[r['child_part_num']] = r['parent_part_num']
        elif r['rel_type'] in ('A', 'M'):
            alt[r['child_part_num']].add(r['parent_part_num'])
            alt[r['parent_part_num']].add(r['child_part_num'])
    set_year = {r['set_num']: int(r['year']) for r in rows('sets.csv')}
    inv_year = {r['id']: set_year.get(r['set_num']) for r in rows('inventories.csv')}
    elements = set()
    for r in rows('elements.csv'):
        elements.add((r['part_num'], int(r['color_id'])))

    def to_ldraw(pn):
        if pn in index:
            e = index[pn]
            if e['ty'] == 'moved' and e.get('to') in index:
                return e['to'], 'LDraw-Umbenennung'
            return pn, 'gleiche Nummer'
        for a in sorted(alt.get(pn, ())):
            if a in index and index[a]['ty'] in ('part', 'shortcut'):
                return a, 'Rebrickable-Beziehung (alternative Form/Nummer)'
        return None, None

    use = defaultdict(lambda: defaultdict(lambda: [0, 0, 9999, 0]))  # rb-part -> color -> [Sets, Sets ab 2016, erstes, letztes Jahr]
    seen = set()
    for r in rows('inventory_parts.csv'):
        if r['is_spare'] in ('True', 't', 'true'):
            continue
        y = inv_year.get(r['inventory_id'])
        if y is None:
            continue
        key = (r['inventory_id'], r['part_num'], r['color_id'])
        if key in seen:
            continue
        seen.add(key)
        u = use[r['part_num']][int(r['color_id'])]
        u[0] += 1
        u[1] += 1 if y >= RECENT_FROM else 0
        u[2] = min(u[2], y)
        u[3] = max(u[3], y)

    by_ldraw = {}
    unmapped_ref = []
    refset = defaultdict(int)  # LDraw-ID -> Sets ab 2016 (Drucke auf das Grundteil gefaltet)
    def base_of(pn):
        if pn in print_parent:
            return print_parent[pn]
        m = RB_PRINT_RE.match(pn)  # Rebrickable-Druck-/Musternummern ohne P-Beziehung (…pr0001, …pat0002)
        return m.group(1) if m and m.group(1) != pn and m.group(1) in parts else pn

    for pn, cols in use.items():
        base_pn = base_of(pn)
        cat = parts.get(base_pn, ('', 0))[1]
        recent = sum(c[1] for c in cols.values())
        ld, how = to_ldraw(pn)
        if ld:
            e = by_ldraw.setdefault(ld, {'rb': set(), 'm': set(), 'c': {}})
            e['rb'].add(pn)
            e['m'].add(how)
            for col, (n, nr, y0, y1) in cols.items():
                c = e['c'].setdefault(col, [0, 0, 9999, 0, False])
                c[0] += n
                c[1] += nr
                c[2] = min(c[2], y0)
                c[3] = max(c[3], y1)
                c[4] = c[4] or (pn, col) in elements
        if recent and cat not in SYSTEM_EXCLUDED_CATS:
            ld_base, _ = to_ldraw(base_pn)
            if ld_base:
                refset[ld_base] += recent
            else:
                unmapped_ref.append(base_pn)
    out = {
        'schema': 'baustein-sim/library-rebrickable-private@1',
        'note': 'NUR LOKAL. Abgeleitet aus Rebrickable-CSV-Dumps (Weitergabe ungeklärt). Nicht versionieren, nicht veröffentlichen.',
        'definition': {
            'recentFrom': RECENT_FROM,
            'excludedCategories': sorted(SYSTEM_EXCLUDED_CATS),
            'refset': 'Teile aus Set-Inventaren (ohne Ersatzteile) von Sets ab %d, Drucke auf das Grundteil gefaltet, ohne Minifiguren-, Duplo-, Technic-Mechanik-, Sticker- und Fremdsystem-Kategorien' % RECENT_FROM,
        },
        'colors': {str(k): v for k, v in sorted(colors.items())},
        'parts': {ld: {'rb': sorted(e['rb']), 'map': sorted(e['m']),
                       'colors': [[col] + v[:4] + [v[4]] for col, v in sorted(e['c'].items())]}
                  for ld, e in sorted(by_ldraw.items())},
        'refset': {k: v for k, v in sorted(refset.items())},
        'refsetUnmapped': sorted(set(unmapped_ref)),
    }
    return out


def with_type_table(parts_rows):
    """Klasse+Rohform als Tabelle; Zeilen verweisen per Index darauf (halbiert die Dateigröße)."""
    types = sorted({(r[0], r[1]) for rows in parts_rows.values() for r in rows})
    idx = {t: i for i, t in enumerate(types)}
    return [list(t) for t in types], {k: [[idx[(r[0], r[1])]] + r[2:] for r in rows] for k, rows in parts_rows.items()}


# ---------------------------------------------------------------- Hauptablauf
def dump(path, obj, compact_rows=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if compact_rows:
        # eine Zeile je Teil: gut lesbare Diffs bei Bibliotheksupdates
        head = {k: v for k, v in obj.items() if k != 'parts'}
        lines = [json.dumps(head, ensure_ascii=False, sort_keys=False)[:-1] + ', "parts": {']
        items = sorted(obj['parts'].items())
        for i, (k, v) in enumerate(items):
            lines.append(json.dumps(k) + ': ' + json.dumps(v, ensure_ascii=False, separators=(',', ':')) + (',' if i < len(items) - 1 else ''))
        lines.append('}}')
        text = '\n'.join(lines) + '\n'
    else:
        text = json.dumps(obj, ensure_ascii=False, indent=1) + '\n'
    with open(path, 'w', encoding='utf8', newline='\n') as fh:
        fh.write(text)
    return hashlib.sha256(text.encode('utf8')).hexdigest().upper(), len(text.encode('utf8'))


def main():
    reg = load_registry()
    ld_root = source_root(reg['ldraw'])
    ld_root = os.path.join(ld_root) if os.path.isdir(os.path.join(ld_root, 'parts')) else os.path.join(ld_root, 'ldraw')
    sh_root = source_root(reg['ldcad-shadow'])
    bn_root = os.path.join(source_root(reg['bricknet']), 'src', 'bricknet', '_data', 'v1')

    lib = Library(ld_root, LDRAW_DIRS)
    parts_dir = os.path.join(ld_root, 'parts')
    stems = {f[:-4].lower() for f in os.listdir(parts_dir) if f.lower().endswith('.dat')}

    # Anschluss-Primitive: alle Primitive, für die die Shadow Library Anschlüsse definiert, plus Noppen-/Röhrenfamilien
    shadow = Shadow(lib, sh_root)
    conn_prims = set()
    for d in ('p', 'p/48', 'p/8'):
        base = os.path.join(sh_root, *d.split('/'))
        if os.path.isdir(base):
            for f in os.listdir(base):
                if f.lower().endswith('.dat') and any(META_RE.match(l.strip()) for l in read_lines(os.path.join(base, f))):
                    conn_prims.add(f.lower())
    for f in os.listdir(os.path.join(ld_root, 'p')):
        if re.match(r'^(stud|stug|stu2|stu\d|connhol|axlehol|peghole|beamhol)', f.lower()):
            conn_prims.add(f.lower())
    geo = GeometryStats(lib, conn_prims)

    index = {}
    release = set()
    for stem in sorted(stems):
        path = os.path.join(parts_dir, stem + '.dat')
        if not os.path.exists(path):
            path = lib.find(stem + '.dat')
        title, org, cat, kws, lic, upd = header(path)
        ty, to, base = classify(stem, title, org, cat, stems)
        e = {'t': title, 'ty': ty}
        if to:
            e['to'] = to
        if base:
            e['pr'] = base
        c = category_of(title, cat)
        if c:
            e['c'] = c
        if kws:
            e['k'] = kws
        if lic:
            e['lic'] = lic
        if upd:
            e['u'] = upd
            if re.match(r'\d{4}-\d{2}', upd):
                release.add(upd)
        # Kennwerte nur für einzeln geführte Teile; Drucke, Aliase und versteckte Unterteile behalten ihre eigene
        # LDraw-Geometrie (Vorschau bei Bedarf), übernehmen aber keine Werte des Grundteils.
        if ty in ('part', 'shortcut'):
            s = geo.stats(stem + '.dat')
            if s and any(p is not None for p in s[0]):
                ext, exact, areas = s
                bmin, bmax = bbox_of(ext)
                e['bb'] = [r2(x, 1) for x in bmin + bmax]
                if not exact:
                    e['bbx'] = 0  # Hüllquader genähert (schief gedrehte Unterdateien)
                f = shape_features(areas, bmin, bmax)
                if f:
                    e['f'] = f
            if geo.missing.get(stem + '.dat'):
                e['gm'] = sorted(geo.missing[stem + '.dat'])[:5]  # Geometrie unvollständig: fehlende Unterdateien
        index[stem] = e
    # Aliase auf ihr Ziel (erste Referenz der Datei) zeigen lassen
    for stem, e in index.items():
        if e['ty'] == 'alias':
            for line in read_lines(os.path.join(parts_dir, stem + '.dat')):
                tok = line.split()
                if len(tok) >= 15 and tok[0] == '1':
                    e['to'] = ' '.join(tok[14:]).lower().replace('.dat', '')
                    break
    print('LDraw:', len(index), 'Dateien in parts/,', Counter(e['ty'] for e in index.values()).most_common())

    # LDCad-Anschlüsse: Teile und Kurzformen ohne Druck
    want = [s for s, e in index.items() if e['ty'] in ('part', 'shortcut')]
    ldcad = {}
    shadow_own = 0
    for stem in want:
        rows = rows_out(shadow.resolve(stem + '.dat'))
        if shadow.sh.find(stem + '.dat'):
            shadow_own += 1
        if rows:
            ldcad[stem] = rows
    print('LDCad: Anschlüsse für', len(ldcad), 'von', len(want), 'Teilen; eigene Shadow-Datei:', shadow_own)

    # BrickNet-Anschlüsse (Katalog v1) mit Alias-Auflösung
    labels = json.loads(lzma.decompress(open(os.path.join(bn_root, 'labels.json.xz'), 'rb').read()))
    aliases = json.loads(lzma.decompress(open(os.path.join(bn_root, 'part_aliases.json.xz'), 'rb').read()))['rows']
    bn_alias = {r['src'].lower(): (r['dst'].lower(), r['final_matrix_3x4']) for r in aliases}
    bricknet, bn_identity = {}, {}
    for key, kinds in labels.items():
        stem = key[:-4].lower()
        if stem in index and index[stem]['ty'] in ('part', 'shortcut'):
            bricknet[stem] = bricknet_rows(kinds)
    for src, (dst, m) in sorted(bn_alias.items()):
        # BrickNet faltet Teile mit gleichem Titel und gleicher Geometrie zusammen; nur reine Umbenennungen (Einheitsmatrix) übernehmen
        identity = [float(x) for x in m] == [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        if identity and src != dst and src in index and index[src]['ty'] in ('part', 'shortcut') and dst in index:
            index[src]['same'] = dst
    print('BrickNet: Anschlüsse für', len(bricknet), 'Teile (Vokabular', len(labels), ')')

    rel = max(release) if release else None
    meta_ld = {'source': 'ldraw', 'sha256': reg['ldraw']['sha256'], 'release': rel}
    files = {}
    files['parts.json'] = dump(os.path.join(OUT, 'parts.json'), {
        'schema': 'baustein-sim/library-parts@1', 'builder': BUILDER, 'licence': 'CC BY 4.0 (LDraw; Teil-Lizenz je Eintrag in lic)',
        'source': meta_ld,
        'fields': {'t': 'Titel', 'ty': 'part|shortcut|print|alias|moved|hidden|other', 'to': 'Ziel bei Umbenennung/Alias', 'pr': 'Grundteil eines Druck-/Aufkleberteils',
                   'c': 'LDraw-Kategorie', 'k': 'LDraw-Schlüsselwörter', 'lic': 'Lizenz', 'u': 'LDraw-Update', 'bb': 'Körper-Hüllquader [min xyz, max xyz] in LDU ohne Anschluss-Primitive',
                   'bbx': '0 = Hüllquader genähert (schief gedrehte Unterdateien, höchstens leicht zu klein)', 'f': 'Flächenanteile h/va/ov/i/cv(cvv) und Neigungsrichtungen sd', 'gm': 'fehlende Unterdateien (Geometrie unvollständig)',
                   'same': 'laut BrickNet geometriegleich mit'},
        'parts': index}, compact_rows=True)
    row_doc = ['Typ-Index', 'x', 'y', 'z', 'Achse x', 'Achse y', 'Achse z']
    types, rows = with_type_table(ldcad)
    files['connectors-ldcad.json'] = dump(os.path.join(OUT, 'connectors-ldcad.json'), {
        'schema': 'baustein-sim/library-connectors@1', 'builder': BUILDER, 'licence': 'CC BY-SA 4.0 (abgeleitet aus der LDCad Shadow Library, Roland Melkert u. a.)',
        'source': {'source': 'ldcad-shadow', 'commit': reg['ldcad-shadow']['commit'], 'sha256': reg['ldcad-shadow']['sha256'], 'geometry': meta_ld},
        'row': row_doc, 'types': types, 'parts': rows}, compact_rows=True)
    types, rows = with_type_table(bricknet)
    files['connectors-bricknet.json'] = dump(os.path.join(OUT, 'connectors-bricknet.json'), {
        'schema': 'baustein-sim/library-connectors@1', 'builder': BUILDER, 'licence': 'MIT (BrickNet, Peter Kulits); abgeleitet aus LDraw (CC BY 4.0)',
        'source': {'source': 'bricknet', 'commit': reg['bricknet']['commit'], 'sha256': reg['bricknet']['sha256'], 'catalog': 'v1'},
        'row': row_doc, 'types': types, 'parts': rows}, compact_rows=True)

    rb = rebrickable(index)
    if rb:
        h = dump(os.path.join(PRIVATE, 'rebrickable-colors.json'), rb)
        print('Rebrickable (privat): Farbbelege für', len(rb['parts']), 'LDraw-Teile; Referenzmenge', len(rb['refset']), '(+', len(rb['refsetUnmapped']), 'ohne LDraw-Zuordnung)')
    else:
        print('Rebrickable: data-raw/rebrickable/ fehlt – keine Farbbelege (öffentlicher Stand).')

    info = {
        'schema': 'baustein-sim/library-build@1', 'builder': BUILDER,
        'sources': {k: {x: v[x] for x in ('url', 'sha256', 'bytes', 'commit', 'licence') if x in v} for k, v in reg.items()},
        'ldrawRelease': rel,
        'counts': {
            'ldrawFiles': len(index), 'byType': dict(sorted(Counter(e['ty'] for e in index.values()).items())),
            'withGeometry': sum(1 for e in index.values() if 'bb' in e),
            'ldcadParts': len(ldcad), 'ldcadOwnShadow': shadow_own, 'bricknetParts': len(bricknet), 'bricknetVocabulary': len(labels),
        },
        'outputs': {k: {'sha256': v[0], 'bytes': v[1]} for k, v in sorted(files.items())},
    }
    dump(os.path.join(OUT, 'build-info.json'), info)
    for k, (d, n) in sorted(files.items()):
        print(f'  {k}: {n / 1e6:.2f} MB  {d[:16]}…')


if __name__ == '__main__':
    sys.setrecursionlimit(10000)
    main()
