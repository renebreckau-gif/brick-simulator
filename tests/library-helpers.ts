// Lädt die versionierten Bibliotheksdateien (und – nur falls lokal vorhanden – die privaten Farbbelege).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PartLibraryIndex } from '../src/core/library/library';
import type { ConnectorsFile, PartsFile, RebrickableColorsFile } from '../src/core/library/types';
import { EvidenceFileSchema } from '../src/core/procurement/evidence';
import { DATA } from './helpers';

export const LIB_DIR = join(DATA, 'library');
export const PRIVATE_COLORS = join(LIB_DIR, 'private', 'rebrickable-colors.json');
const read = <T>(f: string): T => JSON.parse(readFileSync(join(LIB_DIR, f), 'utf8')) as T;

let cached: { pub: PartLibraryIndex; priv: PartLibraryIndex | null } | null = null;

/** pub: nur versionierte Daten (wie frischer Checkout); priv: zusätzlich lokale Farbbelege, falls vorhanden. */
export function loadLibrary() {
  if (cached) return cached;
  const parts = read<PartsFile>('parts.json');
  const conn = { ldcad: read<ConnectorsFile>('connectors-ldcad.json'), bricknet: read<ConnectorsFile>('connectors-bricknet.json') };
  const evidence = EvidenceFileSchema.parse(JSON.parse(readFileSync(join(DATA, 'procurement', 'evidence-05b2.json'), 'utf8')));
  const pub = new PartLibraryIndex(parts, conn);
  const priv = existsSync(PRIVATE_COLORS)
    ? new PartLibraryIndex(parts, conn, JSON.parse(readFileSync(PRIVATE_COLORS, 'utf8')) as RebrickableColorsFile, evidence)
    : null;
  cached = { pub, priv };
  return cached;
}
