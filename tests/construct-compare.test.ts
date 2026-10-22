// Vergleich Teilemodell ↔ Vorlage (Auftrag 05B.1): Achsen der Ansichten und Umrissprofile aus LDraw-Geometrie.
import { describe, expect, it } from 'vitest';
import { buildBow } from '../src/core/construct/bowTechnique';
import { largestDeviation, ldrawScreenAxes, modelProfile, profileOverlap, type Profile } from '../src/core/construct/compare';
import { syntheticBowTarget } from '../src/core/construct/shapeTarget';
import { bundle } from './helpers';

describe('Achsen der Ansichten im LDraw-System (vorn = −z, links = +x, oben = −y)', () => {
  it('linke Seite: Vorderseite links im Bild, Blick auf die linke Seite', () => {
    expect(ldrawScreenAxes('links', 'links')).toEqual({ right: [0, 0, 1], down: [0, 1, 0], toCamera: [1, 0, 0] });
  });
  it('rechte Seite: Vorderseite rechts im Bild', () => {
    expect(ldrawScreenAxes('rechts', 'rechts')).toEqual({ right: [0, 0, -1], down: [0, 1, 0], toCamera: [-1, 0, 0] });
  });
  it('Draufsicht mit Vorderseite unten im Bild', () => {
    const a = ldrawScreenAxes('oben', 'unten');
    expect(a.down).toEqual([0, 0, -1]);
    expect(a.toCamera).toEqual([0, -1, 0]);
    // echte Drehung, keine Spiegelung: rechts × oben = zum Betrachter (oben = −unten)
    const up = a.down.map((c) => -c);
    const cr = [a.right[1] * up[2] - a.right[2] * up[1], a.right[2] * up[0] - a.right[0] * up[2], a.right[0] * up[1] - a.right[1] * up[0]];
    expect(cr.map((c) => c + 0)).toEqual(a.toCamera);
  });
});

describe('Umrissprofile des Teilemodells', () => {
  const t = syntheticBowTarget({ rows: 14, width: 6, noseRows: 8, rearTop: 9, tipTop: 3, canopy: { fromRow: 1, toRow: 4, width: 4, height: 4 }, label: 'Testform A' });
  it('Draufsicht: hinten volle Breite, zur Spitze schmaler; Seitenansicht: hinten am höchsten', async () => {
    const b = await bundle();
    const { model, plan } = buildBow(t, { variant: 'keilplatten', widthStuds: 6 });
    const len = plan.rows * 20;
    const top = modelProfile(model, b.library, 'oben', plan.rows);
    const side = modelProfile(model, b.library, 'seite', plan.rows);
    const w = (s: Profile['samples'][number]) => (s ? s.hi - s.lo : 0);
    expect(w(top.samples.at(-1)!)).toBeCloseTo(120 / len, 1); // 6 Noppen = 120 LDU
    expect(w(top.samples[0])).toBeLessThan(w(top.samples.at(-1)!) / 2);
    expect(side.samples[0]!.lo).toBeCloseTo(0, 1); // Unterseite eben
    expect(side.samples.at(-1)!.hi).toBeGreaterThan(side.samples[0]!.hi);
    expect(profileOverlap(top, top)).toBe(1);
    // Ein zur Hälfte schmaleres Profil überdeckt sich nur zur Hälfte
    const half: Profile = { kind: 'breite', samples: top.samples.map((s) => (s ? { lo: s.lo / 2, hi: s.hi / 2 } : null)) };
    expect(profileOverlap(top, half)).toBeCloseTo(0.5, 1);
    expect(largestDeviation(top, half)!.model).toBeGreaterThan(largestDeviation(top, half)!.template);
  });
});
