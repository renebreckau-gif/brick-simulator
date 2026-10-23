// Teilebibliothek (05C.1): Herkunft, Trennung der Angaben, dreiwertige Eigenschaften, Suche, Abdeckung, Abgleich.
// Läuft ausschließlich auf versionierten Daten (frischer Checkout); private Farbbelege nur, wenn lokal vorhanden.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { families, geoProp } from '../src/core/library/classify';
import { coverage, crosscheckWithPartMeta, ldrawSystemRefSet, rebrickableRefSet, sourcesAgree } from '../src/core/library/coverage';
import { loadPartGeometry } from '../src/core/library/geometry';
import { PartLibraryIndex } from '../src/core/library/library';
import { SEARCH_TASKS, searchParts } from '../src/core/library/search';
import type { BuildInfo, PartsFile } from '../src/core/library/types';
import { definedPartIds } from '../src/core/connectivity/partMeta';
import { LIB_DIR, loadLibrary } from './library-helpers';

const { pub, priv } = loadLibrary();
const sha = (f: string) => createHash('sha256').update(readFileSync(join(LIB_DIR, f))).digest('hex').toUpperCase();

describe('Herkunft und Reproduzierbarkeit', () => {
  const info = JSON.parse(readFileSync(join(LIB_DIR, 'build-info.json'), 'utf8')) as BuildInfo;
  const sources = JSON.parse(readFileSync(join(LIB_DIR, 'sources.json'), 'utf8')).sources as { id: string; sha256: string; commit?: string }[];
  it('Ausgaben entsprechen den im Bauprotokoll festgehaltenen Prüfsummen', () => {
    for (const [f, o] of Object.entries(info.outputs)) expect(sha(f), f).toBe(o.sha256);
  });
  it('jede Quelle ist mit Prüfsumme (und bei Git-Quellen mit Commit) festgelegt und stimmt mit dem Bauprotokoll überein', () => {
    expect(sources.map((s) => s.id).sort()).toEqual(['bricknet', 'ldcad-shadow', 'ldraw']);
    for (const s of sources) {
      expect(s.sha256, s.id).toMatch(/^[0-9A-F]{64}$/);
      expect(info.sources[s.id].sha256).toBe(s.sha256);
    }
    expect(sources.find((s) => s.id === 'ldcad-shadow')!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pub.partsFile.source.sha256).toBe(sources.find((s) => s.id === 'ldraw')!.sha256);
  });
  it('umfassender Bestand, nicht nur die Teile eines Motivs', () => {
    const counts = info.counts as { ldrawFiles: number; ldcadParts: number; bricknetParts: number };
    expect(counts.ldrawFiles).toBeGreaterThan(20000);
    expect(counts.ldcadParts).toBeGreaterThan(5000);
    expect(counts.bricknetParts).toBeGreaterThan(5000);
  });
});

describe('Katalogidentität', () => {
  it('Umbenennungen werden bis zum geführten Teil verfolgt', () => {
    expect(pub.entry('41769')!.ty).toBe('moved');
    expect(pub.canonical('41769')).toBe('41769a');
  });
  it('Prüfkern-Nummer 3023 ist in LDraw 2026-09 umbenannt: Abgleich und Prüfbarkeit laufen über 3023b', () => {
    expect(pub.canonical('3023')).toBe('3023b');
    expect(pub.support('3023b')).toBe('pruefbar');
    const rows = crosscheckWithPartMeta(pub).filter((r) => r.id === '3023');
    expect(rows.every((r) => r.libraryId === '3023b')).toBe(true);
    expect(rows.find((r) => r.cat === 'studs_up')!.ldcad!.match).toBe(true);
  });
  it('Drucke behalten ihre eigene Datei und verweisen auf das Grundteil', () => {
    const prints = Object.entries(pub.parts).filter(([, e]) => e.ty === 'print');
    expect(prints.length).toBeGreaterThan(1000);
    for (const [, e] of prints.slice(0, 200)) expect(pub.entry(e.pr!)).toBeDefined();
    expect(pub.support(prints[0][0])).toBe('nicht-einzeln');
  });
});

