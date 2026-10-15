// Referenzkorpus ohne privaten Katalog: Herkunft, Baufolge, Baugruppen, Stückliste aus Modellinstanzen.
// Der unabhängige Abgleich gegen echte Rebrickable-Inventare liegt in tests-rebrickable/ (optional).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compareBom, computeBom } from '../src/core/bom/bom';
import { sameModelVersion } from '../src/core/model/hash';
import { validate } from '../src/core/validation/validate';
import { bundle, readData, referenceModel } from './helpers';

describe('Referenzen (ohne Katalog)', () => {
  it('Herkunft: Datei-Hashes entsprechen dem Register', async () => {
    const b = await bundle('none');
    for (const r of b.references) {
      const text = await readData(r.file);
      expect(createHash('sha256').update(text).digest('hex'), r.referenceId).toBe(r.source.sha256);
      expect(r.source.license).toMatch(/CC BY/);
      expect(r.notCovered.length).toBeGreaterThan(0);
    }
  });

  it('Stückliste entsteht aus den Modellinstanzen; Katalogfelder bleiben ungeprüft', async () => {
    const b = await bundle('none');
    for (const [id, set, total] of [['ref-40013-1', '40013-1', 18], ['ref-21002-1', '21002-1', 77], ['ref-1869-1', '1869-1', 82]] as const) {
      const bom = computeBom(await referenceModel(id), b.catalog);
      expect(bom.catalogState).toBe('missing');
      expect(bom.unresolved).toEqual([]);
      expect(bom.lines.reduce((a, l) => a + l.quantity, 0)).toBe(total);
      for (const l of bom.lines) {
        expect(l.rebrickablePart).toBeNull();
        expect(l.rebrickableColor).toBeNull();
        expect(l.combination).toBe('unchecked');
        expect(l.partName.length).toBeGreaterThan(0); // LDraw-Titel statt Katalogname
      }
      // Inventarabgleich ohne Katalog: findet nicht statt (weder Übereinstimmung noch Abweichung)
      expect(compareBom(bom, set, b.catalog)).toBeNull();
    }
  });

  it('Ghost 40013-1: Stückliste nach LDraw-Teil und -Farbe (aus der OMR-Datei abgezählt)', async () => {
    const b = await bundle('none');
    const bom = computeBom(await referenceModel('ref-40013-1'), b.catalog);
    expect(bom.lines.map((l) => `${l.ldrawPart}|${l.ldrawColor}|${l.quantity}|${l.colorName}`)).toEqual(['3002|15|5|White', '3003|15|3|White', '3004|0|2|Black', '3004|15|8|White']);
  });

  it('Baufolge und Stückliste beziehen sich auf dieselbe Modellversion; jedes Teil genau einmal verbaut', async () => {
    const b = await bundle('none');
    for (const id of ['ref-40013-1', 'ref-21002-1']) {
      const m = await referenceModel(id);
      const bom = computeBom(m, b.catalog);
      const r = validate(m, b.catalog);
      expect(sameModelVersion(bom.modelRef, r.report.modelRef)).toBe(true);
      const added = m.steps.flatMap((s) => s.add).sort();
      expect(added).toEqual(m.instances.map((i) => i.instanceId).sort());
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
