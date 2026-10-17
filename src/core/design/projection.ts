// Geometrie und Projektion des räumlichen Entwurfs (Auftrag 05B.0).
//
// Alle Ansichten – die frei drehbare 3D-Ansicht und die sechs orthografischen Ansichten – entstehen aus
// derselben Funktion bodyGeometry(). Es gibt keine getrennt erzeugten oder generierten Ansichten.
//
// Koordinatensystem des Objekts (rechtshändig): +x = vorn, +y = links (aus Sicht des Objekts),
// +z = oben. Einheit: Länge des Hauptkörpers = 1, auf allen drei Achsen derselbe Maßstab.
import type { SpatialBody, SpatialDesign, Vec3 } from './spatial';

export type V3 = [number, number, number];

const DEG = Math.PI / 180;

/** Drehmatrix R = Rz(yaw) · Ry(pitch) · Rx(roll), Winkel in Grad, rechte-Hand-Regel um die Objektachsen. */
export function rotationMatrix(r: { yaw: number; pitch: number; roll: number }): number[] {
  const [a, b, c] = [r.yaw * DEG, r.pitch * DEG, r.roll * DEG];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    ca * cb, ca * sb * sc - sa * cc, ca * sb * cc + sa * sc,
    sa * cb, sa * sb * sc + ca * cc, sa * sb * cc - ca * sc,
    -sb, cb * sc, cb * cc,
  ];
}

const mul = (m: number[], v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

export const CYLINDER_SEGMENTS = 20;

/**
 * Lokale Geometrie (vor Drehung und Verschiebung). Länge entlang lokal x, Breite entlang y, Höhe entlang z.
 * - box: Quader
 * - wedge: Keil – hinten volle Höhe, vorn Höhe = taper · Höhe (0 = scharfe Kante unten)
 * - taper: verjüngter Quader – Vorderfläche in Breite und Höhe um taper skaliert
 * - cylinder: Zylinder entlang lokal x mit elliptischem Querschnitt (Breite × Höhe); vorn Radius · taper
 * Alle Formen sind spiegelsymmetrisch zur lokalen x-z-Ebene; eine Links-rechts-Spiegelung ändert nur die Lage.
 */
export function localGeometry(b: Pick<SpatialBody, 'shape' | 'size' | 'taper'>): { vertices: V3[]; faces: number[][] } {
  const L = b.size.length / 2;
  const W = b.size.width / 2;
  const H = b.size.height / 2;
  const t = b.taper;
  if (b.shape === 'cylinder') {
    const n = CYLINDER_SEGMENTS;
    const vertices: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      vertices.push([-L, W * Math.cos(a), H * Math.sin(a)]);
    }
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      vertices.push([L, W * t * Math.cos(a), H * t * Math.sin(a)]);
    }
    const faces: number[][] = [];
    for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
    faces.push([...Array(n).keys()].reverse());
    faces.push([...Array(n).keys()].map((i) => n + i));
    return { vertices, faces };
  }
  const front = b.shape === 'taper' ? { w: W * t, zLo: -H * t, zHi: H * t } : b.shape === 'wedge' ? { w: W, zLo: -H, zHi: -H + 2 * H * t } : { w: W, zLo: -H, zHi: H };
  // 0–3 hinten (x = −L), 4–7 vorn (x = +L); Reihenfolge je Seite: unten rechts, unten links, oben links, oben rechts
  const vertices: V3[] = [
    [-L, -W, -H], [-L, W, -H], [-L, W, H], [-L, -W, H],
    [L, -front.w, front.zLo], [L, front.w, front.zLo], [L, front.w, front.zHi], [L, -front.w, front.zHi],
  ];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  return { vertices, faces };
}

/** Weltgeometrie eines Körpers: identisch für 3D-Ansicht und alle Projektionen. */
export function bodyGeometry(b: SpatialBody): { vertices: V3[]; faces: number[][] } {
  const { vertices, faces } = localGeometry(b);
  const R = rotationMatrix(b.rotation);
  const c = b.center;
  return { vertices: vertices.map((v) => { const r = mul(R, v); return [r[0] + c.x, r[1] + c.y, r[2] + c.z] as V3; }), faces };
}

export type ViewId = 'vorne' | 'hinten' | 'links' | 'rechts' | 'oben' | 'unten';

export interface ViewDef {
  id: ViewId;
  label: string;
  /** Bildschirmrichtungen im Objektsystem: u nach rechts, v nach oben; toCamera zeigt zum Betrachter. */
  right: V3;
  up: V3;
  toCamera: V3;
  /** Lesbare Achsbezeichnung für u (rechts) und v (oben). */
  axisRight: string;
  axisUp: string;
}

/**
 * Sechs orthografische Ansichten. Jede ist eine echte Drehung (right × up = toCamera), keine Spiegelung:
 * z. B. „Vorne“ = Blick von vorn auf die Front; die linke Objektseite (+y) erscheint dabei rechts.
 */
