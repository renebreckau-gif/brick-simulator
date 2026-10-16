// Korrekturauftrag 05A.3: konkrete, gemeinsame Gründe vor der Bestätigung (confirmationBlockers),
// Feldprüfung der Anforderungen (checkRequirements) ohne stille Vorbelegung. Synthetische Fixture.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addImage, BriefError, checkRequirements, confirm, confirmationBlockers, EMPTY_REQUIREMENTS, isConfirmedCurrent, newBrief, readiness, setInterpretation, setRequirements, setView, toRequirements,
  type AnalysisMeta, type DesignBrief,
} from '../src/core/design/brief';
import { manualInterpretationTemplate, type Interpretation } from '../src/core/design/interpretation';

const fixture = () => (JSON.parse(readFileSync('tests/fixtures/design/interpretation-synthetic.json', 'utf8')) as { interpretation: Interpretation }).interpretation;
const at = '2026-10-16T10:00:00.000Z';
const MANUAL: AnalysisMeta = { method: 'manual', provider: 'Test (synthetisch)', model: null, promptVersion: null, at, requestId: null };
const img = { sha256: 'a'.repeat(64), mediaType: 'image/png' as const, bytes: 10, width: 400, height: 300, fileName: 'v.png', view: 'vorn' as const, addedAt: at };
const msgs = (b: DesignBrief) => confirmationBlockers(b).map((x) => x.message);
const valid = { ...EMPTY_REQUIREMENTS, partMin: 300, partMax: 600, keyFeatureIds: ['f1'], intendedUse: 'display' as const };

describe('Gründe vor der Bestätigung (gemeinsame Quelle)', () => {
  it('nur Bild hochgeladen: Interpretation fehlt, Teilezahlbereich fehlt, Merkmal und Nutzung fehlen', () => {
    const b = addImage(newBrief('p', 'p', at), img);
    expect(msgs(b)).toEqual([
      'Interpretation fehlt. Bild automatisch analysieren, manuell beschreiben oder einen vorhandenen Entwurfsauftrag importieren.',
      'Teilezahl „von“ fehlt.',
      'Teilezahl „bis“ fehlt.',
      'Mindestens ein wichtiges Merkmal auswählen.',
      'Nutzung auswählen.',
    ]);
    expect(confirmationBlockers(b)[0].target).toBe('interpretation');
    expect(() => confirm(b)).toThrow(/Interpretation fehlt/);
  });
  it('ohne Bild: zuerst Bild hochladen', () => {
    expect(confirmationBlockers(newBrief('p', 'p', at))[0]).toMatchObject({ target: 'images', message: 'Mindestens ein Bild hochladen.' });
  });
  it('manuelle Interpretation begonnen, Anforderungen fehlen: Ziele sind die Anforderungsfelder', () => {
    const b = setInterpretation(addImage(newBrief('p', 'p', at), img), manualInterpretationTemplate(), MANUAL);
    const bl = confirmationBlockers(b);
    expect(bl.map((x) => x.target)).toEqual(['req-partMin', 'req-partMax', 'req-keyFeatureIds', 'req-intendedUse']);
    expect(readiness(b).filter((r) => !r.ok).map((r) => r.label)).toEqual(['Teilezahlbereich angegeben (ganze Zahlen, Minimum ≤ Maximum)', 'Wichtigste Merkmale ausgewählt', 'Nutzung angegeben']);
  });
  it('nach Ansichtsänderung: Interpretation erneut prüfen', () => {
    let b = setRequirements(setInterpretation(addImage(newBrief('p', 'p', at), img), fixture(), MANUAL), toRequirements(valid, ['f1'])!);
    expect(confirmationBlockers(b)).toEqual([]);
    b = setView(b, img.sha256, 'hinten');
    expect(confirmationBlockers(b)).toEqual([expect.objectContaining({ group: 'bound', target: 'interpretation', message: expect.stringMatching(/^Interpretation nach Bild- oder Ansichtsänderung erneut prüfen/) })]);
  });
  it('vollständig gültig: keine Gründe, Bestätigung gelingt (unveränderter Erfolgsfall)', () => {
    const b = setRequirements(setInterpretation(addImage(newBrief('p', 'p', at), img), fixture(), MANUAL), toRequirements(valid, ['f1'])!);
    expect(confirmationBlockers(b)).toEqual([]);
    expect(readiness(b).every((r) => r.ok)).toBe(true);
    expect(isConfirmedCurrent(confirm(b, at))).toBe(true);
  });
});

describe('Anforderungen: Feldprüfung ohne Vorbelegung', () => {
  it('leerer Eingabestand ist nicht vorbelegt und nicht speicherbar', () => {
    expect(EMPTY_REQUIREMENTS).toMatchObject({ partMin: null, partMax: null, intendedUse: null, keyFeatureIds: [] });
    expect(toRequirements(EMPTY_REQUIREMENTS, ['f1'])).toBeNull();
  });
  const cases: [string, Partial<typeof valid>, string, RegExp][] = [
    ['Minimum größer als Maximum', { partMin: 500, partMax: 100 }, 'partMax', /mindestens so groß sein wie „von“/],
    ['keine ganze Zahl', { partMin: 1.5 }, 'partMin', /ganze Zahl größer als 0/],
    ['null', { partMax: 0 }, 'partMax', /ganze Zahl größer als 0/],
    ['ungültige Eingabe (NaN)', { partMin: Number.NaN }, 'partMin', /fehlt/],
    ['Höchstmaß 0', { maxLengthStuds: 0 }, 'maxLengthStuds', /leer lassen oder eine ganze Zahl/],
    ['Merkmal nicht mehr vorhanden', { keyFeatureIds: ['f9'] }, 'keyFeatureIds', /gibt es in der Interpretation nicht mehr/],
  ];
  for (const [name, patch, field, msg] of cases)
    it(`Feldfehler: ${name}`, () => {
      const p = checkRequirements({ ...valid, ...patch }, ['f1']);
      expect(p.find((x) => x.field === field)?.message).toMatch(msg);
      expect(toRequirements({ ...valid, ...patch }, ['f1'])).toBeNull();
    });
  it('gespeicherte ungültige Anforderungen (z. B. Import) erscheinen als Bestätigungsgrund am Feld', () => {
    const b = setInterpretation(addImage(newBrief('p', 'p', at), img), fixture(), MANUAL);
    const withBad = { ...b, requirements: { ...toRequirements(valid, ['f1'])!, partMin: 900 } };
    expect(confirmationBlockers(withBad)).toContainEqual(expect.objectContaining({ target: 'req-partMax', message: expect.stringMatching(/mindestens so groß/) }));
    expect(() => confirm(withBad as DesignBrief)).toThrow(BriefError);
  });
});
