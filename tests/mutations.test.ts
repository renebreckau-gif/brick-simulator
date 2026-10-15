// Gezielt fehlerhafte Varianten positiver Referenzen: Fehler müssen erkannt UND lokalisiert werden.
// Geometrische Fehler ohne Katalog; die Farb-Mutation zusätzlich mit TESTFIXTURE-Katalog
// (Katalogbefund) und ohne Katalog (Stücklistenzeile nicht auflösbar).
import { describe, expect, it } from 'vitest';
import { computeBom } from '../src/core/bom/bom';
import { validate } from '../src/core/validation/validate';
import { MUTATIONS } from '../src/fixtures/mutations';
import { bundle, referenceModel } from './helpers';

describe('Fehlervarianten', () => {
  for (const ref of ['ref-40013-1', 'ref-1869-1']) {
    for (const mut of MUTATIONS) {
      const mode = mut.mutationId === 'unmapped-color' ? 'fixture' : 'none';
      it(`${ref} / ${mut.mutationId} [${mode === 'fixture' ? 'TESTFIXTURE-Katalog' : 'ohne Katalog'}]`, async () => {
        const b = await bundle(mode);
        const base = await referenceModel(ref);
        if (mut.mutationId === 'last-part-first' && base.steps.length === 0) return; // ohne Baufolge nicht anwendbar
        const { model, target } = mut.apply(base);
        const r = validate(model, b.catalog);
        const codes = mut.expectCode.split('|');
        const hits = r.report.findings.filter((f) => codes.includes(f.code));
        expect(hits.length, `${mut.title}: ${mut.expectCode} erwartet`).toBeGreaterThan(0);
        expect(hits.some((f) => f.affected.instanceIds.includes(target)), `Befund lokalisiert ${target}`).toBe(true);
        // Unverändertes Original bleibt blockerfrei (Kontrollgruppe)
        const orig = validate(base, b.catalog);
        expect(orig.report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed')).toEqual([]);
      });
    }
    it(`${ref} / unmapped-color [ohne Katalog]: Direktfarbe bleibt als nicht auflösbare Stücklistenzeile sichtbar`, async () => {
      const b = await bundle('none');
      const { model, target } = MUTATIONS.find((m) => m.mutationId === 'unmapped-color')!.apply(await referenceModel(ref));
      const bom = computeBom(model, b.catalog);
      expect(bom.unresolved.some((u) => u.instanceIds.includes(target))).toBe(true);
    });
  }
});
