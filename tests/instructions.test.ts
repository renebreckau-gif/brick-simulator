// Anleitungsplan (instr-plan@1.0.0): Teilezählung, Vormontagen, Modellbezug, Invalidierung,
// Zwischenzustände und Betrieb ohne privaten Katalog.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../src/core/bom/bom';
import { buildInstructionPlan, CAMERAS, checkInstructionPlan, germanPartName, InstructionPlanError, INSTRUCTION_PLAN_VERSION, MAX_NEW_PARTS, type InstructionPlan } from '../src/core/instructions/plan';
import { applyEdit, artifactStatus } from '../src/core/model/edit';
import { modelRef } from '../src/core/model/hash';
import type { CanonicalModel } from '../src/core/model/types';
import { validate } from '../src/core/validation/validate';
import { generateSpaceship, VARIANTS } from '../src/generator/spaceship';
import { pdfText } from '../src/ui/instructions/pdf';
import { notice } from '../src/ui/instructions/document';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash } from '../src/core/model/hash';
import { labItems } from '../src/ui/items';
import { bundle } from './helpers';

const variants = Object.entries(VARIANTS);
const planFor = async (params: (typeof VARIANTS)['kompakt']['params'], mode: 'none' | 'fixture' = 'none') => {
  const b = await bundle(mode);
  const { model } = generateSpaceship(params);
  return { b, model, plan: buildInstructionPlan(model, b.catalog, b.library) };
};

describe('Anleitungsplan: Modellbezug und Reproduzierbarkeit', () => {
  for (const [name, v] of variants)
    it(`${name}: Plan verweist auf Modell-ID, Version und Hash; eigene Planversion; deterministisch`, async () => {
      const { b, model, plan } = await planFor(v.params);
      expect(plan.modelRef).toEqual(modelRef(model));
      expect(plan.planVersion).toBe(INSTRUCTION_PLAN_VERSION);
      expect(plan.totalParts).toBe(model.instances.length);
      expect(checkInstructionPlan(plan, model)).toEqual([]);
      const again = buildInstructionPlan(model, b.catalog, b.library);
      expect(again).toEqual(plan);
      expect(plan.sequenceCheck.status).toBe('refined-ok');
    });

  it('Plan verändert das kanonische Modell nicht', async () => {
    const b = await bundle('none');
    const { model } = generateSpaceship(VARIANTS.langgestreckt.params);
    const before = JSON.stringify(model);
    buildInstructionPlan(model, b.catalog, b.library);
    expect(JSON.stringify(model)).toBe(before);
  });
});

describe('Anleitungsplan: Teilezählung', () => {
  for (const [name, v] of variants)
    it(`${name}: jedes Teil genau einmal neu; Summe der Schritte = Modellstückliste; kleine Schritte`, async () => {
      const { b, model, plan } = await planFor(v.params);
      const added = plan.steps.flatMap((s) => s.add);
      expect(added.length).toBe(model.instances.length);
      expect(new Set(added).size).toBe(added.length);
      expect([...added].sort()).toEqual(model.instances.map((i) => i.instanceId).sort());
      // unabhängiger Mengenabgleich gegen computeBom
      const sum = new Map<string, number>();
      for (const s of plan.steps) for (const l of s.newParts) sum.set(`${l.part}|${l.color}`, (sum.get(`${l.part}|${l.color}`) ?? 0) + l.quantity);
      const bom = computeBom(model, b.catalog);
      expect(Object.fromEntries([...sum].sort())).toEqual(Object.fromEntries(bom.lines.map((l) => [`${l.ldrawPart}|${l.ldrawColor}`, l.quantity]).sort()));
      expect(plan.bom.reduce((a, l) => a + l.quantity, 0)).toBe(model.instances.length);
      for (const s of plan.steps) expect(s.add.length, `Schritt ${s.number}`).toBeLessThanOrEqual(MAX_NEW_PARTS);
      expect(plan.steps.length).toBeGreaterThan(model.steps.length);
    });

  it('Teilenamen aus LDraw, Umleitungen aufgelöst, keine erfundenen Elementnummern', async () => {
    const { plan } = await planFor(VARIANTS.langgestreckt.params);
    const names = new Set(plan.bom.map((l) => l.partName));
    for (const n of names) expect(n).toMatch(/^(Stein|Platte|Fliese) \d+×\d+$/);
    expect(plan.bom.find((l) => l.part === '3023')!.partName).toBe('Platte 1×2');
    expect(germanPartName('~Moved to 3023b', '3023', () => 'Plate  1 x  2')).toBe('Platte 1×2');
    // Sonderformen nie auf das Grundteil verkürzen
    expect(germanPartName('Plate  1 x  2 without Groove with 1 Centre Stud', '3794a')).toBe('Plate 1 x 2 without Groove with 1 Centre Stud');
    expect(germanPartName('Brick  1 x  2 with Pin', '2458')).toBe('Brick 1 x 2 with Pin');
    expect(germanPartName('Tile  1 x  8 with "Empire State Building" Pattern', '4162p0b')).toBe('Tile 1 x 8 with "Empire State Building" Pattern');
    expect(germanPartName('Tile  1 x  2 with Groove', '3069b')).toBe('Fliese 1×2');
    expect(JSON.stringify(plan)).not.toMatch(/element|preis|€|EUR/i);
  });
});

