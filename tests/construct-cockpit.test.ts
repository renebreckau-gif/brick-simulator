// Auftrag 05B.2: Variante C (Hohlbau mit Cockpit, abnehmbare Kanzel), Funktionsprüfung, Belege und Masse.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCockpitBow } from '../src/core/construct/cockpitTechnique';
import { syntheticBowTarget } from '../src/core/construct/shapeTarget';
import { coverageFor, EvidenceFileSchema, massEstimate, type EvidenceFile } from '../src/core/procurement/evidence';
import { validate } from '../src/core/validation/validate';
import { IDENTITY } from '../src/core/math';
import type { CanonicalModel } from '../src/core/model/types';
import { buildInstructionPlan } from '../src/core/instructions/plan';
import { bundle, DATA } from './helpers';

const TARGET = () => syntheticBowTarget({ rows: 14, width: 6, noseRows: 8, rearTop: 12, tipTop: 5, canopy: { fromRow: 1, toRow: 7, width: 4, height: 5 }, label: 'Testform Cockpit' });
const findings = (m: CanonicalModel, catalog: Parameters<typeof validate>[1]) => validate(m, catalog).report.findings;
const failed = (fs: ReturnType<typeof findings>, sev = 'blocker') => fs.filter((f) => f.status === 'failed' && f.severity === sev).map((f) => f.code);

describe('Variante C', () => {
  it('Hohlbau: keine Blocker, Innenraum frei, Kanzel gerade abnehmbar, Anschluss frei; Anleitung ableitbar', async () => {
    const b = await bundle();
    const { model, plan } = buildCockpitBow(TARGET(), { widthStuds: 8 });
    const fs = findings(model, b.catalog);
    expect(failed(fs)).toEqual([]);
    expect(fs.filter((f) => f.code === 'FUNC_KEEPOUT_CLEAR').length).toBe(3);
    expect(fs.some((f) => f.code === 'FUNC_REMOVAL_OK')).toBe(true);
    expect(fs.some((f) => f.code === 'FUNC_INTERFACE_COVERED')).toBe(false);
    expect(plan.cockpit).toMatchObject({ widthStuds: 4 });
    expect(model.assemblies.find((a) => a.assemblyId === 'kanzel')?.builtSeparately).toBe(true);
    expect(model.instances.some((i) => i.part === '2437')).toBe(true);
    expect(buildInstructionPlan(model, b.catalog, b.library).steps.length).toBeGreaterThan(5);
  });

  it('geänderte Innenraumanforderung: kürzere Öffnung ergibt anderes, weiterhin geprüftes Modell', async () => {
    const b = await bundle();
    const a = buildCockpitBow(TARGET(), { widthStuds: 8 });
    const c = buildCockpitBow(TARGET(), { widthStuds: 8, req: { openingRows: 4 } });
    expect(c.model.modelId).not.toBe(a.model.modelId);
    expect(c.plan.cockpit!.lengthStuds).toBe(4);
    expect(c.plan.cockpit!.lengthStuds).toBeLessThan(a.plan.cockpit!.lengthStuds);
    expect(failed(findings(c.model, b.catalog))).toEqual([]);
  });

  it('Massivbau gleicher Außenform: kein Innenraum, mehr Masse (Katalogmassen)', async () => {
    const ev = EvidenceFileSchema.parse(JSON.parse(readFileSync(join(DATA, 'procurement/evidence-05b2.json'), 'utf8')));
    const hollow = buildCockpitBow(TARGET(), { widthStuds: 8 }).model;
    const solid = buildCockpitBow(TARGET(), { widthStuds: 8, req: { hollow: false } }).model;
    expect(solid.functional!.keepouts).toEqual([]);
    expect(massEstimate(solid, ev).grams).toBeGreaterThan(massEstimate(hollow, ev).grams);
  });

  it('Breitentest: 24 Formvorgaben × Breiten 6/8/10 ohne Blocker', async () => {
    const b = await bundle();
    const bad: string[] = [];
    for (const rows of [11, 14, 17])
      for (const [rearTop, tipTop] of [[9, 3], [15, 8]])
        for (const canopy of [{ fromRow: 1, toRow: 6, width: 4, height: 5 }, { fromRow: 2, toRow: 8, width: 4, height: 4 }])
          for (const W of [6, 8, 10]) {
            const t = syntheticBowTarget({ rows, width: 6, noseRows: Math.round(rows * 0.6), rearTop, tipTop, canopy });
            const codes = failed(findings(buildCockpitBow(t, { widthStuds: W }).model, b.catalog));
            if (codes.length) bad.push(`${rows}/${rearTop}/${canopy.toRow}/${W}: ${codes.join(',')}`);
          }
    expect(bad).toEqual([]);
  }, 120000);
});

