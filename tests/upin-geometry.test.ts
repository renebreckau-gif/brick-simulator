// Evidenz für R-UPIN-HOLLOWSTUD: die in den Teil-Metadaten eingetragenen Maße werden unabhängig aus
// den LDraw-Dateien nachgerechnet (Primitive-Transformationen, Begrenzungsboxen der Primitive).
import { describe, expect, it } from 'vitest';
import { partMeta } from '../src/core/connectivity/partMeta';
import { CONNECTION_RULES } from '../src/core/connectivity/rules';
import { checkUpinGeometry } from '../src/core/connectivity/upin';
import { normalizeName } from '../src/core/ldraw/parse';
import { transformBox } from '../src/core/math';
import { bundle } from './helpers';

const round = (v: number) => Math.round(v * 1000) / 1000;

describe('R-UPIN-HOLLOWSTUD: Maße aus LDraw', () => {
  it('3004: Unterseitenstift und Hohlraum entsprechen s/3004s01.dat', async () => {
    const b = await bundle('none');
    const flat = b.library.flatten('3004.dat');
    const meta = partMeta('3004')!;
    const pin = meta.connectors.find((c) => c.kind === 'underside_pin')!;
    const g = pin.geometry!;
    // Stift: stud3.dat-Verwendung an der Stiftposition, Begrenzungsbox des Primitivs transformiert
    const stud3 = flat.primitives.filter((p) => p.file === 'stud3.dat');
    expect(stud3).toHaveLength(1);
    const pinBox = transformBox(stud3[0].transform, b.library.flatten('stud3.dat').bbox);
    expect(round((pinBox.max[0] - pinBox.min[0]) / 2)).toBe(g.pinRadius);
    expect(round((pinBox.max[2] - pinBox.min[2]) / 2)).toBe(g.pinRadius);
    expect(round(pinBox.max[1])).toBe(meta.size!.height); // Stift endet bündig am Teilboden
    expect(round(pinBox.max[1] - pinBox.min[1])).toBe(g.pinLength);
    expect([round((pinBox.min[0] + pinBox.max[0]) / 2), round((pinBox.min[2] + pinBox.max[2]) / 2)]).toEqual([pin.position[0], pin.position[2]]);
    // Hohlraum: box5.dat-Verwendung (BFC INVERTNEXT in s/3004s01.dat)
    const box5 = flat.primitives.filter((p) => p.file === 'box5.dat');
    expect(box5).toHaveLength(1);
    const cav = transformBox(box5[0].transform, b.library.flatten('box5.dat').bbox);
    expect([round(cav.max[0]), round(cav.max[2])]).toEqual(g.cavityHalfWidth);
    expect(round(cav.max[1])).toBe(meta.size!.height);
    expect(round(cav.max[1] - cav.min[1])).toBe(g.cavityDepth);
  });

  it('6541: Hohlnoppe entspricht p/stud2.dat; Lochboden durch die Teiloberseite (rect.dat bei y 0)', async () => {
    const b = await bundle('none');
    const meta = partMeta('6541')!;
    const holder = meta.connectors.find((c) => c.kind === 'bar_holder')!;
    const g = holder.geometry!;
    const flat = b.library.flatten('6541.dat');
    const stud2Uses = flat.primitives.filter((p) => p.file === 'stud2.dat');
    expect(stud2Uses).toHaveLength(1);
    expect(stud2Uses[0].transform.position).toEqual([holder.position[0], holder.position[1], holder.position[2]]);
    // Zylinder in stud2.dat: Radien und Höhen direkt aus den Typ-1-Zeilen
    const stud2 = b.library.header('stud2.dat')!;
    const cyl = stud2.lines.filter((l) => l.type === 1 && normalizeName(l.file) === '4-4cyli.dat') as { position: number[]; rotation: number[] }[];
    const radii = cyl.map((c) => Math.abs(c.rotation[0])).sort((x, y) => x - y);
    expect(radii).toEqual([g.holeRadius, g.outerRadius]);
    const hole = cyl.find((c) => Math.abs(c.rotation[0]) === g.holeRadius)!;
    // Lochzylinder von y = −4 (Noppenoberkante) über die Höhe |e| nach unten
    expect(round(hole.position[1])).toBe(-4);
    expect(round(Math.abs(hole.rotation[4]))).toBe(g.holeDepth);
    // Boden: rect.dat in 6541 auf Höhe der Noppenbasis (y 0), deckt das Loch ab
    const rect = flat.primitives.filter((p) => p.file === 'rect.dat' && Math.abs(p.transform.position[1]) < 1e-9);
    expect(rect.length).toBeGreaterThan(0);
    expect(Math.abs(rect[0].transform.rotation[0])).toBeGreaterThanOrEqual(g.outerRadius!);
  });

  it('Vollnoppe stud.dat hat kein Loch (Gegenbeispiel)', async () => {
    const b = await bundle('none');
    const stud = b.library.header('stud.dat')!;
    const cyl = stud.lines.filter((l) => l.type === 1 && normalizeName(l.file) === '4-4cyli.dat') as { rotation: number[] }[];
    expect(cyl.map((c) => Math.abs(c.rotation[0]))).toEqual([6]);
  });

  it('Regelprüfung der Nennmaße ist erfüllt und dokumentiert die Einzelwerte', () => {
    const r = checkUpinGeometry(partMeta('3004')!.connectors.find((c) => c.kind === 'underside_pin')!.geometry, partMeta('6541')!.connectors.find((c) => c.kind === 'bar_holder')!.geometry);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => `${c.value}${c.relation}${c.limit}`)).toEqual(['4≤4', '6≤6', '20≥4', '4≥4']);
  });

  it('fehlende Maße ergeben keine Verbindung (keine erfundene Geometrie)', () => {
    const r = checkUpinGeometry(undefined, partMeta('6541')!.connectors.find((c) => c.kind === 'bar_holder')!.geometry);
    expect(r.ok).toBe(false);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('Geltungsbereich ist auf die belegte Paarung begrenzt', () => {
    const rule = CONNECTION_RULES.find((r) => r.id === 'R-UPIN-HOLLOWSTUD')!;
    expect(rule.status).toBe('implemented');
    expect(rule.scope).toMatchObject({ male: ['3004'], female: ['6541'] });
    // nur die freigegebenen Teile tragen Maße
    expect(partMeta('3010')!.connectors.find((c) => c.kind === 'underside_pin')?.geometry).toBeUndefined();
    expect(partMeta('3794a')!.connectors.find((c) => c.kind === 'bar_holder')?.geometry).toBeUndefined();
  });
});
