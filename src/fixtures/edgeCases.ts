// Grenzfall-Korpus (synthetische Entwickler-Fixtures). Die zugehörigen Erwartungen
// und Begründungen stehen getrennt in data/expectations/edge-cases.json.
import { rotX90 } from '../core/math';
import type { CanonicalModel } from '../core/model/types';
import { fixture, FROM_BELOW } from './build';

export interface EdgeCase {
  caseId: string;
  group: string;
  model: () => CanonicalModel;
  /** Für Fall „veralteter Bericht“: nach der Prüfung anzuwendende Änderung. */
  staleEdit?: { instanceId: string; delta: [number, number, number] };
}

// Gemeinsame Geometrie für Baufolge-/Modulfälle (Platte 4×6, zwei Pfeiler, Mittelstein, Brücke 2×6)
const bridgeParts = (moduleId?: string) => [
  { id: 'platte', part: '3032', color: 71, at: [0, 0, 0] as [number, number, number] },
  { id: 'pfeiler-l', part: '3003', color: 15, at: [-40, -24, 0] as [number, number, number] },
  { id: 'pfeiler-r', part: '3003', color: 15, at: [40, -24, 0] as [number, number, number] },
  { id: 'mitte', part: '3003', color: 4, at: [0, -24, 0] as [number, number, number], assembly: moduleId },
  { id: 'bruecke', part: '2456', color: 4, at: [0, -48, 0] as [number, number, number], assembly: moduleId },
];

