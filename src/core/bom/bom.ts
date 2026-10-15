// Exakte Stückliste aus dem kanonischen Modell (unabhängig von Datei-/Instanzreihenfolge).
import type { Catalog } from '../catalog/catalog';
import { modelRef } from '../model/hash';
import type { CanonicalModel, ModelRef } from '../model/types';

export interface BomLine {
  ldrawPart: string;
  ldrawColor: number;
  quantity: number;
  rebrickablePart: string;
  rebrickableColor: number;
  partName: string;
  colorName: string;
  simulation: string;
  combination: 'evidenced' | 'not-evidenced';
  elementIds: string[];
  instanceIds: string[];
}

export interface UnresolvedLine {
  ldrawPart: string;
  ldrawColor: number;
  quantity: number;
  reasons: string[];
  instanceIds: string[];
}

export interface Bom {
  schema: 'baustein-sim/bom@1';
  modelRef: ModelRef;
  catalogVersion: string;
  lines: BomLine[];
  unresolved: UnresolvedLine[];
  totalInstances: number;
}

export function computeBom(model: CanonicalModel, catalog: Catalog): Bom {
  const groups = new Map<string, { part: string; color: number; ids: string[] }>();
  for (const i of model.instances) {
    const k = `${i.part}|${i.color}`;
    (groups.get(k) ?? groups.set(k, { part: i.part, color: i.color, ids: [] }).get(k)!).ids.push(i.instanceId);
  }
  const lines: BomLine[] = [];
  const unresolved: UnresolvedLine[] = [];
  for (const g of groups.values()) {
    const p = catalog.part(g.part);
    const c = catalog.color(g.color);
    const reasons: string[] = [];
    if (!p.rebrickableId || p.catalogStatus !== 'known') reasons.push('Teil nicht im Katalogauszug');
    if (!c || c.rebrickableId === null) reasons.push('Farbe ohne Katalogzuordnung');
    const ids = [...g.ids].sort();
    if (reasons.length) {
      unresolved.push({ ldrawPart: g.part, ldrawColor: g.color, quantity: ids.length, reasons, instanceIds: ids });
      continue;
    }
    const ev = catalog.partColorEvidence(g.part, g.color);
    lines.push({
      ldrawPart: g.part,
      ldrawColor: g.color,
      quantity: ids.length,
      rebrickablePart: p.rebrickableId!,
      rebrickableColor: c!.rebrickableId!,
      partName: p.name ?? p.ldrawTitle ?? g.part,
      colorName: c!.rebrickableName ?? c!.ldrawName ?? String(g.color),
      simulation: p.simulation,
      combination: ev.status === 'evidenced' ? 'evidenced' : 'not-evidenced',
      elementIds: ev.elementIds,
      instanceIds: ids,
    });
  }
  const sortKey = (a: { ldrawPart: string; ldrawColor: number }, b: { ldrawPart: string; ldrawColor: number }) => a.ldrawPart.localeCompare(b.ldrawPart, 'en', { numeric: true }) || a.ldrawColor - b.ldrawColor;
  return {
    schema: 'baustein-sim/bom@1',
    modelRef: modelRef(model),
    catalogVersion: catalog.version,
    lines: lines.sort(sortKey),
    unresolved: unresolved.sort(sortKey),
    totalInstances: model.instances.length,
  };
}

export type CompareStatus = 'match' | 'quantity-differs' | 'only-in-model' | 'only-in-reference' | 'variant-of';

export interface CompareLine {
  rebrickablePart: string;
  color: number;
  colorName: string | null;
  partName: string | null;
  modelQty: number;
  referenceQty: number;
  status: CompareStatus;
  note: string | null;
}

export interface BomComparison {
  source: string;
  lines: CompareLine[];
  summary: { match: number; differing: number; modelTotal: number; referenceTotal: number; spareExcluded: number };
}

/** Abgleich gegen ein unabhängiges Inventar (Rebrickable). Ersatzteile (spare) werden nicht mitgezählt. */
export function compareBom(bom: Bom, setNum: string, catalog: Catalog): BomComparison | null {
  const inv = catalog.extract.referenceInventories[setNum];
  if (!inv) return null;
  const ref = new Map<string, { qty: number; name: string | null }>();
  let spare = 0;
  for (const l of inv.lines) {
    if (l.isSpare) { spare += l.quantity; continue; }
    const k = `${l.part}|${l.color}`;
    const e = ref.get(k) ?? { qty: 0, name: l.partName };
    e.qty += l.quantity;
    ref.set(k, e);
  }
  const mine = new Map<string, number>();
  for (const l of bom.lines) mine.set(`${l.rebrickablePart}|${l.rebrickableColor}`, (mine.get(`${l.rebrickablePart}|${l.rebrickableColor}`) ?? 0) + l.quantity);
  const keys = [...new Set([...ref.keys(), ...mine.keys()])].sort();
  const lines: CompareLine[] = keys.map((k) => {
    const [part, color] = k.split('|');
    const m = mine.get(k) ?? 0;
    const r = ref.get(k)?.qty ?? 0;
    let status: CompareStatus = m === r ? 'match' : m && r ? 'quantity-differs' : m ? 'only-in-model' : 'only-in-reference';
    let note: string | null = null;
    if (status === 'only-in-model' || status === 'only-in-reference') {
      // Formvarianten (Rebrickable-Relation M) als Hinweis kennzeichnen – nicht als Übereinstimmung
      const rel = catalog.extract.relationships.find((x) => x.type === 'M' && (x.child === part || x.parent === part) && [...(status === 'only-in-model' ? ref.keys() : mine.keys())].some((kk) => kk === `${x.child === part ? x.parent : x.child}|${color}`));
      if (rel) {
        status = 'variant-of';
        note = `Formvariante laut Rebrickable (Relation M: ${rel.child} ↔ ${rel.parent}); Quelle und Modell nennen unterschiedliche Varianten.`;
      }
    }
    return { rebrickablePart: part, color: Number(color), colorName: catalog.extract.colors[color]?.name ?? null, partName: ref.get(k)?.name ?? catalog.extract.parts[part]?.name ?? null, modelQty: m, referenceQty: r, status, note };
  });
  return {
    source: `Rebrickable-Inventar ${setNum} (inventory_id ${inv.inventoryId}, Version ${inv.version}), Auszug vom ${catalog.extract.source.fetchedAt.slice(0, 10)}`,
    lines,
    summary: {
      match: lines.filter((l) => l.status === 'match').length,
      differing: lines.filter((l) => l.status !== 'match').length,
      modelTotal: [...mine.values()].reduce((a, b) => a + b, 0),
      referenceTotal: [...ref.values()].reduce((a, b) => a + b.qty, 0),
      spareExcluded: spare,
    },
  };
}
