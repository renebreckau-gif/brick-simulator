// Teile- und Farbkatalog. Drei getrennte Eigenschaften je Teil:
//  1. catalogStatus  – existiert die Nummer im belegten Katalogauszug?
//  2. simulation     – sind Anschluss-/Kollisionsregeln implementiert?
//  3. Beschaffung    – NICHT hier; siehe core/procurement (Standard: „nicht geprüft“).
import { normalizeColorName, type LdColor } from '../ldraw/colors';
import type { PartLibrary } from '../ldraw/library';
import { partMeta, unsupportedMetaFromBBox, PART_META_VERSION, type PartMeta, type SupportLevel } from '../connectivity/partMeta';

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

export interface CatalogPart {
  ldrawId: string;
  rebrickableId: string | null;
  name: string | null;
  ldrawTitle: string | null;
  mappingBasis: 'identical' | 'manual' | 'none';
  mappingReason?: string;
  catalogStatus: 'known' | 'unknown';
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
  mappingBasis: 'code-and-name' | 'none';
}

export interface PartColorEvidence {
  status: 'evidenced' | 'not-evidenced' | 'not-resolvable';
  elementIds: string[];
  setCount: number;
  source: string;
}

export class Catalog {
  readonly version: string;
  private partsByLdraw = new Map<string, CatalogPart>();
  private colorsByLdraw = new Map<number, CatalogColor>();
  private evidence = new Map<string, { elementIds: string[]; setCount: number }>();

  constructor(
    readonly idMap: IdMap,
    readonly extract: RebrickableExtract,
    readonly ldColors: Map<number, LdColor>,
    private library: PartLibrary,
  ) {
    this.version = `catalog@${idMap.version}+rebrickable@${extract.source.fetchedAt.slice(0, 10)}+${PART_META_VERSION}`;
    for (const e of extract.partColorEvidence) this.evidence.set(`${e.part}|${e.color}`, e);
    for (const [id, c] of Object.entries(extract.colors)) {
      const code = Number(id);
      const ld = ldColors.get(code);
      const sameName = ld && normalizeColorName(ld.name) === normalizeColorName(c.name);
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
    const rb = map ? this.extract.parts[map.rebrickable] : undefined;
    const header = this.library.header(`${ldrawId}.dat`);
    let meta = partMeta(ldrawId) ?? null;
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
      catalogStatus: rb ? 'known' : 'unknown',
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
    return { ldrawCode, ldrawName: ld.name, rebrickableId: null, rebrickableName: null, rgb: ld.value, mappingBasis: 'none' };
  }

  /** Darstellungsfarbe (LDraw-Wert bevorzugt; direkte Farben 0x2RRGGBB werden dekodiert). */
  displayColor(ldrawCode: number): { value: string; edge: string; alpha: number } {
    const ld = this.ldColors.get(ldrawCode);
    if (ld) return { value: ld.value, edge: ld.edge, alpha: ld.alpha };
    if (ldrawCode >= 0x2000000 && ldrawCode <= 0x2ffffff) return { value: `#${(ldrawCode & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`, edge: '#333333', alpha: 1 };
    return { value: '#FF00FF', edge: '#000000', alpha: 1 };
  }

  partColorEvidence(ldrawId: string, ldrawCode: number): PartColorEvidence {
    const part = this.part(ldrawId);
    const color = this.color(ldrawCode);
    if (!part.rebrickableId || color?.rebrickableId == null) return { status: 'not-resolvable', elementIds: [], setCount: 0, source: 'Teil- oder Farbzuordnung fehlt' };
    const e = this.evidence.get(`${part.rebrickableId}|${color.rebrickableId}`);
    if (!e) return { status: 'not-evidenced', elementIds: [], setCount: 0, source: 'Rebrickable elements.csv / inventory_parts.csv: kein Beleg' };
    return { status: 'evidenced', elementIds: e.elementIds, setCount: e.setCount, source: 'Rebrickable elements.csv (Element-IDs) und inventory_parts.csv (Anzahl Sets)' };
  }

  relationshipsFor(rbPart: string) {
    return this.extract.relationships.filter((r) => r.child === rbPart || r.parent === rbPart);
  }
}
