// Auftrag 05B.1: Kollisionsprüfung mit exakten Schräg- und Keilkörpern.
// Je Fall wird gezeigt: der exakte Körper gibt den Freiraum frei, wo die Begrenzungsbox fälschlich blockieren
// würde, und erkennt die Durchdringung, wo ein kleinerer Innenquader sie übersehen würde.
import { describe, expect, it } from 'vitest';
import { boxesPenetrate } from '../src/core/math';
import { validate } from '../src/core/validation/validate';
import { penetrationDepth, solidFromBox, solidFromPrism, sweepSolid } from '../src/core/validation/solids';
import { buildWorld } from '../src/core/validation/world';
import { fixture, FROM_ABOVE, type PartSpec } from '../src/fixtures/build';
import { bundle } from './helpers';

const world = async (parts: PartSpec[]) => buildWorld(fixture({ id: 't', name: 't', description: 'synthetischer Kollisionsfall', parts }), (await bundle()).catalog);
const aabbHit = (w: Awaited<ReturnType<typeof world>>, a: string, b: string) => boxesPenetrate(w.instances.get(a)!.bodySolids[0].aabb, w.instances.get(b)!.bodySolids[0].aabb, 0.5);

describe('Trennachsentest (konvexe Körper)', () => {
  it('Quader: Eindringtiefe = kleinste Achsüberlappung wie bisher', () => {
    const a = solidFromBox({ min: [0, 0, 0], max: [10, 10, 10] });
    const b = solidFromBox({ min: [7, 2, 4], max: [20, 20, 20] });
    expect(penetrationDepth(a, b)).toBeCloseTo(3, 9);
    expect(penetrationDepth(a, solidFromBox({ min: [12, 0, 0], max: [20, 10, 10] }))).toBeLessThan(0);
  });
  it('Prisma und schräge Fläche: Abstand entlang der Flächennormale', () => {
    // Keil: Querschnitt (y, z) mit Schräge y = −z, Würfel knapp darüber bzw. 2 LDU hinein
    const wedge = solidFromPrism({ axis: 0, polygon: [[0, 0], [10, -10], [10, 0]], lo: -5, hi: 5 }, { position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
    const above = solidFromBox({ min: [-5, -2, -10], max: [5, 3, -5] }); // Ecke (y 3, z −5): y < −z → über der Schräge
    expect(penetrationDepth(wedge, above)).toBeLessThanOrEqual(0);
    const into = solidFromBox({ min: [-5, 2, -9], max: [5, 9, -3] }); // Ecke (y 9, z −3) liegt 4,2 LDU in der Schräge
    expect(penetrationDepth(wedge, into)).toBeGreaterThan(2);
  });
  it('Montageweg: ein Körper, der von oben über die Schräge geführt wird, trifft sie', () => {
    const wedge = solidFromPrism({ axis: 0, polygon: [[0, 0], [10, -10], [10, 0]], lo: -5, hi: 5 }, { position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
    const goal = solidFromBox({ min: [-5, 11, -10], max: [5, 15, 0] }); // Ziel unter dem Keil, Weg von oben (−y nach +y)
    expect(penetrationDepth(sweepSolid(goal, [0, 1, 0], 1000), wedge)).toBeGreaterThan(0.5);
    const beside = solidFromBox({ min: [6, 11, -10], max: [12, 15, 0] });
    expect(penetrationDepth(sweepSolid(beside, [0, 1, 0], 1000), wedge)).toBeLessThanOrEqual(0.5);
  });
});

describe('Schrägstein 3039 im Modell', () => {
  it('Platte im Freiraum über der Schräge (berührt nur): keine Durchdringung – die Begrenzungsbox würde blockieren', async () => {
    // Schräge: y = −10 − z; Platte 1×1 bei z −40…−20, y 2…10: Unterkante berührt die Schräge genau an der Kante z = −20
    const w = await world([{ id: 's', part: '3039', at: [0, 0, 0] }, { id: 'p', part: '3024', at: [0, 2, -30] }]);
    expect(w.overlaps).toEqual([]);
    expect(aabbHit(w, 's', 'p')).toBe(true);
  });
  it('dieselbe Platte 4 LDU tiefer: echte Durchdringung (≈ 2,8 LDU senkrecht zur Schräge)', async () => {
    const w = await world([{ id: 's', part: '3039', at: [0, 0, 0] }, { id: 'p', part: '3024', at: [0, 6, -30] }]);
    expect(w.overlaps).toHaveLength(1);
    expect(w.overlaps[0].classification).toBe('penetration');
    expect(w.overlaps[0].depth).toBeCloseTo(4 / Math.SQRT2, 1);
  });
  it('2×2-Platte auf der Noppenreihe ragt über die Schräge: zwei Noppenverbindungen, keine Durchdringung', async () => {
    const w = await world([{ id: 's', part: '3039', at: [0, 0, 0] }, { id: 'p', part: '3022', at: [0, -8, -10] }]);
    expect(w.connections.filter((c) => c.male.instanceId === 's')).toHaveLength(2);
    expect(w.overlaps).toEqual([]);
  });
});

describe('Keilplatte 41769a im Modell', () => {
  it('Platte im ausgesparten Eck neben der Keilkante (berührt nur): frei – die Begrenzungsbox würde blockieren', async () => {
    // Keilkante: 0,97·x + 0,24·z = −9,7 (von (−20, 40) nach (0, −40)); Platte x −25…−5, z −40…−20 berührt sie bei (−5, −20)
    const w = await world([{ id: 'k', part: '41769a', at: [0, 0, 0] }, { id: 'p', part: '3024', at: [-15, 0, -30] }]);
    expect(w.overlaps).toEqual([]);
    expect(aabbHit(w, 'k', 'p')).toBe(true);
  });
  it('dieselbe Platte 5 LDU weiter innen: Durchdringung', async () => {
    const w = await world([{ id: 'k', part: '41769a', at: [0, 0, 0] }, { id: 'p', part: '3024', at: [-10, 0, -30] }]);
    expect(w.overlaps.map((o) => o.classification)).toEqual(['penetration']);
  });
});

describe('Verbindungen der Formteile (gültig und ungültig)', () => {
  it('Schräge auf 2×2-Platte: vier Aufnahmen auf vier Noppen; Gesamtmodell ohne Blocker', async () => {
    const m = fixture({
      id: 'stack', name: 'Platte + Schräge + Platte', description: 'synthetisch',
      parts: [{ id: 'base', part: '3022', at: [0, 24, -10] }, { id: 's', part: '3039', at: [0, 0, 0] }, { id: 'top', part: '3022', at: [0, -8, -10] }],
      steps: [{ add: ['base'] }, { add: ['s'], insertion: { s: FROM_ABOVE } }, { add: ['top'], insertion: { top: FROM_ABOVE } }],
    });
    const b = await bundle();
    const w = buildWorld(m, b.catalog);
    expect(w.connections.filter((c) => c.female.instanceId === 's')).toHaveLength(4);
    const r = validate(m, b.catalog);
    expect(r.report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed').map((f) => f.code)).toEqual([]);
  });
  it('Schräge um eine halbe Noppe versetzt: keine Verbindung (lose)', async () => {
    const w = await world([{ id: 'base', part: '3022', at: [0, 24, -10] }, { id: 's', part: '3039', at: [10, 0, 0] }]);
    expect(w.connections.filter((c) => c.female.instanceId === 's')).toHaveLength(0);
  });
  it('Keilplatte: keine Aufnahme unter dem ausgesparten Teil (Noppe dort verbindet nicht)', async () => {
    // Noppe einer 1×1-Platte unter (−10, z 10) der Keilplatte: Feld liegt nur teilweise unter dem Keil
    const w = await world([{ id: 'k', part: '41769a', at: [0, -8, 0] }, { id: 'p', part: '3024', at: [-10, 0, 10] }]);
    expect(w.connections).toEqual([]);
    const ok = await world([{ id: 'k', part: '41769a', at: [0, -8, 0] }, { id: 'p', part: '3024', at: [10, 0, 10] }]);
    expect(ok.connections).toHaveLength(1);
  });
});
