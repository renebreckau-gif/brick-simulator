// Laden aller lokalen Daten über eine austauschbare Lesefunktion
// (Browser: fetch auf /data, Tests: Dateisystem).
import { Catalog, type IdMap, type RebrickableExtract } from '../catalog/catalog';
import { parseLdConfig } from '../ldraw/colors';
import { PartLibrary } from '../ldraw/library';

export type ReadText = (path: string) => Promise<string>;

export interface ReferenceMeta {
  referenceId: string;
  name: string;
  setNumber: string;
  variant: string;
  year: number;
  file: string;
  source: Record<string, string>;
  dataAcquisition: string[];
  crossCheck: string[];
  coveredBySource: string[];
  notCovered: string[];
  usageStatus: string;
  instructions: { label: string; url: string }[];
  knownDiscrepancies: string[];
}

export interface DataBundle {
  library: PartLibrary;
  catalog: Catalog;
  references: ReferenceMeta[];
  referenceFiles: Map<string, string>;
  manifest: { fetchedAt: string; source: string; files: Record<string, { path?: string; sha256?: string; license?: string | null }> };
}

export async function loadBundle(read: ReadText): Promise<DataBundle> {
  const manifest = JSON.parse(await read('ldraw/manifest.json')) as DataBundle['manifest'];
  const files = new Map<string, string>();
  const paths = Object.values(manifest.files).map((f) => f.path).filter((p): p is string => !!p && p.endsWith('.dat'));
  const texts = await Promise.all(paths.map((p) => read(`ldraw/${p}`)));
  paths.forEach((p, i) => files.set(p.toLowerCase(), texts[i]));
  const library = new PartLibrary(files);
  const ldconfig = parseLdConfig(await read('ldraw/LDConfig.ldr'));
  const idMap = JSON.parse(await read('catalog/id-map.json')) as IdMap;
  const extract = JSON.parse(await read('catalog/rebrickable-extract.json')) as RebrickableExtract;
  const catalog = new Catalog(idMap, extract, ldconfig, library);
  const references = JSON.parse(await read('references/references.json')) as ReferenceMeta[];
  const referenceFiles = new Map<string, string>();
  for (const r of references) referenceFiles.set(r.referenceId, await read(r.file));
  return { library, catalog, references, referenceFiles, manifest };
}