describe('Anleitungsplan: Vormontage Ausleger', () => {
  for (const [name, v] of variants)
    it(`${name}: isoliert gebaut, einmal angesetzt, nicht doppelt gezählt`, async () => {
      const { model, plan } = await planFor(v.params);
      const moduleIds = new Set(model.instances.filter((i) => i.assemblyId === 'ausleger').map((i) => i.instanceId));
      const moduleSteps = plan.steps.filter((s) => s.isModule);
      const attachSteps = plan.steps.filter((s) => s.attach.length);
      expect(attachSteps).toHaveLength(1);
      const at = attachSteps[0];
      // Vormontage vollständig vor dem Einbau, isoliert dargestellt und eigens eingerahmt
      expect(Math.max(...moduleSteps.map((s) => s.number))).toBeLessThan(at.number);
      for (const s of moduleSteps) {
        expect(s.shown.every((id) => moduleIds.has(id)), `Schritt ${s.number}`).toBe(true);
        expect(s.frame).toBe('modul:ausleger');
      }
      expect(moduleSteps[0].cameraNote).toMatch(/separat gebaut/);
      // Einbau: keine neuen Einzelteile, Baugruppe als eine Position mit Verweis auf ihre Schritte
      expect(at.add).toEqual([]);
      expect(at.newParts).toEqual([]);
      expect(at.attachedModules).toEqual([{ assemblyId: 'ausleger', name: 'Ausleger (Vormontage)', instanceCount: moduleIds.size, builtInSteps: moduleSteps.map((s) => s.number) }]);
      expect(new Set(at.highlight)).toEqual(moduleIds);
      expect(at.insertion).toMatchObject({ kind: 'von-oben', checked: true });
      expect(at.frame).toBe('hauptmodell');
      expect(at.cameraNote).toMatch(/Bildausschnitt erweitert/);
      // Hauptmodell vor dem Einbau enthält keine Ausleger-Teile
      for (const s of plan.steps.filter((x) => !x.isModule && x.number < at.number)) expect(s.shown.some((id) => moduleIds.has(id))).toBe(false);
    });
});

