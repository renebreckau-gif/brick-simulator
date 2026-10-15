// Baufolge nach LEGO-Anleitung (21002-1): eigene Zuordnung der 25 Anleitungsschritte auf die OMR-Instanzen.
// Geprüft wird, dass die Zuordnung vollständig und eindeutig ist, die Geometrie unverändert bleibt und die
// Herstellerbaufolge im unterstützten Bewegungsmodell ohne Blocker ausführbar ist.
import { describe, expect, it } from 'vitest';
import { listPublicDataFiles } from '../scripts/data-files.mjs';
import { computeBom } from '../src/core/bom/bom';
import { instructionSequenceModel, SequenceMappingError, type InstructionSequence } from '../src/core/model/instructionSequence';
import { validate } from '../src/core/validation/validate';
import { bundle, DATA, referenceModel } from './helpers';

async function load() {
  const b = await bundle('none');
  const seq = b.sequences.get('ref-21002-1')!;
  const omr = await referenceModel('ref-21002-1');
  return { b, seq, omr, model: instructionSequenceModel(omr, seq) };
}

describe('21002-1: Baufolge nach LEGO-Anleitung', () => {
  it('Zuordnung ist vollständig: 25 Schritte, jede OMR-Gruppe und jedes Teil genau einmal', async () => {
    const { seq, omr, model } = await load();
    expect(seq.steps.map((s) => s.step)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    const main = model.steps.filter((s) => s.stepId.startsWith('anleitung#'));
    expect(main).toHaveLength(25);
    expect(model.steps.filter((s) => !s.stepId.startsWith('anleitung#'))).toHaveLength(4); // 4 Vormontagen (Schritte 21, 23 ×2, 25)
    expect(model.steps.flatMap((s) => s.add).sort()).toEqual(omr.instances.map((i) => i.instanceId).sort());
    expect(new Set(seq.steps.flatMap((s) => s.groups)).size).toBe(omr.steps.filter((s) => s.add.length).length);
    expect(model.stepsSource).toBe('instructions-mapped');
  });

  it('Geometrie unverändert; Stückliste identisch zur OMR-Fassung', async () => {
    const { b, omr, model } = await load();
    for (const i of omr.instances) {
      const j = model.instances.find((x) => x.instanceId === i.instanceId)!;
      expect([j.part, j.color, j.position, j.rotation]).toEqual([i.part, i.color, i.position, i.rotation]);
    }
    const s = (m: typeof omr) => computeBom(m, b.catalog).lines.map((l) => `${l.ldrawPart}|${l.ldrawColor}|${l.quantity}`);
    expect(s(model)).toEqual(s(omr));
  });

  it('Herstellerbaufolge ist im Bewegungsmodell ohne Blocker ausführbar', async () => {
    const { b, model } = await load();
    const r = validate(model, b.catalog);
    const codes = r.report.findings.map((f) => f.code);
    expect(r.report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed').map((f) => f.code)).toEqual([]);
    expect(codes).toContain('ASM_SEQUENCE_OK');
    expect(codes).not.toContain('ASM_CONFLICTING_DIRECTIONS');
    expect(codes).not.toContain('ASM_PATH_BLOCKED');
    // Schritt 24: Sonderverbindung entsteht dort
    const upin = r.report.findings.find((f) => f.code === 'CON_UPIN_HOLLOWSTUD')!;
    expect(upin.affected.stepIds).toEqual(['anleitung#24']);
    // Sockel und Gebäude werden in derselben Bauumgebung gebaut (kein separat vorgebautes Gebäude)
    expect(model.assemblies.filter((a) => a.builtSeparately).every((a) => a.assemblyId.startsWith('anleitung-s'))).toBe(true);
  });

  it('fehlerhafte Zuordnungen werden abgelehnt (keine stillschweigend erfundene Baufolge)', async () => {
    const { seq, omr } = await load();
    const dup: InstructionSequence = { ...seq, steps: [...seq.steps, { step: 26, groups: ['main>21002-base#1'] }] };
    expect(() => instructionSequenceModel(omr, dup)).toThrow(SequenceMappingError);
    const missing: InstructionSequence = { ...seq, steps: seq.steps.slice(0, -1) };
    expect(() => instructionSequenceModel(omr, missing)).toThrow(/Nicht zugeordnet/);
    const wrongInset: InstructionSequence = { ...seq, steps: seq.steps.map((s) => (s.step === 21 ? { ...s, insets: [{ name: 'x', instances: ['main>21002-building/L9'] }] } : s)) };
    expect(() => instructionSequenceModel(omr, wrongInset)).toThrow(/gehört nicht/);
  });

  it('Zuordnungsdatei ist veröffentlichbar (Positivliste), Anleitungen selbst nicht', () => {
    const list = listPublicDataFiles(DATA);
    expect(list).toContain('references/sequences/21002-1.instructions.json');
    expect(list.some((f) => f.endsWith('.pdf'))).toBe(false);
  });
});
