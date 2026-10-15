import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadBundle, type DataBundle } from '../src/core/data/bundle';
import { importLdraw } from '../src/core/model/ldrawImport';
import type { CanonicalModel } from '../src/core/model/types';

const DATA = join(__dirname, '..', 'data');

let cached: Promise<DataBundle> | null = null;
export function bundle(): Promise<DataBundle> {
  cached ??= loadBundle((p) => readFile(join(DATA, p), 'utf8'));
  return cached;
}

export async function readData(p: string): Promise<string> {
  return readFile(join(DATA, p), 'utf8');
}

export async function referenceModel(referenceId: string): Promise<CanonicalModel> {
  const b = await bundle();
  const meta = b.references.find((r) => r.referenceId === referenceId)!;
  return importLdraw(b.referenceFiles.get(referenceId)!, {
    modelId: referenceId,
    name: meta.name,
    origin: { kind: 'reference', label: `Referenz ${meta.setNumber}`, referenceId, sourceFile: meta.file },
    fileName: meta.file,
  });
}
