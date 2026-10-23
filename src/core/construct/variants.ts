// Gemeinsamer Einstieg für die Bautechniken des Konstruktionsnachweises (A, B aus 05B.1; C aus 05B.2).
import type { CanonicalModel } from '../model/types';
import { BOW_VARIANT_LABEL, buildBow, type BowPlan, type BowVariant } from './bowTechnique';
import { buildCockpitBow, type CockpitPlan, type CockpitRequirements } from './cockpitTechnique';
import type { BowTarget } from './shapeTarget';

export type ConstructVariant = BowVariant | 'cockpit';
export const VARIANT_LABEL: Record<ConstructVariant, string> = { ...BOW_VARIANT_LABEL, cockpit: 'Variante C – Hohlbau mit Cockpit und abnehmbarer Kanzel' };
export const VARIANT_SHORT: Record<ConstructVariant, string> = { keilplatten: 'A', schraegsteine: 'B', cockpit: 'C' };

export type AnyPlan = BowPlan | CockpitPlan;

export function buildVariant(t: BowTarget, o: { variant: ConstructVariant; widthStuds: number; req?: Partial<CockpitRequirements> }): { model: CanonicalModel; plan: AnyPlan } {
  return o.variant === 'cockpit' ? buildCockpitBow(t, { widthStuds: o.widthStuds, req: o.req }) : buildBow(t, { variant: o.variant, widthStuds: o.widthStuds });
}

export const isCockpitPlan = (p: AnyPlan): p is CockpitPlan => p.variant === 'cockpit';
