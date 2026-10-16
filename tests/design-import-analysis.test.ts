// Korrekturauftrag 05A.1: vollständige Importvalidierung und unveränderliche Bindung von Analyseanfragen.
// Alle Analyseantworten stammen von einem kontrolliert verzögerten Testanbieter mit synthetischer Fixture –
// kein echter Dienst, kein API-Schlüssel.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addImage, adoptHeldAnalysis, applyAnalysisResult, BriefError, briefHash, briefIssues, confirm, correct, createTicket, isConfirmedCurrent, newBrief, parseBrief,
  readiness, removeImage, replaceImage, setInterpretation, setRequirements, setView, substanceHash, toDesignProvenance, type AnalysisMeta, type DesignBrief, type Requirements,
} from '../src/core/design/brief';
import { sha256Hex } from '../src/core/design/images';
import type { Interpretation } from '../src/core/design/interpretation';
import { analyzeRequest, type AnalysisProvider } from '../server/design-analysis/handler';

const FIX = JSON.parse(readFileSync('tests/fixtures/design/interpretation-synthetic.json', 'utf8')) as { fixture: string; interpretation: Interpretation };
const fixture = () => structuredClone(FIX.interpretation);
const at = '2026-10-16T10:00:00.000Z';
const REQ: Requirements = { partMin: 300, partMax: 600, maxLengthStuds: null, maxWidthStuds: null, maxHeightBricks: null, preferredSize: null, keyFeatureIds: ['f1'], intendedUse: 'display', notes: '' };
const MANUAL: AnalysisMeta = { method: 'manual', provider: 'Test (synthetisch)', model: null, promptVersion: null, at, requestId: null };
const SERVICE: AnalysisMeta = { method: 'anthropic-vision', provider: 'Testanbieter (synthetisch, verzögert)', model: 'kein-modell', promptVersion: 'p', at, requestId: null };

function png(width: number, height: number, tail: number[]): Uint8Array {
  const b = new Uint8Array(33 + tail.length);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b.set(tail, 33);
  return b;
}
async function img(tail: number[], name = 'vorlage.png') {
  const bytes = png(400, 300, tail);
  const sha = await sha256Hex(bytes);
  return { bytes, ref: { sha256: sha, mediaType: 'image/png' as const, bytes: bytes.length, width: 400, height: 300, fileName: name, view: 'vorn' as const, addedAt: at } };
}
const payload = (i: Awaited<ReturnType<typeof img>>, view = i.ref.view) => ({ sha256: i.ref.sha256, mediaType: i.ref.mediaType, view, data: Buffer.from(i.bytes).toString('base64') });

/** Testanbieter, dessen Antwort erst nach Freigabe eintrifft (kontrollierte Verzögerung). */
function delayedProvider(raw: unknown = fixture()) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const provider: AnalysisProvider = { id: 'delayed', label: 'Testanbieter (synthetisch, verzögert)', model: 'kein-modell', configurationProblem: () => null, analyze: async () => { await gate; return { raw, model: 'kein-modell', requestId: 'req-test', stopReason: 'end_turn' }; } };
  return { provider, release };
}

async function confirmedBrief(): Promise<DesignBrief> {
  let b = addImage(newBrief('projekt-a', 'A', at), (await img([1])).ref);
  b = setInterpretation(b, fixture(), MANUAL);
  return confirm(setRequirements(b, REQ), at);
}
/** Nachträglich manipulierte Datei mit korrekt neu berechneten Hashes (wie im Fehlerbericht). */
const rehash = (o: Record<string, unknown>, alsoConfirmed = false) => {
  if (alsoConfirmed) (o.confirmation as { confirmedHash: string }).confirmedHash = substanceHash(o as unknown as DesignBrief);
  o.contentHash = briefHash(o as unknown as DesignBrief);
  return JSON.stringify(o);
};

