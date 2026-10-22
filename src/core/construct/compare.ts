// Vergleich Teilemodell ↔ Vorlage (Auftrag 05B.1): Umrisse beider Seiten auf denselben Bezug normiert.
//
// Profil = je Stützstelle d (0 = Spitze … 1 = hinteres Ende des Abschnitts) die belegte Querstrecke [lo, hi]
// in Einheiten der Abschnittslänge. Draufsicht: quer zur Mittellinie (zentriert, nur Breite zählt);
// Seitenansicht: Höhe über der Unterkante. Die Modellseite wird aus der LDraw-Geometrie der verbauten
// Teile gerastert (dieselben Dreiecke wie im Viewer), nicht aus Hilfskörpern.
import { apply, type Vec3 } from '../math';
import type { PartLibrary } from '../ldraw/library';
import type { CanonicalModel } from '../model/types';
import { VIEW_BY_ID, type ViewId } from '../design/projection';
import { screenMap } from '../design/spatial';

export interface Profile {
  /** 'breite': Draufsicht (zentriert verglichen); 'hoehe': Seitenansicht (über der Unterkante). */
  kind: 'breite' | 'hoehe';
  samples: ({ lo: number; hi: number } | null)[];
}

export const PROFILE_SAMPLES = 60;

/** Bildschirmachsen einer orthografischen Ansicht im LDraw-System des Modells (rechts, unten, zum Betrachter). */
export function ldrawScreenAxes(direction: ViewId, frontInImage: 'links' | 'rechts' | 'oben' | 'unten' | null): { right: Vec3; down: Vec3; toCamera: Vec3 } {
  // Objektsystem der Ansichten: x vorn, y links, z oben → LDraw: vorn = −z, links = +x, oben = −y
  const S: Record<'x' | 'y' | 'z', Vec3> = { x: [0, 0, -1], y: [1, 0, 0], z: [0, -1, 0] };
  const m = screenMap(direction, frontInImage)!;
  // „+ 0“ macht −0 zu 0 (lesbare, vergleichbare Achsen)
  const vec = (a: { axis: 'x' | 'y' | 'z'; sign: number }): Vec3 => S[a.axis].map((c) => c * a.sign + 0) as Vec3;
  const tc = VIEW_BY_ID[direction].toCamera;
  const toCamera: Vec3 = [0, 1, 2].map((k) => tc[0] * S.x[k] + tc[1] * S.y[k] + tc[2] * S.z[k] + 0) as Vec3;
  return { right: vec(m.right), down: vec(m.down), toCamera };
}

/**
 * Umriss des Teilemodells in einer Ansicht: Dreiecke aller Instanzen auf die Ebene projiziert und in ein
 * Raster (cell LDU) eingetragen. Längsachse vom Bug (z = −rows · 20) nach hinten (z = 0).
 */
export function modelProfile(model: CanonicalModel, library: PartLibrary, view: 'oben' | 'seite', rows: number, cell = 2): Profile {
  const len = rows * 20;
  const nu = Math.ceil(len / cell) + 1;
  // Querachse: Draufsicht x (−200 … 200 LDU), Seitenansicht Höhe −y (0 … 400 LDU)
  const span = 400;
  const v0 = view === 'oben' ? -span / 2 : -20;
  const nv = Math.ceil((span + 20) / cell);
  const grid = new Uint8Array(nu * nv);
  const proj = (p: Vec3): [number, number] => [(p[2] + len) / cell, ((view === 'oben' ? p[0] : -p[1]) - v0) / cell];
  for (const inst of model.instances) {
    if (!library.has(`${inst.part}.dat`)) continue;
    const flat = library.flatten(`${inst.part}.dat`);
    for (const t of flat.triangles) {
      const q = t.points.map((p) => { const w = apply(inst.rotation, p); return proj([w[0] + inst.position[0], w[1] + inst.position[1], w[2] + inst.position[2]]); });
      fillTriangle(grid, nu, nv, q[0], q[1], q[2]);
    }
  }
  const samples: Profile['samples'] = [];
  for (let s = 0; s < PROFILE_SAMPLES; s++) {
    const u = Math.min(nu - 1, Math.floor(((s + 0.5) / PROFILE_SAMPLES) * (nu - 1)));
    let lo = -1;
    let hi = -1;
    for (let v = 0; v < nv; v++) if (grid[u * nv + v]) { if (lo < 0) lo = v; hi = v + 1; }
    samples.push(lo < 0 ? null : { lo: (lo * cell + v0) / len, hi: (hi * cell + v0) / len });
  }
  return { kind: view === 'oben' ? 'breite' : 'hoehe', samples };
}

function fillTriangle(grid: Uint8Array, nu: number, nv: number, a: [number, number], b: [number, number], c: [number, number]) {
  const u0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const u1 = Math.min(nu - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const v0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const v1 = Math.min(nv - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return; // in Blickrichtung liegende Dreiecke verdecken nichts zusätzlich
  for (let u = u0; u <= u1; u++)
    for (let v = v0; v <= v1; v++) {
      // Zellmitte; kleine Toleranz, damit an Kanten anliegende Zellen nicht ausfallen
      const p = [u + 0.5, v + 0.5];
      const w0 = ((b[0] - p[0]) * (c[1] - p[1]) - (b[1] - p[1]) * (c[0] - p[0])) / area;
      const w1 = ((c[0] - p[0]) * (a[1] - p[1]) - (c[1] - p[1]) * (a[0] - p[0])) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) grid[u * nv + v] = 1;
    }
}

/**
 * Überdeckung zweier Profile (Schnitt / Vereinigung über alle Stützstellen, 0 … 1). Breitenprofile werden
 * zentriert verglichen (nur die Breite zählt), Höhenprofile absolut über der Unterkante.
 */
export function profileOverlap(a: Profile, b: Profile): number {
  let inter = 0;
  let union = 0;
  const n = Math.min(a.samples.length, b.samples.length);
  for (let s = 0; s < n; s++) {
    let x = a.samples[s];
    let y = b.samples[s];
    if (!x && !y) continue;
    if (a.kind === 'breite') {
      if (x) { const h = (x.hi - x.lo) / 2; x = { lo: -h, hi: h }; }
      if (y) { const h = (y.hi - y.lo) / 2; y = { lo: -h, hi: h }; }
    }
    const lx = x ? x.hi - x.lo : 0;
    const ly = y ? y.hi - y.lo : 0;
    const ov = x && y ? Math.max(0, Math.min(x.hi, y.hi) - Math.max(x.lo, y.lo)) : 0;
    inter += ov;
    union += lx + ly - ov;
  }
  return union > 0 ? inter / union : 0;
}

/** Größte Abweichung der Ausdehnung (Breite bzw. Oberkante) und wo sie liegt (d von der Spitze). */
export function largestDeviation(model: Profile, template: Profile): { d: number; model: number; template: number } | null {
  let best: { d: number; model: number; template: number } | null = null;
  const n = Math.min(model.samples.length, template.samples.length);
  for (let s = 0; s < n; s++) {
    const m = model.samples[s];
    const t = template.samples[s];
    if (!m || !t) continue;
    const mv = model.kind === 'breite' ? m.hi - m.lo : m.hi;
    const tv = template.kind === 'breite' ? t.hi - t.lo : t.hi;
    if (!best || Math.abs(mv - tv) > Math.abs(best.model - best.template)) best = { d: (s + 0.5) / n, model: mv, template: tv };
  }
  return best;
}
