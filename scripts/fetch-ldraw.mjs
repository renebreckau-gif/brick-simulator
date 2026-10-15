// Lädt die benötigten LDraw-Teiledateien (inkl. aller Unterdateien/Primitive)
// aus der offiziellen LDraw-Bibliothek und schreibt ein Herkunftsmanifest.
//
// Aufruf: node scripts/fetch-ldraw.mjs
// Wurzelliste: data/ldraw/roots.json
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'ldraw');
const BASE = 'https://library.ldraw.org/library/official/';

const roots = JSON.parse(await readFile(join(OUT, 'roots.json'), 'utf8'));
const manifest = { source: BASE, fetchedAt: new Date().toISOString(), files: {} };

/** LDraw-Referenz (z. B. "s\\3001s01.dat") → Kandidatenpfade in der Bibliothek. */
function candidates(ref) {
  const r = ref.replace(/\\/g, '/').toLowerCase();
  return [`parts/${r}`, `p/${r}`];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Höflicher Abruf: Pause zwischen Anfragen, Backoff bei HTTP 429.
async function fetchText(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(600);
    const res = await fetch(url, { headers: { 'User-Agent': 'baustein-simulator/0.1 (lokale Entwicklung)' } });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1);
      console.warn(`429 – warte ${wait} ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) return null;
    return await res.text();
  }
  throw new Error('Wiederholt gedrosselt: ' + url);
}

// Bereits vorhandene Dateien wiederverwenden (Wiederaufnahme nach Abbruch).
async function readLocal(ref) {
  for (const c of candidates(ref)) {
    try { return { text: await readFile(join(OUT, c), 'utf8'), path: c }; } catch { /* nicht lokal */ }
  }
  return null;
}

const queue = [...roots.parts];
const seen = new Set();
while (queue.length) {
  const ref = queue.shift();
  const key = ref.replace(/\\/g, '/').toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  const local = await readLocal(ref);
  let text = local?.text ?? null;
  let path = local?.path ?? null;
  if (text === null) for (const c of candidates(ref)) {
    text = await fetchText(BASE + c);
    if (text !== null) { path = c; break; }
  }
  if (text === null) {
    manifest.files[key] = { status: 'nicht gefunden' };
    console.warn('nicht gefunden:', ref);
    continue;
  }
  await mkdir(dirname(join(OUT, path)), { recursive: true });
  await writeFile(join(OUT, path), text);
  const license = /^0\s+!LICENSE\s+(.*)$/m.exec(text)?.[1]?.trim() ?? null;
  const title = /^0\s+(.*)$/m.exec(text)?.[1]?.trim() ?? null;
  const author = /^0\s+Author:\s*(.*)$/m.exec(text)?.[1]?.trim() ?? null;
  manifest.files[key] = {
    path,
    url: BASE + path,
    sha256: createHash('sha256').update(text).digest('hex'),
    title,
    author,
    license,
  };
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === '1' && t.length >= 15) queue.push(t.slice(14).join(' '));
  }
}

for (const extra of roots.extra ?? []) {
  const text = await fetchText(BASE + extra);
  if (text === null) { console.warn('nicht gefunden:', extra); continue; }
  await writeFile(join(OUT, extra), text);
  manifest.files[extra.toLowerCase()] = {
    path: extra,
    url: BASE + extra,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(manifest.files).length} Dateien, Manifest geschrieben.`);
