// Teile- und Farbkatalog. Drei getrennte Eigenschaften je Teil:
//  1. catalogStatus  – existiert die Nummer im belegten Katalogauszug?
//  2. simulation     – sind Anschluss-/Kollisionsregeln implementiert?
//  3. Beschaffung    – NICHT hier; siehe core/procurement (Standard: „nicht geprüft“).
//
// Der Katalogauszug (Rebrickable) ist OPTIONAL. Fehlt er oder ist er beschädigt, bleiben
// Katalogexistenz, Teil-Farb-Belege und Inventarabgleiche ausdrücklich „ungeprüft“;
// es werden keine Ersatzdaten erzeugt. Geometrie und eigene Anschlussregeln wirken unabhängig davon.
import { normalizeColorName, type LdColor } from '../ldraw/colors';
import type { PartLibrary } from '../ldraw/library';
import { unsupportedMetaFromBBox, PART_META_VERSION, type PartMeta, type SupportLevel } from '../connectivity/partMeta';
import { pureRenameTarget, resolvePartMeta } from '../connectivity/identity';

export interface IdMapEntry {
  ldraw: string;
  rebrickable: string;
  basis: 'identical' | 'manual';
  reason?: string;
}
export interface IdMap {
  version: string;
  parts: IdMapEntry[];
}

export interface RebrickableExtract {
  schema: string;
  source: { provider: string; downloadsPage: string; fetchedAt: string; usageNote: string; files: Record<string, { bytes: number; url: string }> };
  parts: Record<string, { name: string; partCatId: number; material: string }>;
  colors: Record<string, { name: string; rgb: string; isTrans: boolean }>;
  partColorEvidence: { part: string; color: number; elementIds: string[]; setCount: number }[];
  relationships: { type: string; child: string; parent: string }[];
  referenceSets: Record<string, { name: string; year: number; numParts: number; themeId: number }>;
  referenceInventories: Record<string, { inventoryId: string; version: number; lines: { part: string; color: number; quantity: number; isSpare: boolean; partName: string | null }[] }>;
}

export const EXTRACT_SCHEMA = 'baustein-sim/rebrickable-extract@1';
/** Kennzeichnung synthetischer Testdaten (source.provider). Solche Daten sind nie ein Beleg für reale Teile. */
export const TEST_FIXTURE_PROVIDER = 'TEST-FIXTURE (synthetisch, kein Katalogbeleg)';

/** Zustand der optionalen Katalogquelle. */
export type CatalogSource =
  | { state: 'loaded'; kind: 'rebrickable' | 'test-fixture'; path: string; fetchedAt: string }
  | { state: 'missing'; path: string }
  | { state: 'corrupt'; path: string; error: string };

export class CatalogDataError extends Error {
  constructor(readonly path: string, readonly reason: string) {
    super(`Katalogdatei ${path} ist beschädigt: ${reason}`);
    this.name = 'CatalogDataError';
  }
}

