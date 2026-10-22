// Auftrag 05A.5: mehrere Ansichten in einer Bilddatei. Fixtures sind SYNTHETISCH (von Claude Code nach
// Betrachtung der Vorlage eingetragen, keine Dienstantwort); kein Dienstaufruf.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addImage, addView, applyAnalysisResult, confirm, createTicket, EMPTY_REQUIREMENTS, isConfirmedCurrent, mergeGroups, newBrief, parseBrief, removeView, replaceImage, setInterpretation, setRequirements, toRequirements, updateView,
  type AnalysisMeta, type DesignBrief,
} from '../src/core/design/brief';
import { checkInterpretation, type Interpretation } from '../src/core/design/interpretation';
import { compareWithReferences, defaultReferenceViews, deriveSpatialProposal, screenMap, syncWithBrief } from '../src/core/design/spatial';
import { checkViews, parseRatioAnnotations, viewContradictions } from '../src/core/design/views';

const at = '2026-10-17T10:00:00.000Z';
const SIX = () => structuredClone((JSON.parse(readFileSync('tests/fixtures/design/interpretation-sechs-ansichten-synthetic.json', 'utf8')) as { interpretation: Interpretation }).interpretation);
const ONE = () => structuredClone((JSON.parse(readFileSync('tests/fixtures/design/interpretation-synthetic.json', 'utf8')) as { interpretation: Interpretation }).interpretation);
const META: AnalysisMeta = { method: 'import', provider: 'Test (synthetisch)', model: null, promptVersion: null, at, requestId: null };
const IMG = (sha: string, w = 1536, h = 1024, view: 'unbekannt' | 'seitlich' | 'oben' = 'unbekannt') => ({ sha256: sha.repeat(64).slice(0, 64), mediaType: 'image/png' as const, bytes: 10, width: w, height: h, fileName: 'tafel.png', view, addedAt: at });
const sixBrief = (): DesignBrief => setInterpretation(addImage(newBrief('b6', 'Tafel', at), IMG('c')), SIX(), META);
const byGroup = (d: ReturnType<typeof deriveSpatialProposal>, g: string) => d.bodies.find((x) => x.groupId === g)!;

describe('Schema und Bildbezug', () => {
  it('sechs Ansichten in einer Datei: gültig, an die Prüfsumme des Bildes gebunden', () => {
    const b = sixBrief();
    const views = b.interpretation!.imageViews!.views;
    expect(views).toHaveLength(6);
    expect(new Set(views.map((v) => v.viewId)).size).toBe(6);
    expect(views.every((v) => v.imageSha256 === b.images[0].sha256)).toBe(true);
    const c = checkInterpretation(b.interpretation, 1, [b.images[0].sha256]);
    expect(c.errors).toEqual([]);
  });
  it('„Unterseite · Entwurf“ bleibt als entworfene Ansicht erkennbar', () => {
    const v = sixBrief().interpretation!.imageViews!.views.find((x) => x.direction === 'unten')!;
    expect(v.label).toBe('UNTEN · ENTWURF');
    expect(v.nature).toBe('entwurf');
  });
  it('Ausschnitt außerhalb, unbekannte Ansicht und Bildbereich außerhalb seiner Ansicht sind Fehler', () => {
    const i = SIX();
    i.imageViews!.views[0].box.w = 1.2;
    i.groups[0].boxes[0].viewId = 'v-gibt-es-nicht';
    i.groups[1].boxes[0].viewId = 'v-links'; // liegt in „Oben“, nicht in „Linke Seite“
    const e = checkViews(i, 1).errors.join(' | ');
    expect(e).toMatch(/außerhalb des Bildes/);
    expect(e).toMatch(/unbekannte Ansicht „v-gibt-es-nicht“/);
    expect(e).toMatch(/nicht in der Ansicht „LINKE SEITE“/);
  });
  it('anderes Bild an derselben Stelle: Prüfsumme passt nicht mehr – Fehler statt stiller Übernahme', () => {
    const b = sixBrief();
    const replaced = replaceImage(b, b.images[0].sha256, IMG('d'));
    const c = checkInterpretation(replaced.interpretation, 1, [replaced.images[0].sha256]);
    expect(c.errors.join(' ')).toMatch(/gehört zu Bild cccccccccccc…/);
    expect(replaced.analysis!.status).toBe('stale');
  });
});

