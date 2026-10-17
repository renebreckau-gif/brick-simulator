// Auftrag 05B.0.1: Verdeckung in den orthografischen Ansichten. Geprüft werden SICHTBARE FLÄCHEN je Bildpunkt,
// nicht nur Umrisse oder Außenmaße. Referenz ist ein unabhängiger Strahltest in dieser Datei
// (Schnitt des Sichtstrahls mit den Halbräumen der konvexen Körper, ohne Dreiecke und ohne Tiefenpuffer).
import { describe, expect, it } from 'vitest';
import { bodyGeometry, cross, sharedFrames, VIEW_BY_ID, VIEWS, type V3, type ViewDef, type ViewId } from '../src/core/design/projection';
import { bodyAt, rasterize, visiblePixels, type RasterFrame } from '../src/core/design/raster';
import type { SpatialBody } from '../src/core/design/spatial';

const basis = { position: 'user', size: 'user', rotation: 'user', shape: 'user', color: 'user' } as const;
const B = (id: string, shape: SpatialBody['shape'], c: [number, number, number], s: [number, number, number], extra: Partial<SpatialBody> = {}): SpatialBody => ({
  id, name: id, groupId: null, isMain: false, shape, center: { x: c[0], y: c[1], z: c[2] }, size: { length: s[0], width: s[1], height: s[2] },
  rotation: { yaw: 0, pitch: 0, roll: 0 }, taper: shape === 'wedge' ? 0 : 1, color: '#888888', basis, assumptions: [], uncertainty: 'mittel', mirrorOf: null, ...extra,
});
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Unabhängige Referenz: welcher Körper ist entlang des Sichtstrahls durch (u, v) der Kamera am nächsten? */
function rayVisible(bodies: SpatialBody[], view: ViewDef, u: number, v: number): { id: string | null; depth: number; margin: number } {
  const base: V3 = [u * view.right[0] + v * view.up[0], u * view.right[1] + v * view.up[1], u * view.right[2] + v * view.up[2]];
  const hits: { id: string; t: number }[] = [];
  for (const b of bodies) {
    const g = bodyGeometry(b);
    let tMin = -Infinity;
    let tMax = Infinity;
    let miss = false;
    for (const f of g.faces) {
      // Ebene aus der ersten nicht entarteten Eckenfolge (bewusst anders berechnet als im Raster)
      const vs = f.map((i) => g.vertices[i]);
      let n: V3 = [0, 0, 0];
      const a = vs[0];
      for (let i = 1; i + 1 < vs.length && Math.hypot(...n) < 1e-12; i++) for (let j = i + 1; j < vs.length && Math.hypot(...n) < 1e-12; j++) n = cross([vs[i][0] - a[0], vs[i][1] - a[1], vs[i][2] - a[2]], [vs[j][0] - a[0], vs[j][1] - a[1], vs[j][2] - a[2]]);
      if (Math.hypot(...n) < 1e-12) continue; // Fläche ohne Inhalt
      // innen: n·(base + t·toCamera − a) ≤ 0
      const k = dot(n, view.toCamera);
      const c = dot(n, a) - dot(n, base);
      if (Math.abs(k) < 1e-12) { if (c < 0) miss = true; continue; }
      if (k > 0) tMax = Math.min(tMax, c / k);
      else tMin = Math.max(tMin, c / k);
    }
    if (!miss && tMin <= tMax) hits.push({ id: b.id, t: tMax });
  }
  hits.sort((p, q) => q.t - p.t);
  return { id: hits[0]?.id ?? null, depth: hits[0]?.t ?? -Infinity, margin: hits.length > 1 ? hits[0].t - hits[1].t : Infinity };
}

