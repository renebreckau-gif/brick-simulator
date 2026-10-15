// Raumschiff-Generator (spaceship-gen@1.0.0): Reproduzierbarkeit, echte Variantenunterschiede, Teilezahl,
// Außenmaße aus Geometrie, nicht erfüllbare Parameter, unabhängige Validierung, Konsistenz von Modell,
// Baufolge, Stückliste und Export, Betrieb ohne privaten Katalog, begrenzte Laufzeit.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../src/core/bom/bom';
import { exportBomCsv, exportLdraw, exportModelJson, exportReportJson } from '../src/core/export/exporters';
import { contentHash, modelRef, sameModelVersion } from '../src/core/model/hash';
import { modelDimensions } from '../src/core/model/dimensions';
import { importLdraw } from '../src/core/model/ldrawImport';
import type { CanonicalModel } from '../src/core/model/types';
import { validate } from '../src/core/validation/validate';
import { generateSpaceship, GeneratorError, HULL_ATTEMPTS, VARIANTS, type ShipParams } from '../src/generator/spaceship';
import { bundle } from './helpers';

const variants = Object.entries(VARIANTS);
/** Geometrie ohne Farben (für den Nachweis, dass Varianten sich konstruktiv unterscheiden). */
const shape = (m: CanonicalModel) => m.instances.map((i) => `${i.part}@${i.position.join(',')}/${i.rotation.join('')}`).sort();

describe('Raumschiff-Generator: Reproduzierbarkeit und Varianten', () => {
  it('gleiche Eingaben ergeben dieselbe Konstruktion (Instanzen, Baufolge, Hash)', () => {
    for (const [, v] of variants) {
      const a = generateSpaceship(v.params);
      const b = generateSpaceship({ ...v.params });
      expect(b.model).toEqual(a.model);
      expect(contentHash(b.model)).toBe(contentHash(a.model));
      expect(a.model.generator).toEqual({ name: 'spaceship', version: 'spaceship-gen@1.0.0', params: v.params });
    }
  });

  it('festgeschriebene Inhalts-Hashes je Variante (gleich in Node und Browser; Änderung erfordert neue Generatorversion)', () => {
    const expected: Record<string, [number, string]> = {
      kompakt: [109, '1e8af544544d5b'],
      langgestreckt: [140, '1985663483f52a'],
      breit: [138, '0f7156c108e4fd'],
    };
    for (const [name, v] of variants) {
      const { model } = generateSpaceship(v.params);
      expect([model.instances.length, contentHash(model)], name).toEqual(expected[name]);
    }
  });

  it('die drei Varianten unterscheiden sich konstruktiv, nicht nur farblich', () => {
    const shapes = variants.map(([, v]) => shape(generateSpaceship(v.params).model));
    for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) expect(shapes[i]).not.toEqual(shapes[j]);
    // Farbpalette allein ändert die Geometrie nicht
    const base = VARIANTS.kompakt.params;
    expect(shape(generateSpaceship({ ...base, palette: 'stahl' }).model)).toEqual(shape(generateSpaceship(base).model));
    // Variantenkennung (Seed) ändert die Steinaufteilung
    expect(shape(generateSpaceship({ ...base, seed: 99 }).model)).not.toEqual(shape(generateSpaceship(base).model));
  });

  it('Teilezahl im Zielbereich, gleich der Stückliste; Plan offengelegt', async () => {
    const b = await bundle('none');
    for (const [, v] of variants) {
      const { model, plan } = generateSpaceship(v.params);
      expect(model.instances.length).toBe(plan.target);
      expect(model.instances.length).toBeGreaterThanOrEqual(v.params.partMin);
      expect(model.instances.length).toBeLessThanOrEqual(v.params.partMax);
      const bom = computeBom(model, b.catalog);
      expect(bom.lines.reduce((s, l) => s + l.quantity, 0) + bom.unresolved.reduce((s, u) => s + u.quantity, 0)).toBe(model.instances.length);
      expect(plan.hullAttempt).toBeLessThan(HULL_ATTEMPTS);
      expect(plan.relaxations.every((r) => !r.includes('nur durchgehende'))).toBe(true);
    }
  });

  it('Außenmaße aus der Geometrie: Länge = Rumpflänge, Breite = Spannweite, Höhe aus Teilhöhen', async () => {
    const b = await bundle('none');
    for (const [, v] of variants) {
      const { model } = generateSpaceship(v.params);
      const d = modelDimensions(model, b.library);
      expect(d.missingGeometry).toEqual([]);
      expect(d.studs.length).toBe(v.params.hullLength);
      expect(d.studs.width).toBe(v.params.span);
      // unabhängige Gegenrechnung der Höhe: höchste Teiloberkante plus Noppe (4 LDU), falls dort Noppen
      const top = Math.min(...model.instances.map((i) => i.position[1]));
      expect(d.box.max[1]).toBe(0); // Unterseite auf y = 0
      expect([-top, -top + 4]).toContain(d.ldu.height);
    }
  });

  it('nicht erfüllbare Parameter ergeben eine verständliche Meldung mit Hinweisen', () => {
    const p = VARIANTS.kompakt.params;
    const cases: [Partial<ShipParams>, RegExp][] = [
      [{ hullLength: 14 }, /Rumpflänge 14 nicht baubar.*10, 12, 16, 20/],
      [{ span: 13 }, /Spannweite 13 nicht baubar/],
      [{ partMin: 400, partMax: 500 }, /nicht erfüllbar: möglich sind \d+–\d+ Teile/],
      [{ partMin: 5, partMax: 20 }, /nicht erfüllbar/],
      [{ partMin: 150, partMax: 100 }, /Teilezahlbereich ungültig/],
      [{ seed: -1 }, /Variantenkennung/],
    ];
    for (const [delta, msg] of cases) {
      let err: unknown;
      try {
        generateSpaceship({ ...p, ...delta });
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(delta)).toBeInstanceOf(GeneratorError);
      expect((err as GeneratorError).message).toMatch(msg);
      expect((err as GeneratorError).hints.length).toBeGreaterThan(0);
    }
  });
});

