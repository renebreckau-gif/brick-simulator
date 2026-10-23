"""Teilebibliothek: Farbbelege und Referenzmenge aus lokalen Rebrickable-Dumps (Auftrag 05C.1.1).

Aufruf (auch für Tests mit synthetischen CSV-Daten):
  python -I scripts/library/rebrickable.py <CSV-Ordner> <Index-JSON (wie parts.json)> <Ausgabe-JSON>
Im Import (build.py) wird build() direkt aufgerufen.

Regeln
- Zuordnung Rebrickable-Teil → LDraw-Teil, getrennt nach Grund:
    'gleiche Nummer'       Rebrickable-Nummer = LDraw-Datei (Teil oder Kurzform)
    'LDraw-Schlüsselwort'  LDraw-Kopfzeile „!KEYWORDS Rebrickable <Nummer>“ (ausdrücklicher Querverweis)
    'LDraw-Umbenennung'    gleiche Nummer ist in LDraw eine „~Moved to“-Datei bzw. ein Alias → deren Ziel
  Nur diese drei begründen eine Identität. Führen sie zu verschiedenen LDraw-Teilen, ist die Zuordnung mehrdeutig
  und es gibt keine Farbbelege. Rebrickable-Beziehungen „alternative Form“ (A) und „Formvariante“ (M) werden als
  Alternative vermerkt, sind aber KEIN Beleg für Farben des Zielteils.
- Inventarversion: je Set zählt nur die neueste Inventarversion (höchste „version“); Ersatzteile zählen nicht.
- Farbbeleg je (LDraw-Teil, Farbe): Anzahl eindeutiger Sets, davon ab RECENT_FROM, Jahre, Element-ID vorhanden,
  Herkunft (Rebrickable-Teil und Zuordnungsgrund). Belege mehrerer Rebrickable-Teile werden als Set-Vereinigung gezählt.
- Referenzmenge: Grundteile (Drucke über P-Beziehung oder Nummernmuster …prNNNN/…patNNNN gefaltet) aus Sets ab
  RECENT_FROM ohne ausgeschlossene Kategorien. Gewicht = Anzahl eindeutiger Sets, in denen das Grundteil (in irgendeiner
  Farbe oder als Druck) vorkommt – je Set einmal, unabhängig von Farben, Drucken und Inventarversionen.
  Nicht zugeordnete Grundteile behalten ihr Gewicht.
- Farbexistenz ist keine Kaufverfügbarkeit: Diese Datei enthält keine Angebots- oder Bestandsangaben.
"""
import csv
import json
import os
import re
import sys
from collections import defaultdict

SCHEMA = 'baustein-sim/library-rebrickable-private@2'
RECENT_FROM = 2016
# Ausgeschlossen: Duplo/Technic-Mechanik/Minifiguren/Figuren und Tiere/Sticker/Fremdsysteme sowie biegsame Teile
EXCLUDED_CATS = {4, 12, 13, 17, 22, 25, 26, 27, 28, 30, 31, 40, 41, 42, 43, 45, 46, 48, 50, 51, 52, 53, 54, 55, 56,
                 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 70, 71, 72, 73, 75, 77, 78}
PRINT_RE = re.compile(r'^(.+?)(?:pat\d+)?(?:pr\d+)?$')
IDENTITY_REASONS = ('gleiche Nummer', 'LDraw-Schlüsselwort', 'LDraw-Umbenennung')


def rows(raw_dir, name):
    with open(os.path.join(raw_dir, name), encoding='utf8', newline='') as fh:
        yield from csv.DictReader(fh)


def truthy(v):
    return str(v).strip().lower() in ('t', 'true', '1')


def resolve_ldraw(index, ldraw_id):
    """Folgt Umbenennungen/Aliasen bis zu einem geführten Teil; None, wenn das nicht gelingt."""
    cur = ldraw_id
    for _ in range(8):
        e = index.get(cur)
        if not e:
            return None
        if e['ty'] in ('part', 'shortcut', 'print'):
            return cur
        if e['ty'] in ('moved', 'alias') and e.get('to'):
            cur = e['to']
            continue
        return None
    return None


def identity_candidates(index, keyword_map, pn):
    """{LDraw-ID: [Gründe]} aus gleicher Nummer, Schlüsselwort und Umbenennung."""
    out = defaultdict(list)
    e = index.get(pn)
    if e and e['ty'] in ('part', 'shortcut', 'print'):
        out[pn].append('gleiche Nummer')
    elif e and e['ty'] in ('moved', 'alias'):
        target = resolve_ldraw(index, pn)
        if target:
            out[target].append('LDraw-Umbenennung')
    for ld in keyword_map.get(pn, ()):
        target = resolve_ldraw(index, ld)
        if target:
            out[target].append('LDraw-Schlüsselwort')
    return {k: sorted(set(v)) for k, v in out.items()}