describe('ein Objekt über alle Ansichten', () => {
  it('sechs Ansichten erzeugen sechs Referenzansichten, aber keine zusätzlichen Körper', () => {
    const b = sixBrief();
    const refs = defaultReferenceViews(b);
    expect(refs.map((r) => r.id)).toEqual(['v-oben', 'v-unten', 'v-links', 'v-rechts', 'v-vorne', 'v-hinten']);
    expect(refs.find((r) => r.primary)!.id).toBe('v-links');
    const d = deriveSpatialProposal(b, { designId: 'r', at });
    expect(d.bodies).toHaveLength(b.interpretation!.groups.length); // ein Körper je Baugruppe
    expect(d.bodies.filter((x) => x.isMain)).toHaveLength(1);
    expect(d.bodies.filter((x) => /gondel/.test(x.groupId ?? ''))).toHaveLength(2);
  });
  it('Proportionen aus mehreren Ansichten, entworfene Unterseite nicht als Messgrundlage', () => {
    const d = deriveSpatialProposal(sixBrief(), { designId: 'r', at });
    const main = d.bodies.find((x) => x.isMain)!;
    // Draufsicht (Vorderseite unten): Breite 160 px / Länge 645 px; Seiten: Höhe 160/585 und 190/595
    expect(main.size.width).toBeCloseTo(160 / 645, 2);
    expect(main.size.height).toBeCloseTo((160 / 585 + 190 / 595) / 2, 2);
    expect(d.origin.provider).toMatch(/aus 5 Ansicht\(en\)/); // Unterseite (Entwurf) zählt nicht
    expect(main.assumptions.join(' ')).not.toMatch(/UNTEN/);
  });
  it('Gondeln: Lage quer aus Drauf-, Front- und Heckansicht – kein Spiegelbild angenommen', () => {
    const d = deriveSpatialProposal(sixBrief(), { designId: 'r', at });
    const l = byGroup(d, 'gondel_l');
    const r = byGroup(d, 'gondel_r');
    expect(l.center.y).toBeGreaterThan(0.1); // links = +y
    expect(r.center.y).toBeLessThan(-0.1);
    expect(l.center.x).toBeLessThan(-0.3); // hinten
    expect(l.mirrorOf).toBeNull();
    expect(r.mirrorOf).toBeNull();
    expect(l.basis.position).toBe('image-derived');
  });
  it('Widersprüche werden benannt: Beschriftung gegen Zeichnung, Ansichten untereinander, entworfene Ansicht', () => {
    const d = deriveSpatialProposal(sixBrief(), { designId: 'r', at });
    const c = d.contradictions.join(' | ');
    expect(c).toMatch(/„OBEN“: beschriftet B ≈ 0,72 L, gezeichnet ≈ 0,43 L/);
    expect(c).toMatch(/Höhe des Hauptkörpers „Rumpf“ \(× Länge\) weicht zwischen Ansichten ab/);
    expect(c).toMatch(/„UNTEN · ENTWURF“ ist eine entworfene Ansicht/);
    // Beschriftungen sind Angaben der Vorlage und werden nicht als Maß übernommen
    expect(d.openQuestions.join(' ')).toMatch(/Angabe der Vorlage, nicht als Maß übernommen: B ≈ 0,72 L/);
  });
  it('je Ansicht doppelt erfasste Baugruppe wird erkannt und lässt sich zusammenführen', () => {
    const i = SIX();
    const g = i.groups.find((x) => x.id === 'gondel_l')!;
    i.groups.push({ ...g, id: 'gondel_l_seite', name: 'Triebwerksgondel links (Seite)', boxes: g.boxes.filter((bx) => bx.viewId === 'v-links') });
    g.boxes = g.boxes.filter((bx) => bx.viewId !== 'v-links');
    const extra = { ...g, id: 'gondel_l_oben', name: 'Triebwerksgondel links (oben)', boxes: g.boxes.filter((bx) => bx.viewId === 'v-oben') };
    i.groups.push(extra);
    g.boxes = g.boxes.filter((bx) => bx.viewId !== 'v-oben');
    const w = checkViews(i, 1).warnings.join(' ');
    expect(w).toMatch(/Vermutlich dieselbe Baugruppe mehrfach erfasst/);
    let b = setInterpretation(addImage(newBrief('b', 'x', at), IMG('c')), i, META);
    b = mergeGroups(mergeGroups(b, 'gondel_l', 'gondel_l_seite', at), 'gondel_l', 'gondel_l_oben', at);
    expect(b.interpretation!.groups.filter((x) => x.id.startsWith('gondel_l'))).toHaveLength(1);
    expect(b.interpretation!.groups.find((x) => x.id === 'gondel_l')!.boxes.map((bx) => bx.viewId).sort()).toEqual(['v-hinten', 'v-links', 'v-oben', 'v-unten', 'v-vorne']);
    expect(checkViews(b.interpretation!, 1).warnings.join(' ')).not.toMatch(/mehrfach erfasst/);
  });
});

