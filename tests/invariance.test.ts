// Unabhängige Kontrollen, die nicht denselben Algorithmus nachbauen:
//  - Starre Bewegung des Gesamtmodells darf relative Verbindungs-/Kollisions-/Graphbefunde nicht ändern.
//  - Der Standbefund muss sich auf die festgelegte Schwerkraft beziehen (Drehung um X ändert ihn).
//  - Dateireihenfolge darf die Stückliste nicht ändern.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../src/core/bom/bom';
import { applyTransform, mul, rotX90, rotY90, type Mat3, type Vec3 } from '../src/core/math';
import { importLdraw } from '../src/core/model/ldrawImport';
import type { CanonicalModel } from '../src/core/model/types';
import { validate } from '../src/core/validation/validate';
import { EDGE_CASES } from '../src/fixtures/edgeCases';
import { bundle, readData, referenceModel } from './helpers';

function moveWhole(m: CanonicalModel, rotation: Mat3, offset: Vec3): CanonicalModel {
  const c = structuredClone(m);
  for (const i of c.instances) {
    i.position = applyTransform({ rotation, position: offset }, i.position);
    i.rotation = mul(rotation, i.rotation);
  }
  return c;
}

/** Relative Befunde: Code + betroffene Instanzen für Verbindung, Graph, Kollision. */
function relativeSignature(m: CanonicalModel, catalog: Parameters<typeof validate>[1]) {
  const r = validate(m, catalog);
  const conns = r.world.connections.map((c) => `${c.male.instanceId}>${c.female.instanceId}:${c.ruleId}`).sort();
  const findings = r.report.findings
    .filter((f) => ['connection', 'graph', 'collision'].includes(f.layer))
    .map((f) => `${f.code}:${f.status}:${f.affected.instanceIds.join(',')}`)
    .sort();
  return { conns, findings, stability: r.stability };
}

const MOTIONS: { name: string; rot: Mat3; off: Vec3 }[] = [
  { name: 'Verschiebung (nicht rasterkonform)', rot: rotY90(0), off: [37, -113, 55] },
  { name: 'Drehung 90° um Y + Verschiebung', rot: rotY90(1), off: [200, 0, -40] },
  { name: 'Drehung 180° um Y', rot: rotY90(2), off: [0, 0, 0] },
  { name: 'Drehung 90° um X (Modell liegt auf der Seite)', rot: rotX90(1), off: [10, 20, 30] },
  { name: 'Kombiniert X·Y', rot: mul(rotX90(-1), rotY90(3)), off: [-5, 7, 11] },
];

describe('Invarianz relativer Befunde', () => {
  const subjects: { name: string; load: () => Promise<CanonicalModel> }[] = [
    { name: 'ref-40013-1', load: () => referenceModel('ref-40013-1') },
    { name: 'ref-21002-1', load: () => referenceModel('ref-21002-1') },
    ...['ec-03a-penetration', 'ec-08a-jumper-offset', 'ec-08b-stud-in-tube', 'ec-01b-touch-only', 'ec-08c-sideways', 'ec-11a-upin-micro', 'ec-11d-upin-too-shallow', 'ec-11f-upin-neighbor-penetration', 'ec-11h-upin-similar-male', 'ec-11i-upin-similar-female'].map((id) => ({ name: id, load: async () => EDGE_CASES.find((e) => e.caseId === id)!.model() })),
  ];
  for (const s of subjects)
    for (const mo of MOTIONS)
      it(`${s.name}: ${mo.name}`, async () => {
        const b = await bundle();
        const m = await s.load();
        const a = relativeSignature(m, b.catalog);
        const t = relativeSignature(moveWhole(m, mo.rot, mo.off), b.catalog);
        expect(t.conns).toEqual(a.conns);
        expect(t.findings).toEqual(a.findings);
      });
});

describe('Standbefund bezieht sich auf Schwerkraft und Unterlage', () => {
  it('Drehung um Y lässt den Standbefund gleich, Drehung um X verändert ihn', async () => {
    const b = await bundle();
    const m = await referenceModel('ref-40013-1');
    const base = validate(m, b.catalog).stability!;
    const yRot = validate(moveWhole(m, rotY90(1), [50, 0, 0]), b.catalog).stability!;
    const xRot = validate(moveWhole(m, rotX90(1), [0, 0, 0]), b.catalog).stability!;
    expect(yRot.marginLDU).toBeCloseTo(base.marginLDU, 3);
    expect(yRot.stands).toBe(base.stands);
    expect(xRot.contactInstanceIds).not.toEqual(base.contactInstanceIds);
    const f = validate(m, b.catalog).report.findings.find((x) => x.layer === 'stability')!;
    expect(f.evidenceLevel).toBe('heuristic');
    expect(f.evidence.gravity).toBe('+Y (Welt)');
  });
});

describe('Stückliste unabhängig von der Reihenfolge', () => {
  it('Umsortierte Instanzen ergeben dieselbe Stückliste', async () => {
    const b = await bundle();
    const m = await referenceModel('ref-21002-1');
    const shuffled = structuredClone(m);
    shuffled.instances.reverse();
    shuffled.instances.push(shuffled.instances.shift()!);
    const strip = (x: ReturnType<typeof computeBom>) => JSON.stringify({ lines: x.lines, unresolved: x.unresolved });
    expect(strip(computeBom(shuffled, b.catalog))).toEqual(strip(computeBom(m, b.catalog)));
  });

  it('Umsortierte Zeilen der LDraw-Datei ergeben dieselbe Stückliste', async () => {
    const b = await bundle();
    const text = await readData('references/omr/1869-1.mpd');
    const lines = text.split(/\r?\n/);
    const refs = lines.filter((l) => l.startsWith('1 '));
    const others = lines.filter((l) => !l.startsWith('1 '));
    // deterministische Permutation
    const permuted = refs.map((l, i) => ({ l, k: (i * 37) % refs.length })).sort((p, q) => p.k - q.k).map((x) => x.l);
    const mk = (t: string) => importLdraw(t, { modelId: 'x', name: 'x', origin: { kind: 'fixture', label: 'Test' }, fileName: '1869-1.mpd' });
    const a = computeBom(mk(text), b.catalog);
    const c = computeBom(mk([...others, ...permuted].join('\n')), b.catalog);
    expect(c.lines.map((l) => [l.ldrawPart, l.ldrawColor, l.quantity])).toEqual(a.lines.map((l) => [l.ldrawPart, l.ldrawColor, l.quantity]));
  });
});
