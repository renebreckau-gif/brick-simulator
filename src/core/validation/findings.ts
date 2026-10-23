// Befund- und Berichtsschema.
// Grundsatz: Fehlende Daten oder nicht implementierte Prüfungen ergeben „ungeprüft“
// bzw. „nicht unterstützt“ – niemals „bestanden“ und nie automatisch „nicht baubar“.
import type { ModelRef } from '../model/types';

// 0.3.0: Kollision mit exakten konvexen Prismen (Schrägen, Keile) per Trennachsentest (Auftrag 05B.1)
export const VALIDATOR_VERSION = 'validator@0.3.0';

export type Layer =
  | 'catalog'
  | 'geometry'
  | 'connection'
  | 'graph'
  | 'collision'
  | 'assembly'
  | 'stability'
  | 'structure'
  | 'usage'
  | 'function'
  | 'procurement';

/** Drei getrennte Bewertungsdimensionen (plus Datenbasis). */
export type Dimension = 'data' | 'assembly' | 'robustness' | 'usage';

/** Ergebnis eines Befunds. */
export type FindingStatus = 'passed' | 'failed' | 'unchecked' | 'unsupported';

/** Bedeutung für die Montage/Nutzung. */
export type Severity = 'blocker' | 'warning' | 'info';

/**
 * Evidenzstufe:
 * - confirmed: deterministische Prüfung im unterstützten Regelumfang
 * - heuristic: begründete Näherung ohne kalibrierte Daten („heuristische Einschätzung“)
 * - unchecked: nicht untersucht / nicht untersuchbar
 */
export type EvidenceLevel = 'confirmed' | 'heuristic' | 'unchecked';

export interface Finding {
  id: string;
  code: string;
  layer: Layer;
  dimension: Dimension;
  status: FindingStatus;
  severity: Severity;
  evidenceLevel: EvidenceLevel;
  title: string;
  message: string;
  affected: { instanceIds: string[]; assemblyIds: string[]; stepIds: string[] };
  ruleVersion: string;
  evidence: Record<string, unknown>;
  limitation: string | null;
  remedy: string | null;
}

export interface LayerSummary {
  layer: Layer;
  /** passed = im Umfang geprüft ohne Fehler; failed = bestätigter Fehler; flagged = nur heuristische Hinweise;
   *  partial = teilweise ungeprüft/nicht unterstützt. */
  status: 'passed' | 'failed' | 'flagged' | 'partial' | 'unchecked';
  counts: Record<FindingStatus, number>;
  scope: string;
}

export interface DataVersions {
  catalog: string;
  partMeta: string;
  rules: string;
  validator: string;
}

export interface ValidationReport {
  schema: 'baustein-sim/report@1';
  reportId: string;
  modelRef: ModelRef;
  dataVersions: DataVersions;
  createdAt: string;
  overall: 'blockers-found' | 'no-blockers-open-checks' | 'no-blockers-all-checked';
  layers: LayerSummary[];
  findings: Finding[];
}

export const LAYER_LABEL: Record<Layer, string> = {
  catalog: 'Katalog & Farbe',
  geometry: 'Teilgeometrie',
  connection: 'Anschlüsse',
  graph: 'Verbindungsgraph',
  collision: 'Kollision',
  assembly: 'Montagefolge',
  stability: 'Stand/Kippen',
  structure: 'Struktur (Risikoindikatoren)',
  usage: 'Nutzungseignung',
  function: 'Funktion (Freiraum, Entnahme, Anschluss)',
  procurement: 'Beschaffung',
};

export const LAYER_SCOPE: Record<Layer, string> = {
  catalog: 'Teil im Katalogauszug, Farbzuordnung LDraw↔Rebrickable, Teil-Farb-Beleg (Element-ID/Set-Inventar)',
  geometry: 'Rotation orthonormal, nicht gespiegelt, Vielfache von 90°',
  connection: 'Noppe↔Aufnahme, Noppe↔Röhre (gerade, achsparallel); Unterseitenstift↔Hohlnoppe nur 3004 auf 6541; andere Anschlussarten nicht unterstützt',
  graph: 'Zusammenhang über reguläre Verbindungen; deklarierte separate Module',
  collision: 'Körper- und Noppenvolumen (Quader, exakte Prismen und Hüllkörper, Trennachsentest); Noppen in verbundenen Aufnahmen erlaubt; falsche Einstecktiefe erkannt',
  assembly: 'Gerade Steckbewegung entlang der Noppenachse, Weg bis zur Endposition, Reihenfolge',
  stability: 'Heuristisch: Schwerpunkt (Volumen als Massenersatz) über Aufstandsfläche, Schwerkraft +Y, ebene Unterlage',
  structure: 'Heuristisch: schwächster Schnitt (Noppenzahl), Ein-Noppen-Anbauten, durchgehende Fugen',
  usage: 'Kleinteile/Altersgrenze (Regel), Klemmstellen nicht geprüft, keine Eignungsurteile',
  function: 'Freizuhaltende Räume (Körper und Noppen), gerade Entnahme abnehmbarer Baugruppen, freie Anschlussnoppen – nur bei deklarierten Funktionsanforderungen',
  procurement: 'Nur Schema – keine Angebotsdaten',
};

let counter = 0;
export function finding(f: Omit<Finding, 'id' | 'affected' | 'evidence' | 'limitation' | 'remedy'> & Partial<Pick<Finding, 'affected' | 'evidence' | 'limitation' | 'remedy'>>): Finding {
  counter++;
  return {
    id: `${f.code}-${counter}`,
    affected: f.affected ?? { instanceIds: [], assemblyIds: [], stepIds: [] },
    evidence: f.evidence ?? {},
    limitation: f.limitation ?? null,
    remedy: f.remedy ?? null,
    ...f,
  };
}

export function affected(instanceIds: string[] = [], stepIds: string[] = [], assemblyIds: string[] = []) {
  return { instanceIds: [...new Set(instanceIds)].sort(), stepIds, assemblyIds };
}

/** Stabile IDs je Bericht (unabhängig von globalem Zähler). */
export function renumber(findings: Finding[]): Finding[] {
  const seen = new Map<string, number>();
  return findings.map((f) => {
    const n = (seen.get(f.code) ?? 0) + 1;
    seen.set(f.code, n);
    return { ...f, id: `${f.code}#${n}` };
  });
}
