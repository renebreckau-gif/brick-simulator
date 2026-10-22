// Formvorgabe aus einer Bildvorlage (Auftrag 05B.1): synthetische Bilder mit bekannter Geometrie.
import { describe, expect, it } from 'vitest';
import type { DesignBrief } from '../src/core/design/brief';
import type { Rgba } from '../src/core/construct/silhouette';
import { profileRuns } from '../src/core/construct/silhouette';
import { bowTargetFromTemplate, viewAssignmentOrigin } from '../src/core/construct/templateTarget';
import { checkBowTarget, TargetError } from '../src/core/construct/shapeTarget';
import { buildBow } from '../src/core/construct/bowTechnique';
import { validate } from '../src/core/validation/validate';
import { bundle } from './helpers';

const IW = 600;
const IH = 300;

/** Weißes Bild; fill(x, y) = true färbt den Punkt dunkelgrau. */
function paint(fill: (x: number, y: number) => boolean): Rgba {
  const data = new Uint8ClampedArray(IW * IH * 4).fill(255);
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) if (fill(x, y)) { const o = (y * IW + x) * 4; data[o] = data[o + 1] = data[o + 2] = 70; }
  return { data, width: IW, height: IH };
}

interface Shape { canopyFrom: number; canopyTo: number }
/**
 * Links Draufsicht (Spitze oben bei y = 20, Breite wächst bis 80 px bei 100 px Abstand), rechts linke Seite
 * (Spitze links bei x = 320, Unterkante y = 200, Höhe wächst von 6 bis 40 px, Kanzel +20 px zwischen canopyFrom/To px).
 * Dazu eine dünne Maßlinie, die nicht als Objekt zählen darf.
 */
function scene(s: Shape): Rgba {
  return paint((x, y) => {
    if (x < 300) {
      const d = y - 20;
      if (d < 0 || d > 260) return x === 40 && y > 20; // senkrechte Maßlinie
      const half = Math.min(40, 3 + 0.37 * d);
      return Math.abs(x - 150) <= half;
    }
    const d = x - 320;
    if (d < 0 || d > 260) return false;
    let h = Math.min(40, 6 + 0.34 * d); // stumpfe Spitze (6 px), wie gezeichnete Umrisse
    if (d >= s.canopyFrom && d <= s.canopyTo) h += 20;
    return y <= 200 && y >= 200 - h;
  });
}

const n = (px: number, total: number) => px / total;
function brief(s: Shape, provider = 'SYNTHETISCH – Testantwort'): DesignBrief {
  const view = (viewId: string, x0: number, x1: number, direction: string, frontInImage: string, nature = 'darstellung', annotations: { text: string; kind: string }[] = []) => ({
    viewId, imageIndex: 0, box: { x: n(x0, IW), y: 0, w: n(x1 - x0, IW), h: 1 }, label: viewId.toUpperCase(), direction, frontInImage, nature, annotations, basis: 'user', uncertainty: 'niedrig', note: '',
  });
  const box = (viewId: string, x0: number, y0: number, x1: number, y1: number) => ({ imageIndex: 0, viewId, x: n(x0, IW), y: n(y0, IH), w: n(x1 - x0, IW), h: n(y1 - y0, IH) });
  return {
    title: 'Testform', images: [{ sha256: 'ab'.repeat(32), width: IW, height: IH }],
    analysis: { method: 'manual', provider, model: null, promptVersion: null },
    interpretation: {
      imageViews: { schema: 'baustein-sim/image-views@1', views: [
        view('oben', 0, 300, 'oben', 'oben', 'darstellung', [{ text: 'L = 1,0', kind: 'mass' }]),
        view('links', 300, 600, 'links', 'links'),
        view('unten', 300, 600, 'unten', 'oben', 'entwurf'),
      ] },
      groups: [
        { id: 'rumpf', name: 'Rumpf', role: 'hauptkoerper', boxes: [box('oben', 110, 20, 190, 280), box('links', 320, 140, 580, 200)] },
        { id: 'kanzel', name: 'Kanzel', role: 'detail', boxes: [box('oben', 140, 20 + s.canopyFrom, 160, 20 + s.canopyTo), box('links', 320 + s.canopyFrom, 140, 320 + s.canopyTo, 180)] },
      ],
    },
  } as unknown as DesignBrief;
}

describe('Umrissmessung', () => {
  it('misst nur den Lauf durch die Mittellinie; dünne Linien zählen nicht', () => {
    const img = scene({ canopyFrom: 60, canopyTo: 110 });
    const runs = profileRuns(img, { x0: 0, y0: 0, x1: 300, y1: 300 }, 'y', 150);
    const r = runs.find((q) => q.pos === 220)!;
    expect(r.hi - r.lo).toBe(81); // 2 · 40 + 1
    expect(runs.every((q) => q.lo > 40)).toBe(true);
  });
});

