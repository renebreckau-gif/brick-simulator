// Erzeugt einen kleinen, belegten Katalogauszug aus lokal abgelegten
// Rebrickable-CSV-Dumps (https://rebrickable.com/downloads/).
//
// Aufruf: node scripts/extract-rebrickable.mjs <ordner-mit-csv> <abrufdatum-ISO>
// Die Rohdaten selbst werden NICHT ins Repository übernommen (siehe docs/QUELLEN.md).
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [srcDir, fetchedAt] = process.argv.slice(2);
if (!srcDir || !fetchedAt) {
  console.error('Aufruf: node scripts/extract-rebrickable.mjs <csv-ordner> <abrufdatum-ISO>');
  process.exit(1);
}

// LDraw-ID → Rebrickable-ID. "identical" wird unten gegen parts.csv geprüft;
// abweichende Zuordnungen sind manuell und begründet.
const PART_MAP = JSON.parse(await readFile(join(ROOT, 'data', 'catalog', 'id-map.json'), 'utf8'));
const REFERENCE_SETS = ['40013-1', '21002-1', '1869-1'];

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function* rows(name) {
  const rl = createInterface({ input: createReadStream(join(srcDir, name), 'utf8'), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (!header) { header = cells; continue; }
    yield Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  }
}

const rbIds = new Set(PART_MAP.parts.map((p) => p.rebrickable));
const fileInfo = {};
for (const f of ['parts.csv', 'colors.csv', 'elements.csv', 'inventories.csv', 'inventory_parts.csv', 'part_relationships.csv', 'sets.csv']) {
  const s = await stat(join(srcDir, f));
  fileInfo[f] = { bytes: s.size, url: `https://cdn.rebrickable.com/media/downloads/${f}.gz` };
}

const parts = {};
for await (const r of rows('parts.csv')) if (rbIds.has(r.part_num)) parts[r.part_num] = { name: r.name, partCatId: Number(r.part_cat_id), material: r.part_material };

const colors = {};
for await (const r of rows('colors.csv')) colors[r.id] = { name: r.name, rgb: r.rgb, isTrans: r.is_trans === 'True' };

// Teil-Farb-Belege 1: LEGO-Element-IDs
const evidence = {};
const key = (p, c) => `${p}|${c}`;
for await (const r of rows('elements.csv')) {
  if (!rbIds.has(r.part_num)) continue;
  const k = key(r.part_num, r.color_id);
  (evidence[k] ??= { part: r.part_num, color: Number(r.color_id), elementIds: [], setCount: 0 }).elementIds.push(r.element_id);
}

// Teil-Farb-Belege 2: Vorkommen in Set-Inventaren (nur Version 1 je Set)
const invToSet = {};
const setInvs = {};
for await (const r of rows('inventories.csv')) {
  invToSet[r.id] = { set: r.set_num, version: Number(r.version) };
  if (REFERENCE_SETS.includes(r.set_num)) (setInvs[r.set_num] ??= []).push({ id: r.id, version: Number(r.version) });
}
const seenSetCombo = new Set();
const referenceInventories = {};
for await (const r of rows('inventory_parts.csv')) {
  const inv = invToSet[r.inventory_id];
  if (!inv) continue;
  if (REFERENCE_SETS.includes(inv.set)) {
    (referenceInventories[inv.set] ??= { inventoryId: r.inventory_id, version: inv.version, lines: [] }).lines.push({
      part: r.part_num, color: Number(r.color_id), quantity: Number(r.quantity), isSpare: r.is_spare === 'True',
      partName: null,
    });
  }
  if (!rbIds.has(r.part_num) || r.is_spare === 'True') continue;
  const sc = `${inv.set}|${r.part_num}|${r.color_id}`;
  if (seenSetCombo.has(sc)) continue;
  seenSetCombo.add(sc);
  const k = key(r.part_num, r.color_id);
  (evidence[k] ??= { part: r.part_num, color: Number(r.color_id), elementIds: [], setCount: 0 }).setCount++;
}

const sets = {};
for await (const r of rows('sets.csv')) if (REFERENCE_SETS.includes(r.set_num)) sets[r.set_num] = { name: r.name, year: Number(r.year), numParts: Number(r.num_parts), themeId: Number(r.theme_id) };

const relationships = [];
for await (const r of rows('part_relationships.csv')) {
  if (rbIds.has(r.child_part_num) || rbIds.has(r.parent_part_num)) relationships.push({ type: r.rel_type, child: r.child_part_num, parent: r.parent_part_num });
}

// Für Referenzinventare auch Teile außerhalb des Katalogs benennen
const refPartNums = new Set(Object.values(referenceInventories).flatMap((i) => i.lines.map((l) => l.part)));
const refPartNames = {};
for await (const r of rows('parts.csv')) if (refPartNums.has(r.part_num)) refPartNames[r.part_num] = r.name;
for (const inv of Object.values(referenceInventories)) for (const l of inv.lines) l.partName = refPartNames[l.part] ?? null;

const usedColorIds = new Set([...Object.values(evidence).map((e) => String(e.color)), ...Object.values(referenceInventories).flatMap((i) => i.lines.map((l) => String(l.color)))]);
const colorsOut = Object.fromEntries([...usedColorIds].sort((a, b) => Number(a) - Number(b)).map((id) => [id, colors[id]]));

const missing = [...rbIds].filter((p) => !parts[p]);
const out = {
  schema: 'baustein-sim/rebrickable-extract@1',
  source: {
    provider: 'Rebrickable',
    downloadsPage: 'https://rebrickable.com/downloads/',
    files: fileInfo,
    fetchedAt,
    usageNote: 'Nutzungsbedingungen konnten beim Abruf nicht eingesehen werden (Bot-Schutz). Auszug nur zur lokalen Entwicklung; Weitergabe vor Klärung nicht freigegeben. Siehe docs/QUELLEN.md.',
  },
  missingParts: missing,
  parts,
  colors: colorsOut,
  partColorEvidence: Object.values(evidence).sort((a, b) => a.part.localeCompare(b.part) || a.color - b.color),
  relationships,
  referenceSets: sets,
  referenceInventories,
};
await writeFile(join(ROOT, 'data', 'catalog', 'rebrickable-extract.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`Teile ${Object.keys(parts).length}, Farben ${Object.keys(colorsOut).length}, Belege ${out.partColorEvidence.length}, fehlend: ${missing.join(', ') || '–'}`);
