// 05C.1.1, Punkte 3 und 4: Datenlader (fehlend / beschädigt / nicht erreichbar, Laufzeitprüfung) und Abdeckung
// mit kleinen, von Hand nachrechenbaren Daten – ohne private Dateien.
import { describe, expect, it } from 'vitest';
import { coverage, rebrickableRefSet } from '../src/core/library/coverage';
import { PartLibraryIndex } from '../src/core/library/library';
import { loadLibraryData, type LoadFetch } from '../src/core/library/load';
import type { ConnectorsFile, PartsFile, RebrickableColorsFile } from '../src/core/library/types';

const SHA = 'A'.repeat(64);
const parts: PartsFile = {
  schema: 'baustein-sim/library-parts@1', builder: 't', licence: 't', source: { source: 'ldraw', sha256: SHA, release: '2026-09' },
  parts: {
    a: { t: 'A', ty: 'part', bb: [0, 0, 0, 20, 24, 20] },
    b: { t: 'B', ty: 'part', bb: [0, 0, 0, 20, 8, 20] },
    c: { t: 'C', ty: 'part' }, // ohne Geometrie
  },
};
const conn = (src: 'ldcad-shadow' | 'bricknet', rows: Record<string, number[][]>): ConnectorsFile => ({
  schema: 'baustein-sim/library-connectors@1', builder: 't', licence: 't', source: { source: src, commit: 'x', sha256: 'x' }, types: [['stud', 'r']], parts: rows,
});
const stud = [0, 0, 0, 0, 0, -1, 0];
const colors: RebrickableColorsFile = {
  schema: 'baustein-sim/library-rebrickable-private@2',
  definition: { recentFrom: 2016, excludedCategories: [], identityReasons: ['gleiche Nummer', 'LDraw-Schlüsselwort', 'LDraw-Umbenennung'], inventoryRule: 'neueste', weight: 'Sets', refset: 'Test' },
  counts: { sets: 10, setsRecent: 10, mapped: 3, ambiguous: 0 },
  colors: { '4': ['Red', 'C91A09', false] },
  parts: { a: { rb: { a: ['gleiche Nummer'] }, alternatives: [], colors: [[4, 2, 2, 2020, 2021, true, ['a']]] } },
  ambiguous: {},
  refset: { a: 6, b: 3, c: 1 },
  refsetUnmapped: { x: 10 },
};

describe('Abdeckung: Gesamtbestand und zugeordneter Bestand getrennt, Gewichte inkl. nicht zugeordneter Teile', () => {
  const lib = new PartLibraryIndex(parts, { ldcad: conn('ldcad-shadow', { a: [stud] }), bricknet: conn('bricknet', { a: [stud], b: [stud] }) }, { colors, validator: (id) => (id === 'a' ? 'supported' : 'none') });
  const row = coverage(lib, rebrickableRefSet(lib)!);
  it('Bestand: 3 zugeordnet + 1 ohne Zuordnung, Gewichte 10 + 10', () => {
    expect(row.refset).toMatchObject({ size: 3, unmapped: 1, weightMapped: 10, weightUnmapped: 10 });
  });
  it('Katalog: 3 von 4 Teilen (Gewicht 10 von 20) zugeordnet', () => {
    expect(row.catalog).toMatchObject({ n: 3, mapped: 3, total: 4, weightedTotal: 0.5 });
  });
  it('Geometrie: a, b → 2/3 zugeordnet, 2/4 gesamt; gewichtet (6+3)/10 und (6+3)/20', () => {
    expect(row.geometry).toEqual({ n: 2, mapped: 3, total: 4, weightedMapped: 0.9, weightedTotal: 0.45 });
  });
  it('Anschlüsse: LDCad nur a; mindestens eine Quelle a, b; beide und einig nur a', () => {
    expect(row.ldcad).toMatchObject({ n: 1, weightedMapped: 0.6, weightedTotal: 0.3 });
    expect(row.anyConnectors).toMatchObject({ n: 2, weightedMapped: 0.9 });
    expect(row.bothAgree).toMatchObject({ n: 1, weightedTotal: 0.3 });
  });
  it('prüfbar laut Prüfkern: a → 6/10 zugeordnet, 6/20 gesamt', () => {
    expect(row.checkable).toEqual({ n: 1, mapped: 3, total: 4, weightedMapped: 0.6, weightedTotal: 0.3 });
  });
  it('ohne Prüfkern-Anbindung keine Aussage zur Prüfbarkeit', () => {
    const noVal = new PartLibraryIndex(parts, {}, { colors });
    expect(coverage(noVal, rebrickableRefSet(noVal)!).checkable).toBeNull();
  });
});