export const VIEWS: ViewDef[] = [
  { id: 'vorne', label: 'Vorne', right: [0, 1, 0], up: [0, 0, 1], toCamera: [1, 0, 0], axisRight: 'links (+y)', axisUp: 'oben (+z)' },
  { id: 'hinten', label: 'Hinten', right: [0, -1, 0], up: [0, 0, 1], toCamera: [-1, 0, 0], axisRight: 'rechts (−y)', axisUp: 'oben (+z)' },
  { id: 'links', label: 'Links', right: [-1, 0, 0], up: [0, 0, 1], toCamera: [0, 1, 0], axisRight: 'hinten (−x)', axisUp: 'oben (+z)' },
  { id: 'rechts', label: 'Rechts', right: [1, 0, 0], up: [0, 0, 1], toCamera: [0, -1, 0], axisRight: 'vorn (+x)', axisUp: 'oben (+z)' },
  { id: 'oben', label: 'Oben', right: [0, -1, 0], up: [1, 0, 0], toCamera: [0, 0, 1], axisRight: 'rechts (−y)', axisUp: 'vorn (+x)' },
  { id: 'unten', label: 'Unten', right: [0, 1, 0], up: [1, 0, 0], toCamera: [0, 0, -1], axisRight: 'links (+y)', axisUp: 'vorn (+x)' },
];
export const VIEW_BY_ID = Object.fromEntries(VIEWS.map((v) => [v.id, v])) as Record<ViewId, ViewDef>;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface Box2 { u0: number; u1: number; v0: number; v1: number }

/**
 * Projektion eines Körpers: nur Umriss und Ausdehnung (für Maßstab, Maße und Referenzabgleich).
 * Verdeckung entscheidet NICHT diese Datei, sondern der Tiefenpuffer je Bildpunkt (raster.ts) –
 * eine Reihenfolge ganzer Körper ist bei schrägen oder überlappenden Körpern falsch.
 */
export interface ProjectedBody {
  id: string;
  /** Konvexe Hülle der projizierten Ecken (u nach rechts, v nach oben). */
  hull: [number, number][];
  bbox: Box2;
}

function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const crossZ = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export const projectPoint = (p: V3, v: ViewDef): [number, number] => [dot(p, v.right), dot(p, v.up)];

export function projectBody(b: SpatialBody, view: ViewDef): ProjectedBody {
  const pts = bodyGeometry(b).vertices.map((p) => projectPoint(p, view));
  const us = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  return { id: b.id, hull: hull(pts), bbox: { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) } };
}

/** Projektion aller Körper in eine Ansicht (Reihenfolge wie im Entwurf; keine Aussage zur Verdeckung). */
export function projectDesign(d: Pick<SpatialDesign, 'bodies'>, view: ViewDef): ProjectedBody[] {
  return d.bodies.map((b) => projectBody(b, view));
}

/** Achsparallele Ausdehnung aller Körper im Objektsystem. */
export function modelBounds(d: Pick<SpatialDesign, 'bodies'>): { min: V3; max: V3; size: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const b of d.bodies) for (const p of bodyGeometry(b).vertices) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  if (!d.bodies.length) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

export interface ViewFrame {
  view: ViewDef;
  bodies: ProjectedBody[];
  /** Mittelpunkt der Modellausdehnung in dieser Ansicht (u, v). */
  center: [number, number];
}

/**
 * Gemeinsame Einpassung: EIN Maßstab (Bildpunkte je Längeneinheit) für alle sechs Ansichten – der größte,
 * bei dem das Modell in jedes Fenster passt. Keine Ansicht wird unabhängig auf ihr Fenster gestreckt.
 * Die Ausdehnung je Ansicht folgt aus der Modellausdehnung (Würfel um alle Körper), damit gleiche Maße
 * in allen Fenstern gleich lang erscheinen.
 */
export function sharedFrames(d: Pick<SpatialDesign, 'bodies'>, viewport: { width: number; height: number; margin: number }): { scale: number; frames: ViewFrame[] } {
  const bounds = modelBounds(d);
  const mid: V3 = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
  const frames = VIEWS.map((view) => ({ view, bodies: projectDesign(d, view), center: projectPoint(mid, view) }));
  let scale = Infinity;
  for (const view of VIEWS) {
    const extU = Math.abs(dot(bounds.size, view.right.map(Math.abs) as V3));
    const extV = Math.abs(dot(bounds.size, view.up.map(Math.abs) as V3));
    const s = Math.min((viewport.width - 2 * viewport.margin) / Math.max(extU, 1e-9), (viewport.height - 2 * viewport.margin) / Math.max(extV, 1e-9));
    scale = Math.min(scale, s);
  }
  return { scale: Number.isFinite(scale) ? scale : 1, frames };
}

export const toVec = (v: Vec3): V3 => [v.x, v.y, v.z];
