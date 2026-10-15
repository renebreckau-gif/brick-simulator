// Eigene, versionierte Teil-Metadaten: Anschlusspunkte und Kollisionsvolumen.
//
// Herkunft: parametrisch aus dem Teiltyp (Raster 20 LDU, Steinhöhe 24, Plattenhöhe 8)
// abgeleitet und per Test gegen die LDraw-Geometrie abgeglichen
// (tests/part-meta-crosscheck.test.ts: Körper ↔ Begrenzungsbox, Noppen ↔ stud*.dat,
// Röhren ↔ stud4.dat). LDraw selbst enthält KEINE Anschlussdaten.
import type { Box, Vec3 } from '../math';
import { BRICK_HEIGHT, LDU_PER_STUD, PLATE_HEIGHT, STUD_DIAMETER, STUD_HEIGHT } from '../units';
import type { ConnectorKind } from './rules';

export const PART_META_VERSION = 'part-meta@1.0.0';

export type SupportLevel = 'supported' | 'partial' | 'unsupported';
export type PartFamily = 'brick' | 'plate' | 'tile' | 'jumper' | 'technic_brick' | 'special_brick' | 'cone' | 'bar';

export interface ConnectorDef {
  id: string;
  kind: ConnectorKind;
  /** Lokale Position (LDU). Noppe: Mittelpunkt der Oberseite; Aufnahme/Röhre: Mittelpunkt der Unterseite. */
  position: Vec3;
  /** Lokale Richtung, in die der Anschluss „zeigt“ (Noppe nach oben = [0,-1,0]; Aufnahme öffnet nach unten = [0,1,0]). */
  axis: Vec3;
  /** Hohlnoppe (LDraw stud2.dat): kann zusätzlich einen Unterseitenstift/eine Stange aufnehmen. */
  hollow?: boolean;
}

export interface PartMeta {
  ldrawId: string;
  family: PartFamily;
  support: SupportLevel;
  size?: { studsX: number; studsZ: number; height: number };
  /** Massive Körpervolumen (ohne Noppen). */
  bodyBoxes: Box[];
  connectors: ConnectorDef[];
  /** Merkmale, deren Regeln nicht implementiert sind (sichtbar als „nicht unterstützt“). */
  unsupportedFeatures: string[];
  /** true, wenn das Kollisionsvolumen nur eine grobe Hülle ist (dann Kollisionen „ungeprüft“). */
  approximateVolume: boolean;
  provenance: {
    method: 'parametric' | 'ldraw-bbox';
    verification: 'ldraw-primitive-crosscheck' | 'none';
    note: string;
  };
}

const UP: Vec3 = [0, -1, 0];
const DOWN: Vec3 = [0, 1, 0];

function grid(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * LDU_PER_STUD);
}

interface RectSpec {
  id: string;
  family: PartFamily;
  sx: number;
  sz: number;
  height: number;
  top: 'grid' | 'center' | 'none';
  hollowStuds?: boolean;
  /** Unterseitenstifte (1×N) weglassen, wenn die LDraw-Geometrie keine zeigt. */
  noUndersidePins?: boolean;
  support?: SupportLevel;
  extraConnectors?: ConnectorDef[];
  unsupportedFeatures?: string[];
  note?: string;
}

