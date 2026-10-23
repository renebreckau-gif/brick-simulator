// Exakte konvexe Körper für die Kollisionsprüfung (Auftrag 05B.1).
//
// Bisher waren alle Teilkörper achsparallele Quader. Schrägsteine und Keilplatten sind das nicht: Ihre
// Begrenzungsbox würde Teile im freien Raum über der Schräge bzw. neben der Keilkante fälschlich blockieren,
// eine kleinere Innenbox echte Durchdringungen übersehen. Deshalb werden solche Körper als konvexe Prismen
// beschrieben und mit dem Trennachsensatz (SAT) geprüft: Zwei konvexe Körper sind genau dann getrennt, wenn
// es eine Achse gibt, auf der sich ihre Projektionen nicht überlappen. Kandidaten sind die Flächennormalen
// beider Körper und die Kreuzprodukte ihrer Kantenrichtungen; die kleinste Überlappung über alle Kandidaten
// ist die Eindringtiefe. Quader sind ein Sonderfall (Ergebnis identisch zur bisherigen Quaderprüfung).
import { apply, applyTransform, type Box, type Transform, type Vec3 } from '../math';

/**
 * Gerades Prisma im Teilsystem (LDU): konvexes Polygon in der Ebene senkrecht zu `axis`, extrudiert von lo bis hi.
 * Polygonkoordinaten (u, v) sind die beiden anderen Achsen in zyklischer Reihenfolge:
 * axis 0 (x) → (y, z) · axis 1 (y) → (z, x) · axis 2 (z) → (x, y).
 */
export interface Prism {
  axis: 0 | 1 | 2;
  polygon: [number, number][];
  lo: number;
  hi: number;
}

/** Konvexer Körper in Weltkoordinaten: Ecken, Flächennormalen und Kantenrichtungen (je Einheitsvektor). */
export interface Solid {
  vertices: Vec3[];
  normals: Vec3[];
  edges: Vec3[];
  /** Achsparalleler Quader (dann genügt der Quadertest). */
  isBox: boolean;
  aabb: Box;
}

const norm = (v: Vec3): Vec3 | null => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l < 1e-9 ? null : [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function aabbOf(vs: Vec3[]): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of vs) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
  return { min, max };
}

/** Richtungen ohne Doppelte (auch gegenläufige gelten als gleich). */
function uniqueDirs(list: (Vec3 | null)[]): Vec3[] {
  const out: Vec3[] = [];
  for (const d of list) if (d && !out.some((o) => Math.abs(dot(o, d)) > 1 - 1e-9)) out.push(d);
  return out;
}

export function solidFromBox(b: Box): Solid {
  const vertices: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) vertices.push([x, y, z]);
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return { vertices, normals: axes, edges: axes, isBox: true, aabb: { min: [...b.min], max: [...b.max] } };
}

const toLocal = (axis: 0 | 1 | 2, u: number, v: number, t: number): Vec3 => {
  const p: Vec3 = [0, 0, 0];
  p[axis] = t;
  p[(axis + 1) % 3] = u;
  p[(axis + 2) % 3] = v;
  return p;
};

/** Ecken des Prismas im Teilsystem (für Abgleich mit der LDraw-Geometrie). */
export function prismVertices(p: Prism): Vec3[] {
  return p.polygon.flatMap(([u, v]) => [toLocal(p.axis, u, v, p.lo), toLocal(p.axis, u, v, p.hi)]);
}

