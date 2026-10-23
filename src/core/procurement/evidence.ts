// Teil-Farb-Belege und Mengenabdeckung (Auftrag 05B.2).
//
// Grundsätze: LDraw-Geometrie und darstellbare Farben belegen weder Existenz noch Kaufbarkeit. Eine
// Stücklistenposition gilt nur als beschaffbar, wenn (1) ein Existenzbeleg für genau diese Teil-Farb-Kombination
// vorliegt und (2) konkrete, zeitgebundene Angebote zusammen die benötigte Menge decken. Fehlt etwas, ist die
// Position „nicht belegt“ bzw. „nicht gedeckt“ – unbekannt heißt nicht verfügbar. Dasselbe Angebot wird nie
// doppelt gezählt.
import { z } from 'zod';
import type { CanonicalModel } from '../model/types';
import type { Offer } from './types';

export const EVIDENCE_SCHEMA = 'baustein-sim/part-evidence@1';

const OfferSchema = z.object({
  offerId: z.string(),
  part: z.object({ system: z.enum(['rebrickable', 'bricklink', 'lego-element']), id: z.string() }),
  color: z.object({ system: z.enum(['rebrickable', 'bricklink', 'lego']), id: z.string() }),
  condition: z.enum(['new', 'used', 'unknown']),
  quantityAvailable: z.number().int().nonnegative(),
  shipsFromRegion: z.string(),
  deliveryRegions: z.array(z.string()),
  unitPrice: z.object({ amount: z.number(), currency: z.string() }),
  shipping: z.object({ amount: z.number().nullable(), currency: z.string(), note: z.string().nullable() }),
  seller: z.object({ name: z.string(), sourceUrl: z.string() }),
  provider: z.string(),
  checkedAt: z.string(),
});

export const EvidenceFileSchema = z.object({
  schema: z.literal(EVIDENCE_SCHEMA),
  checkedAt: z.string(),
  region: z.string(),
  note: z.string(),
  colorMapping: z.array(z.object({ ldraw: z.coerce.number(), rebrickable: z.number(), rebrickableName: z.string(), bricklink: z.number(), bricklinkName: z.string() })),
  lines: z.array(z.object({
    ldraw: z.object({ part: z.string(), color: z.number() }),
    rebrickable: z.object({ part: z.string(), color: z.number(), colorName: z.string(), elementIds: z.array(z.string()), setInventories: z.number(), years: z.tuple([z.number(), z.number()]).nullable() }),
    bricklink: z.object({ part: z.string(), color: z.number(), colorName: z.string() }),
    existence: z.array(z.string()),
    weightG: z.number().nullable(),
    offers: z.array(OfferSchema),
  })),
});
export type EvidenceFile = z.infer<typeof EvidenceFileSchema>;
export type EvidenceLine = EvidenceFile['lines'][number];

export type CoverageStatus = 'gedeckt' | 'teilweise' | 'kein-angebot' | 'kein-existenzbeleg';

export interface CoverageLine {
  ldrawPart: string;
  ldrawColor: number;
  needed: number;
  evidence: EvidenceLine | null;
  /** Existenzbeleg: mindestens eine Element-ID oder ein Set-Inventar für genau diese Kombination. */
  existenceEvidenced: boolean;
  /** Angebote in der Reihenfolge, in der sie den Bedarf decken (je Angebot nur einmal gezählt). */
  used: { offer: Offer; take: number }[];
  covered: number;
  status: CoverageStatus;
}

export interface Coverage {
  region: string;
  checkedAt: string | null;
  lines: CoverageLine[];
  complete: boolean;
  /** Geschätzte Masse aus Katalogangaben je Teil; null, wenn für eine Position keine Angabe vorliegt. */
  massG: number | null;
  missingWeights: string[];
}

/**
 * Deckt den Bedarf aus der Stückliste eines Modells mit belegten Angeboten. Region: Angebote, die dorthin
 * liefern; Zustand: neu bevorzugt, gebraucht nur, wenn erlaubt.
 */
export function coverageFor(model: CanonicalModel, ev: EvidenceFile | null, opts: { region?: string; allowUsed?: boolean } = {}): Coverage {
  const region = opts.region ?? 'DE';
  const need = new Map<string, number>();
  for (const i of model.instances) need.set(`${i.part}|${i.color}`, (need.get(`${i.part}|${i.color}`) ?? 0) + 1);
  const lines: CoverageLine[] = [];
  let mass = 0;
  const missingWeights: string[] = [];
  for (const [k, n] of [...need].sort()) {
    const [part, colorS] = k.split('|');
    const color = Number(colorS);
    const e = ev?.lines.find((l) => l.ldraw.part === part && l.ldraw.color === color) ?? null;
    const existenceEvidenced = !!e && (e.rebrickable.elementIds.length > 0 || e.rebrickable.setInventories > 0);
    const seen = new Set<string>();
    const candidates = (e?.offers ?? [])
      .filter((o) => o.deliveryRegions.includes(region) && (o.condition === 'new' || (opts.allowUsed && o.condition === 'used')))
      .filter((o) => (seen.has(o.offerId) ? false : (seen.add(o.offerId), true)))
      .sort((a, b) => (a.condition === b.condition ? 0 : a.condition === 'new' ? -1 : 1) || a.unitPrice.amount - b.unitPrice.amount);
    const used: CoverageLine['used'] = [];
    let covered = 0;
    for (const o of candidates) {
      if (covered >= n) break;
      const take = Math.min(o.quantityAvailable, n - covered);
      if (take <= 0) continue;
      used.push({ offer: o, take });
      covered += take;
    }
    const status: CoverageStatus = !existenceEvidenced ? 'kein-existenzbeleg' : covered >= n ? 'gedeckt' : covered > 0 ? 'teilweise' : 'kein-angebot';
    lines.push({ ldrawPart: part, ldrawColor: color, needed: n, evidence: e, existenceEvidenced, used, covered, status });
    if (e?.weightG != null) mass += e.weightG * n;
    else missingWeights.push(k);
  }
  return { region, checkedAt: ev?.checkedAt ?? null, lines, complete: lines.every((l) => l.status === 'gedeckt'), massG: missingWeights.length ? null : +mass.toFixed(2), missingWeights };
}

/** Masse aus Katalogangaben (g) für ein Modell; Teile ohne Angabe werden gemeldet. */
export function massEstimate(model: CanonicalModel, ev: EvidenceFile | null): { grams: number; missing: string[] } {
  let g = 0;
  const missing = new Set<string>();
  for (const i of model.instances) {
    const w = ev?.lines.find((l) => l.ldraw.part === i.part && l.weightG != null)?.weightG;
    if (w == null) missing.add(i.part);
    else g += w;
  }
  return { grams: +g.toFixed(2), missing: [...missing] };
}