function rect(spec: RectSpec): PartMeta {
  const hx = (spec.sx * LDU_PER_STUD) / 2;
  const hz = (spec.sz * LDU_PER_STUD) / 2;
  const connectors: ConnectorDef[] = [];
  const xs = grid(spec.sx);
  const zs = grid(spec.sz);
  const studAt = (x: number, z: number) => {
    connectors.push({ id: `stud@${x},${z}`, kind: 'stud', position: [x, 0, z], axis: UP, hollow: spec.hollowStuds });
    if (spec.hollowStuds) connectors.push({ id: `holder@${x},${z}`, kind: 'bar_holder', position: [x, 0, z], axis: UP });
  };
  if (spec.top === 'grid') for (const x of xs) for (const z of zs) studAt(x, z);
  if (spec.top === 'center') studAt(0, 0);
  for (const x of xs) for (const z of zs) connectors.push({ id: `antistud@${x},${z}`, kind: 'antistud', position: [x, spec.height, z], axis: DOWN });
  if (spec.sx >= 2 && spec.sz >= 2)
    for (const x of grid(spec.sx - 1)) for (const z of grid(spec.sz - 1)) connectors.push({ id: `tube@${x},${z}`, kind: 'tube', position: [x, spec.height, z], axis: DOWN });
  // 1×N-Teile (N ≥ 2): Unterseitenstifte zwischen den Aufnahmen (LDraw stud3.dat)
  if (!spec.noUndersidePins && Math.min(spec.sx, spec.sz) === 1 && Math.max(spec.sx, spec.sz) >= 2) {
    const along = spec.sx > 1 ? grid(spec.sx - 1).map((x) => [x, 0]) : grid(spec.sz - 1).map((z) => [0, z]);
    for (const [x, z] of along) connectors.push({ id: `upin@${x},${z}`, kind: 'underside_pin', position: [x, spec.height, z], axis: DOWN });
  }
  connectors.push(...(spec.extraConnectors ?? []));
  return {
    ldrawId: spec.id,
    family: spec.family,
    support: spec.support ?? 'supported',
    size: { studsX: spec.sx, studsZ: spec.sz, height: spec.height },
    bodyBoxes: [{ min: [-hx, 0, -hz], max: [hx, spec.height, hz] }],
    connectors,
    unsupportedFeatures: spec.unsupportedFeatures ?? [],
    approximateVolume: false,
    provenance: {
      method: 'parametric',
      verification: 'ldraw-primitive-crosscheck',
      note: spec.note ?? 'Rechteckteil, Raster 20 LDU; Unterseite: Aufnahmen im Raster, Röhren an inneren Rasterkreuzungen (≥2×2), Unterseitenstifte zwischen den Aufnahmen (1×N).',
    },
  };
}

const B = BRICK_HEIGHT;
const P = PLATE_HEIGHT;

