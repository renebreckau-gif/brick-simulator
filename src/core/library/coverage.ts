// Abdeckungsbericht der Teilebibliothek (05C.1), getrennt nach Ebenen:
//   Katalog → Geometrie → Anschlussdaten (je Quelle) → bereits prüfbare Verbindungen (Prüfkern).
// Zählbasis ist eine definierte Referenzmenge; Dateien, Unterteile und Drucke zählen nicht mit.
import { partMeta, definedPartIds } from '../connectivity/partMeta';
import type { Vec3 } from '../math';
import { families } from './classify';
import type { PartLibraryIndex } from './library';
import type { ConnectorSource, LibraryConnector } from './types';

/** LDraw-Kategorien außerhalb des allgemeinen Systembaus (analog zur Rebrickable-Referenzmenge). */
const NON_SYSTEM_CATEGORY = /^(sticker|minifig|technic|duplo|primo|quatro|znap|belville|scala|fabuland|figure|animal|string|hose|electric|train|pneumatic|moved|obsolete|znap|homemaker|baseplate)/i;

export interface RefSet {
  id: string;
  label: string;
  definition: string;
  ids: string[];
  /** Gewicht je Teil (z. B. Anzahl Sets); fehlt bei ungewichteten Mengen. */
  weight?: Record<string, number>;
  /** Teile der Referenz, die keiner LDraw-Datei zugeordnet werden konnten (Katalog-Lücke). */
  unmapped?: string[];
}

export interface LayerCount {
  n: number;
  of: number;
  /** gewichteter Anteil (nur bei gewichteten Referenzmengen) */
  weighted?: number;
}

export interface CoverageRow {
  refset: Omit<RefSet, 'ids' | 'weight' | 'unmapped'> & { size: number; unmapped: number };
  catalog: LayerCount;
  geometry: LayerCount;
  ldcad: LayerCount;
  bricknet: LayerCount;
  anyConnectors: LayerCount;
  bothConnectors: LayerCount;
  /** beide Quellen vorhanden und Noppen oben + Aufnahmen unten stimmen überein */
  bothAgree: LayerCount;
  checkable: LayerCount;
}

export function ldrawSystemRefSet(lib: PartLibraryIndex): RefSet {
  const ids = lib.ids().filter((id) => {
    const e = lib.parts[id];
    if (e.ty !== 'part') return false;
    if (NON_SYSTEM_CATEGORY.test(e.c ?? '')) return false;
    const fam = families(e);
    return !fam.includes('technic') && !fam.includes('minifig') && !fam.includes('sticker');
  });
  return {
    id: 'ldraw-system',
    label: 'LDraw-Systemteile',
    definition: 'Alle LDraw-Dateien vom Typ „Part“ ohne Drucke/Aufkleber, Umbenennungen, Aliase und versteckte Unterteile; ohne Minifiguren, Technic, Duplo, Figuren/Tiere und Fremdsysteme.',
    ids,
  };
}

export function rebrickableRefSet(lib: PartLibraryIndex): RefSet | null {
  const c = lib.colors;
  if (!c) return null;
  return {
    id: 'rebrickable-aktuell',
    label: `In Sets ab ${c.definition.recentFrom} verwendete Teile`,
    definition: c.definition.refset,
    ids: Object.keys(c.refset).map((id) => lib.canonical(id)),
    weight: Object.fromEntries(Object.entries(c.refset).map(([id, w]) => [lib.canonical(id), w])),
    unmapped: c.refsetUnmapped,
  };
}

const POS_TOL = 0.6;
const key = (p: Vec3) => `${Math.round(p[0] * 2) / 2},${Math.round(p[1] * 2) / 2},${Math.round(p[2] * 2) / 2}`;
const vertical = (a: Vec3) => Math.abs(Math.abs(a[1]) - 1) < 0.15;

