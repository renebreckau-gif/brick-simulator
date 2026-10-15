// Geometrische Voraussetzungen der Regel R-UPIN-HOLLOWSTUD (Unterseitenstift in Hohlnoppe).
// Geprüft werden ausschließlich LDraw-Nennmaße (siehe ConnectorGeometry.source). Ein „ok“ bedeutet
// „geometrisch kompatibel nach Nennmaßen“ – nicht „mechanisch belastbar“.
import { STUD_HEIGHT } from '../units';
import type { ConnectorGeometry } from './partMeta';

/** Maßtoleranz für den Vergleich von Nennmaßen (LDU). */
export const UPIN_DIMENSION_TOLERANCE = 0.05;

export interface GeometryCheck {
  name: string;
  value: number;
  limit: number;
  relation: '≤' | '≥';
  ok: boolean;
}

export function checkUpinGeometry(pin: ConnectorGeometry | undefined, holder: ConnectorGeometry | undefined): { ok: boolean; checks: GeometryCheck[]; missing: string[] } {
  const missing: string[] = [];
  const need = (g: ConnectorGeometry | undefined, k: keyof ConnectorGeometry, label: string) => {
    const v = g?.[k];
    if (v === undefined) missing.push(label);
    return v as number | [number, number] | undefined;
  };
  const pinR = need(pin, 'pinRadius', 'Stiftradius') as number | undefined;
  const pinL = need(pin, 'pinLength', 'Stiftlänge') as number | undefined;
  const cav = need(pin, 'cavityHalfWidth', 'Hohlraumweite') as [number, number] | undefined;
  const cavD = need(pin, 'cavityDepth', 'Hohlraumtiefe') as number | undefined;
  const holeR = need(holder, 'holeRadius', 'Lochradius') as number | undefined;
  const holeD = need(holder, 'holeDepth', 'Lochtiefe') as number | undefined;
  const outR = need(holder, 'outerRadius', 'Noppen-Außenradius') as number | undefined;
  if (missing.length) return { ok: false, checks: [], missing };
  const t = UPIN_DIMENSION_TOLERANCE;
  const insertion = STUD_HEIGHT;
  const checks: GeometryCheck[] = [
    { name: 'Stiftradius ≤ Lochradius', value: pinR!, limit: holeR!, relation: '≤', ok: pinR! <= holeR! + t },
    { name: 'Noppen-Außenradius ≤ halbe lichte Hohlraumweite (schmalere Seite)', value: outR!, limit: Math.min(...cav!), relation: '≤', ok: outR! <= Math.min(...cav!) + t },
    { name: 'Hohlraumtiefe ≥ Einstecktiefe (Noppenhöhe)', value: cavD!, limit: insertion, relation: '≥', ok: cavD! + t >= insertion },
    { name: 'Lochtiefe ≥ Stifteintauchtiefe (Stift endet bündig am Teilboden)', value: holeD!, limit: Math.min(insertion, pinL!), relation: '≥', ok: holeD! + t >= Math.min(insertion, pinL!) },
  ];
  return { ok: checks.every((c) => c.ok), checks, missing };
}
