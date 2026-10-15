// Konstruktive Änderungen erzeugen eine neue Modellversion. Jede Änderung invalidiert
// Prüfbericht, Baufolgen-Prüfung, Stückliste und Beschaffungsstand der Vorversion.
import { add, type Vec3 } from '../math';
import { sameModelVersion } from './hash';
import type { CanonicalModel, ModelRef, PartInstance } from './types';

export type ModelEdit =
  | { kind: 'move'; instanceId: string; delta: Vec3 }
  | { kind: 'remove'; instanceId: string }
  | { kind: 'recolor'; instanceId: string; color: number }
  | { kind: 'replace-part'; instanceId: string; part: string }
  | { kind: 'add'; instance: PartInstance; stepId: string | null };

export function describeEdit(e: ModelEdit): string {
  switch (e.kind) {
    case 'move': return `${e.instanceId} verschoben um [${e.delta.join(', ')}] LDU`;
    case 'remove': return `${e.instanceId} entfernt`;
    case 'recolor': return `${e.instanceId} umgefärbt auf ${e.color}`;
    case 'replace-part': return `${e.instanceId} ersetzt durch Teil ${e.part}`;
    case 'add': return `${e.instance.instanceId} (${e.instance.part}) hinzugefügt`;
  }
}

export function applyEdit(model: CanonicalModel, edit: ModelEdit, at = new Date().toISOString()): CanonicalModel {
  const next: CanonicalModel = structuredClone(model);
  const id = edit.kind === 'add' ? edit.instance.instanceId : edit.instanceId;
  const inst = next.instances.find((i) => i.instanceId === id);
  if (edit.kind !== 'add' && !inst) throw new Error(`Instanz ${id} nicht gefunden`);
  switch (edit.kind) {
    case 'move': inst!.position = add(inst!.position, edit.delta); break;
    case 'recolor': inst!.color = edit.color; break;
    case 'replace-part': inst!.part = edit.part; break;
    case 'remove':
      next.instances = next.instances.filter((i) => i.instanceId !== id);
      for (const s of next.steps) s.add = s.add.filter((x) => x !== id);
      next.steps = next.steps.filter((s) => s.add.length || s.attach.length);
      break;
    case 'add': {
      if (next.instances.some((i) => i.instanceId === id)) throw new Error(`Instanz-ID ${id} existiert bereits`);
      next.instances.push(edit.instance);
      const step = edit.stepId ? next.steps.find((s) => s.stepId === edit.stepId) : null;
      if (step) step.add.push(id);
      break;
    }
  }
  next.version = model.version + 1;
  next.changeLog = [...model.changeLog, { fromVersion: model.version, toVersion: next.version, description: describeEdit(edit), affectedInstances: [id], at }];
  return next;
}

export type ArtifactKind = 'report' | 'bom' | 'steps' | 'procurement';

export interface ArtifactStatus {
  kind: ArtifactKind;
  state: 'current' | 'stale' | 'missing';
  artifactRef: ModelRef | null;
  currentRef: ModelRef;
}

/** Prüft, ob abgeleitete Artefakte noch zur aktuellen Modellversion gehören. */
export function artifactStatus(kind: ArtifactKind, artifactRef: ModelRef | null, currentRef: ModelRef): ArtifactStatus {
  return { kind, artifactRef, currentRef, state: !artifactRef ? 'missing' : sameModelVersion(artifactRef, currentRef) ? 'current' : 'stale' };
}
