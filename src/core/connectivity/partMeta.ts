// Eigene, versionierte Teil-Metadaten: Anschlusspunkte und Kollisionsvolumen.
//
// Herkunft: parametrisch aus dem Teiltyp (Raster 20 LDU, Steinhöhe 24, Plattenhöhe 8)
// abgeleitet und per Test gegen die LDraw-Geometrie abgeglichen
// (tests/part-meta-crosscheck.test.ts: Körper ↔ Begrenzungsbox, Noppen ↔ stud*.dat,
// Röhren ↔ stud4.dat). LDraw selbst enthält KEINE Anschlussdaten.
import type { Box, Vec3 } from '../math';
import { prismContains, type Prism } from '../validation/solids';
import { BRICK_HEIGHT, LDU_PER_STUD, PLATE_HEIGHT, STUD_DIAMETER, STUD_HEIGHT } from '../units';
import type { ConnectorKind } from './rules';

export const PART_META_VERSION = 'part-meta@1.3.0';

export type SupportLevel = 'supported' | 'partial' | 'unsupported';
export type PartFamily = 'brick' | 'plate' | 'tile' | 'jumper' | 'technic_brick' | 'special_brick' | 'cone' | 'bar' | 'slope' | 'wedge_plate' | 'inverse_slope' | 'windscreen';

export interface ConnectorDef {
  id: string;
  kind: ConnectorKind;
  /** Lokale Position (LDU). Noppe: Mittelpunkt der Oberseite; Aufnahme/Röhre: Mittelpunkt der Unterseite. */
  position: Vec3;
  /** Lokale Richtung, in die der Anschluss „zeigt“ (Noppe nach oben = [0,-1,0]; Aufnahme öffnet nach unten = [0,1,0]). */
  axis: Vec3;
  /** Hohlnoppe (LDraw stud2.dat): kann zusätzlich einen Unterseitenstift/eine Stange aufnehmen. */
  hollow?: boolean;
  /**
   * Aus LDraw abgeleitete Maße (LDU) für Sonderverbindungen. Nur gesetzt, wo per Test gegen die
   * LDraw-Primitive abgeglichen (tests/part-meta-crosscheck.test.ts).
   */
  geometry?: ConnectorGeometry;
}

export interface ConnectorGeometry {
  /** Unterseitenstift: Radius und Länge (vom Teilboden aufwärts). */
  pinRadius?: number;
  pinLength?: number;
  /** Hohlraum um den Stift: halbe lichte Weite quer zur Achse (lokal x, z) und Tiefe ab Teilboden. */
  cavityHalfWidth?: [number, number];
  cavityDepth?: number;
  /** Hohlnoppe: Lochradius, Lochtiefe (ab Noppenoberkante), Außenradius der Noppenwand. */
  holeRadius?: number;
  holeDepth?: number;
  outerRadius?: number;
  /** Herkunft der Maße. */
  source: string;
}

