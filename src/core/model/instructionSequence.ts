// Abgeleitete Baufolge nach einer Herstelleranleitung: dieselbe Modellgeometrie (OMR-Instanzen, unverändert),
// aber Schritte, Gruppierung und Vormontagen so, wie die Anleitung sie zeigt. Die Zuordnung ist eigene,
// dokumentierte Auswertung (data/references/sequences/*.json) – keine Anleitungsinhalte.
import type { Assembly, CanonicalModel, StepDef } from './types';

export interface InstructionSequence {
  schema: 'baustein-sim/instruction-sequence@1';
  referenceId: string;
  title: string;
  source: { publisher: string; fetchedAt: string; documents: { id: string; edition: string; url: string; sha256: string; pages: number; role: string }[]; usage: string };
  method: string;
  buildInPlace: boolean;
  buildInPlaceNote?: string;
  steps: { step: number; groups: string[]; insets?: { name: string; instances: string[] }[]; note?: string }[];
}

export class SequenceMappingError extends Error {}

/** Erzeugt die Anleitungs-Baufolge. Wirft, wenn die Zuordnung nicht jede Gruppe/Instanz genau einmal abdeckt. */
export function instructionSequenceModel(model: CanonicalModel, seq: InstructionSequence): CanonicalModel {
  if (seq.referenceId !== model.origin.referenceId) throw new SequenceMappingError(`Zuordnung gehört zu ${seq.referenceId}, Modell ist ${model.origin.referenceId}`);
  const groups = new Map(model.steps.map((s) => [s.stepId, s]));
  const usedGroups = new Set<string>();
  const usedInstances = new Set<string>();
  const c: CanonicalModel = structuredClone(model);
  const instById = new Map(c.instances.map((i) => [i.instanceId, i]));
  const doc = seq.source.documents[0];

  // Untermodelle werden in der Anleitung an Ort und Stelle gebaut (nicht separat vorgefertigt)
  if (seq.buildInPlace) for (const a of c.assemblies) if (a.parentId) a.builtSeparately = false;

  const steps: StepDef[] = [];
  for (const s of seq.steps) {
    const ids: string[] = [];
    let assemblyId = c.rootAssemblyId;
    for (const g of s.groups) {
      const grp = groups.get(g);
      if (!grp) throw new SequenceMappingError(`Schritt ${s.step}: OMR-Gruppe ${g} existiert nicht`);
      if (usedGroups.has(g)) throw new SequenceMappingError(`OMR-Gruppe ${g} mehrfach zugeordnet`);
      usedGroups.add(g);
      ids.push(...grp.add);
      assemblyId = grp.assemblyId;
    }
    const attach: string[] = [];
    (s.insets ?? []).forEach((inset, k) => {
      const insetId = `anleitung-s${s.step}-v${k + 1}`;
      const asm: Assembly = { assemblyId: insetId, name: inset.name, parentId: c.rootAssemblyId, builtSeparately: true, separateModule: false, source: `LEGO-Anleitung ${doc.id}, Schritt ${s.step} (Einschubbild)` };
      c.assemblies.push(asm);
      for (const id of inset.instances) {
        if (!ids.includes(id)) throw new SequenceMappingError(`Schritt ${s.step}: Vormontage-Teil ${id} gehört nicht zu den Gruppen dieses Schritts`);
        instById.get(id)!.assemblyId = insetId;
      }
      steps.push({ stepId: `${insetId}#1`, assemblyId: insetId, add: [...inset.instances], attach: [], source: `LEGO-Anleitung ${doc.id}, Schritt ${s.step}: ${inset.name}` });
      attach.push(insetId);
    });
    const insetIds = new Set((s.insets ?? []).flatMap((i) => i.instances));
    const add = ids.filter((id) => !insetIds.has(id));
    ids.forEach((id) => usedInstances.add(id));
    steps.push({
      stepId: `anleitung#${s.step}`,
      assemblyId,
      add,
      attach,
      notes: s.note ? [s.note] : undefined,
      source: `LEGO-Anleitung ${doc.id}, Schritt ${s.step} (= ${s.groups.join(', ')})`,
    });
  }
  const unmappedGroups = model.steps.filter((s) => s.add.length && !usedGroups.has(s.stepId)).map((s) => s.stepId);
  const unmapped = model.instances.filter((i) => !usedInstances.has(i.instanceId)).map((i) => i.instanceId);
  if (unmappedGroups.length || unmapped.length) throw new SequenceMappingError(`Nicht zugeordnet: Gruppen ${unmappedGroups.join(', ') || '–'}; Teile ${unmapped.length}`);

  c.steps = steps;
  c.stepsSource = 'instructions-mapped';
  c.modelId = `${model.modelId}~anleitung`;
  c.name = `${model.name} – Baufolge nach LEGO-Anleitung`;
  c.origin = { ...model.origin, label: `Referenz ${model.origin.referenceId}: Geometrie OMR, Baufolge nach LEGO-Anleitung ${doc.id} (eigene Zuordnung)` };
  return c;
}
