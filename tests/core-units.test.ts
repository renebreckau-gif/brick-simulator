// Kleinere Einheiten: LDraw-Parser, Katalogtrennung, Änderungen/Invalidierung, Exporte, Beschaffung.
import { describe, expect, it } from 'vitest';
import { compareBom, computeBom } from '../src/core/bom/bom';
import { exportBomCsv, exportLdraw, exportModelJson, exportReportJson } from '../src/core/export/exporters';
import { parseMpd } from '../src/core/ldraw/parse';
import { applyEdit, artifactStatus } from '../src/core/model/edit';
import { contentHash, modelRef } from '../src/core/model/hash';
import { importLdraw } from '../src/core/model/ldrawImport';
import { initialProcurementState, shortfall } from '../src/core/procurement/types';
import { validate } from '../src/core/validation/validate';
import { EDGE_CASES } from '../src/fixtures/edgeCases';
import { loadBundle, RequiredDataError } from '../src/core/data/bundle';
import { bundle, fsReader, readerWithCatalog, referenceModel } from './helpers';

describe('LDraw-Parser', () => {
  it('trennt MPD-Dateien, erkennt STEP und liest die Matrix zeilenweise (a..i)', () => {
    const text = ['0 FILE a.ldr', '0 Titel A', '1 4 10 -24 0 0 0 1 0 1 0 -1 0 0 3004.dat', '0 STEP', '1 0 0 0 0 1 0 0 0 1 0 0 0 1 b.ldr', '0 FILE b.ldr', '1 15 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat'].join('\n');
    const files = parseMpd(text, 'x.mpd');
    expect(files.map((f) => f.name)).toEqual(['a.ldr', 'b.ldr']);
    expect(files[0].title).toBe('Titel A');
    const l = files[0].lines[0];
    expect(l.type === 1 && l.rotation).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
    expect(files[0].lines[1]).toMatchObject({ type: 'step' });
    const m = importLdraw(text, { modelId: 't', name: 't', origin: { kind: 'fixture', label: 'Test' }, fileName: 'x.mpd' });
    expect(m.instances).toHaveLength(2);
    expect(m.steps.map((s) => [s.assemblyId, s.add.length, s.attach.length])).toEqual([['main', 1, 0], ['main>b', 1, 0], ['main', 0, 1]]);
  });
});

describe('Katalog: getrennte Eigenschaften (TESTFIXTURE – synthetisch, kein Beleg)', () => {
  it('Katalogexistenz, Simulation und Beschaffung sind unabhängig', async () => {
    const b = await bundle('fixture');
    expect(b.catalog.source).toMatchObject({ state: 'loaded', kind: 'test-fixture' });
    const p3008 = b.catalog.part('3008');
    expect(p3008.catalogStatus).toBe('known');
    expect(p3008.simulation).toBe('none');
    expect(b.catalog.part('3001').simulation).toBe('supported');
    expect(b.catalog.part('6541').simulation).toBe('partial');
    expect(b.catalog.part('59900').simulation).toBe('unsupported');
    expect(b.catalog.part('9999x').catalogStatus).toBe('unknown');
    const bom = computeBom(EDGE_CASES[0].model(), b.catalog);
    expect(initialProcurementState(bom).status).toBe('not-checked');
  });

  it('Farbzuordnung nur bei gleichem Code UND gleichem Namen', async () => {
    const b = await bundle('fixture');
    for (const code of [0, 1, 2, 4, 14, 15, 19, 71]) expect(b.catalog.color(code)?.mappingBasis, String(code)).toBe('code-and-name');
    // Fixture-Farbe 25 hat absichtlich einen anderen Namen als LDraw (Orange) → keine Zuordnung
    expect(b.catalog.color(25)).toMatchObject({ mappingBasis: 'none', rebrickableId: null });
    expect(b.catalog.color(0x2ff8800)).toBeNull();
  });

  it('Teil-Farb-Beleg aus Fixture ist als Fixture gekennzeichnet; fehlender Beleg ist „nicht belegt“', async () => {
    const b = await bundle('fixture');
    expect(b.catalog.partColorEvidence('3001', 15)).toMatchObject({ status: 'evidenced', source: expect.stringContaining('Testfixture') });
    expect(b.catalog.partColorEvidence('3794a', 15).status).toBe('not-evidenced');
    const r = validate(EDGE_CASES[0].model(), b.catalog);
    expect(r.report.findings.find((f) => f.code === 'CAT_COMBO_EVIDENCED')?.message).toContain('TESTFIXTURE');
  });

  it('Inventarabgleich-Logik: Übereinstimmung, Mengenabweichung, Formvariante, nur im Inventar, Ersatzteile', async () => {
    const b = await bundle('fixture');
    const model = EDGE_CASES.find((e) => e.caseId === 'ec-08a-jumper-offset')!.model();
    const cmp = compareBom(computeBom(model, b.catalog), 'FX-SET-1', b.catalog)!;
    expect(cmp.source).toContain('TESTFIXTURE');
    expect(cmp.lines.map((l) => `${l.rebrickablePart}|${l.color}|${l.status}|${l.modelQty}|${l.referenceQty}`)).toEqual([
      '3001|15|match|1|1',
      '3003|1|only-in-reference|0|1',
      '3005|4|quantity-differs|1|2',
      '3794a|15|variant-of|1|0',
      '3794b|15|variant-of|0|1',
    ]);
    expect(cmp.summary.spareExcluded).toBe(1);
  });
});

