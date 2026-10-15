// Integrationstests gegen den echten, privaten Rebrickable-Auszug (Stand 2026-10-14).
// Die erwarteten Abweichungen stammen aus dem manuellen Quellenvergleich (data/references/references.json).
import { describe, expect, it } from 'vitest';
import { compareBom, computeBom } from '../src/core/bom/bom';
import { loadBundle, type DataBundle } from '../src/core/data/bundle';
import { validate } from '../src/core/validation/validate';
import { EDGE_CASES } from '../src/fixtures/edgeCases';
import { generateSpaceship, PALETTES, VARIANTS, type PaletteId } from '../src/generator/spaceship';
import { fsReader, readData, referenceModel } from '../tests/helpers';

let cached: Promise<DataBundle> | null = null;
const real = () => (cached ??= loadBundle(fsReader()));

describe('Echter Katalogauszug', () => {
  it('wird als Rebrickable-Quelle geladen', async () => {
    const b = await real();
    expect(b.catalog.source).toMatchObject({ state: 'loaded', kind: 'rebrickable' });
  });

  it('Farbzuordnung LDraw ↔ Rebrickable für die verwendeten Farben (gleicher Code und Name)', async () => {
    const b = await real();
    for (const code of [0, 1, 2, 4, 14, 15, 19, 71]) expect(b.catalog.color(code)?.mappingBasis, String(code)).toBe('code-and-name');
  });

  it('jede ID-Zuordnung zeigt auf ein Teil im Auszug', async () => {
    const b = await real();
    for (const e of b.catalog.idMap.parts) expect(b.catalog.extract!.parts[e.rebrickable], e.ldraw).toBeDefined();
  });

  it('Teil-Farb-Kombinationen der Referenzen sind belegt', async () => {
    const b = await real();
    for (const id of ['ref-40013-1', 'ref-1869-1']) {
      const bom = computeBom(await referenceModel(id), b.catalog);
      expect(bom.lines.every((l) => l.combination === 'evidenced'), id).toBe(true);
      expect(bom.unresolved).toEqual([]);
    }
  });
});

describe('Unabhängiger Stücklistenabgleich gegen Rebrickable-Inventare', () => {
  it('40013-1: stimmt vollständig überein', async () => {
    const b = await real();
    const cmp = compareBom(computeBom(await referenceModel('ref-40013-1'), b.catalog), '40013-1', b.catalog)!;
    expect(cmp.lines.every((l) => l.status === 'match')).toBe(true);
    expect(cmp.summary.modelTotal).toBe(18);
    expect(cmp.summary.referenceTotal).toBe(18);
  });

  it('21002-1: einzige Abweichung ist die Jumper-Formvariante 3794a ↔ 3794b', async () => {
    const b = await real();
    const cmp = compareBom(computeBom(await referenceModel('ref-21002-1'), b.catalog), '21002-1', b.catalog)!;
    const diff = cmp.lines.filter((l) => l.status !== 'match');
    expect(diff.map((l) => `${l.rebrickablePart}|${l.color}|${l.status}|${l.modelQty}|${l.referenceQty}`).sort()).toEqual(['3794a|19|variant-of|9|0', '3794b|19|variant-of|0|9']);
    expect(cmp.lines.find((l) => l.rebrickablePart === '4162pr0068')?.status).toBe('match');
    expect(cmp.summary.modelTotal).toBe(77);
    expect(cmp.summary.referenceTotal).toBe(77);
    expect(cmp.summary.spareExcluded).toBe(2);
  });

  it('1869-1: Abweichung 3004/3005 gelb wird ausgewiesen, nicht verdeckt', async () => {
    const b = await real();
    const cmp = compareBom(computeBom(await referenceModel('ref-1869-1'), b.catalog), '1869-1', b.catalog)!;
    const diff = cmp.lines.filter((l) => l.status !== 'match');
    expect(diff.map((l) => `${l.rebrickablePart}|${l.color}|${l.modelQty}|${l.referenceQty}`).sort()).toEqual(['3004|14|7|8', '3005|14|2|0']);
    expect(cmp.summary.modelTotal).toBe(82);
    expect(cmp.summary.referenceTotal).toBe(81);
  });
});

describe('Raumschiff-Generator mit echtem Katalog', () => {
  it('alle Teil-Farb-Kombinationen aller Paletten und Varianten sind im Auszug belegt; Katalogprüfung ohne Blocker', async () => {
    const b = await real();
    for (const palette of Object.keys(PALETTES) as PaletteId[])
      for (const [name, v] of Object.entries(VARIANTS)) {
        const { model } = generateSpaceship({ ...v.params, palette });
        const bom = computeBom(model, b.catalog);
        const label = `${name}/${palette}`;
        expect(bom.unresolved, label).toEqual([]);
        expect(bom.lines.filter((l) => l.combination !== 'evidenced').map((l) => `${l.ldrawPart}|${l.ldrawColor}`), label).toEqual([]);
        const r = validate(model, b.catalog);
        expect(r.report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed').map((f) => f.code), label).toEqual([]);
        expect(r.report.findings.map((f) => f.code), label).not.toContain('CAT_SOURCE_UNAVAILABLE');
      }
  });
});

describe('Grenzfall-Erwartungen mit echtem Katalog', () => {
  it('alle deklarierten Erwartungen gelten auch mit dem echten Auszug', async () => {
    const b = await real();
    const exp = JSON.parse(await readData('expectations/edge-cases.json')) as { cases: { caseId: string; include: { code: string }[]; exclude: string[] }[] };
    for (const ec of EDGE_CASES) {
      const e = exp.cases.find((x) => x.caseId === ec.caseId)!;
      const codes = validate(ec.model(), b.catalog).report.findings.map((f) => f.code);
      for (const i of e.include) expect(codes, `${ec.caseId}: ${i.code}`).toContain(i.code);
      for (const x of e.exclude) expect(codes, `${ec.caseId}: ${x}`).not.toContain(x);
    }
  });
});
