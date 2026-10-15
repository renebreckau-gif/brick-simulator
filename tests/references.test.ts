// Referenzkorpus: unabhängiger Stücklistenabgleich (OMR-Geometrie ↔ Rebrickable-Inventar),
// Konsistenz von Baufolge und Stückliste, Herkunftsangaben.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compareBom, computeBom } from '../src/core/bom/bom';
import { sameModelVersion } from '../src/core/model/hash';
import { validate } from '../src/core/validation/validate';
import { bundle, readData, referenceModel } from './helpers';

describe('Referenzen', () => {
  it('Herkunft: Datei-Hashes entsprechen dem Register', async () => {
    const b = await bundle();
    for (const r of b.references) {
      const text = await readData(r.file);
      expect(createHash('sha256').update(text).digest('hex'), r.referenceId).toBe(r.source.sha256);
      expect(r.source.license).toMatch(/CC BY/);
      expect(r.notCovered.length).toBeGreaterThan(0);
    }
  });

  it('40013-1: Stückliste stimmt vollständig mit dem Rebrickable-Inventar überein', async () => {
    const b = await bundle();
    const cmp = compareBom(computeBom(await referenceModel('ref-40013-1'), b.catalog), '40013-1', b.catalog)!;
    expect(cmp.lines.every((l) => l.status === 'match')).toBe(true);
    expect(cmp.summary.modelTotal).toBe(18);
    expect(cmp.summary.referenceTotal).toBe(18);
  });

  it('21002-1: einzige Abweichung ist die Jumper-Formvariante 3794a ↔ 3794b (in references.json dokumentiert)', async () => {
    const b = await bundle();
    const cmp = compareBom(computeBom(await referenceModel('ref-21002-1'), b.catalog), '21002-1', b.catalog)!;
    const diff = cmp.lines.filter((l) => l.status !== 'match');
    expect(diff.map((l) => `${l.rebrickablePart}|${l.color}|${l.status}|${l.modelQty}|${l.referenceQty}`).sort()).toEqual([
      '3794a|19|variant-of|9|0',
      '3794b|19|variant-of|0|9',
    ]);
    // Druckteil über manuelle Zuordnung aufgelöst
    expect(cmp.lines.find((l) => l.rebrickablePart === '4162pr0068')?.status).toBe('match');
    expect(cmp.summary.modelTotal).toBe(77);
    expect(cmp.summary.referenceTotal).toBe(77);
    expect(cmp.summary.spareExcluded).toBe(2);
  });

  it('1869-1: Abweichung 3004/3005 gelb wird ausgewiesen, nicht verdeckt', async () => {
    const b = await bundle();
    const cmp = compareBom(computeBom(await referenceModel('ref-1869-1'), b.catalog), '1869-1', b.catalog)!;
    const diff = cmp.lines.filter((l) => l.status !== 'match');
    expect(diff.map((l) => `${l.rebrickablePart}|${l.color}|${l.modelQty}|${l.referenceQty}`).sort()).toEqual(['3004|14|7|8', '3005|14|2|0']);
    expect(cmp.summary.modelTotal).toBe(82);
    expect(cmp.summary.referenceTotal).toBe(81);
  });

  it('Baufolge und Stückliste beziehen sich auf dieselbe Modellversion; jedes Teil genau einmal verbaut', async () => {
    const b = await bundle();
    for (const id of ['ref-40013-1', 'ref-21002-1']) {
      const m = await referenceModel(id);
      const bom = computeBom(m, b.catalog);
      const r = validate(m, b.catalog);
      expect(sameModelVersion(bom.modelRef, r.report.modelRef)).toBe(true);
      const added = m.steps.flatMap((s) => s.add).sort();
      expect(added).toEqual(m.instances.map((i) => i.instanceId).sort());
      // Baugruppen: jede Unterbaugruppe wird genau einmal angesetzt
      const attached = m.steps.flatMap((s) => s.attach).sort();
      expect(attached).toEqual(m.assemblies.filter((a) => a.parentId).map((a) => a.assemblyId).sort());
      expect(r.assembly.steps.length).toBe(m.steps.length);
    }
  });

  it('21002-1: Baugruppen aus den MPD-Untermodellen', async () => {
    const m = await referenceModel('ref-21002-1');
    expect(m.assemblies.map((a) => a.assemblyId).sort()).toEqual(['main', 'main>21002-base', 'main>21002-building']);
    expect(m.stepsSource).toBe('source-file');
  });

  it('1869-1: ohne STEP-Angaben gilt die Baufolge als nicht belegt', async () => {
    const m = await referenceModel('ref-1869-1');
    expect(m.steps).toEqual([]);
    expect(m.stepsSource).toBe('none');
  });
});