describe('Raumschiff: unabhängige Validierung (ohne privaten Katalog)', () => {
  const FORBIDDEN = [
    'COL_PENETRATION', 'COL_PARTIAL_INSERTION', 'COL_UNCHECKED', 'GEO_DEFORMED', 'GEO_MIRRORED', 'GEO_FREE_ROTATION', 'GEO_UNAVAILABLE',
    'GRAPH_LOOSE', 'GRAPH_UNKNOWN_LINK', 'GRAPH_SNOT_UNSUPPORTED', 'CON_UNSUPPORTED_FEATURE', 'CAT_SIM_PARTIAL', 'CAT_SIM_UNSUPPORTED',
    'ASM_CONFLICTING_DIRECTIONS', 'ASM_PATH_BLOCKED', 'ASM_DIRECTION_MISMATCH', 'ASM_UNIT_UNCHECKED', 'ASM_MODULE_INCOMPLETE', 'ASM_STEPS_INCONSISTENT',
    'STR_SINGLE_STUD_LINK', 'CON_UPIN_HOLLOWSTUD',
  ];
  for (const [name, v] of variants)
    it(`${name}: keine Blocker, alles verbunden, kollisionsfrei, keine Sondertechnik, Baufolge ausführbar`, async () => {
      const b = await bundle('none');
      const { model } = generateSpaceship(v.params);
      const r = validate(model, b.catalog);
      const codes = r.report.findings.map((f) => f.code);
      expect(r.report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed').map((f) => f.code)).toEqual([]);
      for (const c of FORBIDDEN) expect(codes, c).not.toContain(c);
      for (const c of ['GRAPH_CONNECTED', 'COL_NONE', 'GEO_RIGID_OK', 'ASM_SEQUENCE_OK', 'STAB_STANDS', 'CAT_SOURCE_UNAVAILABLE']) expect(codes, c).toContain(c);
      expect(r.report.findings.find((f) => f.code === 'STAB_STANDS')!.evidenceLevel).toBe('heuristic');
      expect(r.report.findings.filter((f) => f.layer === 'structure').every((f) => f.evidenceLevel === 'heuristic')).toBe(true);
      expect(model.origin.kind).toBe('generated');
      expect(model.usage.intendedUse).toBe('display');
    });

  it('viele Varianten (Seeds × Maße): Generator besteht den Validator ohne Ausnahme', async () => {
    const b = await bundle('none');
    let n = 0;
    for (const hullLength of [10, 12, 16, 20])
      for (const span of [10, 12, 14, 16])
        for (const seed of [0, 7, 23]) {
          const params: ShipParams = { hullLength, span, partMin: 60, partMax: 260, palette: 'stahl', seed };
          const { model } = generateSpaceship(params);
          const r = validate(model, b.catalog);
          const bad = r.report.findings.filter((f) => f.severity === 'blocker' || ['GRAPH_UNKNOWN_LINK', 'CON_UNSUPPORTED_FEATURE', 'COL_UNCHECKED'].includes(f.code));
          expect(bad.map((f) => `${f.code}:${f.affected.instanceIds.join(',')}`), JSON.stringify(params)).toEqual([]);
          n++;
        }
    expect(n).toBe(48);
  });
});

describe('Raumschiff: Konsistenz von Modell, Baufolge, Stückliste und Export', () => {
  it('jedes Teil genau einmal verbaut; Baugruppe Ausleger vormontiert und einmal aufgesetzt', () => {
    for (const [, v] of variants) {
      const { model } = generateSpaceship(v.params);
      expect(model.steps.flatMap((s) => s.add).sort()).toEqual(model.instances.map((i) => i.instanceId).sort());
      expect(model.steps.flatMap((s) => s.attach)).toEqual(['ausleger']);
      expect(model.assemblies.find((a) => a.assemblyId === 'ausleger')!.builtSeparately).toBe(true);
      expect(model.stepsSource).toBe('generated');
      for (const s of model.steps) expect(s.source).toMatch(/keine Herstelleranleitung, nicht physisch erprobt/);
      // Hand­unterstützung für lose Bodenplatten ausdrücklich dokumentiert, wenn mehrere Platten
      const first = model.steps.find((s) => s.notes?.[0] === 'Rumpf: Bodenplatten')!;
      expect(!!first.support).toBe(first.add.length > 1);
    }
  });

  it('Bericht, Stückliste und Exporte beziehen sich auf dieselbe Modellversion; LDraw-Rundreise', async () => {
    const b = await bundle('none');
    const { model } = generateSpaceship(VARIANTS.breit.params);
    const ref = modelRef(model);
    const r = validate(model, b.catalog);
    const bom = computeBom(model, b.catalog);
    expect(sameModelVersion(r.report.modelRef, ref) && sameModelVersion(bom.modelRef, ref)).toBe(true);
    expect(JSON.parse(exportModelJson(model)).exportedRef).toEqual(ref);
    expect(JSON.parse(exportReportJson(r.report)).modelRef).toEqual(ref);
    expect(exportBomCsv(bom).split('\n')[0]).toContain(`hash=${ref.contentHash}`);
    const back = importLdraw(exportLdraw(model), { modelId: 'rt', name: 'rt', origin: { kind: 'fixture', label: 'Rundreise' }, fileName: 'rt.ldr' });
    const s = (x: ReturnType<typeof computeBom>) => x.lines.map((l) => `${l.ldrawPart}|${l.ldrawColor}|${l.quantity}`);
    expect(s(computeBom(back, b.catalog))).toEqual(s(bom));
    expect(validate(back, b.catalog).world.connections.length).toBe(r.world.connections.length);
  });

  it('Parameteränderung ergibt neuen Modellstand; alter Bericht passt nicht mehr', async () => {
    const b = await bundle('none');
    const a = generateSpaceship(VARIANTS.kompakt.params).model;
    const c = generateSpaceship({ ...VARIANTS.kompakt.params, span: 14 }).model;
    const ra = validate(a, b.catalog);
    expect(sameModelVersion(ra.report.modelRef, modelRef(c))).toBe(false);
  });
});

describe('Raumschiff: Laufzeit', () => {
  it('Erzeugen + Prüfen jeder Variante unter 3 s', async () => {
    const b = await bundle('none');
    for (const [, v] of variants) {
      const t0 = performance.now();
      validate(generateSpaceship(v.params).model, b.catalog);
      expect(performance.now() - t0).toBeLessThan(3000);
    }
  });
});
