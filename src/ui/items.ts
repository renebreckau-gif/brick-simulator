// Auswählbare Modelle im Prüflabor: Referenzen, Grenzfälle, abgeleitete Fehlervarianten.
import type { DataBundle } from '../core/data/bundle';
import { instructionSequenceModel } from '../core/model/instructionSequence';
import { importLdraw } from '../core/model/ldrawImport';
import type { CanonicalModel } from '../core/model/types';
import { EDGE_CASES } from '../fixtures/edgeCases';
import { MUTATIONS } from '../fixtures/mutations';

export interface LabItem {
  id: string;
  group: 'Referenzen' | 'Grenzfälle' | 'Fehlervarianten';
  subgroup?: string;
  label: string;
  make: () => CanonicalModel;
  staleEdit?: { instanceId: string; delta: [number, number, number] };
  referenceId?: string;
  caseId?: string;
}

export function labItems(bundle: DataBundle): LabItem[] {
  const refModel = (referenceId: string) => {
    const meta = bundle.references.find((r) => r.referenceId === referenceId)!;
    return importLdraw(bundle.referenceFiles.get(referenceId)!, {
      modelId: referenceId,
      name: meta.name,
      origin: { kind: 'reference', label: `Referenz ${meta.setNumber}`, referenceId, sourceFile: meta.file },
      fileName: meta.file,
    });
  };
  const refs: LabItem[] = bundle.references.map((r) => ({
    id: r.referenceId,
    group: 'Referenzen',
    label: `${r.setNumber} ${r.name}`,
    make: () => refModel(r.referenceId),
    referenceId: r.referenceId,
  }));
  for (const [refId, seq] of bundle.sequences) {
    const meta = bundle.references.find((r) => r.referenceId === refId)!;
    refs.push({
      id: `${refId}~anleitung`,
      group: 'Referenzen',
      label: `${meta.setNumber} ${meta.name} – Baufolge nach LEGO-Anleitung`,
      make: () => instructionSequenceModel(refModel(refId), seq),
      referenceId: refId,
    });
  }
  const cases: LabItem[] = EDGE_CASES.map((c) => {
    const m = c.model();
    return { id: c.caseId, group: 'Grenzfälle', subgroup: c.group, label: m.name, make: c.model, staleEdit: c.staleEdit, caseId: c.caseId };
  });
  const muts: LabItem[] = MUTATIONS.map((mu) => ({
    id: `ref-40013-1~${mu.mutationId}`,
    group: 'Fehlervarianten',
    label: `40013-1: ${mu.title}`,
    make: () => mu.apply(refModel('ref-40013-1')).model,
  }));
  return [...refs, ...cases, ...muts];
}