describe('Anleitungsplan: Zwischenzustände, Kameras, Einsetzrichtung', () => {
  for (const [name, v] of variants)
    it(`${name}: gezeigter Bauzustand folgt exakt dem Plan; verfeinerte Folge besteht den Montageprüfer`, async () => {
      const { b, model, plan } = await planFor(v.params);
      const state = new Map<string, string[]>();
      const moduleIds = (aid: string) => model.instances.filter((i) => i.assemblyId === aid).map((i) => i.instanceId);
      for (const s of plan.steps) {
        const expected = [...(state.get(s.context) ?? []), ...s.add, ...s.attach.flatMap(moduleIds)];
        expect(s.shown, `Schritt ${s.number}`).toEqual(expected);
        expect(s.highlight).toEqual([...s.add, ...s.attach.flatMap(moduleIds)]);
        state.set(s.context, expected);
        expect(Object.keys(CAMERAS)).toContain(s.camera);
        expect([null, 'oben']).toContain(s.detailCamera);
        if (!s.insertion.checked) expect(s.insertion.arrowUnits).toEqual([]);
        expect(model.steps.some((c) => c.stepId === s.sourceStepId)).toBe(true);
      }
      // kanonische Reihenfolge bleibt erhalten
      const order = plan.steps.map((s) => model.steps.findIndex((c) => c.stepId === s.sourceStepId));
      expect([...order].sort((a, c) => a - c)).toEqual(order);
      expect(state.get('main')!.length).toBe(model.instances.length);
      // unabhängige Nachprüfung: Plan-Schritte als Baufolge → Montageprüfer ohne Blocker
      const derived: CanonicalModel = { ...model, steps: plan.steps.map((s) => ({ ...model.steps.find((c) => c.stepId === s.sourceStepId)!, stepId: s.key, add: s.add, attach: s.attach })) };
      const r = validate(derived, b.catalog);
      expect(r.report.findings.filter((f) => f.layer === 'assembly' && f.severity === 'blocker').map((f) => f.code)).toEqual([]);
      expect(r.report.findings.map((f) => f.code)).toContain('ASM_SEQUENCE_OK');
    });

  it('Handunterstützung der Bodenplatten wird übernommen (langgestreckt: zwei Platten)', async () => {
    const { plan } = await planFor(VARIANTS.langgestreckt.params);
    const s = plan.steps.find((x) => x.title.startsWith('Rumpf: Bodenplatten'))!;
    expect(s.support.join(' ')).toMatch(/Handunterstützung/);
    expect(s.insertion.kind).toBe('ablegen');
  });
});

describe('Anleitungsplan: Invalidierung nach Modelländerung', () => {
  it('geänderte Modellversion → Plan veraltet; neuer Plan für die neue Version', async () => {
    const { b, model, plan } = await planFor(VARIANTS.langgestreckt.params);
    const tile = model.instances.find((i) => i.part === '3070b')!;
    const edited = applyEdit(model, { kind: 'remove', instanceId: tile.instanceId });
    expect(artifactStatus('steps', plan.modelRef, modelRef(edited)).state).toBe('stale');
    expect(checkInstructionPlan(plan, edited).join(' ')).toMatch(/Plan gehört zu .* v1/);
    const next = buildInstructionPlan(edited, b.catalog, b.library);
    expect(next.modelRef.version).toBe(2);
    expect(next.totalParts).toBe(model.instances.length - 1);
    expect(checkInstructionPlan(next, edited)).toEqual([]);
    expect(next.planHash).not.toBe(plan.planHash);
  });

  it('Modell mit Blockern: keine Anleitung', async () => {
    const b = await bundle('none');
    const { model } = generateSpaceship(VARIANTS.kompakt.params);
    const brick = model.instances.find((i) => i.instanceId.startsWith('rumpf-l1'))!;
    const broken = applyEdit(model, { kind: 'move', instanceId: brick.instanceId, delta: [10, 0, 0] });
    expect(() => buildInstructionPlan(broken, b.catalog, b.library)).toThrow(InstructionPlanError);
  });
});

describe('Anleitungsplan: Katalogzustand', () => {
  it('ohne Katalog: LDraw-Nummern und -Farbnamen, Zustand „missing“; mit Testfixture: gleiche Schritte', async () => {
    const none = await planFor(VARIANTS.breit.params, 'none');
    const fix = await planFor(VARIANTS.breit.params, 'fixture');
    expect(none.plan.catalogState).toBe('missing');
    expect(none.plan.bom.every((l) => !l.colorName.includes('_'))).toBe(true);
    expect(fix.plan.steps.map((s) => s.add)).toEqual(none.plan.steps.map((s) => s.add));
  });
});

describe('PDF-Text', () => {
  it('Zeichen außerhalb Latin-1 werden lesbar ersetzt, Umlaute bleiben', () => {
    expect(pdfText('Außenmaße „ca.“ – 3 × 4 → ≈ 5 • x')).toBe('Außenmaße "ca." - 3 × 4 -> ca. 5 ? x');
  });
});

