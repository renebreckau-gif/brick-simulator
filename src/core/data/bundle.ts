// Laden aller lokalen Daten über eine austauschbare Lesefunktion
// (Browser: fetch auf /data, Tests: Dateisystem).
//
// Pflichtdaten (im Repository, veröffentlichbar): LDraw-Geometrie, Farben, ID-Zuordnung, Referenzmodelle.
// Optional: Katalogauszug (Rebrickable, privat, nicht veröffentlicht). Fehlt er, läuft alles außer den
// Katalog- und Inventarabgleichen; ist er beschädigt, wird das mit Grund gemeldet und nicht verwendet.
import { Catalog, CatalogDataError, parseExtract, TEST_FIXTURE_PROVIDER, type CatalogSource, type IdMap, type RebrickableExtract } from '../catalog/catalog';
import { parseLdConfig } from '../ldraw/colors';
import { PartLibrary } from '../ldraw/library';

/** Liefert den Dateiinhalt oder null, wenn die Datei nicht existiert. Andere Fehler werden geworfen. */
export type ReadText = (path: string) => Promise<string | null>;

export const CATALOG_EXTRACT_PATH = 'catalog/rebrickable-extract.json';

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

export interface DataSourceInfo {
  id: string;
  label: string;
  required: boolean;
  state: 'loaded' | 'missing' | 'corrupt';
  detail: string;
}

export interface DataBundle {
  library: PartLibrary;
  catalog: Catalog;
  references: ReferenceMeta[];
  referenceFiles: Map<string, string>;
  manifest: { fetchedAt: string; source: string; files: Record<string, { path?: string; sha256?: string; license?: string | null }> };
  sources: DataSourceInfo[];
}

export class RequiredDataError extends Error {
  constructor(readonly path: string) {
    super(`Pflichtdatei fehlt: data/${path}. Sie gehört zum Repository – Checkout unvollständig?`);
    this.name = 'RequiredDataError';
  }
}

async function required(read: ReadText, path: string): Promise<string> {
  const t = await read(path);
  if (t === null) throw new RequiredDataError(path);
  return t;
}

/** Lädt die optionale Katalogquelle und unterscheidet „fehlt“ von „beschädigt“. */
export async function loadCatalogSource(read: ReadText, path = CATALOG_EXTRACT_PATH): Promise<{ extract: RebrickableExtract | null; source: CatalogSource }> {
  const text = await read(path);
  if (text === null) return { extract: null, source: { state: 'missing', path } };
  try {
    const extract = parseExtract(text, path);
    const kind = extract.source.provider === TEST_FIXTURE_PROVIDER ? 'test-fixture' : 'rebrickable';
    return { extract, source: { state: 'loaded', kind, path, fetchedAt: extract.source.fetchedAt } };
  } catch (e) {
    if (e instanceof CatalogDataError) return { extract: null, source: { state: 'corrupt', path, error: e.message } };
    throw e;
  }
}

export async function loadBundle(read: ReadText): Promise<DataBundle> {
  const manifest = JSON.parse(await required(read, 'ldraw/manifest.json')) as DataBundle['manifest'];
  const files = new Map<string, string>();
  const paths = Object.values(manifest.files).map((f) => f.path).filter((p): p is string => !!p && p.endsWith('.dat'));
  const texts = await Promise.all(paths.map((p) => required(read, `ldraw/${p}`)));
  paths.forEach((p, i) => files.set(p.toLowerCase(), texts[i]));
  const library = new PartLibrary(files);
  const ldconfig = parseLdConfig(await required(read, 'ldraw/LDConfig.ldr'));
  const idMap = JSON.parse(await required(read, 'catalog/id-map.json')) as IdMap;
  const { extract, source } = await loadCatalogSource(read);
  const catalog = new Catalog(idMap, extract, source, ldconfig, library);
  const references = JSON.parse(await required(read, 'references/references.json')) as ReferenceMeta[];
  const referenceFiles = new Map<string, string>();
  for (const r of references) referenceFiles.set(r.referenceId, await required(read, r.file));

  const sources: DataSourceInfo[] = [
    { id: 'ldraw', label: 'LDraw-Teilegeometrie', required: true, state: 'loaded', detail: `${paths.length} Teiledateien, abgerufen ${manifest.fetchedAt.slice(0, 10)}, CC BY 4.0` },
    { id: 'ldconfig', label: 'LDraw-Farben (LDConfig.ldr)', required: true, state: 'loaded', detail: `${ldconfig.size} Farben` },
    { id: 'id-map', label: 'ID-Zuordnung LDraw → Rebrickable', required: true, state: 'loaded', detail: `${idMap.parts.length} Einträge (eigene Daten)` },
    { id: 'references', label: 'Referenzmodelle (LDraw-OMR)', required: true, state: 'loaded', detail: `${references.length} Modelle, CC BY 2.0` },
    {
      id: 'catalog',
      label: 'Katalogauszug (Rebrickable, privat)',
      required: false,
      state: source.state,
      detail:
        source.state === 'loaded'
          ? `${source.kind === 'test-fixture' ? 'TESTFIXTURE (synthetisch, kein Beleg)' : 'Rebrickable'}, Stand ${source.fetchedAt.slice(0, 10)}`
          : source.state === 'missing'
            ? `nicht vorhanden (data/${source.path}) – Katalog- und Inventarabgleiche bleiben ungeprüft`
            : source.error,
    },
  ];
  return { library, catalog, references, referenceFiles, manifest, sources };
}

