// Prüft einen öffentlichen Build (dist/) gegen die Positivliste veröffentlichbarer Daten.
// Bricht mit Exit-Code 1 ab, wenn
//  - unter dist/data/ eine Datei liegt, die nicht freigegeben ist,
//  - eine freigegebene Datei fehlt oder inhaltlich vom Original abweicht,
//  - irgendwo in dist/ ein verbotener Pfad (Rohdaten, Katalogauszug, CSV, .env) auftaucht,
//  - irgendeine JSON-Datei in dist/ das Schema eines Katalogauszugs trägt.
// Aufruf: node scripts/check-public-build.mjs [distDir]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRACT_SCHEMA, FORBIDDEN_PATTERNS, listPublicDataFiles } from './data-files.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const DIST = resolve(process.argv[2] ?? join(ROOT, 'dist'));

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const errors = [];
const allowed = new Set(listPublicDataFiles(DATA).map((r) => `data/${r}`));
const files = walk(DIST).map((p) => relative(DIST, p).replace(/\\/g, '/'));

for (const f of files) {
  if (FORBIDDEN_PATTERNS.some((p) => p.test(f))) errors.push(`verbotener Pfad im Build: ${f}`);
  if (f.startsWith('data/') && !allowed.has(f)) errors.push(`nicht freigegebene Datei unter dist/data: ${f}`);
  if (f.endsWith('.json')) {
    try {
      if (JSON.parse(readFileSync(join(DIST, f), 'utf8'))?.schema === EXTRACT_SCHEMA) errors.push(`Katalogauszug (Schema ${EXTRACT_SCHEMA}) im Build: ${f}`);
    } catch {
      errors.push(`ungültiges JSON im Build: ${f}`);
    }
  }
}
for (const a of allowed) {
  if (!files.includes(a)) errors.push(`freigegebene Datei fehlt im Build: ${a}`);
  else if (sha(readFileSync(join(DIST, a))) !== sha(readFileSync(join(ROOT, a)))) errors.push(`Inhalt weicht vom Original ab: ${a}`);
}

const dataCount = files.filter((f) => f.startsWith('data/')).length;
if (errors.length) {
  console.error(`Öffentlicher Build NICHT sauber (${DIST}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Öffentlicher Build sauber: ${files.length} Dateien, davon ${dataCount} Daten aus der Positivliste (${allowed.size} freigegeben); keine privaten Daten.`);
