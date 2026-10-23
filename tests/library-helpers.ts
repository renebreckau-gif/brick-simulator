// Lädt die versionierten Bibliotheksdateien wie ein frischer Checkout – ohne private Daten.
// Der Prüfkern wird wie in der Oberfläche über den Katalog angebunden (gleiche Identitätsauflösung wie die Modellprüfung).
// Private Integrationsprüfungen (echte Farbbelege) liegen in tests-rebrickable/ (npm run test:rebrickable).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PartLibraryIndex } from '../src/core/library/library';
import type { ConnectorsFile, PartsFile } from '../src/core/library/types';
import { bundle, DATA } from './helpers';

export const LIB_DIR = join(DATA, 'library');
const read = <T>(f: string): T => JSON.parse(readFileSync(join(LIB_DIR, f), 'utf8')) as T;

let cached: Promise<{ pub: PartLibraryIndex; noValidator: PartLibraryIndex }> | null = null;

/** pub: versionierte Daten + Prüfkern (Katalog ohne private Daten); noValidator: ohne Prüfkern-Anbindung. */
export function loadLibrary() {
  cached ??= (async () => {
    const parts = read<PartsFile>('parts.json');
    const conn = { ldcad: read<ConnectorsFile>('connectors-ldcad.json'), bricknet: read<ConnectorsFile>('connectors-bricknet.json') };
    const b = await bundle('none');
    return {
      pub: new PartLibraryIndex(parts, conn, { validator: (id) => b.catalog.part(id).simulation }),
      noValidator: new PartLibraryIndex(parts, conn),
    };
  })();
  return cached;
}

/** Python-Aufruf für die Import-Skripte (Windows: python, sonst python3). */
export function python(args: string[], cwd?: string) {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['-I', ...args], { encoding: 'utf8', cwd });
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    return r;
  }
  throw new Error('Kein Python gefunden (benötigt für scripts/library/)');
}
