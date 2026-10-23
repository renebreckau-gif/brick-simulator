// Auftrag 05B.1: Schrägsteine und Keilplatten gegen ihre tatsächliche LDraw-Geometrie.
// Der Körper ist ein exaktes konvexes Prisma; geprüft wird in beide Richtungen:
//  (1) jeder Körperpunkt der LDraw-Geometrie liegt im Prisma (keine Durchdringung wird übersehen),
//  (2) jede Prismenecke liegt auf einem LDraw-Punkt (das Prisma ist nicht größer – passende Teile werden nicht blockiert).
// Dazu Noppen und Unterseitenstifte gegen die LDraw-Primitive und die Unterseiten-Aufnahmen gegen von Hand
// abgeleitete Sollwerte.
import { describe, expect, it } from 'vitest';
import { definedPartIds, partMeta } from '../src/core/connectivity/partMeta';
import { hullContains, prismContains, prismVertices } from '../src/core/validation/solids';
import { bundle } from './helpers';

const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;

/** Sollwerte Unterseiten-Aufnahmen (Noppenkreis r 6 LDU vollständig unter dem Körper), von Hand abgeleitet. */
const ANTISTUDS: Record<string, string[]> = {
  '3039': ['-10,-20', '-10,0', '10,-20', '10,0'],
  '3298': ['-10,-40', '-10,-20', '-10,0', '10,-40', '10,-20', '10,0'],
  '4286': ['0,-40', '0,-20', '0,0'],
  // Keilplatten: volle Reihe (x = +10) plus ein Feld der schrägen Reihe, dessen Kreis ganz unter dem Körper liegt
  // (Abstand Feldmitte ↔ Schrägkante 7,3 LDU ≥ 6 bei z = 30; 2,4 LDU < 6 bei z = 10)
  '41769a': ['-10,30', '10,-10', '10,-30', '10,10', '10,30'],
  '41770a': ['-10,-10', '-10,-30', '-10,10', '-10,30', '10,30'],
  '43722a': ['-10,20', '10,-20', '10,0', '10,20'],
  '43723a': ['-10,-20', '-10,0', '-10,20', '10,20'],
  // 05B.2: Keilsteine – gleicher Grundriss wie die Keilplatten 4×2, also dieselben Aufnahmen
  '41767': ['-10,30', '10,-10', '10,-30', '10,10', '10,30'],
  '41768': ['-10,-10', '-10,-30', '-10,10', '-10,30', '10,30'],
  // 05B.2: inverser Schrägstein trägt nur auf der hinteren, flachen Reihe; Scheibe nur auf der vorderen Leiste
  '3747b': ['-10,0', '10,0'],
  '2437': ['-10,-20', '-30,-20', '10,-20', '30,-20'],
};

const shapedIds = definedPartIds().filter((i) => partMeta(i)!.bodyPrisms || partMeta(i)!.bodyHulls);

describe('Prismenkörper ↔ LDraw-Geometrie', () => {
  it('die Liste der geprüften Formteile ist vollständig', () => {
    expect(shapedIds.sort()).toEqual(Object.keys(ANTISTUDS).sort());
  });
  for (const id of shapedIds) {
    it(id, async () => {
      const b = await bundle();
      const meta = partMeta(id)!;
      const flat = b.library.flatten(`${id}.dat`);
      expect(flat.missing).toEqual([]);
      // Körperpunkte: alle Dreiecksecken unterhalb der Noppenoberseite (y ≥ 0); Noppen ragen nach −y
      const pts = flat.triangles.flatMap((t) => t.points).filter((p) => p[1] >= -1e-6);
      const prisms = meta.bodyPrisms ?? [];
      const hulls = meta.bodyHulls ?? [];
      const outside = pts.filter((p) => !prisms.some((pr) => prismContains(pr, p, 0.6)) && !hulls.some((h) => hullContains(h, p, 0.6)));
      expect(outside.slice(0, 3), 'LDraw-Körperpunkte außerhalb des Prismas').toEqual([]);
      const corners = [...prisms.flatMap(prismVertices), ...hulls.flat()];
      const far = corners.filter((c) => !pts.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < 0.6));
      expect(far, 'Prismenecken ohne LDraw-Punkt (Prisma zu groß)').toEqual([]);
      const prim = (names: string[]) => flat.primitives.filter((p) => names.includes(p.file)).map((p) => key(p.transform.position[0], p.transform.position[2])).sort();
      const conn = (kind: string) => meta.connectors.filter((c) => c.kind === kind).map((c) => key(c.position[0], c.position[2])).sort();
      expect(conn('stud'), 'Noppen ↔ stud.dat').toEqual(prim(['stud.dat', 'stud2.dat', 'stud2a.dat']));
      expect(conn('underside_pin'), 'Unterseitenstifte ↔ stud3/stud3a').toEqual(prim(['stud3.dat', 'stud3a.dat']));
      expect(conn('antistud'), 'Unterseiten-Aufnahmen (Sollwerte)').toEqual(ANTISTUDS[id].sort());
      expect(conn('tube'), 'keine Röhren gewertet (verkürzte/teilweise Röhren)').toEqual([]);
      // Höhe und Grundriss der Begrenzungsbox stimmen mit dem Prisma überein
      const xs = corners.map((c) => c[0]);
      const zs = corners.map((c) => c[2]);
      expect(Math.min(...xs)).toBeCloseTo(flat.bbox.min[0], 1);
      expect(Math.max(...xs)).toBeCloseTo(flat.bbox.max[0], 1);
      expect(Math.min(...zs)).toBeCloseTo(flat.bbox.min[2], 1);
      expect(Math.max(...zs)).toBeCloseTo(flat.bbox.max[2], 1);
      expect(flat.bbox.max[1]).toBeCloseTo(meta.size!.height, 3);
    });
  }
});