export const EDGE_CASES: EdgeCase[] = [
  {
    caseId: 'ec-01a-stud-connection',
    group: 'Steckverbindung vs. Berührung',
    model: () => fixture({
      id: 'ec-01a-stud-connection', name: 'Reguläre Steckverbindung', description: '2×4 auf 2×4, deckungsgleich',
      parts: [{ id: 'unten', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'oben', part: '3001', color: 4, at: [0, -24, 0] }],
      steps: [{ add: ['unten'] }, { add: ['oben'] }],
    }),
  },
  {
    caseId: 'ec-01b-touch-only',
    group: 'Steckverbindung vs. Berührung',
    model: () => fixture({
      id: 'ec-01b-touch-only', name: 'Bloße Berührung', description: 'Zwei 2×4 Seite an Seite',
      parts: [{ id: 'links', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'rechts', part: '3001', color: 4, at: [80, 0, 0] }],
      steps: [{ add: ['links'] }, { add: ['rechts'] }],
    }),
  },
  {
    caseId: 'ec-02-floating',
    group: 'Verbunden vs. schwebend',
    model: () => fixture({
      id: 'ec-02-floating', name: 'Schwebendes Teil', description: '2×2 mit Luftspalt über 2×4',
      parts: [{ id: 'basis', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'schwebend', part: '3003', color: 4, at: [0, -40, 0] }],
      steps: [{ add: ['basis'] }, { add: ['schwebend'] }],
    }),
  },
  {
    caseId: 'ec-03a-penetration',
    group: 'Zulässige Verbindung vs. Durchdringung',
    model: () => fixture({
      id: 'ec-03a-penetration', name: 'Echte Durchdringung', description: '2×4 halb in 2×4 versenkt (12 LDU)',
      parts: [{ id: 'unten', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'versenkt', part: '3001', color: 4, at: [0, -12, 0] }],
      steps: [{ add: ['unten'] }, { add: ['versenkt'] }],
    }),
  },
  {
    caseId: 'ec-03b-half-offset-no-jumper',
    group: 'Zulässige Verbindung vs. Durchdringung',
    model: () => fixture({
      id: 'ec-03b-half-offset-no-jumper', name: 'Halbnoppenversatz ohne Jumper', description: '1×2 um eine halbe Noppe versetzt auf 1×4',
      parts: [{ id: 'basis', part: '3010', color: 1, at: [0, 0, 0] }, { id: 'versetzt', part: '3004', color: 4, at: [10, -24, 0] }],
      steps: [{ add: ['basis'] }, { add: ['versetzt'] }],
    }),
  },
  {
    caseId: 'ec-04a-running-bond',
    group: 'Versetzter Verband vs. durchgehende Fugen',
    model: () => fixture({
      id: 'ec-04a-running-bond', name: 'Versetzter Verband', description: 'Wand 1×8, drei Lagen, Fugen versetzt',
      parts: [
        { id: 'l1-a', part: '3010', color: 4, at: [-40, 0, 0] }, { id: 'l1-b', part: '3010', color: 4, at: [40, 0, 0] },
        { id: 'l2-a', part: '3004', color: 15, at: [-60, -24, 0] }, { id: 'l2-b', part: '3010', color: 15, at: [0, -24, 0] }, { id: 'l2-c', part: '3004', color: 15, at: [60, -24, 0] },
        { id: 'l3-a', part: '3010', color: 4, at: [-40, -48, 0] }, { id: 'l3-b', part: '3010', color: 4, at: [40, -48, 0] },
      ],
      steps: [{ add: ['l1-a', 'l1-b'] }, { add: ['l2-a', 'l2-b', 'l2-c'] }, { add: ['l3-a', 'l3-b'] }],
    }),
  },
  {
    caseId: 'ec-04b-stacked-bond',
    group: 'Versetzter Verband vs. durchgehende Fugen',
    model: () => fixture({
      id: 'ec-04b-stacked-bond', name: 'Durchgehende Fuge mit Abschluss', description: 'Gleiche Steine gestapelt, Fuge über drei Lagen, oben 1×6 als Verbindung',
      parts: [
        { id: 'l1-a', part: '3010', color: 4, at: [-40, 0, 0] }, { id: 'l1-b', part: '3010', color: 4, at: [40, 0, 0] },
        { id: 'l2-a', part: '3010', color: 15, at: [-40, -24, 0] }, { id: 'l2-b', part: '3010', color: 15, at: [40, -24, 0] },
        { id: 'l3-a', part: '3010', color: 4, at: [-40, -48, 0] }, { id: 'l3-b', part: '3010', color: 4, at: [40, -48, 0] },
        { id: 'deckel', part: '3009', color: 1, at: [0, -72, 0] },
      ],
      steps: [{ add: ['l1-a', 'l1-b'] }, { add: ['l2-a', 'l2-b'] }, { add: ['l3-a', 'l3-b'] }, { add: ['deckel'] }],
    }),
  },
  {
    caseId: 'ec-04c-stacked-no-cap',
    group: 'Versetzter Verband vs. durchgehende Fugen',
    model: () => fixture({
      id: 'ec-04c-stacked-no-cap', name: 'Gestapelte Säulen ohne Verbindung', description: 'Wie 04b ohne Deckel: zwei getrennte Säulen',
      parts: [
        { id: 'l1-a', part: '3010', color: 4, at: [-40, 0, 0] }, { id: 'l1-b', part: '3010', color: 4, at: [40, 0, 0] },
        { id: 'l2-a', part: '3010', color: 15, at: [-40, -24, 0] }, { id: 'l2-b', part: '3010', color: 15, at: [40, -24, 0] },
        { id: 'l3-a', part: '3010', color: 4, at: [-40, -48, 0] }, { id: 'l3-b', part: '3010', color: 4, at: [40, -48, 0] },
      ],
      steps: [{ add: ['l1-a', 'l1-b'] }, { add: ['l2-a', 'l2-b'] }, { add: ['l3-a', 'l3-b'] }],
    }),
  },
  {
    caseId: 'ec-05a-correct-order',
    group: 'Endposition passend, Reihenfolge/Weg',
    model: () => fixture({
      id: 'ec-05a-correct-order', name: 'Richtige Reihenfolge', description: 'Mittelstein vor der Brücke',
      parts: bridgeParts(),
      steps: [{ add: ['platte'] }, { add: ['pfeiler-l', 'pfeiler-r', 'mitte'] }, { add: ['bruecke'] }],
    }),
  },
  {
    caseId: 'ec-05b-wrong-order',
    group: 'Endposition passend, Reihenfolge/Weg',
    model: () => fixture({
      id: 'ec-05b-wrong-order', name: 'Falsche Reihenfolge (Klemmposition)', description: 'Mittelstein erst nach der Brücke',
      parts: bridgeParts(),
      steps: [{ add: ['platte'] }, { add: ['pfeiler-l', 'pfeiler-r'] }, { add: ['bruecke'] }, { add: ['mitte'] }],
    }),
  },
  {
    caseId: 'ec-05c-blocked-path',
    group: 'Endposition passend, Reihenfolge/Weg',
    model: () => fixture({
      id: 'ec-05c-blocked-path', name: 'Blockierter Einschubweg', description: 'Platte 1×2 soll unter die fertige Brücke',
      parts: [
        { id: 'platte', part: '3032', color: 71, at: [0, 0, 0] },
        { id: 'pfeiler-l', part: '3003', color: 15, at: [-40, -24, 0] },
        { id: 'pfeiler-r', part: '3003', color: 15, at: [40, -24, 0] },
        { id: 'bruecke', part: '2456', color: 4, at: [0, -48, 0] },
        { id: 'unter-bruecke', part: '3023', color: 19, at: [0, -8, 10] },
      ],
      steps: [{ add: ['platte'] }, { add: ['pfeiler-l', 'pfeiler-r'] }, { add: ['bruecke'] }, { add: ['unter-bruecke'] }],
    }),
  },
  {
    caseId: 'ec-05d-declared-direction-mismatch',
    group: 'Endposition passend, Reihenfolge/Weg',
    model: () => fixture({
      id: 'ec-05d-declared-direction-mismatch', name: 'Deklarierte Richtung widerspricht', description: 'Stein auf Stein, aber Einschub „von unten“ deklariert',
      parts: [{ id: 'unten', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'oben', part: '3001', color: 4, at: [0, -24, 0] }],
      steps: [{ add: ['unten'] }, { add: ['oben'], insertion: { oben: FROM_BELOW } }],
    }),
  },
  {
    caseId: 'ec-06a-premodule',
    group: 'Vormontiertes Modul vs. unzugängliche Verbindung',
    model: () => fixture({
      id: 'ec-06a-premodule', name: 'Separat vormontiertes Modul', description: 'Brücke + Mittelstein als Modul, dann als Einheit aufgesetzt',
      parts: bridgeParts('modul'),
      assemblies: [{ assemblyId: 'modul', name: 'Brückenmodul', builtSeparately: true }],
      steps: [
        { assembly: 'modul', add: ['bruecke'] },
        { assembly: 'modul', add: ['mitte'], notes: ['Mittelstein von unten an die Brücke stecken'] },
        { add: ['platte'] },
        { add: ['pfeiler-l', 'pfeiler-r'] },
        { attach: ['modul'] },
      ],
    }),
  },
  {
    caseId: 'ec-06b-inaccessible',
    group: 'Vormontiertes Modul vs. unzugängliche Verbindung',
    model: () => fixture({
      id: 'ec-06b-inaccessible', name: 'Im Hauptmodell unzugänglich', description: 'Gleiche Endgeometrie wie 06a, aber ohne Vormontage',
      parts: bridgeParts(),
      steps: [{ add: ['platte'] }, { add: ['pfeiler-l', 'pfeiler-r'] }, { add: ['bruecke'] }, { add: ['mitte'] }],
    }),
  },
  {
    caseId: 'ec-07a-hand-support',
    group: 'Zwischenzustand mit Handunterstützung',
    model: () => fixture({
      id: 'ec-07a-hand-support', name: 'Überhang mit dokumentierter Handunterstützung', description: '2×6 kragt über 2×2 aus, Stütze folgt in Schritt 3',
      parts: [
        { id: 'fuss', part: '3003', color: 15, at: [0, 0, 0] },
        { id: 'balken', part: '2456', color: 4, at: [40, -24, 0] },
        { id: 'stuetze', part: '3003', color: 15, at: [80, 0, 0] },
      ],
      steps: [
        { add: ['fuss'] },
        { add: ['balken'], support: { kind: 'hand', note: 'Überstehendes Ende festhalten, bis Schritt 3 die Stütze ergänzt', source: 'Fixture-Deklaration' } },
        { add: ['stuetze'], support: { kind: 'hand', note: 'Bauzustand anheben, Stütze von unten anstecken', source: 'Fixture-Deklaration' } },
      ],
    }),
  },
  {
    caseId: 'ec-07b-no-support-declared',
    group: 'Zwischenzustand mit Handunterstützung',
    model: () => fixture({
      id: 'ec-07b-no-support-declared', name: 'Überhang ohne Deklaration', description: 'Wie 07a, Unterstützung nicht dokumentiert',
      parts: [
        { id: 'fuss', part: '3003', color: 15, at: [0, 0, 0] },
        { id: 'balken', part: '2456', color: 4, at: [40, -24, 0] },
        { id: 'stuetze', part: '3003', color: 15, at: [80, 0, 0] },
      ],
      steps: [{ add: ['fuss'] }, { add: ['balken'] }, { add: ['stuetze'] }],
    }),
  },
  {
    caseId: 'ec-08a-jumper-offset',
    group: 'Halbnoppenversatz und seitliches Bauen',
    model: () => fixture({
      id: 'ec-08a-jumper-offset', name: 'Halbnoppenversatz mit Jumper', description: 'Jumper 3794a versetzt einen 1×1-Stein um eine halbe Noppe',
      parts: [
        { id: 'basis', part: '3001', color: 15, at: [0, 0, 0] },
        { id: 'jumper', part: '3794a', color: 15, at: [0, -8, 10] },
        { id: 'stein', part: '3005', color: 4, at: [0, -32, 10] },
      ],
      steps: [{ add: ['basis'] }, { add: ['jumper'] }, { add: ['stein'] }],
    }),
  },
  {
    caseId: 'ec-08b-stud-in-tube',
    group: 'Halbnoppenversatz und seitliches Bauen',
    model: () => fixture({
      id: 'ec-08b-stud-in-tube', name: 'Noppe in Röhre', description: 'Platte 1×2 mittig unter 2×3: Noppen greifen in die Röhren',
      parts: [{ id: 'platte', part: '3023', color: 19, at: [0, 0, 0] }, { id: 'stein', part: '3002', color: 15, at: [0, -24, 0] }],
      steps: [{ add: ['platte'] }, { add: ['stein'] }],
    }),
  },
  {
    caseId: 'ec-08c-sideways',
    group: 'Halbnoppenversatz und seitliches Bauen',
    model: () => fixture({
      id: 'ec-08c-sideways', name: 'Seitlich angesetzter Stein', description: '1×2 mit Noppen nach +Z an der Seitenfläche eines 2×4',
      parts: [{ id: 'basis', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'seitlich', part: '3004', color: 4, at: [0, 12, 44], rot: rotX90(-1) }],
      steps: [{ add: ['basis'] }, { add: ['seitlich'] }],
    }),
  },
  {
    caseId: 'ec-09a-unknown-connection',
    group: 'Unbekannte Verbindung, fehlende Farbe, veralteter Bericht',
    model: () => fixture({
      id: 'ec-09a-unknown-connection', name: 'Unbekannte Verbindung', description: 'Kegel 59900 (keine Anschlussregeln) auf einer Noppe',
      parts: [{ id: 'basis', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'kegel', part: '59900', color: 19, at: [-30, -24, -10] }],
      steps: [{ add: ['basis'] }, { add: ['kegel'] }],
    }),
  },
  {
    caseId: 'ec-09b-missing-color',
    group: 'Unbekannte Verbindung, fehlende Farbe, veralteter Bericht',
    model: () => fixture({
      id: 'ec-09b-missing-color', name: 'Fehlende Farbzuordnung', description: 'Direkte LDraw-RGB-Farbe ohne Katalogfarbe',
      parts: [{ id: 'unten', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'oben', part: '3001', color: 0x2ff8800, at: [0, -24, 0] }],
      steps: [{ add: ['unten'] }, { add: ['oben'] }],
    }),
  },
  {
    caseId: 'ec-09c-out-of-scope-part',
    group: 'Unbekannte Verbindung, fehlende Farbe, veralteter Bericht',
    model: () => fixture({
      id: 'ec-09c-out-of-scope-part', name: 'Teil außerhalb des Umfangs', description: '1×8-Stein 3008: im Katalog belegt, aber ohne Geometrie/Regeln',
      parts: [{ id: 'basis', part: '3001', color: 4, at: [0, 0, 0] }, { id: 'lang', part: '3008', color: 4, at: [0, -24, -10] }],
      steps: [{ add: ['basis'] }, { add: ['lang'] }],
    }),
  },
  {
    caseId: 'ec-09d-stale-report',
    group: 'Unbekannte Verbindung, fehlende Farbe, veralteter Bericht',
    model: () => fixture({
      id: 'ec-09d-stale-report', name: 'Veralteter Prüfbericht', description: 'Bericht zu Version 1; danach wird ein Teil verschoben',
      parts: [{ id: 'unten', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'oben', part: '3001', color: 4, at: [0, -24, 0] }],
      steps: [{ add: ['unten'] }, { add: ['oben'] }],
    }),
    staleEdit: { instanceId: 'oben', delta: [10, 0, 0] },
  },
  {
    caseId: 'ec-10-under-three',
    group: 'Nutzungseignung',
    model: () => fixture({
      id: 'ec-10-under-three', name: 'Nutzergruppe unter 3 Jahren', description: 'Wie 01a, aber vorgesehene Nutzer ab 2 Jahren',
      parts: [{ id: 'unten', part: '3001', color: 15, at: [0, 0, 0] }, { id: 'oben', part: '3001', color: 4, at: [0, -24, 0] }],
      steps: [{ add: ['unten'] }, { add: ['oben'] }],
      usage: { intendedUse: 'play-goal', intendedUsers: { minAgeYears: 2, source: 'Fixture-Deklaration (Nutzerangabe)' } },
    }),
  },
];
