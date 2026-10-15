// Kleinere Einheiten: LDraw-Parser, Katalogtrennung, Änderungen/Invalidierung, Exporte, Beschaffung.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../src/core/bom/bom';
import { exportBomCsv, exportLdraw, exportModelJson, exportReportJson } from '../src/core/export/exporters';
import { parseMpd } from '../src/core/ldraw/parse';
import { applyEdit, artifactStatus } from '../src/core/model/edit';
import { contentHash, modelRef } from '../src/core/model/hash';
import { importLdraw } from '../src/core/model/ldrawImport';
import { initialProcurementState, shortfall } from '../src/core/procurement/types';
import { validate } from '../src/core/validation/validate';
import { EDGE_CASES } from '../src/fixtures/edgeCases';
import { bundle, referenceModel } from './helpers';

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

describe('Katalog: getrennte Eigenschaften', () => {
  it('Katalogexistenz, Simulation und Beschaffung sind unabhängig', async () => {
    const b = await bundle();
    const p3008 = b.catalog.part('3008');
    expect(p3008.catalogStatus).toBe('known');
    expect(p3008.simulation).toBe('none');
    const p3001 = b.catalog.part('3001');
    expect(p3001.simulation).toBe('supported');
    expect(b.catalog.part('6541').simulation).toBe('partial');
    expect(b.catalog.part('59900').simulation).toBe('unsupported');
    expect(b.catalog.part('9999x').catalogStatus).toBe('unknown');
    const bom = computeBom(EDGE_CASES[0].model(), b.catalog);
    expect(initialProcurementState(bom).status).toBe('not-checked');
  });

  it('Farbzuordnung LDraw ↔ Rebrickable nur bei gleichem Code und Namen', async () => {
    const b = await bundle();
    for (const code of [0, 1, 2, 4, 14, 15, 19, 71]) expect(b.catalog.color(code)?.mappingBasis, String(code)).toBe('code-and-name');
    expect(b.catalog.color(0x2ff8800)).toBeNull();
  });

  it('jede ID-Zuordnung zeigt auf ein Teil im Rebrickable-Auszug', async () => {
    const b = await bundle();
    for (const e of b.catalog.idMap.parts) expect(b.catalog.extract.parts[e.rebrickable], e.ldraw).toBeDefined();
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
  it('Fehlmengen nach Abzug eines eigenen Bestands (ohne Preise)', async () => {
    const b = await bundle();
    const bom = computeBom(await referenceModel('ref-40013-1'), b.catalog);
    const s = shortfall(bom, { inventoryId: 'eigen', source: 'Test', lines: [{ rebrickablePart: '3004', rebrickableColor: 15, quantity: 3 }] });
    expect(s.find((x) => x.rebrickablePart === '3004' && x.rebrickableColor === 15)).toEqual({ rebrickablePart: '3004', rebrickableColor: 15, needed: 8, owned: 3, toProcure: 5 });
  });
});
