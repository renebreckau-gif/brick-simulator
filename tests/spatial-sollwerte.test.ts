// Auftrag 05B.0: Projektionen gegen UNABHÄNGIG VON HAND berechnete Sollwerte (nicht aus dem Code abgeleitet).
// Achsen: +x vorn, +y links, +z oben. Ansichten (u nach rechts, v nach oben):
//   vorne u=+y v=+z · hinten u=−y v=+z · links u=−x v=+z · rechts u=+x v=+z · oben u=−y v=+x · unten u=+y v=+x
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addImage, newBrief, setInterpretation, type AnalysisMeta } from '../src/core/design/brief';
import type { Interpretation } from '../src/core/design/interpretation';
import { modelBounds, projectDesign, VIEW_BY_ID, VIEWS, type ViewId } from '../src/core/design/projection';
import { addMirror, deriveSpatialProposal, updateBody, type SpatialBody, type SpatialDesign } from '../src/core/design/spatial';

const at = '2026-10-17T10:00:00.000Z';
const basis = { position: 'user', size: 'user', rotation: 'user', shape: 'user', color: 'user' } as const;
const B = (id: string, shape: SpatialBody['shape'], c: [number, number, number], s: [number, number, number], extra: Partial<SpatialBody> = {}): SpatialBody => ({
  id, name: id, groupId: null, isMain: false, shape, center: { x: c[0], y: c[1], z: c[2] }, size: { length: s[0], width: s[1], height: s[2] },
  rotation: { yaw: 0, pitch: 0, roll: 0 }, taper: shape === 'wedge' ? 0 : 1, color: '#888888', basis, assumptions: [], uncertainty: 'mittel', mirrorOf: null, ...extra,
});

/**
 * Asymmetrischer Testkörper (keine Drehungen, damit die Sollwerte von Hand nachrechenbar sind):
 *   Rumpf  Quader  Mitte (0, 0, 0)        Maß 1 × 0,5 × 0,3  → x −0,5…0,5   y −0,25…0,25  z −0,15…0,15
 *   Bug    Keil    Mitte (0,65, 0, −0,05) Maß 0,3 × 0,3 × 0,2 → x 0,5…0,8   y −0,15…0,15  z −0,15…0,05
 *   Gondel Quader  Mitte (−0,3, 0,4, 0)   Maß 0,4 × 0,2 × 0,2 → x −0,5…−0,1 y 0,3…0,5     z −0,1…0,1   (nur LINKS)
 *   Turm   Zylinder Mitte (0, 0, 0,2)     Maß 0,1 × 0,1 × 0,1 → x −0,05…0,05 y −0,05…0,05 z 0,15…0,25
 * Außenmaße inklusive Anbauten: x −0,5…0,8 (Länge 1,3) · y −0,25…0,5 (Breite 0,75) · z −0,15…0,25 (Höhe 0,4)
 */
const HAND: SpatialBody[] = [
  B('rumpf', 'box', [0, 0, 0], [1, 0.5, 0.3], { isMain: true }),
  B('bug', 'wedge', [0.65, 0, -0.05], [0.3, 0.3, 0.2]),
  B('gondel', 'box', [-0.3, 0.4, 0], [0.4, 0.2, 0.2]),
  B('turm', 'cylinder', [0, 0, 0.2], [0.1, 0.1, 0.1]),
];