describe('Geometrie, Farbe und Verfügbarkeit bleiben getrennt', () => {
  it('ohne private Farbbelege ist keine Farbe belegt und „transparent“ unbekannt', () => {
    expect(pub.colorEvidence('3001')).toEqual({ state: 'nicht-geladen' });
    expect(geoProp(pub, '3001', 'transparent_belegt')).toBe('unbekannt');
  });
  it('ohne Beschaffungsbeleg gibt es kein Angebot', () => {
    expect(pub.procurement('3001')).toEqual([]);
  });
  it.runIf(!!priv)('mit lokalen Farbbelegen: 3001 in Rot belegt, Glas 60601 transparent', () => {
    const c = priv!.colorEvidence('3001');
    expect(c.state).toBe('belegt');
    if (c.state === 'belegt') expect(c.colors.some((x) => x.name === 'Red' && x.sets > 0)).toBe(true);
    expect(geoProp(priv!, '60601', 'transparent_belegt')).toBe('ja');
  });
});

describe('Anschlüsse: dreiwertig, je Quelle', () => {
  it('fehlende Anschlussdaten sind „unbekannt“, nie „nein“', () => {
    const noData = pub.ids().find((id) => pub.entry(id)!.ty === 'part' && !pub.connectors(id, 'ldcad') && !pub.connectors(id, 'bricknet'))!;
    expect(noData).toBeDefined();
    expect(geoProp(pub, noData, 'glatte_oberseite')).toBe('unbekannt');
    expect(geoProp(pub, noData, 'noppen_seitlich')).toBe('unbekannt');
    expect(pub.support(noData)).not.toBe('pruefbar');
  });
  it('2×4-Stein: beide Quellen stimmen mit dem Prüfkern überein', () => {
    expect(pub.summary('3001', 'ldcad')!.studsUp).toBe(8);
    expect(pub.summary('3001', 'bricknet')!.studsUp).toBe(8);
    expect(sourcesAgree(pub, '3001')).toBe(true);
  });
  it('Fliese: keine Noppe oben; Winkel 99781: Noppen zur Seite', () => {
    expect(geoProp(pub, '3069b', 'glatte_oberseite')).toBe('ja');
    expect(geoProp(pub, '99781', 'noppen_seitlich')).toBe('ja');
    expect(geoProp(pub, '3001', 'noppen_seitlich')).toBe('nein');
  });
  it('widersprechende Quellen werden als Widerspruch ausgewiesen', () => {
    const lib = new PartLibraryIndex(pub.partsFile, {
      ldcad: { schema: 'baustein-sim/library-connectors@1', builder: 't', licence: 't', source: { source: 'ldcad-shadow', commit: 'x', sha256: 'x' }, types: [['stud', 'a']], parts: { '3001': [[0, 0, 0, 0, 0, -1, 0]] } },
      bricknet: { schema: 'baustein-sim/library-connectors@1', builder: 't', licence: 't', source: { source: 'bricknet', commit: 'x', sha256: 'x' }, types: [['antistud', 'b']], parts: { '3001': [[0, 0, 24, 0, 0, -1, 0]] } },
    });
    expect(geoProp(lib, '3001', 'glatte_oberseite')).toBe('widerspruch');
  });
});

describe('Geometrische Kennwerte', () => {
  it('Rundstein: runde senkrechte Wand; 2×4-Stein: weder geneigt noch gekrümmt', () => {
    expect(geoProp(pub, '3062b', 'runde_wand')).toBe('ja');
    expect(geoProp(pub, '3941', 'runde_wand')).toBe('ja');
    expect(geoProp(pub, '3001', 'geneigt')).toBe('nein');
    expect(geoProp(pub, '3001', 'gekruemmt')).toBe('nein');
  });
  it('Schrägstein geneigt in einer Richtung, Eckschräge in zwei; Keilplatte ohne runde Wand', () => {
    expect(geoProp(pub, '3039', 'geneigt')).toBe('ja');
    expect(geoProp(pub, '3039', 'eckneigung')).toBe('nein');
    expect(geoProp(pub, '3045', 'eckneigung')).toBe('ja');
    expect(geoProp(pub, '41769a', 'runde_wand')).toBe('nein');
  });
  it('Katalogfamilie und Messung sind getrennt: Fenster aus dem Katalog', () => {
    expect(families(pub.entry('60592')!)).toContain('window');
  });
});