export interface PartMeta {
  ldrawId: string;
  family: PartFamily;
  support: SupportLevel;
  size?: { studsX: number; studsZ: number; height: number };
  /** Massive Körpervolumen (ohne Noppen), achsparallel. */
  bodyBoxes: Box[];
  /**
   * Exakte konvexe Körper (05B.1) für Teile, die keine Quader sind (Schrägsteine, Keilplatten). Sind sie
   * gesetzt, prüft die Kollision mit ihnen statt mit Quadern; bodyBoxes bleibt dann leer.
   */
  bodyPrisms?: Prism[];
  /**
   * Konvexe Körper als Punktmengen (05B.2) für Formen mit gerundeten Kanten (z. B. Windschutzscheibe 2437): je
   * Teilbereich die konvexe Hülle der LDraw-Ecken; geprüft wie die Prismen (tests/part-meta-shaped.test.ts).
   */
  bodyHulls?: Vec3[][];
  /** Formangaben für die Teileauswahl der Konstruktion (05B.1); aus der LDraw-Geometrie abgelesen. */
  shape?: ShapeInfo;
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

/**
 * Formangaben für die Konstruktion. Lokales LDraw-System: Noppen oben (−y), Schräge fällt nach −z ab.
 * slope: flatRows Noppenreihen oben flach (mit Noppen), dann Gefälle über slopeRows Reihen bis zur Kante (lipLDU).
 * wedge: Plattenkeil, eine Längskante gerade, die andere läuft zur −z-Spitze hin zu (Breite an der Spitze tipLDU).
 */
export type ShapeInfo =
  | { kind: 'slope'; angleDeg: number; flatRows: number; slopeRows: number; lipLDU: number; descendsTo: '-z' }
  | { kind: 'wedge'; taperSide: '-x' | '+x'; narrowEnd: '-z'; wideLDU: number; tipLDU: number; lengthLDU: number };

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

/** Ergänzt abgeleitete Maße an allen Anschlüssen einer Art. */
function withGeometry(meta: PartMeta, kind: ConnectorKind, geometry: ConnectorGeometry): PartMeta {
  for (const c of meta.connectors) if (c.kind === kind) c.geometry = geometry;
  return meta;
}

const B = BRICK_HEIGHT;
const P = PLATE_HEIGHT;

/** Unterseiten-Aufnahmen: Rasterpunkte, an denen ein Noppenkreis (r = 6 LDU) vollständig unter dem Körper liegt. */
function antistudsInside(prisms: Prism[], points: [number, number][], height: number): [number, number][] {
  const r = STUD_DIAMETER / 2;
  const inside = (x: number, z: number) => prisms.some((pr) => prismContains(pr, [x, height - 0.01, z], 1e-6));
  return points.filter(([x, z]) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7071, r * 0.7071], [-r * 0.7071, r * 0.7071], [r * 0.7071, -r * 0.7071], [-r * 0.7071, -r * 0.7071]].every(([dx, dz]) => inside(x + dx, z + dz)));
}

interface ShapedSpec {
  id: string;
  family: 'slope' | 'wedge_plate';
  studsX: number;
  studsZ: number;
  height: number;
  prisms: Prism[];
  studs: [number, number][];
  /** Kandidaten für Unterseiten-Aufnahmen (werden gegen die Körperkontur geprüft). */
  gridUnder: [number, number][];
  upins?: [number, number][];
  shape: ShapeInfo;
  note: string;
}

function shaped(spec: ShapedSpec): PartMeta {
  const connectors: ConnectorDef[] = [];
  for (const [x, z] of spec.studs) connectors.push({ id: `stud@${x},${z}`, kind: 'stud', position: [x, 0, z], axis: UP });
  for (const [x, z] of antistudsInside(spec.prisms, spec.gridUnder, spec.height)) connectors.push({ id: `antistud@${x},${z}`, kind: 'antistud', position: [x, spec.height, z], axis: DOWN });
  for (const [x, z] of spec.upins ?? []) connectors.push({ id: `upin@${x},${z}`, kind: 'underside_pin', position: [x, spec.height, z], axis: DOWN });
  return {
    ldrawId: spec.id, family: spec.family, support: 'supported',
    size: { studsX: spec.studsX, studsZ: spec.studsZ, height: spec.height },
    bodyBoxes: [], bodyPrisms: spec.prisms, shape: spec.shape, connectors, unsupportedFeatures: [], approximateVolume: false,
    provenance: { method: 'parametric', verification: 'ldraw-primitive-crosscheck', note: spec.note },
  };
}

/** Rasterpunkte (Mitte je Noppenfeld) für ein Teil mit sx × sz Feldern um den Ursprung, verschoben um (ox, oz). */
const cells = (sx: number, sz: number, ox = 0, oz = 0): [number, number][] => grid(sx).flatMap((x) => grid(sz).map((z) => [x + ox, z + oz] as [number, number]));

/**
 * Schrägstein: Querschnitt in der y-z-Ebene (y nach unten): oben flach von z = +10 bis zur Schrägkante,
 * Schräge bis zur Lippe (4 LDU) an der Vorderkante −z. Werte aus der LDraw-Geometrie (Ebenen der Schrägflächen).
 */
