// Auftrag 05B.1: Konstruktionsnachweis „Bug mit Kanzel“ aus realen Teilinstanzen.
// Geprüft wird mit dem unveränderten Validator (Verbindungen, Kollision mit exakten Schrägkörpern, Montage),
// dazu Baufolge, Anleitung und Stückliste. Formvorgaben hier sind SYNTHETISCH (keine Vorlagenmessung).
import { describe, expect, it } from 'vitest';
import { computeBom } from '../src/core/bom/bom';
import { buildBow, scaleTarget, type BowVariant } from '../src/core/construct/bowTechnique';
import { syntheticBowTarget, TargetError } from '../src/core/construct/shapeTarget';
import { buildInstructionPlan } from '../src/core/instructions/plan';
import { validate } from '../src/core/validation/validate';
import { bundle } from './helpers';

const BASE = () => syntheticBowTarget({ rows: 14, width: 6, noseRows: 8, rearTop: 9, tipTop: 3, canopy: { fromRow: 1, toRow: 4, width: 4, height: 4 }, label: 'Testform A' });
const variants: BowVariant[] = ['keilplatten', 'schraegsteine'];
const blockers = (r: ReturnType<typeof validate>) => r.report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed').map((f) => `${f.code}: ${f.title}`);

describe.each(variants)('Variante %s', (variant) => {
  for (const W of [6, 8]) {
    it(`${W} Noppen: reale Teile, keine Blocker, zusammenhängend, montierbar; Anleitung und Stückliste`, async () => {
      const b = await bundle();
      const { model, plan } = buildBow(BASE(), { variant, widthStuds: W });
      expect(model.instances.length).toBeGreaterThan(20);
      expect(model.instances.every((i) => b.catalog.part(i.part).meta !== null)).toBe(true);
      const r = validate(model, b.catalog);
      expect(blockers(r)).toEqual([]);
      expect(r.report.findings.some((f) => f.code === 'GRAPH_CONNECTED')).toBe(true);
      expect(r.report.findings.some((f) => f.code === 'COL_NONE')).toBe(true);
      expect(r.report.findings.filter((f) => f.code === 'COL_UNCHECKED')).toEqual([]);
      expect(r.assembly.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed')).toEqual([]);
      const bom = computeBom(model, b.catalog);
      expect(bom.lines.reduce((a, l) => a + l.quantity, 0)).toBe(model.instances.length);
      const instr = buildInstructionPlan(model, b.catalog, b.library);
      expect(instr.steps.length).toBeGreaterThan(2);
      expect(plan.widthStuds).toBe(W);
      // die gebaute größte Breite entspricht der gewählten Breite
      expect(Math.max(...plan.rowsReport.map((x) => x.builtWidth))).toBe(W);
    });
  }
  it('Kanzel aus 45°-Schrägsteinen in getöntem Transparent', () => {
    const { model } = buildBow(BASE(), { variant, widthStuds: 6 });
    const canopy = model.instances.filter((i) => i.assemblyId === 'kanzel');
    expect(canopy.filter((i) => i.part === '3039' && i.color === 40).length).toBeGreaterThan(0);
  });
});

describe('Varianten sind tatsächlich verschieden', () => {
  it('A nutzt Keilplatten, B Schrägsteine; Teilezahlen unterscheiden sich', () => {
    const a = buildBow(BASE(), { variant: 'keilplatten', widthStuds: 6 }).model;
    const b = buildBow(BASE(), { variant: 'schraegsteine', widthStuds: 6 }).model;
    expect(a.instances.some((i) => /^4(1769|1770|3722|3723)a$/.test(i.part))).toBe(true);
    expect(a.instances.some((i) => i.part === '3298')).toBe(false);
    expect(b.instances.some((i) => i.part === '3298')).toBe(true);
    expect(b.instances.some((i) => /^4(1769|1770|3722|3723)a$/.test(i.part))).toBe(false);
    expect(a.instances.length).not.toBe(b.instances.length);
  });
});

describe('Reaktion auf eine geänderte Formvorgabe', () => {
  it('längere Spitze und weiter vorn liegende Kanzel ergeben ein anderes Modell mit anderem Profil', async () => {
    // Testform B: kürzere, steilere Spitze; Kanzel zwei Reihen weiter vorn (auf der dann längeren ebenen Oberkante)
    const t2 = syntheticBowTarget({ rows: 14, width: 6, noseRows: 7, rearTop: 9, tipTop: 2, canopy: { fromRow: 3, toRow: 6, width: 4, height: 4 }, label: 'Testform B' });
    const bd = await bundle();
    for (const variant of variants) {
      const a = buildBow(BASE(), { variant, widthStuds: 6 });
      const b2 = buildBow(t2, { variant, widthStuds: 6 });
      // auch die geänderte Form ist ohne Blocker gebaut (bei beiden Breiten)
      expect(blockers(validate(b2.model, bd.catalog))).toEqual([]);
      expect(blockers(validate(buildBow(t2, { variant, widthStuds: 8 }).model, bd.catalog))).toEqual([]);
      expect(b2.model.modelId).not.toBe(a.model.modelId);
      expect(JSON.stringify(b2.plan.rowsReport.map((r) => [r.builtWidth, r.builtTop]))).not.toBe(JSON.stringify(a.plan.rowsReport.map((r) => [r.builtWidth, r.builtTop])));
      // Kanzel folgt der Vorgabe: ihre Teile liegen weiter vorn (−z)
      const cz = (m: typeof a.model) => Math.min(...m.instances.filter((i) => i.assemblyId === 'kanzel').map((i) => i.position[2]));
      expect(cz(b2.model)).toBeLessThan(cz(a.model));
    }
  });
  it('Skalierung: dieselben Proportionen bei 8 Noppen ergeben mehr Reihen', () => {
    expect(scaleTarget(BASE(), 8).target.rows).toBeGreaterThan(BASE().rows);
  });
  it('Breitentest: 48 Formvorgaben × beide Varianten ohne Blocker (enthält alle früher losen Spitzen)', async () => {
    // Früher lose: lange flache Spitzen (Spitzenreihen nur in der untersten Lage) und Grundplattenfugen unter
    // Fugen der ersten Steinlage. Ein voller Lauf über 432 Kombinationen ist in KONSTRUKTIONSNACHWEIS.md belegt.
    const bd = await bundle();
    const found: string[] = [];
    for (const rows of [11, 14, 17])
      for (const noseFrac of [0.6, 0.8])
        for (const [rearTop, tipTop] of [[6, 1], [9, 3]])
          for (const variant of variants)
            for (const W of [6, 8]) {
              const t = syntheticBowTarget({ rows, width: 6, noseRows: Math.round(rows * noseFrac), rearTop, tipTop });
              const r = validate(buildBow(t, { variant, widthStuds: W }).model, bd.catalog);
              for (const b of blockers(r)) found.push(`${rows}/${noseFrac}/${rearTop}-${tipTop} ${variant} ${W}: ${b}`);
            }
    expect(found).toEqual([]);
  }, 60000);
  it('Kanzel über reinen Schrägflächen entfällt mit Abweichung statt Fehler', () => {
    // Stumpfe, hohe Spitze: Schrägsteinlagen enden gestaffelt, unter der Kanzel ist keine Reihe eben
    const t = { ...BASE(), rows: 11, width: [6, 6, 5.6, 5.9, 5.8, 5.2, 4.6, 4, 3.3, 2.6, 1.9], top: [13.3, 13.1, 12.5, 12.6, 11.7, 10.8, 9.6, 8.6, 7.7, 6.8, 0.5], canopy: { fromRow: 2, toRow: 7, width: 2.9, height: 1 } };
    const { model, plan } = buildBow(t, { variant: 'schraegsteine', widthStuds: 6 });
    expect(plan.deviations.join('\n')).toMatch(/Kanzel entfällt: Rumpfoberkante in Reihe 2–7 ist nirgends eben/);
    expect(model.instances.some((i) => i.assemblyId === 'kanzel')).toBe(false);
  });
  it('ungültige Vorgaben werden abgewiesen', () => {
    expect(() => buildBow({ ...BASE(), width: [] }, { variant: 'keilplatten', widthStuds: 6 })).toThrow(TargetError);
    expect(() => buildBow(BASE(), { variant: 'keilplatten', widthStuds: 7 })).toThrow(/gerade Noppenzahl/);
  });
});
