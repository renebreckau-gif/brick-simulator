// Auftrag 05A: Bildvorlage → Interpretation → Entwurfsauftrag.
// Alle Analyseergebnisse hier stammen aus eindeutig deklarierten synthetischen Fixtures oder
// Testanbietern – keine Live-Analyse wird vorgetäuscht.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addImage, BriefError, confirm, correct, rebaseInterpretation, isConfirmedCurrent, newBrief, parseBrief, readiness, removeImage, replaceImage, setInterpretation, setRequirements, substanceHash, toDesignProvenance,
  type DesignBrief, type ImageRef, type Requirements,
} from '../src/core/design/brief';
import { checkImageBytes, MAX_IMAGE_BYTES, sha256Hex, sniffImageType } from '../src/core/design/images';
import { checkInterpretation, manualInterpretationTemplate, type Interpretation } from '../src/core/design/interpretation';
import { buildInstructionPlan } from '../src/core/instructions/plan';
import { contentHash } from '../src/core/model/hash';
import type { CanonicalModel } from '../src/core/model/types';
import { labItems } from '../src/ui/items';
import { anthropicProvider } from '../server/design-analysis/anthropic';
import { analyzeRequest, ProviderError, type AnalysisProvider } from '../server/design-analysis/handler';
import { bundle } from './helpers';

const FIXTURE = JSON.parse(readFileSync('tests/fixtures/design/interpretation-synthetic.json', 'utf8')) as { fixture: string; interpretation: Interpretation };
const fixture = () => structuredClone(FIXTURE.interpretation);

/** Minimaler PNG-Kopf (Signatur + IHDR) mit beliebigem Inhalt danach – für Kopf- und Prüfsummentests. */
function png(width: number, height: number, tail: number[] = [1, 2, 3]): Uint8Array {
  const b = new Uint8Array(33 + tail.length);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  b.set(tail, 33);
  return b;
}
function jpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 (Länge 16), SOF0 (Länge 17)
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  const dv = new DataView(b.buffer);
  dv.setUint16(25, height);
  dv.setUint16(27, width);
  return b;
}
const ref = async (bytes: Uint8Array, name: string): Promise<ImageRef> => ({ sha256: await sha256Hex(bytes), mediaType: 'image/png', bytes: bytes.length, width: 400, height: 300, fileName: name, view: 'vorn', addedAt: '2026-10-16T00:00:00.000Z' });
const REQ: Requirements = { partMin: 300, partMax: 600, maxLengthStuds: 40, maxWidthStuds: null, maxHeightBricks: null, preferredSize: 'mittel', keyFeatureIds: ['f1'], intendedUse: 'display', notes: '' };
const at = '2026-10-16T10:00:00.000Z';
const analysis = { method: 'manual' as const, provider: 'Test (synthetisch)', model: null, promptVersion: null, at, requestId: null };

async function readyBrief(): Promise<DesignBrief> {
  let b = newBrief('test-brief', 'Test', at);
  b = addImage(b, await ref(png(400, 300), 'vorlage.png'));
  b = setInterpretation(b, fixture(), analysis);
  return setRequirements(b, REQ);
}

describe('Bild-Uploads: Format aus dem Inhalt, Größe, Prüfsumme', () => {
  it('gültiges PNG und JPEG werden am Inhalt erkannt, Maße aus dem Kopf gelesen', () => {
    expect(checkImageBytes(png(400, 300), 'image/png')).toMatchObject({ ok: true, type: 'image/png', width: 400, height: 300 });
    expect(checkImageBytes(jpeg(640, 480), 'image/jpeg')).toMatchObject({ ok: true, type: 'image/jpeg', width: 640, height: 480 });
  });
  it('nicht unterstützte und beschädigte Dateien werden abgelehnt', () => {
    const gif = new TextEncoder().encode('GIF89a......');
    expect(sniffImageType(gif)).toBeNull();
    expect(checkImageBytes(gif, 'image/gif').errors.join(' ')).toMatch(/Kein PNG oder JPEG/);
    // Textdatei mit .png-Endung bzw. falschem Typ: Inhalt entscheidet
    expect(checkImageBytes(new TextEncoder().encode('kein bild'), 'image/png').ok).toBe(false);
    expect(checkImageBytes(new Uint8Array(0), 'image/png').errors).toEqual(['Die Datei ist leer.']);
    const truncated = png(400, 300).slice(0, 20);
    expect(checkImageBytes(truncated, 'image/png').errors.join(' ')).toMatch(/beschädigt oder unvollständig/);
    expect(checkImageBytes(png(20, 20), 'image/png').errors.join(' ')).toMatch(/zu klein/);
    expect(checkImageBytes(png(9000, 100), 'image/png').errors.join(' ')).toMatch(/zu groß/);
    expect(checkImageBytes(jpeg(640, 480), 'image/png').errors.join(' ')).toMatch(/passt nicht zum Inhalt/);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(png(400, 300));
    expect(checkImageBytes(big, 'image/png').errors.join(' ')).toMatch(/höchstens 5 MB/);
  });
  it('gleicher Dateiname, anderer Inhalt → andere Kennung; Dateiname geht nicht in die Analyse ein', async () => {
    const a = await ref(png(400, 300, [1]), 'schiff.png');
    const b = await ref(png(400, 300, [2]), 'schiff.png');
    expect(a.sha256).not.toBe(b.sha256);
    let brief = addImage(newBrief('x', 'x', at), a);
    brief = addImage(brief, b);
    expect(brief.images).toHaveLength(2);
    expect(addImage(brief, a)).toBe(brief); // gleicher Inhalt wird nicht doppelt aufgenommen
  });
});

