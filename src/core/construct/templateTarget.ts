// Formvorgabe „Bug mit Kanzel“ aus den Ansichten einer Bildvorlage ableiten (Auftrag 05B.1).
//
// Quellen je Angabe (keine stille Mittelung):
//   Bugkontur (Breite je Reihe)  ← Draufsicht (Richtung „oben“, keine entworfene Ansicht)
//   Höhenprofil (Oberkante)      ← EINE Seitenansicht (bevorzugt „links“); die andere nur als Vergleich
//   Kanzellage und -höhe         ← Bildbereich der Kanzel-Baugruppe in derselben Seitenansicht
//   Kanzelbreite                 ← Bildbereich der Kanzel in der Draufsicht
//   Maßstab                      ← je Ansicht gezeichnete Rumpflänge L (Bildbereich des Hauptkörpers)
// Entworfene Ansichten (z. B. „Unten · Entwurf“) und Maßbeschriftungen der Vorlage werden nicht verwendet.
import type { DesignBrief } from '../design/brief';
import { viewOfBox, type ImageView } from '../design/views';
import { profileRuns, type PixelRect, type Rgba, type Run } from './silhouette';
import { SHAPE_TARGET_SCHEMA, TargetError, type BowTarget, type TargetSource } from './shapeTarget';
import { PROFILE_SAMPLES, type Profile } from './compare';

export interface TemplateChoice {
  /** Baugruppe der Interpretation, die als Kanzel gilt (vom Nutzer gewählt bzw. bestätigt). */
  canopyGroupId: string;
  /** Breite der Testgröße in Noppen (legt den Maßstab fest). */
  widthStuds?: number;
}

/** Herkunft der Ansichtszuordnung, wie sie im Entwurfsauftrag belegt ist. */
export function viewAssignmentOrigin(b: DesignBrief): { kind: 'live-extended' | 'live-legacy' | 'synthetic' | 'manual' | 'import' | 'none'; text: string } {
  const a = b.analysis;
  if (!a || !b.interpretation?.imageViews) return { kind: 'none', text: 'Keine Ansichtszuordnung vorhanden' };
  if (/SYNTHETISCH/i.test(a.provider)) return { kind: 'synthetic', text: `Synthetische Testantwort bzw. manuelle Eingabe: ${a.provider}` };
  if (a.method === 'anthropic-vision') return a.promptVersion && a.promptVersion >= 'design-prompt@1.1.0'
    ? { kind: 'live-extended', text: `Live-Analyse (${a.provider}, ${a.model ?? '?'}, ${a.promptVersion}) mit erweitertem Ansichtsformat` }
    : { kind: 'live-legacy', text: `Live-Analyse im älteren Format (${a.promptVersion ?? '?'}) – Ansichten nicht aus dieser Analyse` };
  if (a.method === 'manual') return { kind: 'manual', text: `Manuelle Eingabe (${a.provider})` };
  return { kind: 'import', text: `Import (${a.provider})` };
}

/** Eine Ansicht der Vorlage und ihre Rolle für den Konstruktionsnachweis. */
export interface MeasuredView {
  viewId: string;
  label: string;
  direction: ImageView['direction'];
  frontInImage: ImageView['frontInImage'];
  imageIndex: number;
  /** quelle = Vorgabe daraus abgeleitet; vergleich = gemessen, aber nicht verwendet; nur-ansicht = gezeigt, nicht gemessen; keine-quelle = entworfene Ansicht. */
  use: 'quelle' | 'vergleich' | 'nur-ansicht' | 'keine-quelle';
  /** Bildausschnitt in Pixeln des Originalbilds (für Messansichten: der gemessene Abschnitt). */
  rect: PixelRect;
  /** Gemessenes Umrissprofil des Abschnitts (normiert auf die Abschnittslänge), sonst null. */
  profile: Profile | null;
  note: string;
}

export interface TemplateMeasurement { target: BowTarget; views: MeasuredView[] }

interface ViewGeom { view: ImageView; crop: PixelRect; along: 'x' | 'y'; frontAtMin: boolean; mainBox: PixelRect; L: number }