function slopePrism(widthStuds: number, frontZ: number, slopeStartZ: number, height = B, lip = 4): Prism {
  const hx = (widthStuds * LDU_PER_STUD) / 2;
  return { axis: 0, polygon: [[0, 10], [0, slopeStartZ], [height - lip, frontZ], [height, frontZ], [height, 10]], lo: -hx, hi: hx };
}

/** Keilplatte: Grundriss in der z-x-Ebene, Spitze bei −z; taper '-x' = schräge Kante auf der −x-Seite. */
function wedgePrism(lengthStuds: number, taperSide: '-x' | '+x', tipX: number): Prism {
  const hz = (lengthStuds * LDU_PER_STUD) / 2;
  const s = taperSide === '-x' ? 1 : -1; // Spiegelung für die linke Variante
  return { axis: 1, polygon: [[hz, 20 * s], [-hz, 20 * s], [-hz, tipX * s], [hz, -20 * s]], lo: 0, hi: P };
}

interface SolidSpec {
  id: string;
  family: PartFamily;
  studsX: number;
  studsZ: number;
  height: number;
  prisms?: Prism[];
  hulls?: Vec3[][];
  studs: { x: number; z: number; hollow?: boolean }[];
  /** Unterseiten-Aufnahmen ausdrücklich (aus der LDraw-Unterseite abgelesen, im Test als Sollwert geprüft). */
  antistuds: [number, number][];
  upins?: [number, number][];
  note: string;
}

/** Formteil mit ausdrücklich angegebenen Anschlüssen und Prismen- bzw. Hüllkörpern (05B.2). */
function solidPart(spec: SolidSpec): PartMeta {
  const connectors: ConnectorDef[] = [];
  for (const st of spec.studs) connectors.push({ id: `stud@${st.x},${st.z}`, kind: 'stud', position: [st.x, 0, st.z], axis: UP, hollow: st.hollow });
  for (const [x, z] of spec.antistuds) connectors.push({ id: `antistud@${x},${z}`, kind: 'antistud', position: [x, spec.height, z], axis: DOWN });
  for (const [x, z] of spec.upins ?? []) connectors.push({ id: `upin@${x},${z}`, kind: 'underside_pin', position: [x, spec.height, z], axis: DOWN });
  return {
    ldrawId: spec.id, family: spec.family, support: 'supported',
    size: { studsX: spec.studsX, studsZ: spec.studsZ, height: spec.height },
    bodyBoxes: [], bodyPrisms: spec.prisms, bodyHulls: spec.hulls, connectors, unsupportedFeatures: [], approximateVolume: false,
    provenance: { method: 'parametric', verification: 'ldraw-primitive-crosscheck', note: spec.note },
  };
}