def build(raw_dir, index):
    colors = {int(r['id']): [r['name'], r['rgb'], truthy(r['is_trans'])] for r in rows(raw_dir, 'colors.csv')}
    parts = {r['part_num']: (r['name'], int(r['part_cat_id'])) for r in rows(raw_dir, 'parts.csv')}
    print_parent, alternatives = {}, defaultdict(set)
    for r in rows(raw_dir, 'part_relationships.csv'):
        if r['rel_type'] == 'P':
            print_parent[r['child_part_num']] = r['parent_part_num']
        elif r['rel_type'] in ('A', 'M'):
            alternatives[r['child_part_num']].add(r['parent_part_num'])
            alternatives[r['parent_part_num']].add(r['child_part_num'])
    set_year = {r['set_num']: int(r['year']) for r in rows(raw_dir, 'sets.csv')}
    # Inventarversionsregel: je Set nur die neueste Version
    latest = {}
    for r in rows(raw_dir, 'inventories.csv'):
        sn = r['set_num']
        if sn not in set_year:
            continue  # z. B. Minifiguren-Inventare (fig-…): kein Set
        v = int(r['version'])
        if sn not in latest or v > latest[sn][0]:
            latest[sn] = (v, r['id'])
    inv_set = {inv: sn for sn, (_v, inv) in latest.items()}
    elements = {(r['part_num'], int(r['color_id'])) for r in rows(raw_dir, 'elements.csv')}

    keyword_map = defaultdict(set)  # Rebrickable-Nummer → LDraw-Dateien mit Schlüsselwort „Rebrickable <Nummer>“
    for ld, e in index.items():
        for k in e.get('k', []):
            m = re.match(r'^rebrickable\s+(\S+)$', k.strip(), re.I)
            if m:
                keyword_map[m.group(1)].add(ld)

    def base_of(pn):
        if pn in print_parent:
            return print_parent[pn]
        m = PRINT_RE.match(pn)
        return m.group(1) if m and m.group(1) != pn and m.group(1) in parts else pn

    use = defaultdict(lambda: defaultdict(set))  # Rebrickable-Teil → Farbe → {Sets}
    for r in rows(raw_dir, 'inventory_parts.csv'):
        sn = inv_set.get(r['inventory_id'])
        if sn is None or truthy(r['is_spare']):
            continue
        use[r['part_num']][int(r['color_id'])].add(sn)

    mapping, ambiguous = {}, {}
    for pn in sorted(set(use) | set(parts)):
        cands = identity_candidates(index, keyword_map, pn)
        if len(cands) == 1:
            mapping[pn] = next(iter(cands.items()))
        elif len(cands) > 1:
            ambiguous[pn] = sorted(cands)

    per_ld = defaultdict(lambda: {'rb': {}, 'colors': defaultdict(lambda: {'sets': set(), 'el': False, 'src': set()})})
    for pn, cols in use.items():
        if pn not in mapping:
            continue
        ld, reasons = mapping[pn]
        entry = per_ld[ld]
        entry['rb'][pn] = reasons
        for col, sets in cols.items():
            c = entry['colors'][col]
            c['sets'] |= sets
            c['el'] = c['el'] or (pn, col) in elements
            c['src'].add(pn)

    def color_row(col, c):
        years = [set_year[s] for s in c['sets']]
        return [col, len(c['sets']), sum(1 for y in years if y >= RECENT_FROM), min(years), max(years), c['el'], sorted(c['src'])]

    out_parts = {}
    for ld in sorted(per_ld):
        e = per_ld[ld]
        alts = sorted({a for pn in e['rb'] for a in alternatives.get(pn, ())} - set(e['rb']))
        out_parts[ld] = {
            'rb': {pn: e['rb'][pn] for pn in sorted(e['rb'])},
            'alternatives': alts,
            'colors': [color_row(col, e['colors'][col]) for col in sorted(e['colors'])],
        }

    # Referenzmenge: Grundteil → {Sets ab RECENT_FROM}
    base_sets = defaultdict(set)
    for pn, cols in use.items():
        base = base_of(pn)
        if parts.get(base, ('', 0))[1] in EXCLUDED_CATS:
            continue
        for sets in cols.values():
            base_sets[base] |= {s for s in sets if set_year[s] >= RECENT_FROM}
    refset, ref_sets_ld, unmapped = {}, defaultdict(set), {}
    for base, sets in base_sets.items():
        if not sets:
            continue
        if base in mapping:
            ref_sets_ld[mapping[base][0]] |= sets
        else:
            unmapped[base] = len(sets)
    refset = {ld: len(s) for ld, s in sorted(ref_sets_ld.items())}
    return {
        'schema': SCHEMA,
        'note': 'NUR LOKAL. Abgeleitet aus Rebrickable-CSV-Dumps (Weitergabe ungeklärt). Nicht versionieren, nicht veröffentlichen.',
        'definition': {
            'recentFrom': RECENT_FROM,
            'excludedCategories': sorted(EXCLUDED_CATS),
            'identityReasons': list(IDENTITY_REASONS),
            'inventoryRule': 'je Set nur die neueste Inventarversion; Ersatzteile ausgeschlossen',
            'weight': 'Anzahl eindeutiger Sets ab %d, in denen das Grundteil vorkommt (Farben und Drucke gefaltet)' % RECENT_FROM,
            'refset': 'Grundteile aus Set-Inventaren ab %d, Drucke auf das Grundteil gefaltet, ohne Minifiguren-, Duplo-, '
                      'Technic-Mechanik-, Sticker-, Figuren- und Fremdsystem-Kategorien sowie biegsame Teile' % RECENT_FROM,
        },
        'counts': {'sets': len(latest), 'setsRecent': sum(1 for s in latest if set_year[s] >= RECENT_FROM),
                   'mapped': len(mapping), 'ambiguous': len(ambiguous)},
        'colors': {str(k): v for k, v in sorted(colors.items())},
        'parts': out_parts,
        'ambiguous': {k: v for k, v in sorted(ambiguous.items())},
        'refset': refset,
        'refsetUnmapped': {k: v for k, v in sorted(unmapped.items())},
    }


def main():
    raw_dir, index_path, out_path = sys.argv[1:4]
    with open(index_path, encoding='utf8') as fh:
        index = json.load(fh)['parts']
    result = build(raw_dir, index)
    with open(out_path, 'w', encoding='utf8', newline='\n') as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


if __name__ == '__main__':
    main()