function fakeFetch(files: Record<string, { status?: number; body?: string; type?: string; error?: string }>): LoadFetch {
  return async (path) => {
    const f = files[path];
    if (!f) return { status: 404, contentType: 'text/plain', text: async () => '' };
    if (f.error) throw new Error(f.error);
    return { status: f.status ?? 200, contentType: f.type ?? 'application/json', text: async () => f.body ?? '' };
  };
}

describe('Datenlader: fehlend, beschädigt, nicht erreichbar', () => {
  const good = { 'library/parts.json': { body: JSON.stringify(parts) } };
  const state = (d: Awaited<ReturnType<typeof loadLibraryData>>, file: string) => d.files.find((f) => f.file === file)!;

  it('fehlende optionale Dateien: „fehlt“, Bibliothek trotzdem nutzbar', async () => {
    const d = await loadLibraryData(fakeFetch(good));
    expect(d.parts).not.toBeNull();
    expect(state(d, 'library/private/rebrickable-colors.json')).toMatchObject({ state: 'fehlt', required: false });
  });
  it('beschädigter optionaler Farbkatalog (kein JSON) blockiert nichts und heißt „beschädigt“, nicht „fehlt“', async () => {
    const d = await loadLibraryData(fakeFetch({ ...good, 'library/private/rebrickable-colors.json': { body: '{"schema": "baustein-sim/libr' } }));
    expect(d.parts).not.toBeNull();
    expect(d.colors).toBeNull();
    const s = state(d, 'library/private/rebrickable-colors.json');
    expect(s.state).toBe('beschädigt');
    expect(s.reason).toMatch(/kein gültiges JSON/);
    const lib = new PartLibraryIndex(d.parts!, {}, { colors: d.colors, colorsUnavailable: `${s.state} – ${s.reason}` });
    expect(lib.colorEvidence('a')).toMatchObject({ state: 'nicht-geladen', reason: expect.stringMatching(/^beschädigt/) });
  });
  it('gültiges JSON in falscher Form (alte Schemaversion) ist „beschädigt“ mit Ort und Grund', async () => {
    const old = { ...colors, schema: 'baustein-sim/library-rebrickable-private@1' };
    const d = await loadLibraryData(fakeFetch({ ...good, 'library/private/rebrickable-colors.json': { body: JSON.stringify(old) } }));
    expect(state(d, 'library/private/rebrickable-colors.json')).toMatchObject({ state: 'beschädigt', reason: expect.stringMatching(/Datenform ungültig bei schema/) });
  });
  it('kaputte Anschlusszeile wird erkannt', async () => {
    const bad = conn('bricknet', { a: [[0, 1, 2]] });
    const d = await loadLibraryData(fakeFetch({ ...good, 'library/connectors-bricknet.json': { body: JSON.stringify(bad) } }));
    expect(state(d, 'library/connectors-bricknet.json')).toMatchObject({ state: 'beschädigt', reason: expect.stringMatching(/ungültige Anschlusszeile/) });
    expect(d.bricknet).toBeNull();
  });
  it('Netzwerkfehler und Serverfehler: „nicht erreichbar“', async () => {
    const d = await loadLibraryData(fakeFetch({ ...good, 'library/connectors-ldcad.json': { error: 'Failed to fetch' }, 'library/build-info.json': { status: 503 } }));
    expect(state(d, 'library/connectors-ldcad.json')).toMatchObject({ state: 'nicht erreichbar', reason: expect.stringMatching(/Failed to fetch/) });
    expect(state(d, 'library/build-info.json')).toMatchObject({ state: 'nicht erreichbar', reason: expect.stringMatching(/503/) });
  });
  it('HTML statt Daten (SPA-Rückfall) gilt als „fehlt“ mit Grund', async () => {
    const d = await loadLibraryData(fakeFetch({ ...good, 'procurement/evidence-05b2.json': { body: '<!doctype html>', type: 'text/html' } }));
    expect(state(d, 'procurement/evidence-05b2.json')).toMatchObject({ state: 'fehlt', reason: expect.stringMatching(/HTML/) });
  });
  it('fehlender Pflicht-Index wird als solcher gemeldet', async () => {
    const d = await loadLibraryData(fakeFetch({}));
    expect(d.parts).toBeNull();
    expect(state(d, 'library/parts.json')).toMatchObject({ state: 'fehlt', required: true });
  });
});
