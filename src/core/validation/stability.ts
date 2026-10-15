// Heuristische Stand-/Kippprüfung.
// Annahmen (dokumentiert, konservativ vereinfacht):
//  - Schwerkraft wirkt in Welt +Y, Unterlage ist eine ebene, horizontale Fläche unter dem tiefsten Punkt.
//  - Massenersatz: Volumen der Körperhüllen (reale Teile sind hohl; keine kalibrierten Massen).
//  - Das betrachtete Teilmodell verhält sich starr.
// Ergebnis ist ausdrücklich eine „heuristische Einschätzung“, kein Nachweis.
import type { Box } from '../math';
import { APPROX_MM_PER_LDU, TOLERANCE } from '../units';
import type { WorldInstance } from './world';

export interface StabilityResult {
  groundY: number;
  supportPolygon: [number, number][];
  centerOfMass: [number, number, number];
  /** Abstand des Schwerpunkt-Lots zum Rand der Aufstandsfläche (LDU, positiv = innen). */
  marginLDU: number;
  /** Neigungswinkel der Unterlage, ab dem das Modell kippen würde (Grad), falls innen. */
  tipAngleDeg: number | null;
  stands: boolean;
  contactInstanceIds: string[];
}

function cross(o: [number, number], a: [number, number], b: [number, number]) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...new Map(points.map((p) => [`${p[0].toFixed(3)},${p[1].toFixed(3)}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Vorzeichenbehafteter Abstand zum Polygonrand (positiv innen). */
export function signedMargin(p: [number, number], hull: [number, number][]): number {
  if (hull.length === 0) return -Infinity;
  if (hull.length === 1) return -Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1]);
  let minD = Infinity;
  for (let i = 0; i < hull.length; i++) minD = Math.min(minD, segDist(p, hull[i], hull[(i + 1) % hull.length]));
  if (hull.length < 3) return -minD;
  let inside = true;
  for (let i = 0; i < hull.length; i++) if (cross(hull[i], hull[(i + 1) % hull.length], p) < 0) inside = false;
  return inside ? minD : -minD;
}

export function analyzeStability(instances: WorldInstance[]): StabilityResult | null {
  const boxes: { box: Box; id: string; body: boolean }[] = [];
  for (const w of instances) {
    for (const b of w.bodyBoxes) boxes.push({ box: b, id: w.inst.instanceId, body: true });
    for (const s of w.studs) boxes.push({ box: s.box, id: w.inst.instanceId, body: false });
  }
  if (!boxes.length) return null;
  const groundY = Math.max(...boxes.map((b) => b.box.max[1]));
  const contacts = boxes.filter((b) => b.box.max[1] >= groundY - TOLERANCE.contact);
  const pts: [number, number][] = [];
  for (const c of contacts) for (const x of [c.box.min[0], c.box.max[0]]) for (const z of [c.box.min[2], c.box.max[2]]) pts.push([x, z]);
  const hull = convexHull(pts);
  let m = 0;
  const com: [number, number, number] = [0, 0, 0];
  for (const b of boxes.filter((x) => x.body)) {
    const v = (b.box.max[0] - b.box.min[0]) * (b.box.max[1] - b.box.min[1]) * (b.box.max[2] - b.box.min[2]);
    m += v;
    for (let i = 0; i < 3; i++) com[i] += v * (b.box.min[i] + b.box.max[i]) / 2;
  }
  if (m === 0) return null;
  for (let i = 0; i < 3; i++) com[i] /= m;
  const margin = signedMargin([com[0], com[2]], hull);
  const height = groundY - com[1];
  const stands = margin > TOLERANCE.contact;
  return {
    groundY,
    supportPolygon: hull,
    centerOfMass: [Number(com[0].toFixed(2)), Number(com[1].toFixed(2)), Number(com[2].toFixed(2))],
    marginLDU: Number(margin.toFixed(2)),
    tipAngleDeg: stands && height > 0 ? Number(((Math.atan2(margin, height) * 180) / Math.PI).toFixed(1)) : null,
    stands,
    contactInstanceIds: [...new Set(contacts.map((c) => c.id))].sort(),
  };
}

export function marginMm(ldu: number): number {
  return Number((ldu * APPROX_MM_PER_LDU).toFixed(1));
}
