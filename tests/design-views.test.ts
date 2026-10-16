// Nachtrag 05A.2: Ansichtsbezeichnungen gehören zur Bindung einer Interpretation.
// Prüfsummen, Reihenfolge und Ansichten werden überall gleich geprüft (bindingMismatch).
// Synthetische Fixture, kein Analysedienst.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addImage, adoptHeldAnalysis, analysisBound, applyAnalysisResult, BriefError, briefHash, briefIssues, confirm, createTicket, isConfirmedCurrent, newBrief, parseBrief,
  readiness, rebaseInterpretation, setInterpretation, setRequirements, setView, substanceHash, toDesignProvenance, type AnalysisMeta, type DesignBrief, type HeldAnalysis,
} from '../src/core/design/brief';
import type { Interpretation } from '../src/core/design/interpretation';

const fixture = () => (JSON.parse(readFileSync('tests/fixtures/design/interpretation-synthetic.json', 'utf8')) as { interpretation: Interpretation }).interpretation;
const at = '2026-10-16T10:00:00.000Z';
const MANUAL: AnalysisMeta = { method: 'manual', provider: 'Test (synthetisch)', model: null, promptVersion: null, at, requestId: null };
const SERVICE: AnalysisMeta = { method: 'anthropic-vision', provider: 'Testanbieter (synthetisch)', model: 'kein-modell', promptVersion: 'p', at, requestId: null };
const REQ = { partMin: 1, partMax: 2, maxLengthStuds: null, maxWidthStuds: null, maxHeightBricks: null, preferredSize: null, keyFeatureIds: ['f1'], intendedUse: 'display' as const, notes: '' };
const image = (c: string, view: 'vorn' | 'hinten' = 'vorn') => ({ sha256: c.repeat(64), mediaType: 'image/png' as const, bytes: 10, width: 400, height: 300, fileName: 'gleich.png', view, addedAt: at });
const beruht = (b: DesignBrief) => readiness(b).find((r) => r.label.startsWith('Interpretation beruht'))!.ok;

function base(): DesignBrief {
  const b = addImage(newBrief('projekt-v', 'V', at), image('a'));
  return setRequirements(setInterpretation(b, fixture(), MANUAL), REQ);
}
const rehash = (o: Record<string, any>, alsoConfirmed = false) => {
  if (alsoConfirmed) o.confirmation.confirmedHash = substanceHash(o as DesignBrief);
  o.contentHash = briefHash(o as DesignBrief);
  return JSON.stringify(o);
};

describe('Ansichtsänderung direkt', () => {
  it('setView mit tatsächlicher Änderung macht Interpretation und Bestätigung veraltet', () => {
    const ok = confirm(base(), at);
    expect(isConfirmedCurrent(ok)).toBe(true);
    const v = setView(ok, ok.images[0].sha256, 'hinten');
    expect(v.analysis).toMatchObject({ status: 'stale', inputViews: ['vorn'] });
    expect(v.analysis!.staleReason).toMatch(/von „vorn“ auf „hinten“/);
    expect(v.confirmation.status).toBe('stale');
    expect(beruht(v)).toBe(false);
    expect(isConfirmedCurrent(v)).toBe(false);
    expect(() => confirm(v)).toThrow(BriefError);
    expect(() => toDesignProvenance(v)).toThrow(BriefError);
  });
  it('setView ohne Änderung erzeugt keine neue Version', () => {
    const b = base();
    expect(setView(b, b.images[0].sha256, 'vorn')).toBe(b);
  });
  it('erst eine ausdrücklich protokollierte Neubewertung aktualisiert den Stand', () => {
    const v = setView(base(), image('a').sha256, 'hinten');
    const r = rebaseInterpretation(v, at);
    expect(r.analysis).toMatchObject({ status: 'current', inputViews: ['hinten'] });
    expect(r.history.at(-1)!.event).toMatch(/ausdrücklich für die aktuellen Bilder und Ansichten \(aaaaaaaaaaaa…\/hinten\) neu bewertet/);
    expect(isConfirmedCurrent(confirm(r, at))).toBe(true);
  });
});