function geom(b: DesignBrief, v: ImageView, mainGroupId: string): ViewGeom {
  const img = b.images[v.imageIndex];
  const px = (bx: { x: number; y: number; w: number; h: number }): PixelRect => ({ x0: Math.round(bx.x * img.width), y0: Math.round(bx.y * img.height), x1: Math.round((bx.x + bx.w) * img.width), y1: Math.round((bx.y + bx.h) * img.height) });
  const views = b.interpretation!.imageViews!.views;
  const main = b.interpretation!.groups.find((g) => g.id === mainGroupId)!;
  const mb = main.boxes.find((bx) => viewOfBox(bx, views)?.viewId === v.viewId);
  if (!mb) throw new TargetError(`Hauptkörper hat in der Ansicht „${v.label}“ keinen Bildbereich`);
  let along: 'x' | 'y';
  let frontAtMin: boolean;
  if (v.direction === 'oben' || v.direction === 'unten') {
    const f = v.frontInImage ?? 'oben';
    along = f === 'oben' || f === 'unten' ? 'y' : 'x';
    frontAtMin = f === 'oben' || f === 'links';
  } else {
    along = 'x';
    frontAtMin = (v.frontInImage ?? (v.direction === 'rechts' ? 'rechts' : 'links')) === 'links';
  }
  const mbox = px(mb);
  return { view: v, crop: px(v.box), along, frontAtMin, mainBox: mbox, L: along === 'x' ? mbox.x1 - mbox.x0 : mbox.y1 - mbox.y0 };
}

const de = (n: number, d = 2) => n.toFixed(d).replace('.', ',');

/**
 * Leitet die Formvorgabe ab. pixels(imageIndex) liefert die RGBA-Daten des Originalbilds (nur lokal im Browser).
 */
