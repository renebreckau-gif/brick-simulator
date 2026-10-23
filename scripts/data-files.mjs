// Explizite Auswahl der veröffentlichbaren Dateien unter data/.
//
// Nur was hier aufgezählt (oder in den Manifesten namentlich gelistet) ist, wird ausgeliefert
// oder nach dist/ kopiert. Alles andere – insbesondere private Katalogauszüge und Rohdaten –
// bleibt draußen, auch wenn es lokal im Ordner liegt.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Feste, veröffentlichbare Dateien (Lizenz/Herkunft in docs/QUELLEN.md). */
export const FIXED_PUBLIC_FILES = [
  'ldraw/manifest.json',
  'ldraw/LDConfig.ldr',
  'ldraw/CAreadme.txt',
  'catalog/id-map.json',
  'references/references.json',
  'expectations/edge-cases.json',
];

/**
 * Nur vom lokalen Entwicklungsserver ausgeliefert, nie gebaut: private Katalogauszüge sowie die im Repository
 * dokumentierten, zeitgebundenen Angebotsbelege Dritter (05B.2; nicht für den öffentlichen Build bestimmt).
 */
export const PRIVATE_DEV_FILES = ['catalog/rebrickable-extract.json', 'procurement/evidence-05b2.json'];

/** Muster, die in einem öffentlichen Build nie vorkommen dürfen. */
export const FORBIDDEN_PATTERNS = [/(^|\/)data-raw\//, /rebrickable-extract/i, /\.csv(\.gz)?$/i, /(^|\/)\.env/];

/** Inhaltliche Kennung eines Katalogauszugs (Schema-Feld). */
export const EXTRACT_SCHEMA = 'baustein-sim/rebrickable-extract@1';

/**
 * Liefert die vollständige Positivliste (relativ zu data/), abgeleitet aus festen Einträgen,
 * dem LDraw-Manifest und dem Referenzregister. Fehlt eine gelistete Datei, wird abgebrochen.
 */
export function listPublicDataFiles(dataDir) {
  const out = new Set(FIXED_PUBLIC_FILES);
  const manifest = JSON.parse(readFileSync(join(dataDir, 'ldraw/manifest.json'), 'utf8'));
  for (const f of Object.values(manifest.files)) if (f.path && f.path.endsWith('.dat')) out.add(`ldraw/${f.path}`);
  const refs = JSON.parse(readFileSync(join(dataDir, 'references/references.json'), 'utf8'));
  for (const r of refs) {
    out.add(r.file);
    if (r.instructionSequence) out.add(r.instructionSequence);
  }
  const list = [...out].sort();
  for (const rel of list) {
    if (FORBIDDEN_PATTERNS.some((p) => p.test(rel))) throw new Error(`Positivliste enthält verbotenen Pfad: ${rel}`);
    if (!existsSync(join(dataDir, rel))) throw new Error(`Veröffentlichbare Datei fehlt: data/${rel}`);
  }
  return list;
}