describe('Suche', () => {
  const ids = (t: string) => searchParts(pub, { ...SEARCH_TASKS.find((x) => x.id === t)!.query, limit: 2000 }).hits.map((h) => h.id);
  it('glatte, geneigte Ecke findet Doppelschrägen ohne Noppen', () => {
    expect(ids('glatte-geneigte-ecke')).toEqual(expect.arrayContaining(['3043', '3300']));
    expect(ids('glatte-geneigte-ecke')).not.toContain('3045'); // hat eine Noppe oben
  });
  it('runde Wand findet Rundsteine', () => expect(ids('runde-wand')).toEqual(expect.arrayContaining(['3062b', '3941'])));
  it('Fensteröffnung findet Fenster und Windschutzscheiben', () => expect(ids('fensteroeffnung')).toEqual(expect.arrayContaining(['60592', '2437'])));
  it('seitlich angesetzte Platte findet Winkel und Steine mit Seitennoppen', () => expect(ids('seitliche-platte')).toEqual(expect.arrayContaining(['99781', '87087', '11211'])));
  it('Textsuche nach Nummer; Drucke standardmäßig ausgeblendet', () => {
    const r = searchParts(pub, { text: '3001' });
    expect(r.hits[0].id).toBe('3001');
    expect(r.hits.some((h) => pub.entry(h.id)!.ty === 'print')).toBe(false);
  });
});

describe('Abdeckung und Abgleich', () => {
  it('Referenzmenge zählt keine Drucke, Unterteile oder Aliase', () => {
    const ref = ldrawSystemRefSet(pub);
    expect(ref.ids.every((id) => pub.entry(id)!.ty === 'part')).toBe(true);
    const row = coverage(pub, ref);
    expect(row.geometry.n).toBeLessThanOrEqual(row.geometry.of);
    expect(row.checkable.n).toBeLessThanOrEqual(definedPartIds().length);
    expect(row.anyConnectors.n / row.anyConnectors.of).toBeGreaterThan(0.85);
  });
  it.runIf(!!priv)('Rebrickable-Referenzmenge: Anschlussdaten für über 90 % der aktuell verwendeten Teile', () => {
    const row = coverage(priv!, rebrickableRefSet(priv!)!);
    expect(row.anyConnectors.n / row.anyConnectors.of).toBeGreaterThan(0.9);
    expect(row.refset.unmapped).toBeGreaterThan(0); // Katalog-Lücke wird ausgewiesen, nicht verschwiegen
  });
  it('Noppen oben stimmen für alle Prüfkern-Teile mit Daten in beiden Quellen überein', () => {
    const rows = crosscheckWithPartMeta(pub).filter((r) => r.cat === 'studs_up');
    for (const r of rows) {
      if (r.ldcad) expect(r.ldcad.match, `${r.id} LDCad`).toBe(true);
      if (r.bricknet) expect(r.bricknet.match, `${r.id} BrickNet`).toBe(true);
    }
  });
  it('bekannte Abweichungen bleiben sichtbar (keine stille Anpassung des Prüfkerns)', () => {
    const dev = crosscheckWithPartMeta(pub).filter((r) => (r.ldcad && !r.ldcad.match) || (r.bricknet && !r.bricknet.match)).map((r) => `${r.id}:${r.cat}`);
    // dokumentiert in docs/TEILEBIBLIOTHEK.md, Abschnitt „Abgleich“
    expect(dev).toEqual(expect.arrayContaining(['41767:recv_bottom', '43722a:recv_bottom', '3065:recv_bottom', '3039:tubes']));
  });
});

describe('Geometrie bei Bedarf', () => {
  it('lädt Teil und Unterdateien aus parts/ und p/, meldet Fehlendes und flacht ab', async () => {
    const files: Record<string, { dir: 'parts' | 'p'; text: string }> = {
      'x.dat': { dir: 'parts', text: '0 X\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s/xs01.dat\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 prim.dat\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 fehlt.dat\n' },
      's/xs01.dat': { dir: 'parts', text: '0 sub\n3 16 0 0 0 10 0 0 0 0 10\n' },
      'prim.dat': { dir: 'p', text: '0 prim\n4 16 0 0 0 1 0 0 1 1 0 0 1 0\n' },
    };
    const asked: string[] = [];
    const g = await loadPartGeometry('x', async (ref) => { asked.push(ref); return files[ref] ?? null; });
    expect(g.missing).toEqual(['fehlt.dat']);
    expect(asked.sort()).toEqual(['fehlt.dat', 'prim.dat', 's/xs01.dat', 'x.dat']);
    expect(g.library.flatten('x.dat').triangles).toHaveLength(3);
  });
});

it('Teile-Index hat das erwartete Schema', () => {
  const p = JSON.parse(readFileSync(join(LIB_DIR, 'parts.json'), 'utf8')) as PartsFile;
  expect(p.schema).toBe('baustein-sim/library-parts@1');
});
