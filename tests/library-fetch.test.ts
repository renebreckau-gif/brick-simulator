// 05C.1.1, Punkt 5: Beschaffung der Quellstände – Inhalts-Prüfwert, Verhalten bei geänderter Quell-URL und --update
// bei vorhandenem Zwischenspeicher. Läuft mit lokalen file://-Archiven, eigenem Register und eigenem Zwischenspeicher.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { python } from './library-helpers';

const FETCH = join(__dirname, '..', 'scripts', 'library', 'fetch.py');
const dir = mkdtempSync(join(tmpdir(), 'lib-fetch-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const zipPath = join(dir, 'quelle.zip');
const registry = join(dir, 'sources.json');
const cache = join(dir, 'cache');

/** Schreibt ein Zip mit Ordner demo/ und den angegebenen Dateien (über Python-zipfile). */
function makeZip(files: Record<string, string>) {
  const code = 'import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor k,v in json.loads(sys.argv[2]).items(): z.writestr("demo/"+k, v)\nz.close()';
  const r = python(['-c', code, zipPath, JSON.stringify(files)]);
  if (r.status !== 0) throw new Error(r.stderr);
}
function fetch(...args: string[]) {
  const r = (() => {
    const prev = { reg: process.env.LIBRARY_REGISTRY, cache: process.env.LIBRARY_CACHE };
    process.env.LIBRARY_REGISTRY = registry;
    process.env.LIBRARY_CACHE = cache;
    try { return python([FETCH, ...args]); } finally {
      if (prev.reg === undefined) delete process.env.LIBRARY_REGISTRY; else process.env.LIBRARY_REGISTRY = prev.reg;
      if (prev.cache === undefined) delete process.env.LIBRARY_CACHE; else process.env.LIBRARY_CACHE = prev.cache;
    }
  })();
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const reg = () => JSON.parse(readFileSync(registry, 'utf8')).sources[0];
const extracted = (f: string) => readFileSync(join(cache, 'demo', 'demo', f), 'utf8');

describe('Quellstände beschaffen', () => {
  it('ungeprüfter Stand wird ohne --update nicht übernommen', () => {
    makeZip({ 'a.txt': 'eins' });
    writeFileSync(registry, JSON.stringify({ sources: [{ id: 'demo', url: pathToFileURL(zipPath).href, tree: { prefix: 'auto', scope: [], lower: false } }] }));
    const r = fetch();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/noch nicht festgelegt/);
  });
  it('--update legt Stand 1 fest (Inhalts-Prüfwert) und entpackt ihn', () => {
    const r = fetch('--update');
    expect(r.code, r.out).toBe(0);
    expect(reg().tree.sha256).toMatch(/^[0-9A-F]{64}$/);
    expect(reg().tree.files).toBe(1);
    expect(extracted('a.txt')).toBe('eins');
  });
  it('ein zweiter Lauf erkennt den vorhandenen Stand', () => {
    expect(fetch().out).toMatch(/vorhanden, Inhalts-Prüfwert stimmt/);
  });
  it('Quell-URL liefert neuen Inhalt: ohne --update Abbruch (kein Rezept), festgelegter Stand bleibt', () => {
    const before = reg().tree.sha256;
    makeZip({ 'a.txt': 'zwei' });
    // frische Maschine: weder entpackter Stand noch zwischengespeichertes Archiv (sonst würde korrekt das festgelegte Archiv genutzt)
    rmSync(join(cache, 'demo', '.fetched.json'));
    rmSync(join(cache, 'downloads', 'demo.zip'));
    const r = fetch();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/anderen Stand und es gibt kein Wiederherstellungsrezept/);
    expect(reg().tree.sha256).toBe(before);
  });
  it('--update lädt trotz vorhandenem Zwischenspeicher neu und übernimmt Stand 2 (Fehler bis 2d365b2)', () => {
    const before = reg().tree.sha256;
    // Zwischenspeicher wieder in den Zustand „Archiv von Stand 1, Markierung passend“ bringen
    makeZip({ 'a.txt': 'eins' });
    expect(fetch().code).toBe(0);
    expect(fetch().out).toMatch(/vorhanden/);
    makeZip({ 'a.txt': 'zwei' });
    const r = fetch('--update');
    expect(r.code, r.out).toBe(0);
    expect(reg().tree.sha256).not.toBe(before);
    expect(extracted('a.txt')).toBe('zwei');
  });
  it('neu gepacktes Archiv mit gleichem Inhalt wird ohne --update angenommen', () => {
    const tree = reg().tree.sha256;
    const code = 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED)\nz.writestr("demo/a.txt","zwei")\nz.close()';
    expect(python(['-c', code, zipPath]).status).toBe(0);
    rmSync(join(cache, 'demo', '.fetched.json'));
    rmSync(join(cache, 'downloads', 'demo.zip'));
    const r = fetch();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/Archiv neu gepackt, Inhalt unverändert/);
    expect(reg().tree.sha256).toBe(tree);
  });
});