describe('Verspätete Antwort und Übernahme (gemeldeter Ablauf)', () => {
  it('Ansicht während der Analyse geändert → zurückgehalten; Übernahme behält „vorn“ und bleibt veraltet', () => {
    let b = base(); // 1. Interpretation für Bild mit Ansicht „vorn“
    const t = createTicket(b, '', 'ticket-0000-0101', at); // 2. Anfrage
    b = setView(b, b.images[0].sha256, 'hinten'); // 3. dieselbe Datei auf „hinten“
    const out = applyAnalysisResult(b, t, fixture(), SERVICE); // 4. verspätete Antwort
    expect(out.kind).toBe('held');
    const a = adoptHeldAnalysis(b, (out as { held: HeldAnalysis }).held); // 5. Übernahme
    expect(a.analysis!.inputViews).toEqual(['vorn']);
    expect(a.images[0].view).toBe('hinten');
    expect(a.analysis!.status).toBe('stale');
    expect(a.analysis!.staleReason).toMatch(/andere Ansichten \(vorn\) als die aktuellen \(hinten\)/);
    expect(analysisBound(a)).toBe(false);
    expect(() => confirm(a)).toThrow(BriefError);
    expect(isConfirmedCurrent(a)).toBe(false);
    expect(() => toDesignProvenance(a)).toThrow(BriefError);
  });
  it('auch eine direkt angewendete Bindung mit abweichenden Ansichten wird nie „current“', () => {
    const b = addImage(newBrief('projekt-v', 'V', at), image('a', 'hinten'));
    const s = setInterpretation(b, fixture(), SERVICE, { imageHashes: [image('a').sha256], views: ['vorn'], notes: '', ticketId: 'ticket-0000-0102' });
    expect(s.analysis!.status).toBe('stale');
  });
});

describe('Import und Prüfungen lassen die Abweichung nicht durch', () => {
  it('manipulierte Datei: Ansicht geändert, Analyse weiter „current“, alle Hashes neu → nur unbestätigt geladen', () => {
    const o = JSON.parse(JSON.stringify(confirm(base(), at)));
    o.images[0].view = 'hinten';
    const forged = o as DesignBrief;
    o.confirmation.confirmedHash = substanceHash(forged);
    expect(briefIssues(forged).join(' ')).toMatch(/andere Ansichten \(vorn\) als die aktuellen \(hinten\)/);
    expect(isConfirmedCurrent(forged)).toBe(false);
    const loaded = parseBrief(rehash(o, true), at);
    expect(loaded.downgraded).toBe(true);
    expect(loaded.brief.analysis!.status).toBe('stale');
    expect(loaded.brief.confirmation.status).toBe('stale');
    expect(isConfirmedCurrent(loaded.brief)).toBe(false);
    expect(() => toDesignProvenance(loaded.brief)).toThrow(BriefError);
  });
  it('Reihenfolge der Bilder gehört zur Bindung', () => {
    let b = addImage(addImage(newBrief('projekt-v', 'V', at), image('a')), image('b'));
    b = setRequirements(setInterpretation(b, fixture(), MANUAL), REQ);
    const o = JSON.parse(JSON.stringify(confirm(b, at)));
    o.images.reverse();
    const loaded = parseBrief(rehash(o, true), at);
    expect(loaded.issues.join(' ')).toMatch(/Reihenfolge der Bilder weicht ab/);
    expect(isConfirmedCurrent(loaded.brief)).toBe(false);
  });
  it('ältere Datei ohne inputViews: keine Zuordnung erfunden – Analyse veraltet, Neubewertung nötig', () => {
    const o = JSON.parse(JSON.stringify(base()));
    delete o.analysis.inputViews;
    const loaded = parseBrief(rehash(o), at);
    expect(loaded.brief.analysis!.inputViews).toBeNull();
    expect(loaded.brief.analysis!.status).toBe('stale');
    expect(loaded.issues.join(' ')).toMatch(/Ansichten der Analyse nicht belegt \(ältere Datei ohne inputViews\)/);
    expect(loaded.brief.history.at(-1)!.event).toMatch(/Beim Laden fachlich ungültig/);
    expect(() => confirm(loaded.brief)).toThrow(BriefError);
    const r = rebaseInterpretation(loaded.brief, at);
    expect(r.analysis!.inputViews).toEqual(['vorn']);
    expect(isConfirmedCurrent(confirm(r, at))).toBe(true);
  });
});

describe('Unveränderter Erfolgsfall', () => {
  it('passende Prüfsummen, Reihenfolge und Ansichten: übernommen, bestätigt, Import verlustfrei', () => {
    const b = addImage(newBrief('projekt-v', 'V', at), image('a'));
    const t = createTicket(b, 'Hinweis', 'ticket-0000-0103', at);
    const out = applyAnalysisResult(b, t, fixture(), SERVICE);
    expect(out.kind).toBe('applied');
    const applied = (out as { brief: DesignBrief }).brief;
    expect(applied.analysis).toMatchObject({ status: 'current', imageHashes: [image('a').sha256], inputViews: ['vorn'] });
    const ok = confirm(setRequirements(applied, REQ), at);
    expect(isConfirmedCurrent(ok)).toBe(true);
    expect(parseBrief(JSON.stringify(ok))).toEqual({ brief: ok, issues: [], downgraded: false });
    expect(toDesignProvenance(ok).brief!.briefId).toBe('projekt-v');
  });
});
