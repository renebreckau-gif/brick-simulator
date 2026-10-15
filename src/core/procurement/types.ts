// Beschaffungsarchitektur (Phase 1: nur Schema – keine Angebote, keine simulierten Preise,
// keine Warenkorb-Integration). Katalogdaten und Angebotsdaten bleiben getrennt.
import type { Bom } from '../bom/bom';
import type { ModelRef } from '../model/types';

export type Condition = 'new' | 'used' | 'unknown';

/** Ein konkretes Händlerangebot – stammt immer aus einer externen, benannten Quelle. */
export interface Offer {
  offerId: string;
  part: { system: 'rebrickable' | 'bricklink' | 'lego-element'; id: string };
  color: { system: 'rebrickable' | 'bricklink' | 'lego'; id: string };
  condition: Condition;
  quantityAvailable: number;
  shipsFromRegion: string;
  deliveryRegions: string[];
  unitPrice: { amount: number; currency: string };
  shipping: { amount: number | null; currency: string; note: string | null };
  seller: { name: string; sourceUrl: string };
  provider: string;
  checkedAt: string;
}

export type ProcurementStatus = 'not-checked' | 'partially-checked' | 'checked' | 'stale';

/** Schnittstelle für spätere Anbieter (z. B. BrickLink Store API, LEGO Pick a Brick). */
export interface ProcurementProvider {
  id: string;
  name: string;
  /** Dokumentation/Nutzungsbedingungen des Anbieters. */
  termsUrl: string;
  requiresCredentials: boolean;
  findOffers(request: { lines: { part: string; color: number; quantity: number }[]; region: string }): Promise<Offer[]>;
}

/** Eigener Teilebestand (für späteren Abzug vor der Beschaffung). */
export interface OwnedInventory {
  inventoryId: string;
  source: string;
  lines: { rebrickablePart: string; rebrickableColor: number; quantity: number }[];
}

export interface ProcurementState {
  modelRef: ModelRef;
  status: ProcurementStatus;
  offers: Offer[];
  providersQueried: string[];
  note: string;
}

export function initialProcurementState(bom: Bom): ProcurementState {
  return {
    modelRef: bom.modelRef,
    status: 'not-checked',
    offers: [],
    providersQueried: [],
    note: 'Kein Anbieter angebunden. Verfügbarkeit und Preise sind nicht geprüft.',
  };
}

/** Fehlmengen nach Abzug eines eigenen Bestands (reine Mengenrechnung, keine Preise). */
export function shortfall(bom: Bom, owned: OwnedInventory | null) {
  const have = new Map<string, number>();
  for (const l of owned?.lines ?? []) have.set(`${l.rebrickablePart}|${l.rebrickableColor}`, (have.get(`${l.rebrickablePart}|${l.rebrickableColor}`) ?? 0) + l.quantity);
  return bom.lines.map((l) => {
    const h = have.get(`${l.rebrickablePart}|${l.rebrickableColor}`) ?? 0;
    return { rebrickablePart: l.rebrickablePart, rebrickableColor: l.rebrickableColor, needed: l.quantity, owned: Math.min(h, l.quantity), toProcure: Math.max(0, l.quantity - h) };
  });
}