describe('Anleitung für beliebige kanonische Modelle (nicht an den Raumschiffgenerator gekoppelt)', () => {
  it('jedes Labormodell ohne Blocker mit Baufolge erhält einen konsistenten Plan; sonst eine klare Ablehnung', async () => {
    const b = await bundle('none');
    let built = 0;
    for (const item of labItems(b)) {
      const m = item.make();
      const blockers = validate(m, b.catalog).report.findings.some((f) => f.severity === 'blocker' && f.status === 'failed');
      if (blockers || !m.steps.length) {
        expect(() => buildInstructionPlan(m, b.catalog, b.library), item.id).toThrow(InstructionPlanError);
        continue;
      }
      const plan = buildInstructionPlan(m, b.catalog, b.library);
      expect(checkInstructionPlan(plan, m), item.id).toEqual([]);
      expect(plan.sequenceCheck.status, item.id).toBe('refined-ok');
      for (const s of plan.steps) expect(plan.frames[s.frame], `${item.id} Schritt ${s.number}`).toBeDefined();
      built++;
    }
    expect(built).toBeGreaterThanOrEqual(20);
  });

  it('verschachtelte Vormontagen (21002-1 nach LEGO-Anleitung): Unterbaugruppen werden mitgeführt, nicht doppelt gezählt', async () => {
    const b = await bundle('none');
    const item = labItems(b).find((i) => i.id === 'ref-21002-1~anleitung')!;
    const m = item.make();
    const plan = buildInstructionPlan(m, b.catalog, b.library);
    expect(plan.steps.filter((s) => s.attach.length).length).toBeGreaterThan(0);
    for (const s of plan.steps.filter((x) => x.attach.length)) {
      expect(s.newParts.flatMap((l) => l.instanceIds)).toEqual(s.add);
      for (const mod of s.attachedModules) expect(mod.instanceCount).toBe(plan.frameIds[`modul:${mod.assemblyId}`].length);
    }
    expect(plan.steps.flatMap((s) => s.add).length).toBe(m.instances.length);
  });

  it('Herkunftshinweis richtet sich nach dem Modell (Referenz ≠ eigener Entwurf)', async () => {
    const b = await bundle('none');
    const ghost = buildInstructionPlan(labItems(b).find((i) => i.id === 'ref-40013-1')!.make(), b.catalog, b.library);
    const ship = (await planFor(VARIANTS.kompakt.params)).plan;
    expect(notice(ghost)).toMatch(/^Referenzmodell .*keine Herstelleranleitung/);
    expect(notice(ghost)).not.toMatch(/Eigener Entwurf/);
    expect(notice(ship)).toMatch(/^Eigener Entwurf/);
    for (const n of [notice(ghost), notice(ship)]) expect(n).toMatch(/Nicht physisch erprobt/);
  });

  it('Anleitungscode importiert weder Generator noch generatorspezifische Module', () => {
    const files = [join('src', 'core', 'instructions', 'plan.ts'), ...readdirSync(join('src', 'ui', 'instructions')).map((f) => join('src', 'ui', 'instructions', f))];
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/generator\/|spaceship|ausleger/i);
  });

  it('Entwurfsherkunft (Bildquelle, Annahmen, Abweichungen) wird am Modell gespeichert, gehasht und in den Plan übernommen', async () => {
    const b = await bundle('none');
    const base = labItems(b).find((i) => i.id === 'ref-40013-1')!.make();
    const withDesign: CanonicalModel = {
      ...base,
      design: {
        schema: 'baustein-sim/design-provenance@1',
        sources: [{ sourceId: 'img-1', kind: 'concept-image', label: 'Testskizze (synthetisch)', mediaType: 'image/png', sha256: '0'.repeat(64), rights: 'eigene Testdaten' }],
        assumptions: [{ id: 'A1', statement: 'Rückseite wie Vorderseite', basis: 'nicht sichtbar im Bild' }],
        deviations: [{ id: 'D1', description: 'Rundung als Stufen', reason: 'nur rechtwinklige Teile unterstützt' }],
        visualComparison: { method: 'noch nicht implementiert', version: '0', status: 'unchecked' },
      },
    };
    expect(contentHash(withDesign)).not.toBe(contentHash(base));
    const plan = buildInstructionPlan(withDesign, b.catalog, b.library);
    expect(plan.design).toEqual(withDesign.design);
    expect(buildInstructionPlan(base, b.catalog, b.library).design).toBeNull();
  });
});

export type { InstructionPlan };