/** Parst und prüft einen Katalogauszug. Wirft CatalogDataError mit nachvollziehbarem Grund. */
export function parseExtract(text: string, path: string): RebrickableExtract {
  const fail = (reason: string): never => {
    throw new CatalogDataError(path, reason);
  };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    fail(`kein gültiges JSON (${(e as Error).message})`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Wurzel ist kein JSON-Objekt');
  const d = data as Record<string, unknown>;
  if (d.schema !== EXTRACT_SCHEMA) fail(`Schema „${String(d.schema)}“ statt „${EXTRACT_SCHEMA}“`);
  const src = d.source as Record<string, unknown> | undefined;
  if (!src || typeof src !== 'object') fail('Feld „source“ fehlt');
  if (typeof src!.fetchedAt !== 'string' || Number.isNaN(Date.parse(src!.fetchedAt as string))) fail('„source.fetchedAt“ fehlt oder ist kein Datum');
  if (typeof src!.provider !== 'string') fail('„source.provider“ fehlt');
  for (const k of ['parts', 'colors', 'referenceSets', 'referenceInventories'])
    if (!d[k] || typeof d[k] !== 'object' || Array.isArray(d[k])) fail(`Feld „${k}“ fehlt oder ist kein Objekt`);
  for (const k of ['partColorEvidence', 'relationships']) if (!Array.isArray(d[k])) fail(`Feld „${k}“ fehlt oder ist keine Liste`);
  (d.partColorEvidence as unknown[]).forEach((e, i) => {
    const x = e as Record<string, unknown> | null;
    if (typeof x?.part !== 'string' || typeof x?.color !== 'number' || !Array.isArray(x?.elementIds) || typeof x?.setCount !== 'number')
      fail(`„partColorEvidence[${i}]“ hat nicht die Form {part, color, elementIds, setCount}`);
  });
  for (const [id, c] of Object.entries(d.colors as Record<string, unknown>)) {
    const x = c as Record<string, unknown> | null;
    if (!/^-?\d+$/.test(id) || typeof x?.name !== 'string' || typeof x?.rgb !== 'string') fail(`Farbe „${id}“ unvollständig`);
  }
  for (const [id, p] of Object.entries(d.parts as Record<string, unknown>))
    if (typeof (p as Record<string, unknown> | null)?.name !== 'string') fail(`Teil „${id}“ ohne Namen`);
  for (const [set, inv] of Object.entries(d.referenceInventories as Record<string, unknown>))
    if (!Array.isArray((inv as Record<string, unknown> | null)?.lines)) fail(`Inventar „${set}“ ohne Positionsliste`);
  return d as unknown as RebrickableExtract;
}

export interface CatalogPart {
  ldrawId: string;
  rebrickableId: string | null;
  name: string | null;
  ldrawTitle: string | null;
  mappingBasis: 'identical' | 'manual' | 'none';
  mappingReason?: string;
  /** known/unknown nur bei geladenem Katalog; sonst unavailable (= ungeprüft). */
  catalogStatus: 'known' | 'unknown' | 'unavailable';
  geometryAvailable: boolean;
  simulation: SupportLevel | 'none';
  meta: PartMeta | null;
}

export interface CatalogColor {
  ldrawCode: number;
  ldrawName: string | null;
  rebrickableId: number | null;
  rebrickableName: string | null;
  rgb: string;
  /** unavailable = kein Katalog geladen, Zuordnung ungeprüft. */
  mappingBasis: 'code-and-name' | 'none' | 'unavailable';
}

export interface PartColorEvidence {
  status: 'evidenced' | 'not-evidenced' | 'not-resolvable' | 'unchecked';
  elementIds: string[];
  setCount: number;
  source: string;
}

export class Catalog {
  readonly version: string;
  /** true nur bei geladener, gültiger Katalogquelle. */
  readonly available: boolean;
  private partsByLdraw = new Map<string, CatalogPart>();
  private colorsByLdraw = new Map<number, CatalogColor>();
  private evidence = new Map<string, { elementIds: string[]; setCount: number }>();

  constructor(
    readonly idMap: IdMap,
    readonly extract: RebrickableExtract | null,
    readonly source: CatalogSource,
    readonly ldColors: Map<number, LdColor>,
    private library: PartLibrary,
  ) {
    this.available = extract !== null && source.state === 'loaded';
    const tag = !this.available
      ? source.state === 'corrupt' ? 'katalog-beschaedigt' : 'katalog-nicht-geladen'
      : `${source.state === 'loaded' && source.kind === 'test-fixture' ? 'testfixture' : 'rebrickable'}@${extract!.source.fetchedAt.slice(0, 10)}`;
    this.version = `catalog@${idMap.version}+${tag}+${PART_META_VERSION}`;
    if (!this.available) return;
    for (const e of extract!.partColorEvidence) this.evidence.set(`${e.part}|${e.color}`, e);
    for (const [id, c] of Object.entries(extract!.colors)) {
      const code = Number(id);
      const ld = ldColors.get(code);
      const sameName = !!ld && normalizeColorName(ld.name) === normalizeColorName(c.name);
      this.colorsByLdraw.set(code, {
        ldrawCode: code,
        ldrawName: ld?.name ?? null,
        rebrickableId: sameName ? code : null,
        rebrickableName: c.name,
        rgb: `#${c.rgb}`,
        mappingBasis: sameName ? 'code-and-name' : 'none',
      });
    }
  }

  part(ldrawIdRaw: string): CatalogPart {
    const ldrawId = ldrawIdRaw.toLowerCase().replace(/\.dat$/, '');
    const cached = this.partsByLdraw.get(ldrawId);
    if (cached) return cached;
    const map = this.idMap.parts.find((p) => p.ldraw.toLowerCase() === ldrawId);
    const rb = map && this.available ? this.extract!.parts[map.rebrickable] : undefined;
    const header = this.library.header(`${ldrawId}.dat`);
    // Gemeinsame, belegte Identitätsauflösung (05C.1.1): z. B. 3023b über die reine Umbenennung 3023.dat → 3023b.dat
    let meta = resolvePartMeta(ldrawId, (k) => pureRenameTarget(this.library.header(`${k}.dat`)))?.meta ?? null;
    if (!meta && header) {
      const flat = this.library.flatten(`${ldrawId}.dat`);
      const family = ldrawId === '59900' ? 'cone' : ldrawId === '30374' ? 'bar' : 'brick';
      meta = unsupportedMetaFromBBox(ldrawId, family, flat.triangles.length ? flat.bbox : null, 'Keine Anschlussregeln für dieses Teil implementiert');
    }
    const part: CatalogPart = {
      ldrawId,
      rebrickableId: map?.rebrickable ?? null,
      name: rb?.name ?? null,
      ldrawTitle: header?.title ?? null,
      mappingBasis: map?.basis ?? 'none',
      mappingReason: map?.reason,
      catalogStatus: !this.available ? 'unavailable' : rb ? 'known' : 'unknown',
      geometryAvailable: header !== null,
      simulation: meta?.support ?? 'none',
      meta,
    };
    this.partsByLdraw.set(ldrawId, part);
    return part;
  }

  color(ldrawCode: number): CatalogColor | null {
    const c = this.colorsByLdraw.get(ldrawCode);
    if (c) return c;
    const ld = this.ldColors.get(ldrawCode);
    if (!ld) return null;
    return { ldrawCode, ldrawName: ld.name, rebrickableId: null, rebrickableName: null, rgb: ld.value, mappingBasis: this.available ? 'none' : 'unavailable' };
  }

  /** Darstellungsfarbe (LDraw-Wert bevorzugt; direkte Farben 0x2RRGGBB werden dekodiert). */
  displayColor(ldrawCode: number): { value: string; edge: string; alpha: number } {
    const ld = this.ldColors.get(ldrawCode);
    if (ld) return { value: ld.value, edge: ld.edge, alpha: ld.alpha };
    if (ldrawCode >= 0x2000000 && ldrawCode <= 0x2ffffff) return { value: `#${(ldrawCode & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`, edge: '#333333', alpha: 1 };
    return { value: '#FF00FF', edge: '#000000', alpha: 1 };
  }

  partColorEvidence(ldrawId: string, ldrawCode: number): PartColorEvidence {
    if (!this.available) return { status: 'unchecked', elementIds: [], setCount: 0, source: 'Kein Katalog geladen – Teil-Farb-Beleg ungeprüft' };
    const part = this.part(ldrawId);
    const color = this.color(ldrawCode);
    if (!part.rebrickableId || color?.rebrickableId == null) return { status: 'not-resolvable', elementIds: [], setCount: 0, source: 'Teil- oder Farbzuordnung fehlt' };
    const e = this.evidence.get(`${part.rebrickableId}|${color.rebrickableId}`);
    if (!e) return { status: 'not-evidenced', elementIds: [], setCount: 0, source: 'Katalogauszug: kein Beleg (Element-ID oder Set-Inventar)' };
    return {
      status: 'evidenced',
      elementIds: e.elementIds,
      setCount: e.setCount,
      source: this.source.state === 'loaded' && this.source.kind === 'test-fixture' ? 'Testfixture (synthetisch – kein realer Beleg)' : 'Rebrickable elements.csv (Element-IDs) und inventory_parts.csv (Anzahl Sets)',
    };
  }

  relationshipsFor(rbPart: string) {
    return (this.extract?.relationships ?? []).filter((r) => r.child === rbPart || r.parent === rbPart);
  }
}
