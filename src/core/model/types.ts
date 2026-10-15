// Kanonisches, versioniertes Modell – gemeinsame Quelle für 3D-Ansicht,
// Prüfung, Stückliste und Bauschritte.
import type { Mat3, Vec3 } from '../math';

export const MODEL_SCHEMA = 'baustein-sim/model@1';

export interface PartInstance {
  /** Stabil über Versionen hinweg; wird beim Import/Erzeugen einmalig vergeben. */
  instanceId: string;
  /** LDraw-Teilnummer ohne .dat (Geometriequelle). */
  part: string;
  /** LDraw-Farbcode. */
  color: number;
  position: Vec3;
  rotation: Mat3;
  assemblyId: string;
}

export interface Assembly {
  assemblyId: string;
  name: string;
  parentId: string | null;
  /** Wird separat vormontiert und als Einheit angesetzt. */
  builtSeparately: boolean;
  /** Bleibt im Endmodell absichtlich eine eigene, lose Komponente (z. B. Figur, Ständer). */
  separateModule: boolean;
  source: string;
}

export type SupportKind = 'hand' | 'auxiliary-support';

export interface StepDef {
  stepId: string;
  assemblyId: string;
  /** In diesem Schritt hinzugefügte Einzelteile. */
  add: string[];
  /** In diesem Schritt als Einheit angesetzte, separat gebaute Baugruppen. */
  attach: string[];
  /** Explizite Einschubrichtung (Welt, Bewegungsrichtung) je Teil-/Baugruppen-ID; fehlt → abgeleitet. */
  insertion?: Record<string, Vec3>;
  /** Dokumentierte Unterstützung während dieses Schritts. */
  support?: { kind: SupportKind; note: string; source: string };
  notes?: string[];
  source: string;
}

export interface UsageProfile {
  intendedUse: 'display' | 'careful-handling' | 'play-goal' | 'unspecified';
  intendedUsers: { minAgeYears: number | null; source: string };
  /** Alterseignung: eigenes Feld mit Herkunft/Evidenz – wird nie aus Stabilität abgeleitet. */
  ageSuitability: { status: 'not-assessed' | 'manufacturer-statement' | 'independent-evidence'; value: string | null; source: string | null; evidence: string | null };
  handlingScenarios: { id: string; description: string; status: 'unchecked' }[];
}

export interface ModelOrigin {
  /** generated = eigener Entwurf eines Generators (nie Referenz, nie offizielles Modell). */
  kind: 'reference' | 'fixture' | 'user' | 'generated';
  /** Bei 'fixture': ausdrücklich synthetisch, nie als Referenz/Katalognachweis zu verwenden. */
  label: string;
  sourceFile?: string;
  referenceId?: string;
}

export interface ChangeRecord {
  fromVersion: number;
  toVersion: number;
  description: string;
  affectedInstances: string[];
  at: string;
}

export interface CanonicalModel {
  schema: typeof MODEL_SCHEMA;
  modelId: string;
  version: number;
  name: string;
  origin: ModelOrigin;
  units: 'LDU';
  coordinateSystem: 'ldraw-right-handed-negative-y-up';
  rootAssemblyId: string;
  instances: PartInstance[];
  assemblies: Assembly[];
  /** Geordnete Baufolge; leer = keine belegte Baufolge. */
  steps: StepDef[];
  /** instructions-mapped = Baufolge einer Herstelleranleitung, eigene Zuordnung auf die Modellinstanzen. */
  stepsSource: 'source-file' | 'fixture-declared' | 'instructions-mapped' | 'generated' | 'none';
  usage: UsageProfile;
  changeLog: ChangeRecord[];
  /** Bei erzeugten Modellen: Generator, Version und Eingaben (Reproduzierbarkeit). */
  generator?: { name: string; version: string; params: Record<string, unknown> };
}

/** Bezug eines abgeleiteten Artefakts auf genau eine Modellversion. */
export interface ModelRef {
  modelId: string;
  version: number;
  contentHash: string;
}

export function defaultUsage(): UsageProfile {
  return {
    intendedUse: 'unspecified',
    intendedUsers: { minAgeYears: null, source: 'nicht angegeben' },
    ageSuitability: { status: 'not-assessed', value: null, source: null, evidence: null },
    handlingScenarios: [
      { id: 'H1-lift', description: 'Modell an der Basis anheben und auf ebene Fläche zurückstellen', status: 'unchecked' },
      { id: 'H2-tilt', description: 'Unterlage langsam neigen bis zum Kippen', status: 'unchecked' },
      { id: 'H3-carry', description: 'Modell mit einer Hand an der höchsten Stelle tragen', status: 'unchecked' },
    ],
  };
}
