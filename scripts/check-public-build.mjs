// Prüft einen öffentlichen Build (dist/) gegen die Positivliste veröffentlichbarer Daten.
// Bricht mit Exit-Code 1 ab, wenn
//  - unter dist/data/ eine Datei liegt, die nicht freigegeben ist,
//  - eine freigegebene Datei fehlt oder inhaltlich vom Original abweicht,
//  - irgendwo in dist/ ein verbotener Pfad (Rohdaten, Katalogauszug, CSV, .env) auftaucht,
//  - irgendeine JSON-Datei in dist/ das Schema eines Katalogauszugs trägt,
//  - Bilddateien (Uploads), Entwurfsaufträge oder Zugangsdaten (API-Schlüssel) im Build liegen,
//  - das serverseitige Anthropic-SDK in das Browser-Bundle geraten ist.
// Aufruf: node scripts/check-public-build.mjs [distDir]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_PATTERNS, isPrivateSchema, listPublicDataFiles } from './data-files.mjs';

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

const SECRET = /sk-ant-[A-Za-z0-9_-]{8,}/;
for (const f of files) {
  if (FORBIDDEN_PATTERNS.some((p) => p.test(f))) errors.push(`verbotener Pfad im Build: ${f}`);
  if (/\.(png|jpe?g|webp|gif|heic)$/i.test(f)) errors.push(`Bilddatei im Build (Uploads bleiben lokal): ${f}`);
  if (/entwurfsauftrag\.json$/i.test(f)) errors.push(`Entwurfsauftrag im Build: ${f}`);
  if (/raumentwurf\.json$/i.test(f)) errors.push(`Räumlicher Entwurf im Build: ${f}`);
  if (/\.(js|css|html|json|txt|map)$/i.test(f)) {
    const text = readFileSync(join(DIST, f), 'utf8');
    if (SECRET.test(text)) errors.push(`möglicher API-Schlüssel im Build: ${f}`);
    if (/ANTHROPIC_API_KEY\s*[=:]\s*["']?[A-Za-z0-9]/.test(text)) errors.push(`Zugangsdaten-Zuweisung im Build: ${f}`);
    if (text.includes('anthropic-version') || text.includes('api.anthropic.com')) errors.push(`serverseitiges Anthropic-SDK im Browser-Bundle: ${f}`);
  }
  if (f.startsWith('data/') && !allowed.has(f)) errors.push(`nicht freigegebene Datei unter dist/data: ${f}`);
  if (f.endsWith('.json')) {
    try {
      const schema = JSON.parse(readFileSync(join(DIST, f), 'utf8'))?.schema;
      if (isPrivateSchema(schema)) errors.push(`Katalogauszug (Schema ${schema}) im Build: ${f}`);
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
