// Auftrag 05B.0: Geometrische Konsistenz der sechs Ansichten. Alle Projektionen stammen aus derselben
// Geometrie (bodyGeometry); geprÃ¼ft werden Lage, Ausdehnung, Achsabbildung, HÃ¤ndigkeit und gemeinsamer MaÃŸstab.
// Synthetische EntwÃ¼rfe â€“ kein Bild, keine Analyse.
import { describe, expect, it } from 'vitest';
import { bodyGeometry, cross, modelBounds, projectBody, sharedFrames, VIEW_BY_ID, VIEWS, type V3, type ViewId } from '../src/core/design/projection';
import type { SpatialBody, SpatialDesign } from '../src/core/design/spatial';

const basis = { position: 'user', size: 'user', rotation: 'user', shape: 'user', color: 'user' } as const;
const body = (id: string, p: Partial<SpatialBody>): SpatialBody => ({
  id, name: id, groupId: null, isMain: false, shape: 'box', center: { x: 0, y: 0, z: 0 }, size: { length: 1, width: 1, height: 1 },
  rotation: { yaw: 0, pitch: 0, roll: 0 }, taper: 1, color: '#888888', basis, assumptions: [], uncertainty: 'mittel', mirrorOf: null, ...p,
});

/**
 * Bewusst asymmetrischer Entwurf: HauptkÃ¶rper und eine Markierung vorn-links-oben, ein Ausleger hinten-rechts-unten.
 * Damit fallen vertauschte Seiten, falsche Kamerarichtungen und Spiegelungen sofort auf.
 */
const ASYM: Pick<SpatialDesign, 'bodies'> = {
  bodies: [
    body('main', { isMain: true, size: { length: 1, width: 0.5, height: 0.3 } }),
    body('marker', { center: { x: 0.4, y: 0.2, z: 0.25 }, size: { length: 0.1, width: 0.05, height: 0.08 }, shape: 'cylinder', taper: 0.5 }),
    body('boom', { center: { x: -0.6, y: -0.35, z: -0.2 }, size: { length: 0.3, width: 0.2, height: 0.1 }, shape: 'wedge', taper: 0, rotation: { yaw: 20, pitch: -10, roll: 5 } }),
  ],
};