const frameFor = (bodies: SpatialBody[], view: ViewDef, W = 240, H = 170): RasterFrame => {
  const s = sharedFrames({ bodies }, { width: W, height: H, margin: 10 });
  const f = s.frames.find((x) => x.view.id === view.id)!;
  return { view, scale: s.scale, center: f.center, width: W, height: H };
};
const pixelToUV = (f: RasterFrame, x: number, y: number): [number, number] => [f.center[0] + (x + 0.5 - f.width / 2) / f.scale, f.center[1] - (y + 0.5 - f.height / 2) / f.scale];
const uvToPixel = (f: RasterFrame, u: number, v: number): [number, number] => [f.width / 2 + (u - f.center[0]) * f.scale, f.height / 2 - (v - f.center[1]) * f.scale];

/** Vergleicht jeden Bildpunkt, der nicht auf einer Kante liegt, mit dem Strahltest. */
function compareWithRays(bodies: SpatialBody[], viewId: ViewId) {
  const view = VIEW_BY_ID[viewId];
  const f = frameFor(bodies, view);
  const r = rasterize({ bodies }, f);
  let checked = 0;
  const wrong: string[] = [];
  // jeder zweite Bildpunkt je Richtung (Laufzeit); reicht für über 1000 eindeutige Prüfpunkte je Ansicht
  for (let y = 0; y < f.height; y += 2)
    for (let x = 0; x < f.width; x += 2) {
      const [u, v] = pixelToUV(f, x, y);
      const ref = rayVisible(bodies, view, u, v);
      // Kanten und nahezu gleich tiefe Flächen auslassen: dort ist die Zuordnung je Bildpunkt nicht eindeutig
      const d = 0.6 / f.scale;
      const stable = [[d, 0], [-d, 0], [0, d], [0, -d]].every(([du, dv]) => rayVisible(bodies, view, u + du, v + dv).id === ref.id) && ref.margin > 1e-6;
      if (!stable) continue;
      checked++;
      const got = bodyAt(r, x, y);
      if (got !== ref.id) wrong.push(`(${x},${y}) Raster ${got} ≠ Strahl ${ref.id}`);
    }
  return { checked, wrong };
}

// Reproduktionsfall aus dem Auftrag
const KEIL = B('keil', 'wedge', [0, 0, 0], [1, 1, 1]);
const QUADER = B('quader', 'box', [0.2, 0, 0], [0.1, 0.2, 0.2]);

describe('Reproduktionsfall Keil + Quader, Ansicht von vorn', () => {
  it('Ursache belegt: nach größtem Körperabstand läge der Keil vorn (0,5 > 0,25) – eine Körpersortierung zeichnet ihn zuletzt', () => {
    const maxDepth = (b: SpatialBody) => Math.max(...bodyGeometry(b).vertices.map((p) => dot(p, VIEW_BY_ID.vorne.toCamera)));
    expect(maxDepth(KEIL)).toBeCloseTo(0.5, 9);
    expect(maxDepth(QUADER)).toBeCloseTo(0.25, 9);
  });
  it('Strahltest (unabhängig): in der Bildmitte liegt die Quaderfront bei x = 0,25, die Keilfläche bei x = 0 → Quader sichtbar', () => {
    const ref = rayVisible([KEIL, QUADER], VIEW_BY_ID.vorne, 0, 0);
    expect(ref.id).toBe('quader');
    expect(ref.depth).toBeCloseTo(0.25, 9);
    // ohne Quader: Keilfläche in der Mitte bei x = 0 (Schräge von z = 0,5 hinten bis z = −0,5 vorn)
    expect(rayVisible([KEIL], VIEW_BY_ID.vorne, 0, 0).depth).toBeCloseTo(0, 9);
  });
  it('Tiefenpuffer: Bildmitte zeigt den Quader – unabhängig von der Reihenfolge im Entwurf', () => {
    for (const bodies of [[KEIL, QUADER], [QUADER, KEIL]]) {
      const f = frameFor(bodies, VIEW_BY_ID.vorne);
      const r = rasterize({ bodies }, f);
      const [x, y] = uvToPixel(f, 0, 0);
      expect(bodyAt(r, x, y)).toBe('quader');
      // ganze Quaderfront (0,2 × 0,2) sichtbar: Fläche in Bildpunkten ≈ (0,2 · Maßstab)²
      const expected = (0.2 * f.scale) ** 2;
      expect(visiblePixels(r).get('quader')!).toBeGreaterThan(expected * 0.9);
      expect(visiblePixels(r).get('quader')!).toBeLessThan(expected * 1.1);
    }
  });
  it('in allen sechs Ansichten stimmt jeder eindeutige Bildpunkt mit dem Strahltest überein', () => {
    for (const v of VIEWS) {
      const { checked, wrong } = compareWithRays([KEIL, QUADER], v.id);
      expect(checked, v.id).toBeGreaterThan(1000);
      expect(wrong, v.id).toEqual([]);
    }
  });
  it('von oben ragt der Quader aus der Keilschräge heraus und ist sichtbar', () => {
    // Die Schräge fällt von z = 0,5 (x = −0,5) auf z = −0,5 (x = 0,5), über dem Quader (x 0,15…0,25) also auf
    // z = −0,15…−0,25. Die Quaderoberseite liegt bei z = 0,1 – höher als die Schräge, also von oben sichtbar.
    const f = frameFor([KEIL, QUADER], VIEW_BY_ID.oben);
    const r = rasterize({ bodies: [KEIL, QUADER] }, f);
    const [x, y] = uvToPixel(f, 0, 0.2); // oben: u = −y, v = x
    expect(bodyAt(r, x, y)).toBe('quader');
  });
});

