// Minimale Vektor-/Matrixmathematik ohne Abhängigkeit von Three.js,
// damit der Prüfkern unabhängig von der Darstellung bleibt.
//
// Konvention wie LDraw: Mat3 ist zeilenweise [a b c d e f g h i];
// ein Punkt (u,v,w) wird zu (a·u+b·v+c·w, d·u+e·v+f·w, g·u+h·v+i·w).

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
export function dist(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function det(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** Starre Transformation: Rotation (Mat3) und Verschiebung. */
export interface Transform {
  position: Vec3;
  rotation: Mat3;
}

export function applyTransform(t: Transform, v: Vec3): Vec3 {
  return add(apply(t.rotation, v), t.position);
}

export function compose(outer: Transform, inner: Transform): Transform {
  return { rotation: mul(outer.rotation, inner.rotation), position: applyTransform(outer, inner.position) };
}

/** Maximale Abweichung von R·Rᵀ = I. */
export function orthonormalityError(m: Mat3): number {
  const p = mul(m, transpose(m));
  let e = 0;
  for (let i = 0; i < 9; i++) e = Math.max(e, Math.abs(p[i] - IDENTITY[i]));
  return e;
}

/** true, wenn jede Zeile/Spalte genau einen Eintrag ±1 hat (Vielfaches von 90°). */
export function isAxisAligned(m: Mat3, tol = 1e-4): boolean {
  for (const x of m) if (Math.abs(x) > tol && Math.abs(Math.abs(x) - 1) > tol) return false;
  for (let i = 0; i < 3; i++) {
    let row = 0;
    let col = 0;
    for (let j = 0; j < 3; j++) {
      if (Math.abs(m[i * 3 + j]) > tol) row++;
      if (Math.abs(m[j * 3 + i]) > tol) col++;
    }
    if (row !== 1 || col !== 1) return false;
  }
  return true;
}

export function roundVec(v: Vec3, digits = 3): Vec3 {
  const f = 10 ** digits;
  return [Math.round(v[0] * f) / f, Math.round(v[1] * f) / f, Math.round(v[2] * f) / f];
}

/** Rotation um die Y-Achse in 90°-Schritten (LDraw-Konvention). */
export function rotY90(quarterTurns: number): Mat3 {
  const q = ((quarterTurns % 4) + 4) % 4;
  const c = [1, 0, -1, 0][q];
  const s = [0, 1, 0, -1][q];
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** Rotation um die X-Achse in 90°-Schritten. */
export function rotX90(quarterTurns: number): Mat3 {
  const q = ((quarterTurns % 4) + 4) % 4;
  const c = [1, 0, -1, 0][q];
  const s = [0, 1, 0, -1][q];
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/** Achsenparallele Box in Weltkoordinaten. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

export function transformBox(t: Transform, b: Box): Box {
  const corners: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) corners.push(applyTransform(t, [x, y, z]));
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], c[i]); max[i] = Math.max(max[i], c[i]); }
  return { min, max };
}

/** Überlappungstiefe je Achse (negativ = Abstand). */
export function overlapDepths(a: Box, b: Box): Vec3 {
  return [
    Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]),
    Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]),
    Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]),
  ];
}

export function boxesPenetrate(a: Box, b: Box, tol: number): boolean {
  const d = overlapDepths(a, b);
  return d[0] > tol && d[1] > tol && d[2] > tol;
}

/** Berühren oder überlappen (Abstand ≤ tol in allen Achsen). */
export function boxesTouch(a: Box, b: Box, tol: number): boolean {
  const d = overlapDepths(a, b);
  return d[0] >= -tol && d[1] >= -tol && d[2] >= -tol;
}

export function unionBox(boxes: Box[]): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b.min[i]); max[i] = Math.max(max[i], b.max[i]); }
  return { min, max };
}
