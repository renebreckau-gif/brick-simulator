// Auftrag 05B.0: räumlicher Entwurf – Ableitung, Bearbeitung, Symmetrie, Prüfung, Versionierung, Veraltung,
// Import, Erhalt älterer Bildentwürfe und verspätete Antworten. Nur synthetische Fixture, kein Dienstaufruf.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addImage, correct, newBrief, parseBrief, setInterpretation, setRequirements, setView, toRequirements, EMPTY_REQUIREMENTS, type AnalysisMeta, type DesignBrief } from '../src/core/design/brief';
import type { Interpretation } from '../src/core/design/interpretation';
import { projectBody, VIEW_BY_ID } from '../src/core/design/projection';
import {
  addBody, addMirror, applySpatialResult, checkSpatial, checkSpatialProposal, compareWithReferences, confirmSpatial, createSpatialTicket, decouple, deriveSpatialProposal, isSpatialConfirmedCurrent, mirrorPose, parseSpatial,
  MIRROR_BASIS, rebaseSpatial, removeBody, restoreContent, setScale, setSymmetry, SpatialError, spatialHash, spatialPrerequisite, syncWithBrief, updateBody, type SpatialDesign, type SpatialProposal,
} from '../src/core/design/spatial';

const fixture = () => (JSON.parse(readFileSync('tests/fixtures/design/interpretation-synthetic.json', 'utf8')) as { interpretation: Interpretation }).interpretation;
const at = '2026-10-17T10:00:00.000Z';
const MANUAL: AnalysisMeta = { method: 'manual', provider: 'Test (synthetisch)', model: null, promptVersion: null, at, requestId: null };
const img = { sha256: 'a'.repeat(64), mediaType: 'image/png' as const, bytes: 10, width: 400, height: 300, fileName: 'v.png', view: 'seitlich' as const, addedAt: at };
const brief = (): DesignBrief => setInterpretation(addImage(newBrief('b1', 'Test', at), img), fixture(), MANUAL);
const derive = (b = brief()) => deriveSpatialProposal(b, { designId: 'r1', at });
const errors = (d: SpatialDesign, b: DesignBrief | null) => checkSpatial(d, b).filter((f) => f.level === 'error').map((f) => f.message);
const byGroup = (d: SpatialDesign, g: string) => d.bodies.find((x) => x.groupId === g)!;