describe('Antwortformat für den Analysedienst', () => {
  it('das erweiterte Schema lässt sich offline in das Format der strukturierten Ausgabe umwandeln (kein Dienstaufruf)', async () => {
    const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');
    const { Interpretation } = await import('../src/core/design/interpretation');
    const f = betaZodOutputFormat(Interpretation) as unknown as { schema: unknown };
    const text = JSON.stringify(f.schema);
    expect(text).toMatch(/imageViews/);
    expect(text).toMatch(/frontInImage/);
    expect(text).toMatch(/viewId/);
  });
});

describe('Orientierung im Ausschnitt', () => {
  it('Draufsicht mit Vorderseite unten: Bild rechts = links am Objekt (+y), Bild unten = vorn (+x)', () => {
    expect(screenMap('oben', 'unten')).toEqual({ right: { axis: 'y', sign: 1 }, down: { axis: 'x', sign: 1 } });
    expect(screenMap('oben', 'oben')).toEqual({ right: { axis: 'y', sign: -1 }, down: { axis: 'x', sign: -1 } });
    // Vorderseite links: Bild rechts = hinten (−x)
    expect(screenMap('oben', 'links')!.right).toEqual({ axis: 'x', sign: -1 });
    expect(screenMap('links', 'links')).toEqual({ right: { axis: 'x', sign: -1 }, down: { axis: 'z', sign: -1 } });
  });
  it('Abgleich mit der Vorlage berücksichtigt die Orientierung: richtig gedrehte Draufsicht ohne falschen Seitenwechsel', () => {
    const b = sixBrief();
    const d = deriveSpatialProposal(b, { designId: 'r', at });
    expect(compareWithReferences(d, b).filter((t) => /Seiten vertauscht/.test(t))).toEqual([]);
    // falsch angegebene Orientierung (Vorderseite oben statt unten) wird als Seitenwechsel sichtbar
    const wrong = { ...d, referenceViews: d.referenceViews.map((r) => (r.id === 'v-oben' ? { ...r, frontInImage: 'oben' as const } : r)) };
    expect(compareWithReferences(wrong, b).join(' ')).toMatch(/Triebwerksgondel links“ von oben.*Seiten vertauscht/);
  });
  it('Seitenansicht mit unpassender Vorderseite wird als möglicher Spiegel-/Seitenfehler gemeldet', () => {
    const i = SIX();
    i.imageViews!.views.find((v) => v.viewId === 'v-links')!.frontInImage = 'rechts';
    expect(checkViews(i, 1).warnings.join(' ')).toMatch(/Gespiegelt oder Seite vertauscht/);
  });
});

describe('Beschriftungen der Vorlage', () => {
  it('Verhältnisangaben werden gelesen, aber nur als Angabe der Vorlage', () => {
    expect(parseRatioAnnotations(['B ≈ 0,72 L', 'H ≈ 0,38 L', 'L = 1,00', 'Kein geprüfter Bauplan'])).toEqual([
      { quantity: 'B', value: 0.72, text: 'B ≈ 0,72 L' }, { quantity: 'H', value: 0.38, text: 'H ≈ 0,38 L' }, { quantity: 'L', value: 1, text: 'L = 1,00' },
    ]);
  });
  it('widersprüchliche Beschriftungen werden angezeigt', () => {
    const i = SIX();
    i.imageViews!.views.find((v) => v.viewId === 'v-vorne')!.annotations[1].text = 'B ≈ 0,80 L';
    expect(viewContradictions(i, [{ sha256: 'c', width: 1536, height: 1024 }]).join(' ')).toMatch(/Vorlage widersprüchlich beschriftet: B = 0,72 L \(„OBEN“\).*0,80 L \(„VORNE“\)/);
  });
});

describe('mehrere Dateien', () => {
  it('Seitenansicht in Bild 1, Draufsicht in Bild 2: Ableitung nutzt beide, Bezug je Prüfsumme', () => {
    const i = SIX();
    // Draufsicht als eigenes Bild 2 (gleiche Pixelmaße), übrige Ansichten bleiben in Bild 1
    const top = i.imageViews!.views.find((v) => v.viewId === 'v-oben')!;
    top.imageIndex = 1;
    for (const g of i.groups) for (const bx of g.boxes) if (bx.viewId === 'v-oben') bx.imageIndex = 1;
    let b = addImage(addImage(newBrief('b2', 'zwei', at), IMG('c')), IMG('e'));
    b = setInterpretation(b, i, META);
    expect(b.interpretation!.imageViews!.views.find((v) => v.viewId === 'v-oben')!.imageSha256).toBe('e'.repeat(64));
    expect(checkInterpretation(b.interpretation, 2, b.images.map((x) => x.sha256)).errors).toEqual([]);
    const d = deriveSpatialProposal(b, { designId: 'r', at });
    expect(d.bodies.find((x) => x.isMain)!.size.width).toBeCloseTo(160 / 645, 2);
  });
});

