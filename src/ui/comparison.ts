// Vergleichsgrundlage für den Inventarabgleich: Sie muss zum aktuell dargestellten Modell gehören,
// nicht zur zuletzt gewählten Auswahl im Prüflabor.
import type { CanonicalModel } from '../core/model/types';
import type { LabItem } from './items';

/** Referenz-ID für den Stücklistenabgleich oder undefined, wenn das dargestellte Modell keine Referenz ist
 *  (z. B. ein erzeugtes Raumschiff) oder nicht zur gewählten Referenz gehört. */
export function comparisonReferenceId(model: CanonicalModel | null, item: LabItem | undefined, mode: 'pruef' | 'schiff'): string | undefined {
  if (mode !== 'pruef' || !model || !item?.referenceId) return undefined;
  if (model.origin.kind !== 'reference' || model.origin.referenceId !== item.referenceId) return undefined;
  return item.referenceId;
}

export const GENERATED_COMPARISON_NOTE = 'Kein Inventarabgleich: eigener Entwurf, zu dem es kein Referenzinventar gibt. Die Stückliste stammt ausschließlich aus dem dargestellten Modell.';
