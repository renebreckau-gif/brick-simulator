// Öffentliche Builds: explizite Positivliste und Prüfung von dist/.
// Die Prüfung wird an künstlichen dist-Ordnern getestet – sauber und absichtlich verunreinigt.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listPublicDataFiles, PRIVATE_DEV_FILES } from '../scripts/data-files.mjs';
import { DATA } from './helpers';

const SCRIPT = join(__dirname, '..', 'scripts', 'check-public-build.mjs');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function cleanDist(): string {
  const d = mkdtempSync(join(tmpdir(), 'dist-'));
  dirs.push(d);
  writeFileSync(join(d, 'index.html'), '<!doctype html>');
  for (const rel of listPublicDataFiles(DATA)) {
    mkdirSync(dirname(join(d, 'data', rel)), { recursive: true });
    cpSync(join(DATA, rel), join(d, 'data', rel));
  }
  return d;
}
function put(d: string, rel: string, content: string) {
  mkdirSync(dirname(join(d, rel)), { recursive: true });
  writeFileSync(join(d, rel), content);
}
function check(d: string) {
  const r = spawnSync(process.execPath, [SCRIPT, d], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const FAKE_EXTRACT = JSON.stringify({ schema: 'baustein-sim/rebrickable-extract@1', source: { provider: 'x' } });

describe('Positivliste veröffentlichbarer Daten', () => {
  it('enthält LDraw-Geometrie mit Lizenz/Herkunft, Referenzen und eigene Daten – aber keine privaten Dateien', () => {
    const list = listPublicDataFiles(DATA);
    expect(list).toEqual(expect.arrayContaining(['ldraw/CAreadme.txt', 'ldraw/manifest.json', 'ldraw/LDConfig.ldr', 'catalog/id-map.json', 'references/references.json', 'references/omr/40013-1.mpd']));
    expect(list.filter((f) => f.endsWith('.dat'))).toHaveLength(79);
    for (const p of PRIVATE_DEV_FILES) expect(list).not.toContain(p);
    expect(list.some((f) => /rebrickable-extract|data-raw|\.csv/.test(f))).toBe(false);
  });
});

describe('Prüfung öffentlicher Builds (scripts/check-public-build.mjs)', () => {
  it('sauberer Build besteht', () => {
    const r = check(cleanDist());
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('Öffentlicher Build sauber');
  });

  const dirty: [string, (d: string) => void, RegExp][] = [
    ['privater Katalogauszug unter data/', (d) => put(d, 'data/catalog/rebrickable-extract.json', FAKE_EXTRACT), /rebrickable-extract/],
    ['Rohdaten', (d) => put(d, 'data-raw/rebrickable/sets.csv', 'set_num'), /data-raw/],
    ['nicht freigegebene Datei unter data/', (d) => put(d, 'data/catalog/notizen.json', '{}'), /nicht freigegebene Datei/],
    ['Auszug unter anderem Namen', (d) => put(d, 'assets/katalog.json', FAKE_EXTRACT), /Katalogauszug \(Schema/],
    ['veränderte freigegebene Datei', (d) => put(d, 'data/catalog/id-map.json', '{"manipuliert":true}'), /weicht vom Original ab/],
    ['.env', (d) => put(d, '.env', 'TOKEN=x'), /verbotener Pfad/],
  ];
  for (const [label, mutate, msg] of dirty)
    it(`schlägt fehl: ${label}`, () => {
      const d = cleanDist();
      mutate(d);
      const r = check(d);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(msg);
    });

  it('fehlende freigegebene Datei wird erkannt', () => {
    const d = cleanDist();
    rmSync(join(d, 'data', 'references', 'references.json'));
    const r = check(d);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/fehlt im Build/);
  });
});