describe('Einzelansicht und ältere Entwürfe', () => {
  it('ohne Ansichten (ältere Interpretation): keine Ansicht erfunden, Ableitung wie bisher', () => {
    const b = setInterpretation(addImage(newBrief('b1', 'x', at), { ...IMG('a', 400, 300), view: 'seitlich' }), ONE(), META);
    expect(b.interpretation!.imageViews).toBeUndefined();
    const refs = defaultReferenceViews(b);
    expect(refs).toHaveLength(1);
    expect(refs[0].sourceViewId).toBeUndefined();
    expect(deriveSpatialProposal(b, { designId: 'r', at }).origin.provider).toMatch(/Hauptreferenz/);
  });
  it('älterer Entwurfsauftrag ohne Ansichten lädt unverändert (gleicher Hash, keine Ansichten ergänzt)', () => {
    const b = setInterpretation(addImage(newBrief('b1', 'x', at), IMG('a', 400, 300)), ONE(), META);
    const text = JSON.stringify(b);
    const l = parseBrief(text, at);
    expect(l.issues).toEqual([]);
    expect(l.brief.contentHash).toBe(b.contentHash);
    expect(JSON.stringify(l.brief)).not.toMatch(/imageViews|viewId/);
  });
});

describe('Änderungen veralten nachvollziehbar', () => {
  const ready = () => setRequirements(sixBrief(), toRequirements({ ...EMPTY_REQUIREMENTS, partMin: 100, partMax: 200, keyFeatureIds: ['f1'], intendedUse: 'display' }, ['f1'])!);
  it('geänderter Ausschnitt: neue Version, protokolliert, Grundlage „Nutzer“, Bestätigung und räumlicher Entwurf veraltet', () => {
    const b = confirm(ready(), at);
    expect(isConfirmedCurrent(b)).toBe(true);
    const d = deriveSpatialProposal(b, { designId: 'r', at });
    const b2 = updateView(b, 'v-oben', { box: { x: 0.01, y: 0.08, w: 0.25, h: 0.86 } }, at);
    expect(b2.version).toBe(b.version + 1);
    expect(b2.corrections.at(-1)!.path).toBe('imageViews.views.0');
    expect(b2.interpretation!.imageViews!.views[0].basis).toBe('user');
    expect(b2.confirmation.status).toBe('stale');
    expect(syncWithBrief(d, b2, at).status).toEqual({ state: 'stale', reason: expect.stringMatching(/Interpretation geändert/) });
  });
  it('geänderte Orientierung und Zuordnung (Ansicht entfernen) veralten ebenso', () => {
    const b = confirm(ready(), at);
    expect(updateView(b, 'v-oben', { frontInImage: 'oben' }, at).confirmation.status).toBe('stale');
    const r = removeView(b, 'v-hinten', at);
    expect(r.confirmation.status).toBe('stale');
    expect(r.interpretation!.groups.flatMap((g) => g.boxes).some((bx) => bx.viewId === 'v-hinten')).toBe(false);
  });
  it('ergänzte Ansicht erhält die Prüfsumme des Bildes und die Grundlage „Nutzer“', () => {
    const b = addView(sixBrief(), { viewId: 'v-detail', imageIndex: 0, box: { x: 0.8, y: 0.0, w: 0.2, h: 0.07 }, label: 'Titel', direction: 'unbekannt', frontInImage: null, nature: 'unbekannt', annotations: [], uncertainty: 'hoch', note: '' }, at);
    const v = b.interpretation!.imageViews!.views.at(-1)!;
    expect(v.imageSha256).toBe(b.images[0].sha256);
    expect(v.basis).toBe('user');
  });
  it('verspätete Analyseantwort nach einer Ansichtskorrektur wird zurückgehalten', () => {
    const b = sixBrief();
    const t = createTicket(b, '', 'ticket-mv-0001', at);
    const edited = updateView(b, 'v-links', { label: 'LINKE SEITE (korrigiert)' }, at);
    const r = applyAnalysisResult(edited, t, SIX(), { ...META, method: 'anthropic-vision' });
    expect(r.kind).toBe('held');
    if (r.kind === 'held') expect(r.held.reasons.join(' ')).toMatch(/Interpretation wurde seit der Anfrage geändert/);
  });
});