describe('Funktionsprüfung – Gegenproben', () => {
  it('Stein im Cockpit → Freiraum verletzt', async () => {
    const b = await bundle();
    const { model } = buildCockpitBow(TARGET(), { widthStuds: 8 });
    const k = model.functional!.keepouts[0];
    const x = (k.min[0] + k.max[0]) / 2;
    const z = (k.min[2] + k.max[2]) / 2;
    const bad: CanonicalModel = { ...model, instances: [...model.instances, { instanceId: 'stoerer', part: '3003', color: 72, position: [x, -8 - 24, z], rotation: IDENTITY, assemblyId: 'rumpf' }] };
    expect(findings(bad, b.catalog).some((f) => f.code === 'FUNC_KEEPOUT_VIOLATED' && f.affected.instanceIds.includes('stoerer'))).toBe(true);
  });
  it('Entnahme seitlich → gesperrt durch senkrechte Steckverbindungen', async () => {
    const b = await bundle();
    const { model } = buildCockpitBow(TARGET(), { widthStuds: 8 });
    const side: CanonicalModel = { ...model, functional: { ...model.functional!, removable: [{ assemblyId: 'kanzel', label: 'Kanzel', direction: [1, 0, 0] }] } };
    expect(failed(findings(side, b.catalog))).toContain('FUNC_REMOVAL_BLOCKED');
  });
  it('Kanzel ohne Verbindungsplatten zerfällt beim Abnehmen', async () => {
    const b = await bundle();
    const { model } = buildCockpitBow(TARGET(), { widthStuds: 8 });
    const noLinks: CanonicalModel = { ...model, instances: model.instances.filter((i) => !(i.assemblyId === 'kanzel' && i.part === '3023' && i.color === 40)) };
    expect(failed(findings(noLinks, b.catalog))).toContain('FUNC_REMOVAL_BLOCKED');
  });
});

describe('Teil-Farb-Belege und Mengenabdeckung', () => {
  const offer = (id: string, qty: number, cond: 'new' | 'used' = 'new', region = 'DE') => ({ offerId: id, part: { system: 'bricklink' as const, id: '3001' }, color: { system: 'bricklink' as const, id: '85' }, condition: cond, quantityAvailable: qty, shipsFromRegion: region, deliveryRegions: [region], unitPrice: { amount: 0.1, currency: 'EUR' }, shipping: { amount: null, currency: 'EUR', note: null }, seller: { name: id, sourceUrl: 'x' }, provider: 'test', checkedAt: '2026-10-23T00:00:00Z' });
  const ev = (offers: ReturnType<typeof offer>[], elementIds = ['4211085']): EvidenceFile => ({ schema: 'baustein-sim/part-evidence@1', checkedAt: '2026-10-23', region: 'DE', note: 'synthetisch', colorMapping: [], lines: [{ ldraw: { part: '3001', color: 72 }, rebrickable: { part: '3001', color: 72, colorName: 'Dark Bluish Gray', elementIds, setInventories: 0, years: null }, bricklink: { part: '3001', color: 85, colorName: 'Dark Bluish Gray' }, existence: [], weightG: 2.32, offers }] });
  const model = (n: number, color = 72) => ({ instances: Array.from({ length: n }, (_, k) => ({ instanceId: `i${k}`, part: '3001', color, position: [0, 0, 0], rotation: IDENTITY, assemblyId: 'r' })) }) as unknown as CanonicalModel;

  it('gedeckt aus mehreren Angeboten, jedes nur einmal gezählt', () => {
    const c = coverageFor(model(10), ev([offer('a', 6), offer('a', 6), offer('b', 5)]));
    expect(c.lines[0]).toMatchObject({ status: 'gedeckt', covered: 10 });
    expect(c.lines[0].used.map((u) => u.offer.offerId)).toEqual(['a', 'b']);
  });
  it('teilweise, kein Angebot, kein Existenzbeleg, falsche Region, gebraucht nur auf Wunsch', () => {
    expect(coverageFor(model(10), ev([offer('a', 4)])).lines[0].status).toBe('teilweise');
    expect(coverageFor(model(1), ev([])).lines[0].status).toBe('kein-angebot');
    expect(coverageFor(model(1), ev([offer('a', 4)], [])).lines[0].status).toBe('kein-existenzbeleg');
    expect(coverageFor(model(1, 71), ev([offer('a', 4)])).lines[0].status).toBe('kein-existenzbeleg');
    expect(coverageFor(model(1), ev([offer('a', 4, 'new', 'US')])).lines[0].status).toBe('kein-angebot');
    expect(coverageFor(model(1), ev([offer('a', 4, 'used')])).lines[0].status).toBe('kein-angebot');
    expect(coverageFor(model(1), ev([offer('a', 4, 'used')]), { allowUsed: true }).lines[0].status).toBe('gedeckt');
  });
  it('Belegdatei deckt die Stückliste der Variante C vollständig', () => {
    const e = EvidenceFileSchema.parse(JSON.parse(readFileSync(join(DATA, 'procurement/evidence-05b2.json'), 'utf8')));
    const c = coverageFor(buildCockpitBow(TARGET(), { widthStuds: 8 }).model, e);
    expect(c.lines.filter((l) => l.status !== 'gedeckt').map((l) => `${l.ldrawPart}/${l.ldrawColor}`)).toEqual([]);
    expect(c.massG).toBeGreaterThan(0);
  });
});
