// 05C.1.1, Punkt 5: Der Import muss unter Linux und Windows dieselben Bytes erzeugen.
// Ursache der Linux-Abweichung bei u9200 (f.cv 0,095 → 0,096; f.in 0,261 → 0,260): `x ** 2` ruft pow() der
// C-Bibliothek auf; MSVC rundet pow(x, 2) nicht korrekt (unter Windows ≈ 1 von 2000 Werten ≠ x * x), glibc schon.
// Erlaubt sind daher nur korrekt gerundete Operationen (+ − × ÷, sqrt, fsum). Diese Prüfung hält die Regel fest;
// den eigentlichen Byte-Vergleich über Plattformen macht .github/workflows/library-reproducibility.yml.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { python } from './library-helpers';

const DIR = join(__dirname, '..', 'scripts', 'library');
const code = (f: string) => readFileSync(join(DIR, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#') && !l.trim().startsWith('"""'));

describe('Plattformunabhängige Arithmetik im Import', () => {
  for (const f of ['build.py', 'common.py', 'rebrickable.py']) {
    it(`${f}: kein pow/**, keine nicht korrekt gerundeten Funktionen`, () => {
      const bad = code(f).filter((l) => /\*\*\s*\d|math\.(pow|hypot|exp|log|atan2?|asin|acos|tan|degrees)\b/.test(l));
      expect(bad).toEqual([]);
    });
  }
  it('sin/cos nur in sincos() (Vielfache von 90° exakt, Ergebnis gerundet)', () => {
    const lines = code('build.py');
    const uses = lines.map((l, i) => [l, i] as const).filter(([l]) => /math\.(sin|cos)\(/.test(l));
    const start = lines.findIndex((l) => l.startsWith('def sincos('));
    for (const [, i] of uses) expect(i > start && i < start + 8).toBe(true);
  });
  it('sincos liefert Vielfache von 90° exakt', () => {
    const r = python(['-c', 'import importlib.util,sys\ns=importlib.util.spec_from_file_location("b",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint([m.sincos(d) for d in (0,90,180,270,-90,450)])', join(DIR, 'build.py')]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('[(0.0, 1.0), (1.0, 0.0), (0.0, -1.0), (-1.0, 0.0), (-1.0, 0.0), (1.0, 0.0)]');
  });
  it('Geometrie-Kennwerte von u9200 entsprechen dem plattformunabhängigen Ergebnis (Linux-Referenz)', () => {
    const parts = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'library', 'parts.json'), 'utf8')).parts;
    expect(parts.u9200.f).toEqual({ cv: 0.096, cvv: 0.001, h: 0.002, i: 0.006, in: 0.26, va: 0.017 });
  });
});