const worldBox = (b: SpatialBody) => {
  const vs = bodyGeometry(b).vertices;
  const lo = [0, 1, 2].map((k) => Math.min(...vs.map((v) => v[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...vs.map((v) => v[k])));
  return { lo, hi };
};
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('Ansichten: echte Drehungen, keine Spiegelung', () => {
  it('jede Ansicht ist rechtshÃ¤ndig (rechts Ã— oben = zur Kamera)', () => {
    for (const v of VIEWS) expect(cross(v.right, v.up).map((x) => x + 0)).toEqual(v.toCamera);
  });
  it('Gegenansichten sind entgegengesetzt (vorne/hinten, links/rechts, oben/unten)', () => {
    const pairs: [ViewId, ViewId][] = [['vorne', 'hinten'], ['links', 'rechts'], ['oben', 'unten']];
    for (const [a, b] of pairs) expect(VIEW_BY_ID[a].toCamera.map((x, k) => x + VIEW_BY_ID[b].toCamera[k])).toEqual([0, 0, 0]);
  });
});

describe('gleiche Lage und Ausdehnung in allen Projektionen', () => {
  it('jede Projektion bildet genau die Weltausdehnung des KÃ¶rpers auf ihre Achsen ab', () => {
    for (const b of ASYM.bodies) {
      const { lo, hi } = worldBox(b);
      for (const v of VIEWS) {
        const p = projectBody(b, v);
        // u = right Â· p, v = up Â· p; fÃ¼r Achsvektoren mit Vorzeichen Â±1 ergibt sich die Ausdehnung direkt
        const range = (dir: V3) => { const k = dir.findIndex((x) => x !== 0); const s = dir[k]; return s > 0 ? [lo[k], hi[k]] : [-hi[k], -lo[k]]; };
        const [u0, u1] = range(v.right);
        const [v0, v1] = range(v.up);
        close(p.bbox.u0, u0); close(p.bbox.u1, u1); close(p.bbox.v0, v0); close(p.bbox.v1, v1);
      }
    }
  });
  it('LÃ¤nge (x) ist in Oben, Unten, Links und Rechts gleich; Breite (y) in Vorne, Hinten, Oben, Unten; HÃ¶he (z) in Vorne, Hinten, Links, Rechts', () => {
    for (const b of ASYM.bodies) {
      const p = Object.fromEntries(VIEWS.map((v) => [v.id, projectBody(b, v).bbox])) as Record<ViewId, { u0: number; u1: number; v0: number; v1: number }>;
      const w = (x: { u0: number; u1: number }) => x.u1 - x.u0;
      const hh = (x: { v0: number; v1: number }) => x.v1 - x.v0;
      const L = hh(p.oben);
      for (const x of [hh(p.unten), w(p.links), w(p.rechts)]) close(x, L);
      const W = w(p.vorne);
      for (const x of [w(p.hinten), w(p.oben), w(p.unten)]) close(x, W);
      const H = hh(p.vorne);
      for (const x of [hh(p.hinten), hh(p.links), hh(p.rechts)]) close(x, H);
    }
  });
});

describe('asymmetrischer Entwurf: Seiten und Kamerarichtungen erkennbar', () => {
  const at = (id: ViewId, bodyId: string) => {
    const pb = projectBody(ASYM.bodies.find((b) => b.id === bodyId)!, VIEW_BY_ID[id]);
    return { u: (pb.bbox.u0 + pb.bbox.u1) / 2, v: (pb.bbox.v0 + pb.bbox.v1) / 2 };
  };
  // Markierung: vorn (+x), links (+y), oben (+z)
  it.each([
    ['vorne', 'rechts', 'oben'], // Blick auf die Front: die linke Objektseite erscheint rechts
    ['hinten', 'links', 'oben'],
    ['links', 'links', 'oben'], // Blick auf die linke Seite: vorn ist links im Bild
    ['rechts', 'rechts', 'oben'], // Blick auf die rechte Seite: vorn ist rechts im Bild
    ['oben', 'links', 'oben'], // Draufsicht, vorn oben im Bild: die linke Seite liegt links
    ['unten', 'rechts', 'oben'], // Untersicht, vorn oben im Bild: die linke Seite erscheint rechts
  ] as [ViewId, 'links' | 'rechts', 'oben' | 'unten'][])('Markierung in Ansicht â€ž%sâ€œ: %s, %s', (view, h, v) => {
    const m = at(view, 'marker');
    expect(m.u > 0 ? 'rechts' : 'links').toBe(h);
    expect(m.v > 0 ? 'oben' : 'unten').toBe(v);
  });
  it('Ausleger (hinten-rechts-unten) liegt in jeder Ansicht auf der Gegenseite der Markierung', () => {
    for (const v of VIEWS) {
      const a = at(v.id, 'marker');
      const b = at(v.id, 'boom');
      expect(Math.sign(a.u) * Math.sign(b.u)).toBe(-1);
      expect(Math.sign(a.v) * Math.sign(b.v)).toBe(-1);
    }
  });
  it('eine versehentliche Spiegelung (y â†’ âˆ’y) verÃ¤ndert die Ansichten erkennbar', () => {
    const mirrored = { bodies: ASYM.bodies.map((b) => ({ ...b, center: { ...b.center, y: -b.center.y } })) };
    const before = projectBody(ASYM.bodies[1], VIEW_BY_ID.vorne).bbox;
    const after = projectBody(mirrored.bodies[1], VIEW_BY_ID.vorne).bbox;
    expect(Math.sign(before.u0 + before.u1)).toBe(-Math.sign(after.u0 + after.u1));
  });
});

describe('gemeinsamer MaÃŸstab', () => {
  it('ein MaÃŸstab fÃ¼r alle sechs Ansichten; das Modell passt in jedes Fenster; gleiche MaÃŸe erscheinen gleich lang', () => {
    const vp = { width: 300, height: 200, margin: 10 };
    const { scale, frames } = sharedFrames(ASYM, vp);
    const size = modelBounds(ASYM).size;
    expect(scale).toBeGreaterThan(0);
    for (const f of frames) {
      const us = f.bodies.flatMap((b) => [b.bbox.u0, b.bbox.u1]);
      const vs = f.bodies.flatMap((b) => [b.bbox.v0, b.bbox.v1]);
      expect((Math.max(...us) - Math.min(...us)) * scale).toBeLessThanOrEqual(vp.width - 2 * vp.margin + 1e-9);
      expect((Math.max(...vs) - Math.min(...vs)) * scale).toBeLessThanOrEqual(vp.height - 2 * vp.margin + 1e-9);
    }
    // LÃ¤nge im Fenster â€žObenâ€œ (senkrecht) = LÃ¤nge im Fenster â€žLinksâ€œ (waagerecht), beide mit demselben MaÃŸstab
    const oben = frames.find((f) => f.view.id === 'oben')!;
    const links = frames.find((f) => f.view.id === 'links')!;
    const ext = (f: typeof oben, k: 'u' | 'v') => (k === 'u' ? Math.max(...f.bodies.map((b) => b.bbox.u1)) - Math.min(...f.bodies.map((b) => b.bbox.u0)) : Math.max(...f.bodies.map((b) => b.bbox.v1)) - Math.min(...f.bodies.map((b) => b.bbox.v0)));
    close(ext(oben, 'v') * scale, ext(links, 'u') * scale);
    close(ext(oben, 'v'), size[0]);
  });
  it('MaÃŸstab hÃ¤ngt nicht von einer einzelnen Ansicht ab: ein langer flacher KÃ¶rper wird nicht in der HÃ¶he gestreckt', () => {
    const flat = { bodies: [body('m', { isMain: true, size: { length: 1, width: 0.2, height: 0.05 } })] };
    const { scale } = sharedFrames(flat, { width: 300, height: 300, margin: 0 });
    expect(scale).toBeCloseTo(300, 9); // durch die LÃ¤nge bestimmt, nicht durch die kleine HÃ¶he
  });
});

describe('KÃ¶rperformen', () => {
  it('Keil: hinten volle HÃ¶he, vorn nur taper Â· HÃ¶he', () => {
    const g = bodyGeometry(body('w', { shape: 'wedge', taper: 0, size: { length: 1, width: 1, height: 1 } }));
    const frontTop = Math.max(...g.vertices.filter((v) => v[0] > 0).map((v) => v[2]));
    const rearTop = Math.max(...g.vertices.filter((v) => v[0] < 0).map((v) => v[2]));
    close(frontTop, -0.5);
    close(rearTop, 0.5);
  });
  it('Drehung: 90Â° Gieren dreht die LÃ¤nge auf die Breitenachse', () => {
    const { lo, hi } = worldBox(body('r', { size: { length: 1, width: 0.2, height: 0.2 }, rotation: { yaw: 90, pitch: 0, roll: 0 } }));
    close(hi[1] - lo[1], 1);
    close(hi[0] - lo[0], 0.2);
  });
});