type Ext = [number, number, number, number]; // u0, u1, v0, v1
const extent = (bodies: SpatialBody[], v: ViewId): Ext => {
  const p = projectDesign({ bodies }, VIEW_BY_ID[v]);
  return [Math.min(...p.map((b) => b.bbox.u0)), Math.max(...p.map((b) => b.bbox.u1)), Math.min(...p.map((b) => b.bbox.v0)), Math.max(...p.map((b) => b.bbox.v1))];
};
const center = (bodies: SpatialBody[], id: string, v: ViewId) => {
  const b = projectDesign({ bodies }, VIEW_BY_ID[v]).find((x) => x.id === id)!.bbox;
  return [(b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2];
};
const expectExt = (got: Ext, want: Ext) => got.forEach((g, k) => expect(g).toBeCloseTo(want[k], 9));

describe('Außenmaße inklusive Anbauten (Sollwerte von Hand)', () => {
  // Sollwerte aus der Tabelle oben, je Ansicht über die Achsabbildung im Kopf dieser Datei
  const SOLL: Record<ViewId, Ext> = {
    vorne: [-0.25, 0.5, -0.15, 0.25], // u = y
    hinten: [-0.5, 0.25, -0.15, 0.25], // u = −y
    links: [-0.8, 0.5, -0.15, 0.25], // u = −x
    rechts: [-0.5, 0.8, -0.15, 0.25], // u = x
    oben: [-0.5, 0.25, -0.5, 0.8], // u = −y, v = x
    unten: [-0.25, 0.5, -0.5, 0.8], // u = y, v = x
  };
  it.each(VIEWS.map((v) => v.id))('Ansicht %s', (v) => expectExt(extent(HAND, v), SOLL[v]));
  it('Gesamtausdehnung 1,3 × 0,75 × 0,4', () => {
    const s = modelBounds({ bodies: HAND }).size;
    [1.3, 0.75, 0.4].forEach((w, k) => expect(s[k]).toBeCloseTo(w, 9));
  });
  it('die nur links liegende Gondel erscheint in jeder Ansicht auf der richtigen Seite', () => {
    // Gondel-Mitte (−0,3; 0,4; 0) → vorne u=+0,4 · hinten −0,4 · links +0,3 · rechts −0,3 · oben −0,4 (v=−0,3) · unten +0,4 (v=−0,3)
    const soll: Record<ViewId, [number, number]> = { vorne: [0.4, 0], hinten: [-0.4, 0], links: [0.3, 0], rechts: [-0.3, 0], oben: [-0.4, -0.3], unten: [0.4, -0.3] };
    for (const v of VIEWS) center(HAND, 'gondel', v.id).forEach((g, k) => expect(g).toBeCloseTo(soll[v.id][k], 9));
  });
});

/** Minimaler Entwurf mit den Handkörpern (Kopf aus einer synthetischen Ableitung; Inhalt ersetzt). */
function syntheticBrief() {
  const interp = (JSON.parse(readFileSync('tests/fixtures/design/interpretation-synthetic.json', 'utf8')) as { interpretation: Interpretation }).interpretation;
  const MANUAL: AnalysisMeta = { method: 'manual', provider: 'Test (synthetisch)', model: null, promptVersion: null, at, requestId: null };
  const img = { sha256: 'a'.repeat(64), mediaType: 'image/png' as const, bytes: 10, width: 400, height: 300, fileName: 'v.png', view: 'seitlich' as const, addedAt: at };
  return setInterpretation(addImage(newBrief('b1', 'x', at), img), interp, MANUAL);
}
function handDesign(): SpatialDesign {
  const d = deriveSpatialProposal(syntheticBrief(), { designId: 'hand', at });
  return { ...d, symmetry: { kind: 'left-right', basis: 'user', note: 'Test' }, bodies: HAND };
}

describe('Spiegelung mit dem asymmetrischen Testkörper', () => {
  it('Spiegelbild der Gondel liegt bei y −0,5…−0,3; Breite wächst auf 1,0; Front- und Heckansicht spiegeln sich', () => {
    const d = addMirror(handDesign(), 'gondel', 'gondel-r', at);
    const m = d.bodies.find((b) => b.id === 'gondel-r')!;
    expect(m.center).toEqual({ x: -0.3, y: -0.4, z: 0 });
    expectExt(extent(d.bodies, 'vorne'), [-0.5, 0.5, -0.15, 0.25]);
    // von vorn: Original rechts (+0,4), Spiegelbild links (−0,4); von hinten umgekehrt
    expect(center(d.bodies, 'gondel', 'vorne')[0]).toBeCloseTo(0.4, 9);
    expect(center(d.bodies, 'gondel-r', 'vorne')[0]).toBeCloseTo(-0.4, 9);
    expect(center(d.bodies, 'gondel', 'hinten')[0]).toBeCloseTo(-0.4, 9);
    expect(center(d.bodies, 'gondel-r', 'hinten')[0]).toBeCloseTo(0.4, 9);
  });
  it('gedrehte Vorlage: Gieren +30° wird beim Spiegelbild zu −30° (Draufsicht spiegelbildlich)', () => {
    let d = addMirror(handDesign(), 'gondel', 'gondel-r', at);
    d = updateBody(d, 'gondel', { rotation: { yaw: 30, pitch: 0, roll: 0 } }, at);
    const o = projectDesign(d, VIEW_BY_ID.oben);
    const a = o.find((b) => b.id === 'gondel')!.bbox;
    const b = o.find((b2) => b2.id === 'gondel-r')!.bbox;
    // Spiegelung an y=0 ⇒ in der Draufsicht (u = −y) Spiegelung an u=0
    expect(a.u0).toBeCloseTo(-b.u1, 9);
    expect(a.u1).toBeCloseTo(-b.u0, 9);
    expect(a.v0).toBeCloseTo(b.v0, 9);
    expect(a.v1).toBeCloseTo(b.v1, 9);
  });
});

describe('Änderungen an Länge, Breite und Gondelposition erscheinen in allen sechs Ansichten', () => {
  it('Gondel länger (0,6) und weiter hinten (x −0,4): Länge 1,5 in Links/Rechts/Oben/Unten; Vorne/Hinten unverändert', () => {
    // neue Gondel x −0,7…−0,1 ⇒ Außenmaß x −0,7…0,8 (Länge 1,5)
    const d = updateBody(handDesign(), 'gondel', { size: { length: 0.6, width: 0.2, height: 0.2 }, center: { x: -0.4, y: 0.4, z: 0 } }, at);
    expectExt(extent(d.bodies, 'links'), [-0.8, 0.7, -0.15, 0.25]);
    expectExt(extent(d.bodies, 'rechts'), [-0.7, 0.8, -0.15, 0.25]);
    expectExt(extent(d.bodies, 'oben'), [-0.5, 0.25, -0.7, 0.8]);
    expectExt(extent(d.bodies, 'unten'), [-0.25, 0.5, -0.7, 0.8]);
    expectExt(extent(d.bodies, 'vorne'), [-0.25, 0.5, -0.15, 0.25]);
    expectExt(extent(d.bodies, 'hinten'), [-0.5, 0.25, -0.15, 0.25]);
  });
  it('Rumpf breiter (0,8 ⇒ y −0,4…0,4): Vorne/Hinten/Oben/Unten zeigen die neue Breite; Links/Rechts unverändert', () => {
    const d = updateBody(handDesign(), 'rumpf', { size: { length: 1, width: 0.8, height: 0.3 } }, at);
    expectExt(extent(d.bodies, 'vorne'), [-0.4, 0.5, -0.15, 0.25]);
    expectExt(extent(d.bodies, 'hinten'), [-0.5, 0.4, -0.15, 0.25]);
    expectExt(extent(d.bodies, 'oben'), [-0.5, 0.4, -0.5, 0.8]);
    expectExt(extent(d.bodies, 'unten'), [-0.4, 0.5, -0.5, 0.8]);
    expectExt(extent(d.bodies, 'links'), [-0.8, 0.5, -0.15, 0.25]);
  });
  it('Länge einer Baugruppe (Bug 0,5 ⇒ x 0,5…1,0 bei Mitte 0,75) erscheint in vier Ansichten, nicht in Vorne/Hinten', () => {
    const d = updateBody(handDesign(), 'bug', { size: { length: 0.5, width: 0.3, height: 0.2 }, center: { x: 0.75, y: 0, z: -0.05 } }, at);
    expectExt(extent(d.bodies, 'rechts'), [-0.5, 1.0, -0.15, 0.25]);
    expectExt(extent(d.bodies, 'oben'), [-0.5, 0.25, -0.5, 1.0]);
    expectExt(extent(d.bodies, 'vorne'), [-0.25, 0.5, -0.15, 0.25]);
  });
});

describe('Begründung der korrigierten Erwartung (synthetische Ableitung)', () => {
  it('Gesamtlänge 1,375: Rumpf x −0,5…0,5, Kasten links bei x 0,625 mit Länge 0,5 ⇒ bis 0,875', () => {
    // Fixture: Bild 400 × 300, Seitenansicht, Vorderseite links angenommen.
    // Hauptkörper-Bildbereich x 0,2…0,8 (Mitte 0,5, Breite 0,6); Kasten-links-Bildbereich x 0,05…0,2 (Mitte 0,125).
    // Längsversatz = (0,125 − 0,5) / 0,6 = −0,625 Hauptkörperlängen im Bild; Bild links = vorn ⇒ x = +0,625.
    // Länge des Kastens = 0,5 (relative Größe) ⇒ x 0,375…0,875. Außenmaß x −0,5…0,875 ⇒ 1,375.
    // Mit Maßstab 16 Noppen je Hauptkörperlänge: 1,375 · 16 = 22,0 Noppen (> Höchstmaß 20).
    const d = deriveSpatialProposal(syntheticBrief(), { designId: 'x', at });
    const kasten = d.bodies.find((b) => b.groupId === 'g2')!;
    expect(kasten.center.x).toBeCloseTo(0.625, 9);
    expect(kasten.size.length).toBe(0.5);
    const bnd = modelBounds(d);
    expect(bnd.min[0]).toBeCloseTo(-0.5, 9);
    expect(bnd.max[0]).toBeCloseTo(0.875, 9);
    expect(bnd.size[0] * 16).toBeCloseTo(22, 9);
  });
});
