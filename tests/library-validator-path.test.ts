// 05C.1.1, Punkt 2: „prüfbar“ in der Bibliothek muss dem tatsächlichen Weg zur Modellprüfung entsprechen.
// Ausgangsfehler (2d365b2): Bibliothek zeigte 3023b als „prüfbar“, der Prüfkern führte 3023b als „unsupported“.
import { describe, expect, it } from 'vitest';
import { pureRenameTarget, resolvePartMeta } from '../src/core/connectivity/identity';
import { definedPartIds } from '../src/core/connectivity/partMeta';
import { importLdraw } from '../src/core/model/ldrawImport';
import { validate } from '../src/core/validation/validate';
import { parseLdraw } from '../src/core/ldraw/parse';
import { bundle } from './helpers';
import { loadLibrary } from './library-helpers';

const { pub, noValidator } = await loadLibrary();
const b = await bundle('none');

function model(lines: string[]) {
  return importLdraw(['0 Testmodell', ...lines].join('\n'), { modelId: 'test-3023b', name: 'Test', origin: { kind: 'fixture', label: 'Test' }, fileName: 'test.ldr' });
}

describe('Gemeinsame Identitätsauflösung', () => {
  it('3023.dat ist in der Prüfbibliothek eine reine Umbenennung nach 3023b', () => {
    expect(pureRenameTarget(b.library.header('3023.dat'))).toBe('3023b');
  });
  it('gedrehter oder zusätzlicher Inhalt ist keine reine Umbenennung', () => {
    expect(pureRenameTarget(parseLdraw('0 ~Moved to 3023b\n1 16 0 0 0 0 0 1 0 1 0 -1 0 0 3023b.dat\n', 'x.dat'))).toBeNull();
    expect(pureRenameTarget(parseLdraw('0 ~Moved to 3023b\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 3023b.dat\n3 16 0 0 0 1 0 0 0 0 1\n', 'x.dat'))).toBeNull();
    expect(pureRenameTarget(parseLdraw('0 Plate 1 x 2\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 3023b.dat\n', 'x.dat'))).toBeNull();
  });
  it('Metadaten werden für 3023b über 3023 aufgelöst, andere Nummern nicht', () => {
    const r = resolvePartMeta('3023b', (k) => pureRenameTarget(b.library.header(`${k}.dat`)));
    expect(r?.metaId).toBe('3023');
    expect(r?.basis).toBe('reine Umbenennung');
    expect(resolvePartMeta('3023c', (k) => pureRenameTarget(b.library.header(`${k}.dat`)))).toBeNull();
  });
});

describe('Prüfkern und Bibliothek sagen dasselbe', () => {
  it('3023b: Prüfkern unterstützt, Bibliothek „prüfbar“', () => {
    expect(b.catalog.part('3023b').simulation).toBe('supported');
    expect(pub.support('3023b')).toBe('pruefbar');
  });
  it('ohne Prüfkern-Anbindung zeigt die Bibliothek nie „prüfbar“', () => {
    expect(noValidator.validatorAvailable).toBe(false);
    expect(noValidator.ids().some((id) => noValidator.support(id) === 'pruefbar' || noValidator.support(id) === 'teilweise-pruefbar')).toBe(false);
  });
  it('jedes als prüfbar angezeigte Teil führt der Prüfkern als unterstützt – und umgekehrt für alle Prüfkern-Teile', () => {
    for (const id of pub.ids()) {
      const s = pub.support(id);
      if (s === 'pruefbar') expect(b.catalog.part(id).simulation, id).toBe('supported');
      if (s === 'teilweise-pruefbar') expect(b.catalog.part(id).simulation, id).toBe('partial');
    }
    for (const id of definedPartIds()) {
      const sim = b.catalog.part(id).simulation;
      const lib = pub.support(id);
      if (sim === 'supported' && pub.entry(id)?.ty !== 'moved') expect(lib, id).toBe('pruefbar');
    }
  });
});

describe('Tatsächlicher Weg zur Modellprüfung', () => {
  it('Platte 3023b auf Stein 3001: Verbindung erkannt, kein „nicht unterstützt“', () => {
    const m = model(['1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 1 -20 -8 10 1 0 0 0 1 0 0 0 1 3023b.dat']);
    const r = validate(m, b.catalog);
    const plate = m.instances.find((i) => i.part === '3023b')!;
    expect(r.world.connections.some((c) => JSON.stringify(c).includes(plate.instanceId))).toBe(true);
    expect(r.report.findings.filter((f) => f.code === 'CAT_SIM_UNSUPPORTED' || f.code === 'CON_UNSUPPORTED_FEATURE')).toEqual([]);
  });
  it('ein Teil mit nur importierten Anschlüssen (3043) bleibt in der Modellprüfung „nicht unterstützt“', () => {
    expect(pub.support('3043')).toBe('anschluesse-importiert');
    expect(b.catalog.part('3043').simulation).not.toBe('supported');
  });
});