function sameSet(a: Vec3[], b: Vec3[]): boolean {
  if (a.length !== b.length) return false;
  const used = new Set<number>();
  return a.every((p) => {
    const i = b.findIndex((q, j) => !used.has(j) && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= POS_TOL);
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}

type Cat = 'studs_up' | 'studs_side' | 'recv_bottom' | 'tubes' | 'underside_pins';
export const CAT_LABEL: Record<Cat, string> = {
  studs_up: 'Noppen oben', studs_side: 'Noppen seitlich', recv_bottom: 'Noppenaufnahmen unten', tubes: 'Röhren unten', underside_pins: 'Unterseitenstifte',
};

/** Gleiche Position nur einmal (LDCad definiert z. B. bei 3066 zwei Aufnahmeformen an derselben Stelle). */
function unique(pts: Vec3[]): Vec3[] {
  const seen = new Set<string>();
  return pts.filter((p) => !seen.has(key(p)) && !!seen.add(key(p)));
}

function sourcePoints(conns: LibraryConnector[], cat: Cat, src: ConnectorSource): Vec3[] | null {
  const pts = rawPoints(conns, cat, src);
  return pts ? unique(pts) : null;
}

function rawPoints(conns: LibraryConnector[], cat: Cat, src: ConnectorSource): Vec3[] | null {
  switch (cat) {
    case 'studs_up': return conns.filter((c) => c.cls === 'stud' && vertical(c.axis) && c.axis[1] < 0).map((c) => c.pos);
    case 'studs_side': return conns.filter((c) => c.cls === 'stud' && !vertical(c.axis)).map((c) => c.pos);
    case 'recv_bottom': return conns.filter((c) => c.cls === 'antistud' && vertical(c.axis) && c.raw !== 'hole:tube' && c.raw !== 'hole:post').map((c) => c.pos);
    case 'tubes': return src === 'bricknet' ? conns.filter((c) => c.raw === 'hole:tube').map((c) => c.pos) : null;
    case 'underside_pins': return src === 'bricknet' ? conns.filter((c) => c.raw === 'hole:post').map((c) => c.pos) : null;
  }
}

function metaPoints(id: string, cat: Cat): Vec3[] {
  const m = partMeta(id);
  if (!m) return [];
  const cs = m.connectors;
  switch (cat) {
    case 'studs_up': return cs.filter((c) => c.kind === 'stud' && vertical(c.axis) && c.axis[1] < 0).map((c) => c.position);
    case 'studs_side': return cs.filter((c) => c.kind === 'side_stud' || (c.kind === 'stud' && !vertical(c.axis))).map((c) => c.position);
    case 'recv_bottom': return cs.filter((c) => c.kind === 'antistud').map((c) => c.position);
    case 'tubes': return cs.filter((c) => c.kind === 'tube').map((c) => c.position);
    case 'underside_pins': return cs.filter((c) => c.kind === 'underside_pin').map((c) => c.position);
  }
}

export interface CrosscheckRow {
  id: string;
  /** aktuelle LDraw-Nummer, unter der die Anschlussquellen geführt werden (≠ id bei Umbenennung) */
  libraryId: string;
  cat: Cat;
  meta: number;
  ldcad: { n: number; match: boolean } | null;
  bricknet: { n: number; match: boolean } | null;
}

/** Vergleich der importierten Anschlüsse mit den handgepflegten, gegen LDraw geprüften Teil-Metadaten des Prüfkerns. */
export function crosscheckWithPartMeta(lib: PartLibraryIndex): CrosscheckRow[] {
  const rows: CrosscheckRow[] = [];
  for (const id of definedPartIds().sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const libraryId = lib.canonical(id);
    for (const cat of Object.keys(CAT_LABEL) as Cat[]) {
      const meta = metaPoints(id, cat);
      const res = (src: ConnectorSource) => {
        const conns = lib.connectors(libraryId, src);
        if (!conns) return null;
        const pts = sourcePoints(conns, cat, src);
        return pts ? { n: pts.length, match: sameSet(meta, pts) } : null;
      };
      const ldcad = res('ldcad');
      const bricknet = res('bricknet');
      if (meta.length === 0 && (ldcad?.n ?? 0) === 0 && (bricknet?.n ?? 0) === 0) continue;
      rows.push({ id, libraryId, cat, meta: meta.length, ldcad, bricknet });
    }
  }
  return rows;
}

/** Stimmen beide Quellen bei Noppen oben und Aufnahmen unten überein? null = mindestens eine Quelle ohne Daten. */
export function sourcesAgree(lib: PartLibraryIndex, id: string): boolean | null {
  const a = lib.connectors(id, 'ldcad');
  const b = lib.connectors(id, 'bricknet');
  if (!a || !b) return null;
  return (['studs_up', 'recv_bottom'] as Cat[]).every((cat) => sameSet(sourcePoints(a, cat, 'ldcad')!, sourcePoints(b, cat, 'bricknet')!));
}

export function coverage(lib: PartLibraryIndex, ref: RefSet): CoverageRow {
  const ids = [...new Set(ref.ids)];
  const unmapped = ref.unmapped?.length ?? 0;
  const w = ref.weight;
  const totalW = w ? ids.reduce((s, id) => s + (w[id] ?? 0), 0) : 0;
  const count = (pred: (id: string) => boolean, of = ids.length): LayerCount => {
    const hit = ids.filter(pred);
    const out: LayerCount = { n: hit.length, of };
    if (w && totalW > 0) out.weighted = hit.reduce((s, id) => s + (w[id] ?? 0), 0) / totalW;
    return out;
  };
  const inCatalog = (id: string) => { const e = lib.entry(id); return !!e && (e.ty === 'part' || e.ty === 'shortcut'); };
  return {
    refset: { id: ref.id, label: ref.label, definition: ref.definition, size: ids.length, unmapped },
    catalog: { n: ids.filter(inCatalog).length, of: ids.length + unmapped },
    geometry: count((id) => { const e = lib.entry(id); return !!e?.bb && !e.gm; }),
    ldcad: count((id) => !!lib.connectors(id, 'ldcad')),
    bricknet: count((id) => !!lib.connectors(id, 'bricknet')),
    anyConnectors: count((id) => !!(lib.connectors(id, 'ldcad') || lib.connectors(id, 'bricknet'))),
    bothConnectors: count((id) => !!(lib.connectors(id, 'ldcad') && lib.connectors(id, 'bricknet'))),
    bothAgree: count((id) => sourcesAgree(lib, id) === true),
    checkable: count((id) => lib.validatorKnows(id)),
  };
}
