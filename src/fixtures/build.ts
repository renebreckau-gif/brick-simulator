// Hilfsfunktionen zum Erzeugen kleiner, offen deklarierter Entwickler-Fixtures.
// Fixtures sind KEINE Referenzmodelle und kein Katalognachweis.
import { IDENTITY, mul, rotY90, type Mat3, type Vec3 } from '../core/math';
import { defaultUsage, MODEL_SCHEMA, type Assembly, type CanonicalModel, type StepDef, type UsageProfile } from '../core/model/types';

export interface PartSpec {
  id: string;
  part: string;
  color?: number;
  at: Vec3;
  /** Viertelumdrehungen um Y. */
  rotY?: number;
  /** Zusätzliche Rotation (nach rotY angewendet). */
  rot?: Mat3;
  assembly?: string;
}

export interface StepSpec {
  id?: string;
  assembly?: string;
  add?: string[];
  attach?: string[];
  insertion?: Record<string, Vec3>;
  support?: StepDef['support'];
  notes?: string[];
}

export interface FixtureSpec {
  id: string;
  name: string;
  description: string;
  parts: PartSpec[];
  steps?: StepSpec[];
  assemblies?: Partial<Assembly>[];
  usage?: Partial<UsageProfile>;
}

export const FROM_ABOVE: Vec3 = [0, 1, 0];
export const FROM_BELOW: Vec3 = [0, -1, 0];

export function fixture(spec: FixtureSpec): CanonicalModel {
  const assemblies: Assembly[] = [
    { assemblyId: 'main', name: spec.name, parentId: null, builtSeparately: false, separateModule: false, source: 'Fixture-Deklaration' },
    ...(spec.assemblies ?? []).map((a) => ({
      assemblyId: a.assemblyId!,
      name: a.name ?? a.assemblyId!,
      parentId: a.parentId ?? 'main',
      builtSeparately: a.builtSeparately ?? false,
      separateModule: a.separateModule ?? false,
      source: 'Fixture-Deklaration',
    })),
  ];
  const steps: StepDef[] = (spec.steps ?? []).map((s, i) => ({
    stepId: s.id ?? `${s.assembly ?? 'main'}#${i + 1}`,
    assemblyId: s.assembly ?? 'main',
    add: s.add ?? [],
    attach: s.attach ?? [],
    insertion: s.insertion,
    support: s.support,
    notes: s.notes,
    source: 'Fixture-Deklaration',
  }));
  return {
    schema: MODEL_SCHEMA,
    modelId: spec.id,
    version: 1,
    name: spec.name,
    origin: { kind: 'fixture', label: 'Synthetische Entwickler-Fixture – keine Referenz, kein Katalognachweis' },
    units: 'LDU',
    coordinateSystem: 'ldraw-right-handed-negative-y-up',
    rootAssemblyId: 'main',
    instances: spec.parts.map((p) => ({
      instanceId: p.id,
      part: p.part,
      color: p.color ?? 15,
      position: p.at,
      rotation: p.rot ? mul(p.rot, rotY90(p.rotY ?? 0)) : p.rotY ? rotY90(p.rotY) : IDENTITY,
      assemblyId: p.assembly ?? 'main',
    })),
    assemblies,
    steps,
    stepsSource: spec.steps ? 'fixture-declared' : 'none',
    usage: { ...defaultUsage(), ...(spec.usage ?? {}) },
    changeLog: [],
  };
}