describe('teilweise verdeckte und gedrehte Körper', () => {
  const SZENE: SpatialBody[] = [
    B('rumpf', 'taper', [0, 0, 0], [1, 0.5, 0.35], { taper: 0.6 }),
    B('kanzel', 'box', [0.25, 0, 0.18], [0.3, 0.2, 0.15], { rotation: { yaw: 0, pitch: -12, roll: 0 } }),
    B('gondel', 'cylinder', [-0.3, 0.35, 0], [0.5, 0.25, 0.25], { rotation: { yaw: 15, pitch: 0, roll: 0 } }),
    B('strebe', 'box', [-0.3, 0.2, 0], [0.15, 0.3, 0.05], { rotation: { yaw: 0, pitch: 0, roll: 25 } }),
    B('keil', 'wedge', [0.55, 0, -0.05], [0.3, 0.45, 0.25], { taper: 0.2, rotation: { yaw: -20, pitch: 10, roll: 5 } }),
  ];
  it.each(VIEWS.map((v) => v.id))('Ansicht %s: jeder eindeutige Bildpunkt wie im Strahltest', (v) => {
    const { checked, wrong } = compareWithRays(SZENE, v);
    expect(checked).toBeGreaterThan(1000);
    expect(wrong.slice(0, 5)).toEqual([]);
  });
  it('teilweise Verdeckung: die Strebe ist von vorn sichtbar, aber kleiner als ihre volle Projektion', () => {
    const f = frameFor(SZENE, VIEW_BY_ID.links);
    const all = visiblePixels(rasterize({ bodies: SZENE }, f)).get('strebe') ?? 0;
    const alone = visiblePixels(rasterize({ bodies: [SZENE[3]] }, f)).get('strebe') ?? 0;
    // von links verdeckt die Gondel (y 0,35, Kameraseite) einen Teil der Strebe
    expect(alone).toBeGreaterThan(0);
    expect(all).toBeLessThan(alone);
  });
  it('Auswahl per Bildpunkt liefert den sichtbaren, nicht einen verdeckten Körper', () => {
    const f = frameFor(SZENE, VIEW_BY_ID.links);
    const r = rasterize({ bodies: SZENE }, f);
    const [x, y] = uvToPixel(f, 0.3, 0); // links: u = −x ⇒ Gondelmitte x = −0,3 liegt bei u = 0,3
    expect(bodyAt(r, x, y)).toBe('gondel');
    expect(rayVisible(SZENE, VIEW_BY_ID.links, 0.3, 0).id).toBe('gondel');
  });
});
