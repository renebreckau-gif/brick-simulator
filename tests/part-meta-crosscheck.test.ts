// Unabhängiger Abgleich der eigenen Anschluss-Metadaten gegen die LDraw-Geometrie:
// Die Metadaten sind parametrisch aus Teilmaßen erzeugt, der Abgleich liest dagegen die
// Positionen der LDraw-Primitive (stud.dat, stud2.dat, stud3.dat, stud4.dat) und die Begrenzungsbox.
import { describe, expect, it } from 'vitest';
import { definedPartIds, partMeta } from '../src/core/connectivity/partMeta';
import { bundle } from './helpers';

const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;

/** Bekannte, begründete Abweichungen zwischen Begrenzungsbox und Körper (Anbauten außerhalb des Körpers). */
const BBOX_EXCEPTIONS: Record<string, string> = {
  '2458': 'Technic-Pin ragt seitlich 20 LDU über den Körper hinaus (nicht im Kollisionsmodell, als nicht unterstützt deklariert).',
};

describe('Teil-Metadaten ↔ LDraw-Geometrie', () => {
  // Teile mit exakten Prismenkörpern (Schrägen, Keilplatten) prüft tests/part-meta-shaped.test.ts
  for (const id of definedPartIds().filter((i) => !partMeta(i)!.bodyPrisms && !partMeta(i)!.bodyHulls)) {
    it(id, async () => {
      const b = await bundle();
      const meta = partMeta(id)!;
      const flat = b.library.flatten(`${id}.dat`);
      expect(flat.missing, 'alle Unterdateien vorhanden').toEqual([]);
      const body = meta.bodyBoxes[0];
      const hasStuds = meta.connectors.some((c) => c.kind === 'stud');
      if (!BBOX_EXCEPTIONS[id]) {
        expect(flat.bbox.min[0]).toBeCloseTo(body.min[0], 3);
        expect(flat.bbox.max[0]).toBeCloseTo(body.max[0], 3);
        expect(flat.bbox.min[2]).toBeCloseTo(body.min[2], 3);
        expect(flat.bbox.max[2]).toBeCloseTo(body.max[2], 3);
      }
      expect(flat.bbox.max[1]).toBeCloseTo(body.max[1], 3);
      expect(flat.bbox.min[1]).toBeCloseTo(hasStuds ? -4 : 0, 3);

      const prim = (names: string[]) => flat.primitives.filter((p) => names.includes(p.file)).map((p) => key(p.transform.position[0], p.transform.position[2])).sort();
      const conn = (kind: string, pred: (c: { hollow?: boolean }) => boolean = () => true) =>
        meta.connectors.filter((c) => c.kind === kind && pred(c)).map((c) => key(c.position[0], c.position[2])).sort();

      expect(conn('stud'), 'Noppen ↔ stud.dat/stud2.dat').toEqual(prim(['stud.dat', 'stud2.dat']));
      expect(conn('stud', (c) => !!c.hollow), 'Hohlnoppen ↔ stud2.dat').toEqual(prim(['stud2.dat']));
      expect(conn('tube'), 'Röhren ↔ stud4.dat').toEqual(prim(['stud4.dat']));
      expect(conn('underside_pin'), 'Unterseitenstifte ↔ stud3.dat').toEqual(prim(['stud3.dat']));
    });
  }
});