/** Windschutzscheibe 2437: Teilbereiche als konvexe Hüllen der LDraw-Ecken (Skript-Auszug, im Test gegengeprüft). */
const HULLS_2437: Vec3[][] = [
  // Leiste vorn unten (mit gerundeten Ecken r 10)
  [[-36, 24, -10], [36, 24, -10], [36, 32, -10], [-36, 32, -10], [30, 32, -30], [-30, 32, -30], [30, 24, -30], [-30, 24, -30], [40, 32, -20], [-40, 32, -20], [-39.24, 32, -23.83], [-37.07, 32, -27.07], [-33.83, 32, -29.24], [39.24, 32, -23.83], [37.07, 32, -27.07], [33.83, 32, -29.24], [33.83, 24, -29.24], [37.07, 24, -27.07], [39.24, 24, -23.83], [40, 24, -20], [-33.83, 24, -29.24], [-37.07, 24, -27.07], [-39.24, 24, -23.83], [-40, 24, -20]],
  // schräge Scheibe (4 LDU stark)
  [[30, 24, -30], [-30, 24, -30], [30, 24, -26], [30, 4, -9.33], [-30, 24, -26], [-30, 4, -9.33], [30, 0, -10], [-30, 0, -10]],
  // Dachsteg mit den beiden Hohlnoppen
  [[35.54, 4, -5.63], [36, 4, -3.33], [34.24, 4, -7.57], [32.3, 4, -8.87], [30, 4, -9.33], [-35.54, 4, -5.63], [-36, 4, -3.33], [-34.24, 4, -7.57], [-32.3, 4, -8.87], [-30, 4, -9.33], [36, 4, 10], [-36, 4, 10], [36, 0, 10], [-36, 0, 10], [39.24, 0, -3.83], [33.83, 0, -9.24], [30, 0, -10], [40, 0, 0], [37.07, 0, -7.07], [-39.24, 0, -3.83], [-33.83, 0, -9.24], [-30, 0, -10], [-40, 0, 0], [-37.07, 0, -7.07]],
  // Seitenwangen (4 LDU stark, volle Höhe, hinten offen)
  [[36, 32, -20], [36, 24, -20], [36, 32, 30], [40, 0, 30], [40, 32, 30], [36, 0, 30], [40, 32, -20], [39.24, 0, -3.83], [40, 0, 0], [37.07, 0, -7.07], [36, 0, 0], [40, 24, -20]],
  [[-36, 32, -20], [-36, 24, -20], [-36, 32, 30], [-36, 0, 30], [-40, 32, 30], [-40, 0, 30], [-40, 32, -20], [-39.24, 0, -3.83], [-40, 0, 0], [-37.07, 0, -7.07], [-36, 0, 0], [-40, 24, -20]],
  // Rundung Scheibe ↔ Seitenwange
  [[36, 24, -10], [36, 24, -20], [30, 24, -30], [35.54, 24, -22.3], [30, 24, -26], [33.83, 0, -9.24], [30, 0, -10], [34, 0, 0], [30, 0, -4], [36, 0, 0], [35.54, 0, -2.3], [33.83, 24, -29.24]],
  [[-36, 24, -10], [-36, 24, -20], [-30, 24, -30], [-35.54, 24, -22.3], [-30, 24, -26], [-33.83, 0, -9.24], [-30, 0, -10], [-34, 0, 0], [-30, 0, -4], [-36, 0, 0], [-35.54, 0, -2.3], [-33.83, 24, -29.24]],
];