describe('Ableitung aus der tatsächlichen Interpretation', () => {
  it('ohne gültige, gebundene Interpretation keine Ableitung – mit klarer nächster Aktion', () => {
    expect(spatialPrerequisite(addImage(newBrief('b', 'x', at), img))).toMatch(/Interpretation erstellen/);
    expect(() => deriveSpatialProposal(setView(brief(), img.sha256, 'vorn'), { designId: 'r', at })).toThrow(/passt nicht mehr/);
  });
  it('Hauptkörper hat Länge 1; Breite und Höhe sind Verhältnisse zur Länge (keine Normierung je Achse)', () => {
    const d = derive();
    const main = d.bodies.find((x) => x.isMain)!;
    expect(main.size.length).toBe(1);
    // Bildbereich 0,6 × 0,4 in einem 400 × 300-Bild: Höhe/Länge = (0,4·300)/(0,6·400) = 0,5
    expect(main.size.height).toBeCloseTo(0.5, 3);
    expect(main.basis.size).toBe('image-derived');
    // Breite ist aus einer Seitenansicht nicht ableitbar → angenommen und als Frage sichtbar
    expect(main.size.width).toBe(0.5);
    expect(d.openQuestions.join(' ')).toMatch(/Breite des Hauptkörpers.*nicht messbar/);
  });
  it('Größen der Baugruppen = relative Größe × Hauptkörpermaß; Bezug zur Interpretation bleibt', () => {
    const d = derive();
    const g2 = byGroup(d, 'g2');
    expect(g2.size).toEqual({ length: 0.5, width: 0.15, height: 0.2 });
    expect(g2.name).toBe('Kasten links');
  });
  it('gleich große Baugruppen bei angenommener Symmetrie: seitlich gespiegelt und gekoppelt', () => {
    const d = derive();
    const [a, b] = [byGroup(d, 'g2'), byGroup(d, 'g3')];
    expect(d.symmetry.kind).toBe('left-right');
    expect(b.mirrorOf).toBe(a.id);
    expect(b.center).toEqual(mirrorPose(a).center);
    expect(Math.abs(a.center.y)).toBeGreaterThan(0);
    expect(errors(d, brief())).toEqual([]);
  });
  it('keine Vorlage und kein Dateiname: andere Interpretation ergibt einen anderen Entwurf', () => {
    const other = fixture();
    other.groups[1].relativeSize = { length: 0.2, width: 0.2, height: 0.9 };
    const d2 = deriveSpatialProposal(setInterpretation(addImage(newBrief('b2', 'Test', at), { ...img, fileName: 'sandwaechter.png' }), other, MANUAL), { designId: 'r', at });
    expect(byGroup(d2, 'g2').size.height).not.toBe(byGroup(derive(), 'g2').size.height);
    expect(byGroup(d2, 'g3').mirrorOf).toBeNull(); // nicht mehr gleich groß → kein Paar
  });
  it('Details werden nicht als Körper übernommen, aber benannt', () => {
    const i = fixture();
    i.groups.push({ id: 'g9', name: 'Emblem', role: 'detail', description: '', basis: 'assumed', boxes: [], relativeSize: { length: 0.05, width: 0.01, height: 0.05 }, colorIds: [], confidence: 'niedrig' });
    const d = deriveSpatialProposal(setInterpretation(addImage(newBrief('b3', 'x', at), img), i, MANUAL), { designId: 'r', at });
    expect(d.bodies.some((x) => x.groupId === 'g9')).toBe(false);
    expect(d.openQuestions.join(' ')).toMatch(/Nicht als Körper übernommen.*Emblem/);
  });
  it('Einschub zeigt dasselbe Objekt: Bildbereiche darin bestimmen die Lage nicht', () => {
    const i = fixture();
    // zusätzlicher (größerer) Bildbereich von g2 in einem Heck-Einschub unten rechts
    i.groups[1].boxes.push({ imageIndex: 0, x: 0.8, y: 0.8, w: 0.18, h: 0.18 });
    const b = setInterpretation(addImage(newBrief('b4', 'x', at), img), i, MANUAL);
    const refs = [
      { id: 'main', imageIndex: 0, box: { x: 0, y: 0, w: 1, h: 1 }, direction: 'unbekannt' as const, frontInImage: 'links' as const, primary: true, basis: 'user' as const, note: '' },
      { id: 'inset', imageIndex: 0, box: { x: 0.75, y: 0.75, w: 0.25, h: 0.25 }, direction: 'hinten' as const, frontInImage: null, primary: false, basis: 'user' as const, note: 'Heck-Einschub' },
    ];
    const d = deriveSpatialProposal(b, { designId: 'r', at, referenceViews: refs });
    const without = derive();
    expect(byGroup(d, 'g2').center.x).toBeCloseTo(byGroup(without, 'g2').center.x, 9);
    expect(d.bodies.length).toBe(without.bodies.length); // keine zusätzliche Baugruppe
  });
});