export function bowTargetFromTemplate(b: DesignBrief, pixels: (imageIndex: number) => Rgba, choice: TemplateChoice): TemplateMeasurement {
  const it = b.interpretation;
  if (!it?.imageViews?.views.length) throw new TargetError('Die Interpretation enthält keine Ansichten – zuerst Ansichten erfassen (Abschnitt „Ansichten in den Bildern“).');
  const views = it.imageViews.views.filter((v) => v.nature !== 'entwurf');
  const main = it.groups.find((g) => g.role === 'hauptkoerper');
  if (!main) throw new TargetError('Kein Hauptkörper in der Interpretation');
  const canopyGroup = it.groups.find((g) => g.id === choice.canopyGroupId);
  if (!canopyGroup) throw new TargetError(`Kanzel-Baugruppe „${choice.canopyGroupId}“ fehlt`);
  const top = views.find((v) => v.direction === 'oben');
  const side = views.find((v) => v.direction === 'links') ?? views.find((v) => v.direction === 'rechts');
  if (!top || !side) throw new TargetError('Benötigt werden eine Draufsicht und eine Seitenansicht (keine entworfenen Ansichten).');
  const alt = views.find((v) => (v.direction === 'links' || v.direction === 'rechts') && v !== side);
  const notes: string[] = [];
  const sources: TargetSource[] = [];
  const W = choice.widthStuds ?? 6;

  const gTop = geom(b, top, main.id);
  const gSide = geom(b, side, main.id);
  const center = (g: ViewGeom) => (g.along === 'y' ? (g.mainBox.x0 + g.mainBox.x1) / 2 : (g.mainBox.y0 + g.mainBox.y1) / 2);
  const span = (g: ViewGeom): [number, number] => (g.along === 'y' ? [g.mainBox.x0, g.mainBox.x1] : [g.mainBox.y0, g.mainBox.y1]);
  // Schwelle 40 und Lückenschluss bis 2 % der Rumpflänge: helle (sandfarbene) Teilflächen gehören zum Umriss
  // Öffnen mit Radius 2 entfernt Maß- und Hilfslinien (bis 4 Bildpunkte stark), bevor Lücken geschlossen werden
  const measure = (g: ViewGeom) => profileRuns(pixels(g.view.imageIndex), g.crop, g.along, center(g), { span: span(g), threshold: 40, maxGap: Math.round(0.02 * g.L), open: 2 });
  const runsTop = measure(gTop);
  const runsSide = measure(gSide);
  if (runsTop.length < 10 || runsSide.length < 10) throw new TargetError('Umriss in Drauf- oder Seitenansicht nicht messbar (zu wenige Objektpunkte)');
  const tipOf = (g: ViewGeom, runs: Run[]) => (g.frontAtMin ? Math.min(...runs.map((r) => r.pos)) : Math.max(...runs.map((r) => r.pos)));
  const tipTop = tipOf(gTop, runsTop);
  const tipSide = tipOf(gSide, runsSide);
  const dir = (g: ViewGeom) => (g.frontAtMin ? 1 : -1); // Richtung von der Spitze nach hinten
  const runAt = (runs: Run[], pos: number) => {
    let best: Run | null = null;
    for (const r of runs) if (Math.abs(r.pos - pos) <= 3 && (!best || Math.abs(r.pos - pos) < Math.abs(best.pos - pos))) best = r;
    return best;
  };

  // Kanzel in der Seitenansicht: Abstand ihrer Vorder- und Hinterkante von der Spitze (in L)
  const cbSide = canopyGroup.boxes.find((bx) => viewOfBox(bx, it.imageViews!.views)?.viewId === side.viewId);
  const cbTop = canopyGroup.boxes.find((bx) => viewOfBox(bx, it.imageViews!.views)?.viewId === top.viewId);
  if (!cbSide) throw new TargetError(`Kanzel „${canopyGroup.name}“ hat in der Seitenansicht „${side.label}“ keinen Bildbereich`);
  const img = b.images[side.imageIndex];
  const cs = { x0: cbSide.x * img.width, x1: (cbSide.x + cbSide.w) * img.width, y0: cbSide.y * img.height };
  const dFront = (Math.min(Math.abs(cs.x0 - tipSide), Math.abs(cs.x1 - tipSide))) / gSide.L;
  const dRear = (Math.max(Math.abs(cs.x0 - tipSide), Math.abs(cs.x1 - tipSide))) / gSide.L;
  const segL = dRear + 0.25 * (dRear - dFront);
  sources.push({ field: 'Abschnittslänge', source: `${side.label} (Ausschnitt ${side.viewId})`, method: `Spitze bis Kanzelende + 25 % der Kanzellänge = ${de(segL)} L` });

  // Maßstab aus der größten Breite im Abschnitt (Draufsicht)
  const widthL = (d: number) => { const r = runAt(runsTop, tipTop + dir(gTop) * d * gTop.L); return r ? (r.hi - r.lo) / gTop.L : 0; };
  const samples = Array.from({ length: 50 }, (_, k) => widthL(((k + 0.5) / 50) * segL));
  const maxW = Math.max(...samples);
  if (!(maxW > 0)) throw new TargetError('Keine Bugbreite messbar');
  const studsPerL = W / maxW;
  const rows = Math.max(4, Math.round(segL * studsPerL));
  sources.push({ field: 'Maßstab', source: `${top.label} (Ausschnitt ${top.viewId})`, method: `größte gezeichnete Bugbreite ${de(maxW)} L ≙ ${W} Noppen → ${de(studsPerL, 1)} Noppen je L (Länge und Höhe gleich skaliert)` });

  // Höhenprofil: Oberkante über der Rumpfunterkante (Median der Unterkanten im Abschnitt) in der gewählten Seitenansicht
  const sideRunsInSeg = runsSide.filter((r) => Math.abs(r.pos - tipSide) / gSide.L <= segL);
  const bottomRef = sideRunsInSeg.map((r) => r.hi).sort((a, c) => a - c)[sideRunsInSeg.length >> 1];
  const heightL = (runs: Run[], tip: number, g: ViewGeom, d: number, bottom: number) => { const r = runAt(runs, tip + dir(g) * d * g.L); return r ? Math.max(0, (bottom - r.lo) / g.L) : null; };
  const width: number[] = [];
  const topP: number[] = [];
  const dRow = (j: number) => (rows - j - 0.5) / studsPerL; // Abstand der Reihenmitte von der Spitze (L)
  const canopyRows = { from: Math.max(0, Math.round(rows - dRear * studsPerL)), to: Math.min(rows - 1, Math.round(rows - 1 - dFront * studsPerL)) };
  // Die Rumpfoberkante unter der Kanzel ist verdeckt (die Silhouette enthält dort die Kanzel). Angenommen:
  // eben in Höhe der Oberkante an der Kanzelvorderkante; die Kanzel ragt darüber hinaus.
  const hullUnderCanopy = heightL(runsSide, tipSide, gSide, Math.max(0, dFront - 0.01), bottomRef) ?? 0;
  let canopyTopL = 0;
  for (let j = 0; j < rows; j++) {
    width.push(Math.max(0.5, widthL(dRow(j)) * studsPerL));
    const h = heightL(runsSide, tipSide, gSide, dRow(j), bottomRef) ?? 0;
    if (j >= canopyRows.from && j <= canopyRows.to) { canopyTopL = Math.max(canopyTopL, h); topP.push(Math.max(0.5, Math.min(h, hullUnderCanopy) * studsPerL * 2.5)); }
    else topP.push(Math.max(0.5, h * studsPerL * 2.5));
  }
  sources.push({ field: 'Bugkontur', source: `${top.label} (Ausschnitt ${top.viewId}, Vorderseite ${top.frontInImage ?? '?'})`, method: 'Breite des Objektlaufs durch die Rumpfmittellinie je Reihe' });
  sources.push({ field: 'Höhenprofil', source: `${side.label} (Ausschnitt ${side.viewId})`, method: 'Oberkante des Objektlaufs über der Rumpfunterkante (Median im Abschnitt) je Reihe' });
  const cw = cbTop ? (cbTop.w * b.images[top.imageIndex].width) / gTop.L * studsPerL : 2;
  const canopyHeight = Math.max(0, (canopyTopL - hullUnderCanopy) * studsPerL * 2.5);
  sources.push({ field: 'Kanzel', source: `${canopyGroup.name}: Lage/Höhe aus ${side.label}, Breite aus ${cbTop ? top.label : '— (angenommen 2 Noppen)'}`, method: 'Bildbereiche der Kanzel-Baugruppe; Kanzelhöhe = höchster Punkt im Kanzelbereich über der (verdeckten, als eben angenommenen) Rumpfoberkante an der Kanzelvorderkante' });
  notes.push('Rumpfoberkante unter der Kanzel ist in der Vorlage verdeckt – eben in Höhe der Kanzelvorderkante angenommen');

  // Messprofile und Bildausschnitte für den Vergleich mit dem Teilemodell (Abschnitt Spitze … segL)
  const lenPx = (g: ViewGeom) => segL * g.L;
  const profileOf = (g: ViewGeom, runs: Run[], tip: number, kind: Profile['kind'], bottom: number): Profile => ({
    kind,
    samples: Array.from({ length: PROFILE_SAMPLES }, (_, s) => {
      const r = runAt(runs, tip + dir(g) * ((s + 0.5) / PROFILE_SAMPLES) * lenPx(g));
      if (!r) return null;
      return kind === 'breite' ? { lo: (r.lo - center(g)) / lenPx(g), hi: (r.hi - center(g)) / lenPx(g) } : { lo: (bottom - r.hi) / lenPx(g), hi: (bottom - r.lo) / lenPx(g) };
    }),
  });
  const segRect = (g: ViewGeom, tip: number): PixelRect => {
    const e = tip + dir(g) * lenPx(g);
    const pad = 0.04 * lenPx(g);
    const [q0, q1] = span(g);
    const qpad = 0.15 * (q1 - q0);
    const r = g.along === 'y'
      ? { x0: q0 - qpad, y0: Math.min(tip, e) - pad, x1: q1 + qpad, y1: Math.max(tip, e) + pad }
      : { x0: Math.min(tip, e) - pad, y0: q0 - qpad, x1: Math.max(tip, e) + pad, y1: q1 + qpad };
    return { x0: Math.round(Math.max(g.crop.x0, r.x0)), y0: Math.round(Math.max(g.crop.y0, r.y0)), x1: Math.round(Math.min(g.crop.x1, r.x1)), y1: Math.round(Math.min(g.crop.y1, r.y1)) };
  };
  const info = (v: ImageView) => ({ viewId: v.viewId, label: v.label, direction: v.direction, frontInImage: v.frontInImage, imageIndex: v.imageIndex });
  const measured: MeasuredView[] = [
    { ...info(top), use: 'quelle', rect: segRect(gTop, tipTop), profile: profileOf(gTop, runsTop, tipTop, 'breite', 0), note: 'Bugkontur und Maßstab' },
    { ...info(side), use: 'quelle', rect: segRect(gSide, tipSide), profile: profileOf(gSide, runsSide, tipSide, 'hoehe', bottomRef), note: 'Höhenprofil, Kanzellage und -höhe' },
  ];

  // Vergleich mit der anderen Seitenansicht – nicht gemittelt
  if (alt) {
    try {
      const gAlt = geom(b, alt, main.id);
      const runsAlt = measure(gAlt);
      const tipAlt = tipOf(gAlt, runsAlt);
      const inSeg = runsAlt.filter((r) => Math.abs(r.pos - tipAlt) / gAlt.L <= segL);
      const bottomAlt = inSeg.map((r) => r.hi).sort((a, c) => a - c)[inSeg.length >> 1];
      let maxDiff = 0;
      for (let j = 0; j < rows; j++) {
        const h1 = heightL(runsSide, tipSide, gSide, dRow(j), bottomRef);
        const h2 = heightL(runsAlt, tipAlt, gAlt, dRow(j), bottomAlt);
        if (h1 !== null && h2 !== null) maxDiff = Math.max(maxDiff, Math.abs(h1 - h2));
      }
      notes.push(`Höhenprofil aus „${side.label}“; „${alt.label}“ weicht im Abschnitt um bis zu ${de(maxDiff)} L (${de(maxDiff * studsPerL * 2.5, 1)} Plattenhöhen) ab – nicht gemittelt`);
      measured.push({ ...info(alt), use: 'vergleich', rect: segRect(gAlt, tipAlt), profile: profileOf(gAlt, runsAlt, tipAlt, 'hoehe', bottomAlt), note: `gemessen, nicht gemittelt (Abweichung bis ${de(maxDiff * studsPerL * 2.5, 1)} Plattenhöhen)` });
    } catch (e) {
      notes.push(`Vergleichsansicht „${alt.label}“ nicht messbar: ${(e as Error).message}`);
    }
  }
  const front = views.find((v) => v.direction === 'vorne');
  if (front) notes.push(`Frontansicht „${front.label}“ nur zum Vergleich (Breite : Höhe), nicht als Vorgabe verwendet`);
  const whole = (v: ImageView): PixelRect => { const im = b.images[v.imageIndex]; return { x0: Math.round(v.box.x * im.width), y0: Math.round(v.box.y * im.height), x1: Math.round((v.box.x + v.box.w) * im.width), y1: Math.round((v.box.y + v.box.h) * im.height) }; };
  for (const v of views.filter((x) => x.direction === 'vorne' || x.direction === 'hinten'))
    measured.push({ ...info(v), use: 'nur-ansicht', rect: whole(v), profile: null, note: v.direction === 'vorne' ? 'zeigt das ganze Objekt (mit Gondeln und Turm) – nur qualitativ vergleichbar' : 'Heck des ganzen Objekts – der Bugabschnitt endet hinten mit einer Schnittfläche, nicht vergleichbar' });
  for (const v of it.imageViews.views.filter((x) => x.nature === 'entwurf')) measured.push({ ...info(v), use: 'keine-quelle', rect: whole(v), profile: null, note: 'entworfene Ansicht der Vorlage – keine Konstruktionsquelle' });
  for (const v of it.imageViews.views.filter((x) => x.nature === 'entwurf')) notes.push(`„${v.label}“ ist eine entworfene Ansicht – keine Konstruktionsquelle`);
  for (const v of it.imageViews.views) for (const a of v.annotations.filter((x) => x.kind === 'mass')) notes.push(`Beschriftung „${a.text}“ („${v.label}“) ist eine Angabe der Vorlage und wurde nicht als Maß übernommen`);
  notes.push(`Herkunft der Ansichtszuordnung: ${viewAssignmentOrigin(b).text}`);

  const target: BowTarget = {
    schema: SHAPE_TARGET_SCHEMA, kind: 'bow-with-canopy', label: `${b.title || 'Vorlage'} – Bug und Kanzel`,
    origin: { kind: 'template-measurement', description: `Gemessen aus „${top.label}“ und „${side.label}“ der Vorlage (Bild ${b.images[side.imageIndex].sha256.slice(0, 12)}…)`, imageSha256: b.images[side.imageIndex].sha256 },
    studsPerL, rows, width, top: topP,
    canopy: canopyRows.to - canopyRows.from >= 1 ? { fromRow: canopyRows.from, toRow: canopyRows.to, width: Math.max(2, cw), height: Math.max(1, canopyHeight) } : null,
    sources, notes,
  };
  return { target, views: measured };
}