describe('Interpretation: Struktur und Widersprüche', () => {
  it('Fixture ist gültig und als synthetisch deklariert', () => {
    expect(FIXTURE.fixture).toMatch(/SYNTHETISCH/);
    const c = checkInterpretation(fixture(), 1);
    expect(c.errors).toEqual([]);
    expect(c.ok).toBe(true);
  });
  it('unvollständige Antwort wird strukturell abgelehnt', () => {
    const { groups: _g, ...rest } = fixture();
    void _g;
    const c = checkInterpretation(rest, 1);
    expect(c.ok).toBe(false);
    expect(c.value).toBeNull();
    expect(c.errors[0]).toMatch(/Struktur: groups/);
    expect(checkInterpretation('kein objekt', 1).value).toBeNull();
  });
  const contradictions: [string, (i: Interpretation) => void, RegExp][] = [
    ['zwei Hauptkörper', (i) => { i.groups[1].role = 'hauptkoerper'; }, /Genau ein Hauptkörper/],
    ['beobachtet ohne Bildbereich', (i) => { i.groups[2].basis = 'observed'; }, /beobachtet markiert, hat aber keinen Bildbereich/],
    ['verdeckt aber beobachtet', (i) => { i.hiddenAreas[0].basis = 'observed'; }, /Verdeckter Bereich/],
    ['unbekannte Farbe', (i) => { i.groups[0].colorIds = ['c9']; }, /unbekannte Farbe/],
    ['Flächenanteile > 100 %', (i) => { i.colors[0].areaShare = 0.9; }, /mehr als 100 %/],
    ['Bildbereich außerhalb', (i) => { i.groups[0].boxes[0].w = 0.95; }, /außerhalb des Bildes/],
    ['Bildindex ohne Bild', (i) => { i.groups[1].boxes[0].imageIndex = 3; }, /verweist auf Bild 4/],
    ['Hauptkörper nicht Bezugsgröße', (i) => { i.groups[0].relativeSize.height = 2; }, /Bezugsgröße/],
    ['doppelte Kennung', (i) => { i.colors[1].id = 'c1'; }, /doppelt/],
    ['ungültiger Farbwert', (i) => { i.colors[0].hex = 'grau'; }, /kein #RRGGBB/],
    ['Merkmal auf unbekannte Baugruppe', (i) => { i.features[0].groupIds = ['g7']; }, /unbekannte Baugruppe/],
  ];
  for (const [name, mutate, msg] of contradictions)
    it(`Widerspruch erkannt: ${name}`, () => {
      const i = fixture();
      mutate(i);
      const c = checkInterpretation(i, 1);
      expect(c.ok).toBe(false);
      expect(c.errors.join(' | ')).toMatch(msg);
    });
  it('Warnungen: reale Maße und Teilenummern sind aus einem Bild nicht belegbar', () => {
    const i = fixture();
    i.summary = 'etwa 30 cm lang, Teilenummer 3001';
    i.hiddenAreas = [];
    const w = checkInterpretation(i, 1).warnings.join(' ');
    expect(w).toMatch(/realen Abmessungen/);
    expect(w).toMatch(/Teilenummern/);
    expect(w).toMatch(/Rückseite und Innenkonstruktion/);
  });
  it('manuelle Vorlage: alle Aussagen „vom Nutzer“ bzw. angenommen; ohne Ergänzung nicht bestätigbar', () => {
    const t = manualInterpretationTemplate();
    expect(t.groups.every((g) => g.basis === 'user')).toBe(true);
    expect(checkInterpretation(t, 1).ok).toBe(true);
  });
});

describe('Entwurfsauftrag: Versionen, Korrekturen, Veralten, Bestätigung', () => {
  it('Korrektur wird protokolliert, setzt die Grundlage auf „Vorgabe“ und erzeugt neue Version + Hash', async () => {
    const b = await readyBrief();
    const c = correct(b, 'groups.1.relativeSize.height', 0.6, at);
    expect(c.version).toBe(b.version + 1);
    expect(c.contentHash).not.toBe(b.contentHash);
    expect(c.interpretation!.groups[1].basis).toBe('user');
    expect(c.interpretation!.groups[1].relativeSize.height).toBe(0.6);
    expect(c.corrections.at(-1)).toMatchObject({ path: 'groups.1.relativeSize.height', before: 0.4, after: 0.6 });
    expect(b.interpretation!.groups[1].relativeSize.height).toBe(0.4); // unverändert (unveränderliche Fortschreibung)
    expect(correct(c, 'groups.1.relativeSize.height', 0.6)).toBe(c); // keine Änderung → keine neue Version
  });
  it('Bestätigung nur bei erfüllten Voraussetzungen; Nutzerkorrektur danach macht sie veraltet', async () => {
    const b = await readyBrief();
    expect(readiness(b).every((r) => r.ok)).toBe(true);
    const ok = confirm(b, at);
    expect(isConfirmedCurrent(ok)).toBe(true);
    expect(ok.confirmation.confirmedHash).toBe(substanceHash(b));
    const changed = correct(ok, 'colors.0.name', 'Dunkelgrau', at);
    expect(changed.confirmation.status).toBe('stale');
    expect(isConfirmedCurrent(changed)).toBe(false);
    expect(() => confirm(setRequirements(b, { ...REQ, partMin: 700 }))).toThrow(BriefError);
    expect(() => confirm(setRequirements(b, { ...REQ, keyFeatureIds: [] }))).toThrow(/Merkmale/);
  });
  it('Bildwechsel macht Interpretation und Bestätigung nachvollziehbar veraltet', async () => {
    const ok = confirm(await readyBrief(), at);
    const neu = await ref(png(400, 300, [9, 9]), 'vorlage.png'); // gleicher Name, anderer Inhalt
    const r = replaceImage(ok, ok.images[0].sha256, neu);
    expect(r.analysis!.status).toBe('stale');
    expect(r.analysis!.staleReason).toMatch(/ersetzt/);
    expect(r.confirmation.status).toBe('stale');
    expect(readiness(r).find((x) => x.label.startsWith('Interpretation beruht'))!.ok).toBe(false);
    expect(() => confirm(r)).toThrow(BriefError);
    // ausdrückliche Übernahme durch den Nutzer: protokolliert, Bestätigung bleibt veraltet bis zur Neubestätigung
    const rb = rebaseInterpretation(r, at);
    expect(rb.analysis).toMatchObject({ status: 'current', imageHashes: [neu.sha256] });
    expect(rb.history.at(-1)!.event).toMatch(/vom Nutzer für die aktuellen Bilder übernommen/);
    expect(isConfirmedCurrent(rb)).toBe(false);
    expect(isConfirmedCurrent(confirm(rb, at))).toBe(true);
    const removed = removeImage(ok, ok.images[0].sha256);
    expect(removed.analysis!.status).toBe('stale');
    expect(readiness(removed)[0].ok).toBe(false);
  });
  it('Speichern und Wiederherstellen ohne Datenverlust; veränderte Datei wird abgelehnt', async () => {
    const b = correct(confirm(await readyBrief(), at), 'summary', 'geändert', at);
    const back = parseBrief(JSON.stringify(b));
    expect(back).toEqual(b);
    const tampered = JSON.parse(JSON.stringify(b));
    tampered.requirements.partMax = 5000;
    expect(() => parseBrief(JSON.stringify(tampered))).toThrow(/Inhalts-Hash/);
    expect(() => parseBrief('{"schema":"anderes"}')).toThrow(/Schema/);
    expect(() => parseBrief('kaputt')).toThrow(/JSON/);
  });
  it('Verknüpfung mit CanonicalModel.design nur aus gültig bestätigtem Auftrag; Teilinstanzen entstehen keine', async () => {
    const b = await readyBrief();
    expect(() => toDesignProvenance(b)).toThrow(BriefError);
    const ok = confirm(b, at);
    const d = toDesignProvenance(ok);
    expect(d.brief).toEqual({ briefId: 'test-brief', version: ok.version, contentHash: ok.contentHash, confirmedHash: ok.confirmation.confirmedHash });
    expect(d.sources[0]).toMatchObject({ kind: 'concept-image', sha256: ok.images[0].sha256 });
    expect(d.assumptions.map((a) => a.id)).toEqual(['group:g3', 'hidden:1', 'symmetry']);
    expect(d.deviations).toEqual([]);
    expect(JSON.stringify(ok)).not.toMatch(/instanceId|"part":/);
    // Anbindung an ein (hier: vorhandenes Referenz-)Modell nur zur Prüfung der Schnittstelle
    const b2 = await bundle('none');
    const model: CanonicalModel = { ...labItems(b2).find((i) => i.id === 'ref-40013-1')!.make(), design: d };
    const plan = buildInstructionPlan(model, b2.catalog, b2.library);
    expect(plan.design?.brief?.briefId).toBe('test-brief');
    expect(contentHash(model)).not.toBe(contentHash({ ...model, design: undefined }));
  });
});

describe('Analyse-Endpunkt: Anbieter gekapselt, Antworten validiert', () => {
  const imgPayload = async () => {
    const bytes = png(400, 300);
    return { sha256: await sha256Hex(bytes), mediaType: 'image/png' as const, view: 'vorn', data: Buffer.from(bytes).toString('base64') };
  };
  const fake = (impl: AnalysisProvider['analyze'], problem: string | null = null): AnalysisProvider => ({ id: 'fake', label: 'Testanbieter (synthetisch)', model: 'kein-modell', configurationProblem: () => problem, analyze: impl });

  it('fehlende Zugangsdaten: 503 mit Einrichtungshinweisen, kein Aufruf', async () => {
    let called = false;
    const r = await analyzeRequest(fake(async () => { called = true; return { raw: {}, model: 'x', requestId: null, stopReason: null }; }, 'kein Schlüssel'), { images: [await imgPayload()] }, 'p');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, code: 'not_configured' });
    expect((r.body as { setup: string[] }).setup.join(' ')).toMatch(/ANTHROPIC_API_KEY/);
    expect(called).toBe(false);
    // echter Anbieter ohne Schlüssel meldet dasselbe
    expect(anthropicProvider({}).configurationProblem()).toMatch(/ANTHROPIC_API_KEY fehlt/);
  });
  it('ungültige Anfragen: keine Bilder, falsche Prüfsumme, kein Bildinhalt', async () => {
    const p = fake(async () => ({ raw: fixture(), model: 'x', requestId: null, stopReason: null }));
    expect((await analyzeRequest(p, {}, 'p')).body).toMatchObject({ code: 'invalid_request' });
    const img = await imgPayload();
    expect((await analyzeRequest(p, { images: [{ ...img, sha256: '0'.repeat(64) }] }, 'p')).body).toMatchObject({ code: 'invalid_request', message: expect.stringMatching(/Prüfsumme/) });
    expect((await analyzeRequest(p, { images: [{ ...img, data: Buffer.from('hallo').toString('base64') }] }, 'p')).body).toMatchObject({ code: 'invalid_request', message: expect.stringMatching(/Kein PNG/) });
  });
  it('Dienstausfall und Ablehnung werden als Fehlercode gemeldet', async () => {
    for (const code of ['unreachable', 'rate_limited', 'auth_failed', 'refusal', 'truncated'] as const) {
      const r = await analyzeRequest(fake(async () => { throw new ProviderError(code, `simuliert: ${code}`); }), { images: [await imgPayload()] }, 'p');
      expect(r.body, code).toMatchObject({ ok: false, code });
    }
  });
  it('echter Anbieter gegen nicht erreichbaren Endpunkt: Netzwerkfehler wird erkannt (kein externer Aufruf)', async () => {
    const p = anthropicProvider({ apiKey: 'test-ungueltig', baseURL: 'http://127.0.0.1:9' });
    const r = await analyzeRequest(p, { images: [await imgPayload()] }, 'p');
    expect(r.body).toMatchObject({ ok: false, code: 'unreachable' });
  }, 60000);
  it('ungültige, widersprüchliche und gültige Antworten', async () => {
    const run = (raw: unknown) => imgPayload().then((img) => analyzeRequest(fake(async () => ({ raw, model: 'm', requestId: 'r1', stopReason: 'end_turn' })), { images: [img] }, 'design-prompt@test'));
    expect((await run({ foo: 1 })).body).toMatchObject({ ok: false, code: 'invalid_response' });
    const contra = fixture();
    contra.hiddenAreas[0].basis = 'observed';
    const c = await run(contra);
    expect(c.status).toBe(422);
    expect(c.body).toMatchObject({ ok: false, code: 'contradictory_response', candidate: expect.any(Object) });
    const ok = await run(fixture());
    expect(ok.body).toMatchObject({ ok: true, meta: { provider: 'Testanbieter (synthetisch)', model: 'm', requestId: 'r1', promptVersion: 'design-prompt@test' } });
  });
});