describe('Import: vollständige Laufzeitprüfung (korrekter Hash ersetzt keine fachliche Prüfung)', () => {
  it('Regression 1: fehlendes confirmation-Feld mit neu berechnetem Hash wird abgelehnt; isConfirmedCurrent wirft nie', async () => {
    const o = JSON.parse(JSON.stringify(await confirmedBrief()));
    delete o.confirmation;
    expect(() => parseBrief(rehash(o))).toThrow(BriefError);
    expect(() => parseBrief(rehash(o))).toThrow(/strukturell ungültig: confirmation: Pflichtfeld fehlt/);
    expect(isConfirmedCurrent(o as DesignBrief)).toBe(false);
    expect(() => toDesignProvenance(o as DesignBrief)).toThrow(BriefError);
  });

  it('Regression 2: negative relative Höhe mit neu berechneten Hashes → nur unbestätigt zur Korrektur geladen', async () => {
    const o = JSON.parse(JSON.stringify(await confirmedBrief()));
    o.interpretation.groups[1].relativeSize.height = -1;
    const text = rehash(o, true);
    // vor der Korrektur: Bestätigung hätte gegolten – jetzt nicht mehr
    expect(isConfirmedCurrent(o as DesignBrief)).toBe(false);
    expect(readiness(o as DesignBrief).some((r) => !r.ok)).toBe(true);
    const loaded = parseBrief(text, at);
    expect(loaded.issues.join(' ')).toMatch(/relative Höhe muss größer als 0/);
    expect(loaded.downgraded).toBe(true);
    expect(loaded.brief.confirmation.status).toBe('stale');
    expect(loaded.brief.confirmation.reason).toMatch(/Beim Laden fachlich ungültig/);
    expect(loaded.brief.history.at(-1)!.event).toMatch(/Beim Laden fachlich ungültig/);
    expect(isConfirmedCurrent(loaded.brief)).toBe(false);
    expect(() => toDesignProvenance(loaded.brief)).toThrow(BriefError);
    expect(() => confirm(loaded.brief)).toThrow(BriefError);
    // nach der Korrektur wieder bestätigbar
    const fixed = confirm(correct(loaded.brief, 'groups.1.relativeSize.height', 0.4, at), at);
    expect(isConfirmedCurrent(fixed)).toBe(true);
  });

  const structural: [string, (o: Record<string, any>) => void, RegExp][] = [
    ['Bildprüfsumme kein SHA-256', (o) => { o.images[0].sha256 = 'abc'; }, /images\.0\.sha256/],
    ['Bild ohne Maße', (o) => { delete o.images[0].width; }, /images\.0\.width/],
    ['unbekannte Ansicht', (o) => { o.images[0].view = 'unten'; }, /images\.0\.view/],
    ['Analyseherkunft mit falschem Verfahren', (o) => { o.analysis.method = 'orakel'; }, /analysis\.method/],
    ['Anforderung Teilezahl 0', (o) => { o.requirements.partMin = 0; }, /requirements\.partMin/],
    ['Korrektur ohne Pfad', (o) => { o.corrections = [{ at, path: '', before: 1, after: 2 }]; }, /corrections\.0\.path/],
    ['Verlauf leer', (o) => { o.history = []; }, /history/],
    ['Version keine Zahl', (o) => { o.version = 'drei'; }, /version/],
    ['Bestätigung mit unbekanntem Status', (o) => { o.confirmation.status = 'vielleicht'; }, /confirmation\.status/],
    ['Interpretation ohne Baugruppen', (o) => { delete o.interpretation.groups; }, /interpretation\.groups/],
  ];
  for (const [name, mutate, msg] of structural)
    it(`strukturell ungültig wird abgelehnt: ${name}`, async () => {
      const o = JSON.parse(JSON.stringify(await confirmedBrief()));
      mutate(o);
      expect(() => parseBrief(rehash(o))).toThrow(msg);
    });

  const semantic: [string, (o: Record<string, any>) => void, RegExp][] = [
    ['Minimum > Maximum', (o) => { o.requirements.partMin = 900; }, /Minimum größer als Maximum/],
    ['Merkmal existiert nicht', (o) => { o.requirements.keyFeatureIds = ['f9']; }, /„f9“ existiert nicht/],
    ['Verlauf passt nicht zur Version', (o) => { o.version = 9; }, /Verlauf endet bei Version/],
    ['Analyse „aktuell“, aber andere Bilder', (o) => { o.analysis.imageHashes = ['b'.repeat(64)]; }, /als aktuell markiert, beruht aber auf anderen Bildern/],
    ['Bestätigung ohne Zeitpunkt', (o) => { o.confirmation.at = null; }, /ohne Zeitpunkt/],
  ];
  for (const [name, mutate, msg] of semantic)
    it(`fachlich widersprüchlich wird nur unbestätigt geladen: ${name}`, async () => {
      const o = JSON.parse(JSON.stringify(await confirmedBrief()));
      mutate(o);
      const loaded = parseBrief(rehash(o, true), at);
      expect(loaded.issues.join(' | ')).toMatch(msg);
      expect(loaded.brief.confirmation.status).not.toBe('confirmed');
      expect(isConfirmedCurrent(loaded.brief)).toBe(false);
      expect(() => toDesignProvenance(loaded.brief)).toThrow(BriefError);
    });

  it('unveränderter Erfolgsfall: gültiger bestätigter Auftrag lädt verlustfrei und bleibt gültig bestätigt', async () => {
    const b = await confirmedBrief();
    const loaded = parseBrief(JSON.stringify(b));
    expect(loaded).toEqual({ brief: b, issues: [], downgraded: false });
    expect(briefIssues(b)).toEqual([]);
    expect(isConfirmedCurrent(loaded.brief)).toBe(true);
    expect(toDesignProvenance(loaded.brief).brief!.confirmedHash).toBe(b.confirmation.confirmedHash);
  });

  it('isConfirmedCurrent prüft fachliche Gültigkeit und aktuelle Bildzuordnung', async () => {
    const b = await confirmedBrief();
    // Bild ausgetauscht, Bestätigungsfelder künstlich belassen → trotzdem nicht gültig
    const swapped = { ...b, images: [{ ...b.images[0], sha256: 'c'.repeat(64) }] };
    expect(isConfirmedCurrent({ ...swapped, confirmation: { ...b.confirmation, confirmedHash: substanceHash(swapped) } })).toBe(false);
    expect(isConfirmedCurrent(null as unknown as DesignBrief)).toBe(false);
  });
});