/** Ist ein Punkt (Teilsystem) innerhalb des Prismas (mit Toleranz)? */
export function prismContains(p: Prism, q: Vec3, tol = 1e-6): boolean {
  const t = q[p.axis];
  if (t < p.lo - tol || t > p.hi + tol) return false;
  const u = q[(p.axis + 1) % 3];
  const v = q[(p.axis + 2) % 3];
  const n = p.polygon.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = p.polygon[i];
    const [bx, by] = p.polygon[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const c = ((bx - ax) * (v - ay) - (by - ay) * (u - ax)) / len; // vorzeichenbehafteter Abstand zur Kante
    if (Math.abs(c) <= tol) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function solidFromPrism(p: Prism, t: Transform): Solid {
  const n = p.polygon.length;
  const localV = prismVertices(p);
  const axisDir: Vec3 = toLocal(p.axis, 0, 0, 1);
  const localNormals: (Vec3 | null)[] = [axisDir];
  const localEdges: (Vec3 | null)[] = [axisDir];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = p.polygon[i];
    const [bx, by] = p.polygon[(i + 1) % n];
    const e = norm(toLocal(p.axis, bx - ax, by - ay, 0));
    localEdges.push(e);
    localNormals.push(e ? norm(cross(e, axisDir)) : null);
  }
  const vertices = localV.map((v) => applyTransform(t, v));
  const normals = uniqueDirs(localNormals.map((d) => (d ? norm(apply(t.rotation, d)) : null)));
  const edges = uniqueDirs(localEdges.map((d) => (d ? norm(apply(t.rotation, d)) : null)));
  const axisAligned = p.polygon.length === 4 && normals.every((d) => d.filter((c) => Math.abs(c) > 1 - 1e-9).length === 1);
  return { vertices, normals, edges, isBox: axisAligned && normals.length === 3, aabb: aabbOf(vertices) };
}

/**
 * Flächen der konvexen Hülle einer kleinen Punktmenge (05B.2; Teilkörper mit gerundeten Kanten, die kein gerades
 * Prisma sind). Durchprobieren aller Punkttripel genügt für die wenigen Ecken eines Teilkörpers.
 */
export function hullFaces(points: Vec3[], eps = 1e-6): { normal: Vec3; d: number; on: number[] }[] {
  const faces: { normal: Vec3; d: number; on: number[] }[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const a = points[i];
        let nv = norm(cross([points[j][0] - a[0], points[j][1] - a[1], points[j][2] - a[2]], [points[k][0] - a[0], points[k][1] - a[1], points[k][2] - a[2]]));
        if (!nv) continue;
        let d = dot(nv, a);
        const side = points.map((p) => dot(nv!, p) - d);
        if (side.some((s) => s > eps) && side.some((s) => s < -eps)) continue;
        if (side.some((s) => s > eps)) { nv = [-nv[0], -nv[1], -nv[2]]; d = -d; }
        if (faces.some((f) => dot(f.normal, nv!) > 1 - 1e-9 && Math.abs(f.d - d) < 1e-6)) continue;
        faces.push({ normal: nv, d, on: points.map((p, m) => (Math.abs(dot(nv!, p) - d) <= eps ? m : -1)).filter((m) => m >= 0) });
      }
  return faces;
}

/** Liegt ein Punkt (Teilsystem) in der konvexen Hülle (mit Toleranz)? */
export function hullContains(points: Vec3[], q: Vec3, tol = 1e-6): boolean {
  return hullFaces(points).every((f) => dot(f.normal, q) - f.d <= tol);
}

export function solidFromHull(points: Vec3[], t: Transform): Solid {
  const faces = hullFaces(points);
  const edgeDirs: (Vec3 | null)[] = [];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      if (faces.filter((f) => f.on.includes(i) && f.on.includes(j)).length >= 2) edgeDirs.push(norm([points[j][0] - points[i][0], points[j][1] - points[i][1], points[j][2] - points[i][2]]));
  const vertices = points.map((v) => applyTransform(t, v));
  return {
    vertices,
    normals: uniqueDirs(faces.map((f) => norm(apply(t.rotation, f.normal)))),
    edges: uniqueDirs(edgeDirs.map((d) => (d ? norm(apply(t.rotation, d)) : null))),
    isBox: false,
    aabb: aabbOf(vertices),
  };
}

/** Körper entlang d verschoben gedacht (Montageweg): konvexe Hülle aus Körper und um len·d versetztem Körper. */
export function sweepSolid(s: Solid, d: Vec3, len: number): Solid {
  const back: Vec3 = [-d[0] * len, -d[1] * len, -d[2] * len]; // die Einheit kommt aus −d
  const vertices = [...s.vertices, ...s.vertices.map((v) => [v[0] + back[0], v[1] + back[1], v[2] + back[2]] as Vec3)];
  const dn = norm(d)!;
  return {
    vertices,
    normals: uniqueDirs([...s.normals, ...s.edges.map((e) => norm(cross(e, dn)))]),
    edges: uniqueDirs([...s.edges, dn]),
    isBox: false,
    aabb: aabbOf(vertices),
  };
}

function project(vs: Vec3[], axis: Vec3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vs) { const p = dot(v, axis); if (p < lo) lo = p; if (p > hi) hi = p; }
  return [lo, hi];
}

/**
 * Eindringtiefe zweier konvexer Körper (kleinste Projektionsüberlappung über alle Trennachsen-Kandidaten);
 * ≤ 0 heißt getrennt bzw. höchstens berührend. Bei Quadern identisch mit der kleinsten Achsüberlappung.
 */
export function penetrationDepth(a: Solid, b: Solid): number {
  // Grobtest über die umhüllenden Quader: deutlich getrennt (> 1 LDU) → genauer Wert unerheblich
  for (let i = 0; i < 3; i++) {
    const gap = Math.min(a.aabb.max[i] - b.aabb.min[i], b.aabb.max[i] - a.aabb.min[i]);
    if (gap < -1) return gap;
  }
  const candidates = [...a.normals, ...b.normals];
  if (!(a.isBox && b.isBox)) for (const ea of a.edges) for (const eb of b.edges) { const c = norm(cross(ea, eb)); if (c) candidates.push(c); }
  // Kleinste Überlappung über alle Achsen: > 0 Eindringtiefe, ≤ 0 größter Abstand (für die Berührungsprüfung)
  let min = Infinity;
  for (const axis of candidates) {
    const [a0, a1] = project(a.vertices, axis);
    const [b0, b1] = project(b.vertices, axis);
    const overlap = Math.min(a1, b1) - Math.max(a0, b0);
    if (overlap < min) min = overlap;
    if (min < -1) return min;
  }
  return min;
}

export const solidsPenetrate = (a: Solid, b: Solid, tol: number) => penetrationDepth(a, b) > tol;
/** Berührung: nirgends weiter als tol getrennt (für Kontakt-/Lose-Erkennung). */
export const solidsTouch = (a: Solid, b: Solid, tol: number) => penetrationDepth(a, b) >= -tol;