/** Unterstützte und teilunterstützte Teile (Phase 1). Maße: studsX entlang lokaler X-Achse. */
const DEFINED: PartMeta[] = [
  rect({ id: '3001', family: 'brick', sx: 4, sz: 2, height: B, top: 'grid' }),
  rect({ id: '3002', family: 'brick', sx: 3, sz: 2, height: B, top: 'grid' }),
  rect({ id: '3003', family: 'brick', sx: 2, sz: 2, height: B, top: 'grid' }),
  withGeometry(rect({ id: '3004', family: 'brick', sx: 2, sz: 1, height: B, top: 'grid' }), 'underside_pin', {
    pinRadius: 4,
    pinLength: 20,
    cavityHalfWidth: [16, 6],
    cavityDepth: 20,
    source: 'LDraw s/3004s01.dat: stud3.dat (r 4) von y 4 bis 24; Hohlraum box5.dat (INVERTNEXT) x ±16, z ±6, y 4–24',
  }),
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
  withGeometry(
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
    'bar_holder',
    { holeRadius: 4, holeDepth: 4, outerRadius: 6, source: 'LDraw p/stud2.dat: Wand r 6, Loch r 4 (INVERTNEXT 4-4cyli), Lochtiefe 4 bis zur Teiloberseite (rect.dat bei y 0 in 6541.dat)' },
  ),
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
  // ---- Konstruktionsnachweis 05B.1: Platten im Rechteckraster
  rect({ id: '3020', family: 'plate', sx: 4, sz: 2, height: P, top: 'grid' }),
  rect({ id: '3021', family: 'plate', sx: 3, sz: 2, height: P, top: 'grid' }),
  rect({ id: '3022', family: 'plate', sx: 2, sz: 2, height: P, top: 'grid' }),
  rect({ id: '3710', family: 'plate', sx: 4, sz: 1, height: P, top: 'grid' }),
  rect({ id: '3666', family: 'plate', sx: 6, sz: 1, height: P, top: 'grid' }),
  rect({ id: '3795', family: 'plate', sx: 6, sz: 2, height: P, top: 'grid' }),
  // ---- Konstruktionsnachweis 05B.2: Bodenplatte über 8 Noppen, Fliese, Steine ohne Unterseitenröhre (Glasseiten)
  rect({ id: '3034', family: 'plate', sx: 8, sz: 2, height: P, top: 'grid' }),
  rect({ id: '3068b', family: 'tile', sx: 2, sz: 2, height: P, top: 'none' }),
  rect({ id: '3065', family: 'brick', sx: 2, sz: 1, height: B, top: 'grid', noUndersidePins: true, note: 'Stein 1×2 ohne Unterseitenstift (LDraw: kein stud3); Aufnahmen im Raster.' }),
  rect({ id: '3066', family: 'brick', sx: 4, sz: 1, height: B, top: 'grid', noUndersidePins: true, note: 'Stein 1×4 ohne Unterseitenstifte (LDraw: kein stud3); Aufnahmen im Raster.' }),
  // ---- Schrägsteine (Geometrie s. tests/part-meta-shaped.test.ts); Röhren der Schrägen (stud4a, verkürzt) nicht als Anschluss gewertet
  shaped({
    id: '3039', family: 'slope', studsX: 2, studsZ: 2, height: B, prisms: [slopePrism(2, -30, -10)], studs: [[-10, 0], [10, 0]], gridUnder: cells(2, 2, 0, -10),
    shape: { kind: 'slope', angleDeg: 45, flatRows: 1, slopeRows: 1, lipLDU: 4, descendsTo: '-z' },
    note: 'Schrägstein 45° 2×2: Schrägfläche y = −10 − z (LDraw-Ebene n = (0, 0,71, 0,71)), Lippe 4 LDU; Noppen nur in der hinteren Reihe.',
  }),
  shaped({
    id: '3298', family: 'slope', studsX: 2, studsZ: 3, height: B, prisms: [slopePrism(2, -50, -10)], studs: [[-10, 0], [10, 0]], gridUnder: cells(2, 3, 0, -20),
    shape: { kind: 'slope', angleDeg: 33, flatRows: 1, slopeRows: 2, lipLDU: 4, descendsTo: '-z' },
    note: 'Schrägstein 33° 3×2: Schrägfläche y = −5 − z/2 (LDraw-Ebene n = (0, 0,89, 0,45)), Lippe 4 LDU.',
  }),
  shaped({
    id: '4286', family: 'slope', studsX: 1, studsZ: 3, height: B, prisms: [slopePrism(1, -50, -10)], studs: [[0, 0]], gridUnder: cells(1, 3, 0, -20), upins: [[0, -30]],
    shape: { kind: 'slope', angleDeg: 33, flatRows: 1, slopeRows: 2, lipLDU: 4, descendsTo: '-z' },
    note: 'Schrägstein 33° 3×1: Schräge wie 3298; ein Unterseitenstift (stud3a) bei z = −30.',
  }),
  // ---- Keilplatten (Ausgabe „a“ der LDraw-Bibliothek; 41769/41770/43722/43723 sind Weiterleitungen)
  shaped({
    id: '41769a', family: 'wedge_plate', studsX: 2, studsZ: 4, height: P, prisms: [wedgePrism(4, '-x', 0)], studs: [[10, -30], [10, -10], [10, 10], [10, 30]], gridUnder: cells(2, 4),
    shape: { kind: 'wedge', taperSide: '-x', narrowEnd: '-z', wideLDU: 40, tipLDU: 20, lengthLDU: 80 },
    note: 'Keilplatte 4×2 rechts: gerade Kante +x, schräge Kante von (x −20, z 40) bis (x 0, z −40) (LDraw-Ebene n = (0,97, 0, 0,24)); Noppen nur in der vollen Reihe.',
  }),
  shaped({
    id: '41770a', family: 'wedge_plate', studsX: 2, studsZ: 4, height: P, prisms: [wedgePrism(4, '+x', 0)], studs: [[-10, -30], [-10, -10], [-10, 10], [-10, 30]], gridUnder: cells(2, 4),
    shape: { kind: 'wedge', taperSide: '+x', narrowEnd: '-z', wideLDU: 40, tipLDU: 20, lengthLDU: 80 },
    note: 'Keilplatte 4×2 links: Spiegelbild von 41769a.',
  }),
  shaped({
    id: '43722a', family: 'wedge_plate', studsX: 2, studsZ: 3, height: P, prisms: [wedgePrism(3, '-x', 0)], studs: [[10, -20], [10, 0], [10, 20]], gridUnder: cells(2, 3),
    shape: { kind: 'wedge', taperSide: '-x', narrowEnd: '-z', wideLDU: 40, tipLDU: 20, lengthLDU: 60 },
    note: 'Keilplatte 3×2 rechts: schräge Kante von (x −20, z 30) bis (x 0, z −30) (LDraw-Ebene n = (0,95, 0, 0,32)).',
  }),
  shaped({
    id: '43723a', family: 'wedge_plate', studsX: 2, studsZ: 3, height: P, prisms: [wedgePrism(3, '+x', 0)], studs: [[-10, -20], [-10, 0], [-10, 20]], gridUnder: cells(2, 3),
    shape: { kind: 'wedge', taperSide: '+x', narrowEnd: '-z', wideLDU: 40, tipLDU: 20, lengthLDU: 60 },
    note: 'Keilplatte 3×2 links: Spiegelbild von 43722a.',
  }),
  // ---- 05B.2: Keilsteine (Grundriss wie die Keilplatten 41769a/41770a, Steinhöhe) für die Bugkontur in Steinlagen
  shaped({
    id: '41767', family: 'wedge_plate', studsX: 2, studsZ: 4, height: B, prisms: [{ ...wedgePrism(4, '-x', 0), hi: B }], studs: [[10, -30], [10, -10], [10, 10], [10, 30]], gridUnder: cells(2, 4),
    shape: { kind: 'wedge', taperSide: '-x', narrowEnd: '-z', wideLDU: 40, tipLDU: 20, lengthLDU: 80 },
    note: 'Keilstein 4×2 rechts: Grundriss wie Keilplatte 41769a, 1 Steinhöhe; Noppen nur in der vollen Reihe (x = +10).',
  }),
  shaped({
    id: '41768', family: 'wedge_plate', studsX: 2, studsZ: 4, height: B, prisms: [{ ...wedgePrism(4, '+x', 0), hi: B }], studs: [[-10, -30], [-10, -10], [-10, 10], [-10, 30]], gridUnder: cells(2, 4),
    shape: { kind: 'wedge', taperSide: '+x', narrowEnd: '-z', wideLDU: 40, tipLDU: 20, lengthLDU: 80 },
    note: 'Keilstein 4×2 links: Spiegelbild von 41767.',
  }),
  // ---- 05B.2: inverser Schrägstein und Windschutzscheibe
  solidPart({
    id: '3747b', family: 'inverse_slope', studsX: 2, studsZ: 3, height: B,
    prisms: [{ axis: 0, polygon: [[0, 10], [24, 10], [24, -10], [3, -50], [0, -50]], lo: -20, hi: 20 }],
    studs: [{ x: -10, z: 0 }, { x: 10, z: 0 }, { x: -10, z: -20 }, { x: 10, z: -20 }, { x: -10, z: -40 }, { x: 10, z: -40 }],
    antistuds: [[-10, 0], [10, 0]],
    note: 'Inverser Schrägstein 33° 3×2: Unterseite flach nur in der hinteren Reihe (z −10…10), Schrägfläche 0,885 y − 0,465 z = 25,9 bis zur Lippe (y 0…3 bei z −50); ovaler Unterseitenstift nicht als Anschluss gewertet.',
  }),
  solidPart({
    id: '2437', family: 'windscreen', studsX: 4, studsZ: 3, height: 32,
    hulls: HULLS_2437,
    studs: [{ x: -30, z: 0, hollow: true }, { x: 30, z: 0, hollow: true }],
    antistuds: [[-30, -20], [-10, -20], [10, -20], [30, -20]],
    upins: [[-20, -20], [0, -20], [20, -20]],
    note: 'Windschutzscheibe 3×4×1⅓: vordere Leiste (z −30…−10) mit Unterseitenstiften zwischen vier Aufnahmen, schräge Scheibe bis zum Dachsteg (y 0…4) mit zwei Hohlnoppen, Seitenwangen; unten hinter der Leiste und hinten offen.',
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