describe('Formvorgabe aus der Vorlage', () => {
  const base = { canopyFrom: 60, canopyTo: 110 };
  it('leitet Breite, Höhe und Kanzel mit gemeinsamem Maßstab ab', () => {
    const { target: t, views } = bowTargetFromTemplate(brief(base), () => scene(base), { canopyGroupId: 'kanzel' });
    expect(checkBowTarget(t)).toEqual([]);
    expect(views.map((v) => [v.viewId, v.use])).toEqual([['oben', 'quelle'], ['links', 'quelle'], ['unten', 'keine-quelle']]);
    // Messprofil der Draufsicht: an der Spitze schmal, hinten 80 px bei 122,5 px Abschnittslänge
    const w = (s: { lo: number; hi: number } | null) => (s ? s.hi - s.lo : 0);
    expect(w(views[0].profile!.samples.at(-1)!)).toBeCloseTo(81 / 122.5, 1);
    expect(w(views[0].profile!.samples[0])).toBeLessThan(0.15);
    // Abschnitt: Kanzelende 110 px + 25 % von 50 px = 122,5 px; größte Breite 80 px ≙ 6 Noppen → 9 Reihen
    expect(t.rows).toBe(9);
    expect(Math.max(...t.width)).toBeCloseTo(6, 0);
    expect(t.width[0]).toBeGreaterThan(t.width[t.rows - 1]); // Reihe 0 hinten, letzte Reihe = Spitze
    // Rumpfhöhe 40 px bei 80 px Breite → 6 Noppen · 0,5 · 2,5 = 7,5 Platten
    expect(t.top[0]).toBeCloseTo(7.5, 0);
    expect(t.top[t.rows - 1]).toBeLessThan(3);
    expect(t.canopy).not.toBeNull();
    // Kanzeloberkante 60 px; Rumpfoberkante kurz vor der Kanzel (≈ 57 px hinter der Spitze) ≈ 25 px → ≈ 35 px
    // ≙ 35 / 260 L · 19,3 Noppen/L · 2,5 Platten/Noppe ≈ 6,5 Platten
    expect(t.canopy!.height).toBeGreaterThan(5.8);
    expect(t.canopy!.height).toBeLessThan(7.2);
    expect(t.top[t.canopy!.fromRow]).toBeCloseTo(t.top[t.canopy!.toRow], 5); // verdeckte Rumpfoberkante eben angenommen
    expect(t.origin.kind).toBe('template-measurement');
    expect(t.sources.map((s) => s.field)).toEqual(expect.arrayContaining(['Bugkontur', 'Höhenprofil', 'Kanzel', 'Maßstab']));
    expect(t.notes.join('\n')).toMatch(/entworfene Ansicht – keine Konstruktionsquelle/);
    expect(t.notes.join('\n')).toMatch(/„L = 1,0“.*nicht als Maß übernommen/);
    expect(t.notes.join('\n')).toMatch(/Synthetische Testantwort/);
  });

  it('reagiert auf eine geänderte Kanzellage', () => {
    const fwd = { canopyFrom: 30, canopyTo: 80 };
    const a = bowTargetFromTemplate(brief(base), () => scene(base), { canopyGroupId: 'kanzel' }).target;
    const b = bowTargetFromTemplate(brief(fwd), () => scene(fwd), { canopyGroupId: 'kanzel' }).target;
    // weiter vorn = höhere Reihennummern relativ zur Abschnittslänge
    expect(b.canopy!.toRow / b.rows).toBeGreaterThan(a.canopy!.toRow / a.rows);
    const ma = buildBow(a, { variant: 'schraegsteine', widthStuds: 6 });
    const mb = buildBow(b, { variant: 'schraegsteine', widthStuds: 6 });
    expect(ma.model.modelId).not.toBe(mb.model.modelId);
  });

  it('aus der gemessenen Form entstehen beide Varianten bei 6 und 8 Noppen ohne Blocker', async () => {
    const bd = await bundle();
    const found: string[] = [];
    for (const W of [6, 8]) {
      const t = bowTargetFromTemplate(brief(base), () => scene(base), { canopyGroupId: 'kanzel', widthStuds: W }).target;
      for (const variant of ['keilplatten', 'schraegsteine'] as const) {
        const r = validate(buildBow(t, { variant, widthStuds: W }).model, bd.catalog);
        for (const f of r.report.findings.filter((x) => x.severity === 'blocker' && x.status === 'failed')) found.push(`${variant} ${W}: ${f.code} ${f.affected.instanceIds.join(' ')}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('verlangt Draufsicht, Seitenansicht und Kanzel-Bildbereich', () => {
    const b = brief(base);
    expect(() => bowTargetFromTemplate(b, () => scene(base), { canopyGroupId: 'fehlt' })).toThrow(TargetError);
    const noSide = structuredClone(b);
    noSide.interpretation!.imageViews!.views = noSide.interpretation!.imageViews!.views.filter((v) => v.direction !== 'links');
    expect(() => bowTargetFromTemplate(noSide, () => scene(base), { canopyGroupId: 'kanzel' })).toThrow(/Seitenansicht/);
  });

  it('kennzeichnet die Herkunft der Ansichtszuordnung', () => {
    expect(viewAssignmentOrigin(brief(base)).kind).toBe('synthetic');
    expect(viewAssignmentOrigin(brief(base, 'Hand')).kind).toBe('manual');
    const live = brief(base, 'Anthropic');
    (live.analysis as { method: string }).method = 'anthropic-vision';
    (live.analysis as { promptVersion: string }).promptVersion = 'design-prompt@1.0.0';
    expect(viewAssignmentOrigin(live).kind).toBe('live-legacy');
  });
});
