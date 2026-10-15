// Testhilfen. Die reguläre Suite verwendet NIE den privaten Rebrickable-Auszug:
//  - 'none':    Katalogquelle fehlt (wie im frischen Checkout), auch wenn lokal eine Datei liegt.
//  - 'fixture': synthetische TESTFIXTURE (tests/fixtures/catalog-fixture.json) für die Kataloglogik –
//               ausdrücklich kein Beleg für reale Teile.
// Der echte Auszug wird nur in tests-rebrickable/ (npm run test:rebrickable) verwendet.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CATALOG_EXTRACT_PATH, loadBundle, type DataBundle, type ReadText } from '../src/core/data/bundle';
import { importLdraw } from '../src/core/model/ldrawImport';
import type { CanonicalModel } from '../src/core/model/types';

export const DATA = join(__dirname, '..', 'data');
export const FIXTURE_CATALOG = join(__dirname, 'fixtures', 'catalog-fixture.json');

export type CatalogMode = 'none' | 'fixture';

/** Dateisystem-Leser: null nur bei „Datei existiert nicht“. */
export function fsReader(root = DATA): ReadText {
  return async (p) => {
    try {
      return await readFile(join(root, p), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  };
}

/** Leser mit ersetzter Katalogquelle (null = fehlt, Text = Inhalt). */
export function readerWithCatalog(catalogText: string | null, root = DATA): ReadText {
  const base = fsReader(root);
  return (p) => (p === CATALOG_EXTRACT_PATH ? Promise.resolve(catalogText) : base(p));
}

const cache = new Map<CatalogMode, Promise<DataBundle>>();
export function bundle(mode: CatalogMode = 'none'): Promise<DataBundle> {
  if (!cache.has(mode)) {
    cache.set(
      mode,
      (async () => loadBundle(readerWithCatalog(mode === 'fixture' ? await readFile(FIXTURE_CATALOG, 'utf8') : null)))(),
    );
  }
  return cache.get(mode)!;
}

export async function readData(p: string): Promise<string> {
  return readFile(join(DATA, p), 'utf8');
}

export async function referenceModel(referenceId: string): Promise<CanonicalModel> {
  const b = await bundle('none');
  const meta = b.references.find((r) => r.referenceId === referenceId)!;
  return importLdraw(b.referenceFiles.get(referenceId)!, {
    modelId: referenceId,
    name: meta.name,
    origin: { kind: 'reference', label: `Referenz ${meta.setNumber}`, referenceId, sourceFile: meta.file },
    fileName: meta.file,
  });
}