describe('Katalog fehlt (frischer Checkout)', () => {
  it('alle Katalogaussagen bleiben ungeprüft – keine Ersatzdaten', async () => {
    const b = await bundle('none');
    expect(b.catalog.available).toBe(false);
    expect(b.catalog.source.state).toBe('missing');
    expect(b.catalog.extract).toBeNull();
    expect(b.catalog.part('3001')).toMatchObject({ catalogStatus: 'unavailable', name: null, simulation: 'supported' });
    expect(b.catalog.color(15)).toMatchObject({ ldrawName: 'White', rebrickableId: null, mappingBasis: 'unavailable' });
    expect(b.catalog.partColorEvidence('3001', 15).status).toBe('unchecked');
    expect(b.catalog.version).toContain('katalog-nicht-geladen');
    expect(b.sources.find((s) => s.id === 'catalog')).toMatchObject({ state: 'missing', required: false });
    const r = validate(EDGE_CASES[0].model(), b.catalog);
    const cat = r.report.findings.filter((f) => f.layer === 'catalog');
    expect(cat.map((f) => f.code)).toEqual(['CAT_SOURCE_UNAVAILABLE']);
    expect(cat[0].affected.instanceIds).toHaveLength(2);
    expect(r.report.layers.find((l) => l.layer === 'catalog')?.status).toBe('unchecked');
  });
});

describe('Katalog beschädigt', () => {
  const S = 'baustein-sim/rebrickable-extract@1';
  const variants: [string, string, RegExp][] = [
    ['kein JSON', '{ "schema": ', /kein gültiges JSON/],
    ['falsches Schema', JSON.stringify({ schema: 'etwas/anderes@1' }), /Schema/],
    ['Feld fehlt', JSON.stringify({ schema: S, source: { provider: 'x', fetchedAt: '2026-10-14' } }), /„parts“/],
    ['kaputter Beleg', JSON.stringify({ schema: S, source: { provider: 'x', fetchedAt: '2026-10-14' }, parts: {}, colors: {}, referenceSets: {}, referenceInventories: {}, partColorEvidence: [{ part: 3001 }], relationships: [] }), /partColorEvidence\[0\]/],
    ['Datum ungültig', JSON.stringify({ schema: S, source: { provider: 'x', fetchedAt: 'gestern' } }), /fetchedAt/],
  ];
  for (const [label, text, reason] of variants)
    it(`${label}: nachvollziehbare Meldung, Anwendung bleibt nutzbar`, async () => {
      const b = await loadBundle(readerWithCatalog(text));
      expect(b.catalog.available).toBe(false);
      expect(b.catalog.source.state).toBe('corrupt');
      const err = b.catalog.source.state === 'corrupt' ? b.catalog.source.error : '';
      expect(err).toContain('catalog/rebrickable-extract.json');
      expect(err).toMatch(reason);
      expect(b.sources.find((s) => s.id === 'catalog')?.state).toBe('corrupt');
      const r = validate(EDGE_CASES[0].model(), b.catalog);
      const f = r.report.findings.find((x) => x.code === 'CAT_SOURCE_CORRUPT')!;
      expect(f.status).toBe('unchecked');
      expect(f.message).toMatch(reason);
      expect(r.world.connections.length).toBe(8); // Geometrie unberührt
    });

  it('Lesefehler (nicht „fehlt“) wird nicht als fehlender Katalog verschluckt', async () => {
    const base = fsReader();
    await expect(loadBundle((p) => (p === 'catalog/rebrickable-extract.json' ? Promise.reject(new Error('EACCES: Zugriff verweigert')) : base(p)))).rejects.toThrow('EACCES');
  });

  it('fehlende Pflichtdatei ergibt eindeutige Meldung', async () => {
    const base = fsReader();
    await expect(loadBundle((p) => (p === 'ldraw/LDConfig.ldr' ? Promise.resolve(null) : base(p)))).rejects.toThrow(RequiredDataError);
  });
});