/** Unterstützte und teilunterstützte Teile (Phase 1). Maße: studsX entlang lokaler X-Achse. */
const DEFINED: PartMeta[] = [
  rect({ id: '3001', family: 'brick', sx: 4, sz: 2, height: B, top: 'grid' }),
  rect({ id: '3002', family: 'brick', sx: 3, sz: 2, height: B, top: 'grid' }),
  rect({ id: '3003', family: 'brick', sx: 2, sz: 2, height: B, top: 'grid' }),
  rect({ id: '3004', family: 'brick', sx: 2, sz: 1, height: B, top: 'grid' }),
  rect({ id: '3005', family: 'brick', sx: 1, sz: 1, height: B, top: 'grid' }),
  rect({ id: '3010', family: 'brick', sx: 4, sz: 1, height: B, top: 'grid' }),
  rect({ id: '3009', family: 'brick', sx: 6, sz: 1, height: B, top: 'grid' }),
  rect({ id: '2456', family: 'brick', sx: 6, sz: 2, height: B, top: 'grid' }),
  rect({ id: '3024', family: 'plate', sx: 1, sz: 1, height: P, top: 'grid' }),
  rect({ id: '3023', family: 'plate', sx: 2, sz: 1, height: P, top: 'grid', note: 'LDraw-Datei 3023.dat ist eine Weiterleitung (~Moved to 3023b); Geometrie aus 3023b.' }),
  rect({ id: '3032', family: 'plate', sx: 6, sz: 4, height: P, top: 'grid' }),
  rect({ id: '3030', family: 'plate', sx: 10, sz: 4, height: P, top: 'grid' }),
  rect({ id: '3070b', family: 'tile', sx: 1, sz: 1, height: P, top: 'none' }),
  rect({ id: '3069b', family: 'tile', sx: 2, sz: 1, height: P, top: 'none', noUndersidePins: true, note: 'LDraw-Geometrie (s/3069bs01.dat) zeigt keinen Unterseitenstift; daher keiner modelliert (reales Teil nicht unabhängig geprüft).' }),
  rect({ id: '6636', family: 'tile', sx: 6, sz: 1, height: P, top: 'none' }),
  rect({ id: '4162', family: 'tile', sx: 8, sz: 1, height: P, top: 'none' }),
  rect({ id: '4162p0b', family: 'tile', sx: 8, sz: 1, height: P, top: 'none', note: 'Bedruckte Variante von 4162; gleiche Form.' }),
  rect({ id: '3794a', family: 'jumper', sx: 2, sz: 1, height: P, top: 'center', hollowStuds: true, note: 'Jumper: eine Hohlnoppe mittig (Halbnoppenversatz), Unterseite wie Platte 1×2.' }),
  rect({
    id: '6541',
    family: 'technic_brick',
    sx: 1,
    sz: 1,
    height: B,
    top: 'grid',
    hollowStuds: true,
    support: 'partial',
    extraConnectors: [
      { id: 'pinhole+z', kind: 'technic_pin_hole', position: [0, 10, 10], axis: [0, 0, 1] },
      { id: 'pinhole-z', kind: 'technic_pin_hole', position: [0, 10, -10], axis: [0, 0, -1] },
    ],
    unsupportedFeatures: ['Technic-Pinloch (lokale Z-Achse)'],
    note: 'Noppe/Aufnahme unterstützt; Pinloch nur deklariert (Regel R-PIN-HOLE nicht implementiert).',
  }),
  rect({
    id: '2458',
    family: 'special_brick',
    sx: 2,
    sz: 1,
    height: B,
    top: 'grid',
    support: 'partial',
    extraConnectors: [{ id: 'pin-z', kind: 'technic_pin', position: [0, 10, -10], axis: [0, 0, -1] }],
    unsupportedFeatures: ['Technic-Pin seitlich (lokale −Z-Richtung); Pinvolumen nicht im Kollisionsmodell'],
    note: 'Körper wie 3004; Pin nur deklariert (Regel R-PIN-HOLE nicht implementiert).',
  }),
];

const BY_ID = new Map(DEFINED.map((m) => [m.ldrawId, m]));

export function partMeta(ldrawId: string): PartMeta | undefined {
  return BY_ID.get(ldrawId.toLowerCase());
}

export function definedPartIds(): string[] {
  return [...BY_ID.keys()];
}

/** Grobe Hülle für Teile ohne eigene Metadaten (z. B. 59900, 30374): Kollisionen sind dann „ungeprüft“. */
export function unsupportedMetaFromBBox(ldrawId: string, family: PartFamily, bbox: Box | null, reason: string): PartMeta {
  return {
    ldrawId,
    family,
    support: 'unsupported',
    bodyBoxes: bbox ? [bbox] : [],
    connectors: [],
    unsupportedFeatures: [reason],
    approximateVolume: true,
    provenance: { method: 'ldraw-bbox', verification: 'none', note: 'Begrenzungsbox der LDraw-Geometrie; keine Anschlussregeln.' },
  };
}

/** Noppenvolumen (achsparallele Näherung des Zylinders) für eine lokale Noppe. */
export function studBox(c: ConnectorDef): Box {
  const r = STUD_DIAMETER / 2;
  const [x, y, z] = c.position;
  // Noppe ragt entlang der Achse STUD_HEIGHT aus der Fläche
  const tip: Vec3 = [x + c.axis[0] * STUD_HEIGHT, y + c.axis[1] * STUD_HEIGHT, z + c.axis[2] * STUD_HEIGHT];
  const min: Vec3 = [Math.min(x, tip[0]), Math.min(y, tip[1]), Math.min(z, tip[2])];
  const max: Vec3 = [Math.max(x, tip[0]), Math.max(y, tip[1]), Math.max(z, tip[2])];
  for (let i = 0; i < 3; i++) if (c.axis[i] === 0) { min[i] -= r; max[i] += r; }
  return { min, max };
}