describe('Analyse: verspätete Antworten überschreiben keinen geänderten Entwurfsstand', () => {
  async function start(b: DesignBrief, i: Awaited<ReturnType<typeof img>>, notes = 'Hinweis A') {
    const ticket = createTicket(b, notes, 'ticket-0000-0001', at);
    const { provider, release } = delayedProvider();
    const pending = analyzeRequest(provider, { ticketId: ticket.ticketId, images: [payload(i)], notes }, 'p');
    return { ticket, release, pending };
  }

  it('Ticket ist unveränderlich und trägt Projekt, Version, Eingabe-Hash, Bilder, Ansichten, Hinweise, Kennung', async () => {
    const i = await img([1]);
    const b = addImage(newBrief('projekt-a', 'A', at), i.ref);
    const t = createTicket(b, 'Hinweis', 'ticket-0000-0001', at);
    expect(Object.isFrozen(t) && Object.isFrozen(t.binding)).toBe(true);
    expect(t).toMatchObject({ briefId: 'projekt-a', briefVersion: b.version, binding: { imageHashes: [i.ref.sha256], views: ['vorn'], notes: 'Hinweis', ticketId: 'ticket-0000-0001' } });
    expect(() => createTicket(b, '', 'x')).toThrow(/Anfragekennung/);
  });

  it('unveränderter Erfolgsfall: Antwort wird mit dem Bildbezug der Anfrage übernommen', async () => {
    const i = await img([1]);
    const b = addImage(newBrief('projekt-a', 'A', at), i.ref);
    const { ticket, release, pending } = await start(b, i);
    release();
    const r = await pending;
    expect(r.body).toMatchObject({ ok: true, ticketId: ticket.ticketId });
    const out = applyAnalysisResult(b, ticket, (r.body as { interpretation: Interpretation }).interpretation, SERVICE);
    expect(out.kind).toBe('applied');
    const a = (out as { brief: DesignBrief }).brief.analysis!;
    expect(a).toMatchObject({ status: 'current', imageHashes: [i.ref.sha256], inputViews: ['vorn'], notes: 'Hinweis A', ticketId: ticket.ticketId });
  });

  const changes: [string, (b: DesignBrief, other: DesignBrief['images'][number]) => DesignBrief, RegExp][] = [
    ['Bildwechsel', (b, other) => replaceImage(b, b.images[0].sha256, other), /Bilder, ihre Reihenfolge oder Ansichten/],
    ['Bild entfernt', (b) => removeImage(b, b.images[0].sha256), /Bilder, ihre Reihenfolge oder Ansichten/],
    ['Bild hinzugefügt', (b, other) => addImage(b, other), /Bilder, ihre Reihenfolge oder Ansichten/],
    ['Ansicht geändert', (b) => setView(b, b.images[0].sha256, 'seitlich'), /Ansichten/],
    ['manuelle Korrektur', (b) => correct(b, 'summary', 'vom Nutzer geändert', at), /Interpretation wurde seit der Anfrage geändert/],
  ];
  for (const [name, change, reason] of changes)
    it(`${name} während der Analyse → Antwort zurückgehalten, Stand bleibt unverändert`, async () => {
      const i = await img([1]);
      const other = (await img([2], 'vorlage.png')).ref; // gleicher Dateiname, anderer Inhalt
      let b = addImage(newBrief('projekt-a', 'A', at), i.ref);
      b = setInterpretation(b, fixture(), MANUAL);
      const { ticket, release, pending } = await start(b, i);
      const changed = change(b, other); // Änderung, während die Antwort noch aussteht
      release();
      const r = await pending;
      const out = applyAnalysisResult(changed, ticket, (r.body as { interpretation: Interpretation }).interpretation, SERVICE);
      expect(out.kind).toBe('held');
      const held = (out as { held: Parameters<typeof adoptHeldAnalysis>[1] }).held;
      expect(held.reasons.join(' ')).toMatch(reason);
      // nur der tatsächliche Grund wird genannt (Bildänderung ≠ Interpretationsänderung)
      expect(held.reasons).toHaveLength(1);
      expect(held.ticket.binding.imageHashes).toEqual([i.ref.sha256]); // ursprünglicher Bildbezug bleibt
      // ausdrückliche Übernahme: ursprünglicher Bezug; passt er nicht zu den Bildern, sofort veraltet
      const adopted = adoptHeldAnalysis(changed, held);
      expect(adopted.analysis!.imageHashes).toEqual([i.ref.sha256]);
      const imagesSame = JSON.stringify(changed.images.map((x) => x.sha256)) === JSON.stringify([i.ref.sha256]);
      expect(adopted.analysis!.status).toBe(imagesSame ? 'current' : 'stale');
      if (!imagesSame) expect(readiness(adopted).find((x) => x.label.startsWith('Interpretation beruht'))!.ok).toBe(false);
    });

  it('neuer Entwurf bzw. Import eines anderen Projekts während der Analyse → Antwort verworfen', async () => {
    const i = await img([1]);
    const b = addImage(newBrief('projekt-a', 'A', at), i.ref);
    const { ticket, release, pending } = await start(b, i);
    const other = addImage(newBrief('projekt-b', 'B', at), i.ref); // gleiches Bild, anderes Projekt
    release();
    const r = await pending;
    const out = applyAnalysisResult(other, ticket, (r.body as { interpretation: Interpretation }).interpretation, SERVICE);
    expect(out).toMatchObject({ kind: 'rejected', reason: expect.stringMatching(/gehört zu Entwurf „projekt-a“/) });
    expect(() => adoptHeldAnalysis(other, { ticket, interpretation: fixture(), meta: SERVICE, reasons: [], problems: [] })).toThrow(BriefError);
  });

  it('Import desselben Projekts mit anderem Stand während der Analyse → zurückgehalten', async () => {
    const i = await img([1]);
    const b = addImage(newBrief('projekt-a', 'A', at), i.ref);
    const { ticket, release, pending } = await start(b, i);
    const imported = parseBrief(JSON.stringify(setInterpretation(b, fixture(), MANUAL))).brief;
    release();
    const r = await pending;
    expect(applyAnalysisResult(imported, ticket, (r.body as { interpretation: Interpretation }).interpretation, SERVICE).kind).toBe('held');
  });

  it('widersprüchliche Dienstantwort: Kandidat behält den Bildbezug der Anfrage, auch nach Bildwechsel', async () => {
    const i = await img([1]);
    const bad = fixture();
    bad.hiddenAreas[0].basis = 'observed';
    const b = addImage(newBrief('projekt-a', 'A', at), i.ref);
    const ticket = createTicket(b, '', 'ticket-0000-0002', at);
    const { provider, release } = delayedProvider(bad);
    const pending = analyzeRequest(provider, { ticketId: ticket.ticketId, images: [payload(i)] }, 'p');
    const swapped = replaceImage(b, i.ref.sha256, (await img([3])).ref);
    release();
    const r = await pending;
    expect(r.body).toMatchObject({ ok: false, code: 'contradictory_response', ticketId: ticket.ticketId });
    const body = r.body as { candidate: Interpretation; errors: string[] };
    // auch ohne Eingabeänderung nie automatisch übernommen
    expect(applyAnalysisResult(b, ticket, body.candidate, SERVICE, body.errors).kind).toBe('held');
    const out = applyAnalysisResult(swapped, ticket, body.candidate, SERVICE, body.errors);
    expect(out.kind).toBe('held');
    const adopted = adoptHeldAnalysis(swapped, (out as { held: Parameters<typeof adoptHeldAnalysis>[1] }).held);
    expect(adopted.analysis).toMatchObject({ imageHashes: [i.ref.sha256], status: 'stale' });
  });

  it('Server gibt die Anfragekennung unverändert zurück; ungültige Kennung → null', async () => {
    const i = await img([1]);
    const { provider, release } = delayedProvider();
    release();
    expect((await analyzeRequest(provider, { ticketId: 'ticket-0000-0003', images: [payload(i)] }, 'p')).body.ticketId).toBe('ticket-0000-0003');
    expect((await analyzeRequest(provider, { ticketId: '<script>', images: [payload(i)] }, 'p')).body.ticketId).toBeNull();
    expect((await analyzeRequest(provider, {}, 'p')).body.ticketId).toBeNull();
  });
});