describe('Bearbeiten, Symmetrie, Rückgängig', () => {
  it('Änderung erzeugt neue Version, protokolliert, setzt Grundlage „vom Nutzer“; Spiegelbild läuft mit', () => {
    const d = derive();
    const a = byGroup(d, 'g2');
    const e = updateBody(d, a.id, { center: { x: 0.1, y: 0.4, z: 0.05 }, rotation: { yaw: 15, pitch: 5, roll: -3 } }, at);
    expect(e.version).toBe(d.version + 1);
    expect(e.contentHash).not.toBe(d.contentHash);
    const a2 = byGroup(e, 'g2');
    const b2 = byGroup(e, 'g3');
    expect(a2.basis.position).toBe('user');
    expect(b2.center).toEqual({ x: 0.1, y: -0.4, z: 0.05 });
    expect(b2.rotation).toEqual({ yaw: -15, pitch: 5, roll: 3 });
    expect(e.corrections.map((c) => c.field)).toEqual(['center', 'rotation']);
    // Spiegelbild bleibt eine Symmetrieannahme, auch wenn die Vorlage vom Nutzer gesetzt ist
    expect(b2.basis).toEqual(MIRROR_BASIS);
    expect(b2.assumptions.join(' ')).toMatch(/Symmetrieannahme.*kein Beleg/);
    // Projektionen bestätigen die Spiegelung: von oben gleiche Länge, gespiegelte Seite
    const pa = projectBody(a2, VIEW_BY_ID.oben).bbox;
    const pb = projectBody(b2, VIEW_BY_ID.oben).bbox;
    expect(pa.u0).toBeCloseTo(-pb.u1, 9);
    expect(pa.v1 - pa.v0).toBeCloseTo(pb.v1 - pb.v0, 9);
  });
  it('gekoppeltes Spiegelbild ist nicht direkt verschiebbar; nach dem Lösen schon', () => {
    const d = derive();
    const b = byGroup(d, 'g3');
    expect(() => updateBody(d, b.id, { center: { x: 0, y: 0, z: 0 } })).toThrow(/gekoppeltes Spiegelbild/);
    const free = updateBody(decouple(d, b.id, at), b.id, { center: { x: 0.2, y: -0.3, z: 0 } }, at);
    expect(byGroup(free, 'g3').mirrorOf).toBeNull();
    expect(errors(free, brief())).toEqual([]);
  });
  it('Spiegeln nur mit vorgegebener oder angenommener Symmetrie; Aufheben löst Kopplungen', () => {
    let d = setSymmetry(derive(), 'none', at);
    expect(d.bodies.every((x) => x.mirrorOf === null)).toBe(true);
    d = addBody(d, { id: 'strebe', name: 'Strebe', groupId: null, shape: 'box', center: { x: 0, y: 0.3, z: 0 }, size: { length: 0.1, width: 0.2, height: 0.05 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, taper: 1, color: '#555555', uncertainty: 'hoch' }, at);
    expect(() => addMirror(d, 'strebe', 'strebe-r', at)).toThrow(/Links-rechts-Symmetrie/);
    d = addMirror(setSymmetry(d, 'left-right', at), 'strebe', 'strebe-r', at);
    expect(d.bodies.find((x) => x.id === 'strebe-r')!.center.y).toBe(-0.3);
    expect(d.symmetry.basis).toBe('user');
  });
  it('inkonsistente Kopplung wird erkannt (z. B. nach Import manipuliert)', () => {
    const d = derive();
    const bad = { ...d, bodies: d.bodies.map((x) => (x.groupId === 'g3' ? { ...x, center: { ...x.center, y: 0.9 } } : x)) };
    expect(errors(bad, brief()).join(' ')).toMatch(/nicht das Spiegelbild/);
    const noSym = { ...d, symmetry: { ...d.symmetry, kind: 'none' as const } };
    expect(errors(noSym, brief()).join(' ')).toMatch(/keine Links-rechts-Symmetrie/);
  });
  it('Hauptkörper: Länge bleibt 1 und er ist nicht entfernbar', () => {
    const d = derive();
    const m = d.bodies.find((x) => x.isMain)!;
    expect(() => updateBody(d, m.id, { size: { length: 2, width: 1, height: 1 } })).toThrow(/bleibt 1/);
    expect(() => removeBody(d, m.id)).toThrow(/Hauptkörper/);
  });
  it('Rückgängig stellt den Inhalt als neue Version wieder her', () => {
    const d = derive();
    const e = updateBody(d, byGroup(d, 'g2').id, { color: '#ff0000' }, at);
    const u = restoreContent(e, d, 'Rückgängig: Farbe', at);
    expect(u.version).toBe(e.version + 1);
    expect(u.bodies).toEqual(d.bodies);
    expect(u.history.at(-1)!.event).toBe('Rückgängig: Farbe');
  });
});

describe('Prüfung', () => {
  const d = derive();
  const m = (patch: Partial<SpatialDesign['bodies'][number]>) => ({ ...d, bodies: d.bodies.map((x) => (x.groupId === 'g2' ? { ...x, ...patch } : x)) });
  it.each([
    ['Breite 0', { size: { length: 0.5, width: 0, height: 0.2 } }, /Breite muss eine positive/],
    ['negative Höhe', { size: { length: 0.5, width: 0.1, height: -1 } }, /Höhe muss eine positive/],
    ['unendliche Position', { center: { x: Infinity, y: 0, z: 0 } }, /Position x/],
    ['Drehung außerhalb ±180°', { rotation: { yaw: 400, pitch: 0, roll: 0 } }, /Gieren/],
    ['Verjüngung > 1', { taper: 1.5 }, /Verjüngung/],
    ['unbekannte Baugruppe', { groupId: 'gX' }, /die es in der Interpretation nicht gibt/],
  ])('%s', (_n, patch, re) => {
    expect(errors(m(patch as never), brief()).join(' ')).toMatch(re);
  });
  it('doppelte Kennungen und fehlender Hauptkörper', () => {
    const dup = { ...d, bodies: [...d.bodies, { ...d.bodies[1] }] };
    expect(errors(dup, brief()).join(' ')).toMatch(/doppelt/);
    expect(errors({ ...d, bodies: d.bodies.filter((x) => !x.isMain) }, brief()).join(' ')).toMatch(/Genau ein Hauptkörper/);
  });
  it('Zielmaße nur mit Maßstab; Überschreitung blockiert', () => {
    const b = setRequirements(brief(), toRequirements({ ...EMPTY_REQUIREMENTS, partMin: 100, partMax: 200, keyFeatureIds: ['f1'], intendedUse: 'display', maxLengthStuds: 20 }, ['f1'])!);
    const d2 = rebaseSpatial(derive(), b, at);
    expect(checkSpatial(d2, b).some((f) => f.level === 'info' && /kein Maßstab/.test(f.message))).toBe(true);
    // Gesamtlänge inkl. Anbauten 1,375 × Hauptkörperlänge
    expect(errors(setScale(d2, 12, at), b)).toEqual([]);
    expect(errors(setScale(d2, 16, at), b).join(' ')).toMatch(/Zielmaß überschritten: Länge 22\.0 Noppen > höchstens 20/);
  });
  it('Überlappungen sind kein Befund', () => {
    const over = updateBody(d, byGroup(d, 'g2').id, { center: { x: 0, y: 0, z: 0 } }, at);
    expect(errors(over, brief())).toEqual([]);
    expect(checkSpatial(over, brief()).some((f) => /keine Kollisions/.test(f.message))).toBe(true);
  });
});

describe('Versionierung, Veraltung, Bestätigung', () => {
  it('Bestätigung nur der räumlichen Form; jede Änderung macht sie veraltet', () => {
    const b = brief();
    const c = confirmSpatial(derive(b), b, at);
    expect(isSpatialConfirmedCurrent(c, b)).toBe(true);
    expect(c.history.at(-1)!.event).toMatch(/keine Aussage zu Stabilität, Montage oder Verfügbarkeit/);
    const e = updateBody(c, byGroup(c, 'g2').id, { color: '#000000' }, at);
    expect(e.confirmation.status).toBe('stale');
    expect(isSpatialConfirmedCurrent(e, b)).toBe(false);
  });
  it('Änderung an Bildern, Interpretation oder Höchstmaßen macht den Entwurf sichtbar veraltet – ohne Überschreiben', () => {
    const b = brief();
    const c = confirmSpatial(updateBody(derive(b), byGroup(derive(b), 'g2').id, { color: '#123456' }, at), b, at);
    const b2 = correct(b, 'groups.1.name', 'Seitenkasten', at);
    const s = syncWithBrief(c, b2, at);
    expect(s.status).toEqual({ state: 'stale', reason: expect.stringMatching(/Interpretation geändert/) });
    expect(s.confirmation.status).toBe('stale');
    expect(byGroup(s, 'g2').color).toBe('#123456'); // Nutzerkorrektur bleibt
    expect(isSpatialConfirmedCurrent(s, b2)).toBe(false);
    expect(() => confirmSpatial(s, b2, at)).toThrow(/Grundlage veraltet/);
    const r = rebaseSpatial(s, b2, at);
    expect(r.status.state).toBe('current');
    expect(isSpatialConfirmedCurrent(confirmSpatial(r, b2, at), b2)).toBe(true);
    expect(syncWithBrief(c, setView(b, img.sha256, 'vorn'), at).status.reason).toMatch(/Bilder oder Ansichten/);
    const withReq = setRequirements(b, toRequirements({ ...EMPTY_REQUIREMENTS, partMin: 1, partMax: 2, keyFeatureIds: ['f1'], intendedUse: 'display', maxWidthStuds: 8 }, ['f1'])!);
    expect(syncWithBrief(c, withReq, at).status.reason).toMatch(/Höchstmaße/);
  });
  it('Teilezahl und Nutzung ändern die Form nicht und machen den Entwurf nicht veraltet', () => {
    const b = setRequirements(brief(), toRequirements({ ...EMPTY_REQUIREMENTS, partMin: 1, partMax: 2, keyFeatureIds: ['f1'], intendedUse: 'display' }, ['f1'])!);
    const d = deriveSpatialProposal(b, { designId: 'r', at });
    const b2 = setRequirements(b, { ...b.requirements!, partMin: 500, partMax: 900, intendedUse: 'play-goal' });
    expect(syncWithBrief(d, b2, at).status.state).toBe('current');
  });
});

describe('Import', () => {
  const b = brief();
  const good = () => confirmSpatial(derive(b), b, at);
  it('gültiger Export lässt sich wieder laden', () => {
    const l = parseSpatial(JSON.stringify(good()), b, at);
    expect(l.issues).toEqual([]);
    expect(isSpatialConfirmedCurrent(l.design, b)).toBe(true);
  });
  it.each([
    ['kein JSON', '{', /Keine gültige JSON/],
    ['anderes Schema', JSON.stringify({ schema: 'x' }), /Kein räumlicher Entwurf/],
    ['Pflichtfeld fehlt', JSON.stringify({ ...good(), bodies: undefined }), /Struktur ungültig/],
    ['ungültige Transformation (Text statt Zahl)', JSON.stringify({ ...good(), bodies: good().bodies.map((x, k) => (k === 1 ? { ...x, rotation: { yaw: 'quer', pitch: 0, roll: 0 } } : x)) }), /Struktur ungültig/],
  ])('%s → abgelehnt', (_n, text, re) => {
    expect(() => parseSpatial(text as string, b, at)).toThrow(re);
  });
  it('veränderter Inhalt ohne passenden Hash → abgelehnt', () => {
    const g = good();
    expect(() => parseSpatial(JSON.stringify({ ...g, bodies: g.bodies.map((x) => ({ ...x, color: '#000000' })) }), b, at)).toThrow(/Inhalts-Hash/);
  });
  it('fachlich unstimmig, aber Hash passend → nur zur Korrektur geladen, Bestätigung aufgehoben', () => {
    const g = good();
    const bad = { ...g, bodies: g.bodies.map((x) => (x.groupId === 'g2' ? { ...x, size: { ...x.size, width: -1 } } : x)) };
    const resigned = { ...bad, contentHash: spatialHash(bad) };
    const l = parseSpatial(JSON.stringify(resigned), b, at);
    expect(l.issues.join(' ')).toMatch(/Breite muss eine positive/);
    expect(l.downgraded).toBe(true);
    expect(l.design.confirmation.status).toBe('stale');
  });
  it('Entwurf zu einem anderen Auftrag wird geladen, aber als veraltet markiert', () => {
    const other = setInterpretation(addImage(newBrief('b-anders', 'x', at), img), fixture(), MANUAL);
    const l = parseSpatial(JSON.stringify(good()), other, at);
    expect(l.design.status.reason).toMatch(/gehört zu Entwurfsauftrag „b1“/);
    expect(isSpatialConfirmedCurrent(l.design, other)).toBe(false);
  });
});

describe('Erhalt älterer Bildentwürfe', () => {
  it('Entwurfsauftrag ohne räumlichen Entwurf (Schema unverändert) lädt wie bisher', () => {
    const b = brief();
    const l = parseBrief(JSON.stringify(b), at);
    expect(l.brief).toEqual(b);
    expect(l.issues).toEqual([]);
  });
});

describe('verspätete Antworten eines räumlichen Vorschlags', () => {
  const b = brief();
  const meta = { provider: 'Testanbieter (synthetisch)', model: 'm', promptVersion: 'p', requestId: null, at };
  const proposal = (): SpatialProposal => {
    const d = derive(b);
    return {
      referenceViews: d.referenceViews.map(({ id: _i, basis: _b, ...r }) => r),
      symmetry: { kind: 'left-right', note: 'synthetisch' },
      bodies: d.bodies.map((x) => ({ ...x, basis: { position: 'assumed', size: 'assumed', rotation: 'assumed', shape: 'assumed', color: 'assumed' } })),
      contradictions: ['synthetischer Widerspruch: Einschub zeigt andere Höhe'], openQuestions: [],
    };
  };
  it('ohne vorhandenen Entwurf und unveränderte Grundlage: übernommen, Widersprüche sichtbar', () => {
    const t = createSpatialTicket(b, null, 'ticket-0001', at);
    const r = applySpatialResult(b, null, t, proposal(), meta, 'r9');
    expect(r.kind).toBe('applied');
    if (r.kind === 'applied') {
      expect(r.design.origin).toMatchObject({ method: 'anthropic-vision', ticketId: 'ticket-0001' });
      expect(r.design.contradictions).toHaveLength(1);
    }
  });
  it('Grundlage seit der Anfrage geändert → verworfen', () => {
    const t = createSpatialTicket(b, null, 'ticket-0002', at);
    expect(applySpatialResult(correct(b, 'groups.1.name', 'x', at), null, t, proposal(), meta, 'r9')).toMatchObject({ kind: 'rejected', reason: expect.stringMatching(/seit der Anfrage geändert/) });
  });
  it('anderer Auftrag geöffnet → verworfen', () => {
    const t = createSpatialTicket(b, null, 'ticket-0003', at);
    const other = setInterpretation(addImage(newBrief('b-anders', 'x', at), img), fixture(), MANUAL);
    expect(applySpatialResult(other, null, t, proposal(), meta, 'r9').kind).toBe('rejected');
  });
  it('Entwurf inzwischen vom Nutzer korrigiert → zurückgehalten, nichts überschrieben', () => {
    const d = derive(b);
    const t = createSpatialTicket(b, d, 'ticket-0004', at);
    const edited = updateBody(d, byGroup(d, 'g2').id, { color: '#abcdef' }, at);
    const r = applySpatialResult(b, edited, t, proposal(), meta, 'r9');
    expect(r.kind).toBe('held');
    if (r.kind === 'held') expect(r.reasons.join(' ')).toMatch(/seit der Anfrage geändert.*Nutzerkorrektur/);
  });
  it('unstimmiger Vorschlag wird zurückgehalten; Dienst darf keine unbekannten Baugruppen nennen', () => {
    const p = proposal();
    p.bodies[1].groupId = 'erfunden';
    expect(checkSpatialProposal(p, 1, fixture()).errors.join(' ')).toMatch(/unbekannte Baugruppe/);
    const t = createSpatialTicket(b, null, 'ticket-0005', at);
    expect(applySpatialResult(b, null, t, p, meta, 'r9').kind).toBe('held');
  });
  it('ungültige Anfragekennung wird abgewiesen', () => {
    expect(() => createSpatialTicket(b, null, 'x', at)).toThrow(SpatialError);
  });
});

describe('Abgleich mit Referenzansichten', () => {
  it('Heck-Einschub mit vertauschter Seite wird benannt', () => {
    const i = fixture();
    // Einschub „von hinten“: Hauptkörper mittig, g2 im Bild LINKS – von hinten erscheint die linke Objektseite (+y) aber links nur, wenn g2 rechts (−y) liegt
    i.groups[0].boxes.push({ imageIndex: 0, x: 0.8, y: 0.8, w: 0.1, h: 0.06 });
    i.groups[1].boxes.push({ imageIndex: 0, x: 0.92, y: 0.82, w: 0.04, h: 0.04 });
    const b = setInterpretation(addImage(newBrief('b5', 'x', at), img), i, MANUAL);
    const refs = [
      { id: 'main', imageIndex: 0, box: { x: 0, y: 0, w: 0.75, h: 1 }, direction: 'unbekannt' as const, frontInImage: 'links' as const, primary: true, basis: 'user' as const, note: '' },
      { id: 'heck', imageIndex: 0, box: { x: 0.75, y: 0.75, w: 0.25, h: 0.25 }, direction: 'hinten' as const, frontInImage: null, primary: false, basis: 'user' as const, note: '' },
    ];
    const d = deriveSpatialProposal(b, { designId: 'r', at, referenceViews: refs });
    const g2 = byGroup(d, 'g2');
    expect(g2.center.y).toBeGreaterThan(0); // Kameraseite links (+y)
    // von hinten liegt +y im Bild links; der Einschub zeigt g2 rechts → Widerspruch
    expect(compareWithReferences(d, b).join(' ')).toMatch(/Kasten links.*von hinten.*im Bild rechts, im Modell links/);
  });
});