describe('Konstruktive Änderung invalidiert abgeleitete Artefakte', () => {
  it('Version, Hash und Status', async () => {
    const b = await bundle();
    const m = await referenceModel('ref-40013-1');
    const r = validate(m, b.catalog);
    const bom = computeBom(m, b.catalog);
    const target = m.instances[5].instanceId;
    const m2 = applyEdit(m, { kind: 'remove', instanceId: target });
    expect(m2.version).toBe(2);
    expect(contentHash(m2)).not.toBe(contentHash(m));
    expect(m2.steps.flatMap((s) => s.add)).not.toContain(target);
    expect(m2.changeLog[0]).toMatchObject({ fromVersion: 1, toVersion: 2, affectedInstances: [target] });
    for (const k of ['report', 'bom', 'steps', 'procurement'] as const) expect(artifactStatus(k, k === 'bom' ? bom.modelRef : r.report.modelRef, modelRef(m2)).state).toBe('stale');
    expect(computeBom(m2, b.catalog).totalInstances).toBe(17);
    // unverändertes Modell: Artefakte aktuell
    expect(artifactStatus('report', r.report.modelRef, modelRef(m)).state).toBe('current');
  });
});

describe('Exporte', () => {
  it('LDraw-Export und Re-Import ergeben dieselbe Stückliste (Rundreise)', async () => {
    const b = await bundle();
    const m = await referenceModel('ref-21002-1');
    const text = exportLdraw(m);
    const back = importLdraw(text, { modelId: 'rt', name: 'rt', origin: { kind: 'fixture', label: 'Rundreise' }, fileName: 'rt.ldr' });
    const s = (x: ReturnType<typeof computeBom>) => x.lines.map((l) => `${l.ldrawPart}|${l.ldrawColor}|${l.quantity}`);
    expect(s(computeBom(back, b.catalog))).toEqual(s(computeBom(m, b.catalog)));
    // Geometrie unverändert → gleiche Verbindungen
    expect(validate(back, b.catalog).world.connections.length).toBe(validate(m, b.catalog).world.connections.length);
  });

  it('CSV enthält Modellbezug, Kopfzeile und nicht auflösbare Zeilen getrennt', async () => {
    const b = await bundle();
    const m = EDGE_CASES.find((e) => e.caseId === 'ec-09b-missing-color')!.model();
    const csv = exportBomCsv(computeBom(m, b.catalog));
    expect(csv.split('\n')[0]).toContain(`modell=${m.modelId};version=1`);
    expect(csv).toContain('beschaffung=nicht geprueft');
    expect(csv).toContain(`nicht aufloesbar,3001,${0x2ff8800}`);
  });

  it('JSON-Exporte sind parsebar und tragen den Modellbezug', async () => {
    const b = await bundle();
    const m = EDGE_CASES[0].model();
    const r = validate(m, b.catalog);
    expect(JSON.parse(exportModelJson(m)).exportedRef).toEqual(modelRef(m));
    expect(JSON.parse(exportReportJson(r.report)).modelRef).toEqual(modelRef(m));
  });
});

describe('Beschaffung', () => {
  it('Fehlmengen nach Abzug eines eigenen Bestands (ohne Preise, TESTFIXTURE-Zuordnung)', async () => {
    const b = await bundle('fixture');
    const bom = computeBom(await referenceModel('ref-40013-1'), b.catalog);
    const s = shortfall(bom, { inventoryId: 'eigen', source: 'Test', lines: [{ rebrickablePart: '3004', rebrickableColor: 15, quantity: 3 }] });
    expect(s.find((x) => x.rebrickablePart === '3004' && x.rebrickableColor === 15)).toEqual({ rebrickablePart: '3004', rebrickableColor: 15, needed: 8, owned: 3, toProcure: 5 });
  });
});
