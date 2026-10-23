// 05C.1.1, Punkte 1 und 3: Farbbelege und Gewichtung aus synthetischen Rebrickable-CSV-Daten (tests/fixtures/rebrickable-mini).
// Keine privaten Daten. Jede erwartete Zahl ist aus den CSV-Zeilen von Hand nachgerechnet (Herleitung im Kommentar).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RebrickableColorsFile } from '../src/core/library/types';
import { python } from './library-helpers';

const ROOT = join(__dirname, '..');
const FIX = join(__dirname, 'fixtures', 'rebrickable-mini');
const dir = mkdtempSync(join(tmpdir(), 'rb-rules-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(): RebrickableColorsFile {
  const out = join(dir, 'out.json');
  const r = python([join(ROOT, 'scripts', 'library', 'rebrickable.py'), FIX, join(FIX, 'ldraw-index.json'), out]);
  if (r.status !== 0) throw new Error(`rebrickable.py: ${r.stderr}`);
  return JSON.parse(readFileSync(out, 'utf8'));
}
const rb = run();
const colorIds = (ld: string) => rb.parts[ld]?.colors.map((c) => c[0]) ?? [];

describe('Farbbelege: nur eindeutige Identität oder nachgewiesene Umbenennung', () => {
  it('Alternative ist kein Farbbeleg (Fehler bis 2d365b2: 3794a erhielt Grün von alt9)', () => {
    // alt9 (keine LDraw-Datei, Rebrickable-Beziehung A zu 3794a) liegt in S3 in Grün (2). 3794a selbst nur Blau in S2.
    expect(colorIds('3794a')).toEqual([1]);
    expect(rb.parts['3794a'].alternatives).toEqual(['3794b', 'alt9']);
    expect(rb.parts['3794a'].rb).toEqual({ '3794a': ['gleiche Nummer'] });
  });
  it('nachgewiesene Umbenennung und Schlüsselwort: Rebrickable 3023 → LDraw 3023b', () => {
    expect(rb.parts['3023b'].rb).toEqual({ '3023': ['LDraw-Schlüsselwort', 'LDraw-Umbenennung'] });
    expect(rb.parts['3023']).toBeUndefined();
  });
  it('mehrdeutige Identität ergibt keine Farbbelege', () => {
    expect(rb.ambiguous).toEqual({ amb: ['amb', 'amb2'] });
    expect(rb.parts.amb).toBeUndefined();
    expect(rb.parts.amb2).toBeUndefined();
  });
  it('Druckfarben belegen nicht das unbedruckte Grundteil', () => {
    // 3001pr0001 nur in Weiß (15) in S3 → 3001 hat kein Weiß
    expect(colorIds('3001')).not.toContain(15);
  });
  it('Herkunft je Teil-Farb-Beleg bleibt erhalten', () => {
    for (const p of Object.values(rb.parts)) for (const c of p.colors) expect(c[6].length).toBeGreaterThan(0);
    expect(rb.parts['3023b'].colors[0][6]).toEqual(['3023']);
  });
});

describe('Zählung eindeutiger Sets (Inventarversionsregel: je Set nur die neueste Version)', () => {
  it('3001 Rot: S1 (v2, zwei Zeilen), S2, S3 → 3 Sets, davon ab 2016: S1, S3 → 2; Element-ID vorhanden', () => {
    expect(rb.parts['3001'].colors.find((c) => c[0] === 4)).toEqual([4, 3, 2, 2010, 2021, true, ['3001']]);
  });
  it('3001 Schwarz steht nur in der alten Inventarversion von S1 → kein Beleg', () => {
    expect(colorIds('3001')).toEqual([1, 4]);
  });
  it('Minifiguren-Inventar (fig-0001) und Ersatzteile zählen nicht', () => {
    expect(colorIds('3001')).not.toContain(2); // Grün nur in fig-0001
    expect(colorIds('3023b')).not.toContain(14); // Gelb nur als Ersatzteil in S2
  });
  it('3023b Schwarz: S1 nur in alter Version, S3 → 1 Set', () => {
    expect(rb.parts['3023b'].colors).toEqual([[0, 1, 1, 2021, 2021, false, ['3023']]]);
  });
});

describe('Referenzmenge und Gewichte', () => {
  it('Gewicht = eindeutige Sets ab 2016; Farben, Drucke und Versionen gewichten nicht mehrfach', () => {
    // 3001: S1 (Rot+Blau), S3 (Rot + Druck 3001pr0001) → 2 (bis 2d365b2: 5)
    // 3023b: nur S3 (S1-Eintrag nur in alter Version) → 1; 3794b: S3 → 1; 3794a: nur 2010 → nicht enthalten
    expect(rb.refset).toEqual({ '3001': 2, '3023b': 1, '3794b': 1 });
  });
  it('nicht zugeordnete Teile behalten ihr Gewicht (auch mehrdeutige und reine Alternativen)', () => {
    expect(rb.refsetUnmapped).toEqual({ alt9: 1, amb: 1, x999: 1 });
  });
  it('ausgeschlossene Kategorien (Minifigur fig1) fehlen ganz', () => {
    expect(rb.refset.fig1 ?? rb.refsetUnmapped.fig1).toBeUndefined();
  });
  it('Zählwerte', () => {
    expect(rb.counts).toEqual({ sets: 3, setsRecent: 2, mapped: 4, ambiguous: 1 });
  });
});
