// Mehrere Ansichten in einer Bilddatei (Auftrag 05A.5), Schema „baustein-sim/image-views@1“.
//
// Eine Bilddatei kann mehrere beschriftete Ansichten desselben Objekts enthalten (z. B. eine Tafel mit
// Oben, Unten, Seiten, Vorne, Hinten). Jede Ansicht ist ein normierter Ausschnitt eines Originalbilds
// (Bezug über Bildindex UND Prüfsumme) mit Blickrichtung, Orientierung, Art und Herkunft der Zuordnung.
// Baugruppen bleiben objektbezogen: EINE Baugruppe je physischem Teil, mit Bildbereichen in jeder
// Ansicht, in der sie sichtbar ist (ImageBox.viewId). Sechs Ansichten erzeugen keine sechs Rümpfe.
//
// Beschriftungen der Vorlage (z. B. „B ≈ 0,72 L“) sind Angaben der Vorlage, keine geprüften Maße.
import { z } from 'zod';
import type { Interpretation } from './interpretation';

export const IMAGE_VIEWS_SCHEMA = 'baustein-sim/image-views@1';

export const VIEW_DIRECTIONS = ['vorne', 'hinten', 'links', 'rechts', 'oben', 'unten', 'schraeg', 'unbekannt'] as const;
export type ViewDirection = (typeof VIEW_DIRECTIONS)[number];
export const VIEW_DIRECTION_LABEL: Record<ViewDirection, string> = { vorne: 'von vorn', hinten: 'von hinten', links: 'linke Seite', rechts: 'rechte Seite', oben: 'von oben', unten: 'von unten', schraeg: 'schräg (perspektivisch)', unbekannt: 'Richtung unbekannt' };
export const ORTHO_DIRECTIONS: readonly ViewDirection[] = ['vorne', 'hinten', 'links', 'rechts', 'oben', 'unten'];

export const NATURE_LABEL = { darstellung: 'Darstellung des Objekts', entwurf: 'entworfene Ansicht (kein Beleg)', unbekannt: 'Art unbekannt' } as const;

/** Bildausschnitt, normiert auf 0…1 im Originalbild (x nach rechts, y nach unten). */
export const ViewBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type ViewBox = z.infer<typeof ViewBox>;

export const ImageViewSchema = z.object({
  /** Stabile Kennung innerhalb der Interpretation (bleibt bei Korrekturen erhalten). */
  viewId: z.string(),
  imageIndex: z.number().int(),
  /** Prüfsumme des Originalbilds; wird beim Übernehmen aus dem tatsächlichen Bildbezug gesetzt. */
  imageSha256: z.string().optional(),
  box: ViewBox,
  /** Beschriftung in der Vorlage, wörtlich (z. B. „UNTEN · ENTWURF“). */
  label: z.string(),
  direction: z.enum(VIEW_DIRECTIONS),
  /** Wohin die Vorderseite des Objekts im Ausschnitt zeigt (Orientierung); null = nicht erkennbar. */
  frontInImage: z.enum(['links', 'rechts', 'oben', 'unten']).nullable(),
  /** darstellung = zeigt das Objekt; entwurf = in der Vorlage ausdrücklich entworfen/ergänzt (kein Beleg). */
  nature: z.enum(['darstellung', 'entwurf', 'unbekannt']),
  /** Angaben der Vorlage im Ausschnitt, wörtlich – Maße sind Behauptungen der Vorlage, keine geprüften Maße. */
  annotations: z.array(z.object({ text: z.string(), kind: z.enum(['mass', 'beschriftung', 'hinweis']) })),
  /** Herkunft der Zuordnung: observed = aus Bild/Beschriftung erkannt, assumed = vermutet, user = vom Nutzer. */
  basis: z.enum(['observed', 'assumed', 'user']),
  uncertainty: z.enum(['hoch', 'mittel', 'niedrig']),
  note: z.string(),
});
export type ImageView = z.infer<typeof ImageViewSchema>;

export const ImageViewsSchema = z.object({ schema: z.literal(IMAGE_VIEWS_SCHEMA), views: z.array(ImageViewSchema) });
export type ImageViews = z.infer<typeof ImageViewsSchema>;

export interface ImageInfo { sha256: string; width: number; height: number }

const inside = (b: { x: number; y: number; w: number; h: number }, v: ViewBox, tol = 0.01) => b.x >= v.x - tol && b.y >= v.y - tol && b.x + b.w <= v.x + v.w + tol && b.y + b.h <= v.y + v.h + tol;
const overlap = (a: ViewBox, b: ViewBox) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Ansicht, zu der ein Bildbereich gehört: ausdrücklich (viewId) oder über Lage im Ausschnitt. */
export function viewOfBox(box: { imageIndex: number; x: number; y: number; w: number; h: number; viewId?: string | null }, views: ImageView[]): ImageView | null {
  if (box.viewId) return views.find((v) => v.viewId === box.viewId) ?? null;
  const cands = views.filter((v) => v.imageIndex === box.imageIndex && inside(box, v.box));
  return cands.sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0] ?? null;
}

const stem = (name: string) => name.toLowerCase().replace(/\(.*?\)/g, '').replace(/\b(oben|unten|vorne?|hinten|links|rechts|seite|seitlich|ansicht|draufsicht|untersicht|front|heck|entwurf|linke|rechte)\b/g, '').replace(/[^a-zäöüß]+/g, ' ').trim();

/**
 * Strukturelle Prüfung der Ansichten (ergänzt checkInterpretation). Fehler: ungültige Ausschnitte, unbekannte
 * Ansicht in Bildbereichen, Bildbereich außerhalb seiner Ansicht, Prüfsumme passt nicht zum Bild.
 * Hinweise: überlappende Ansichten, doppelte Richtungen, vermutlich mehrfach erfasste Baugruppen.
 */
export function checkViews(interp: Pick<Interpretation, 'groups' | 'imageViews'>, imageCount: number, imageShas?: readonly string[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const views = interp.imageViews?.views ?? [];
  const ids = new Set<string>();
  for (const v of views) {
    const name = `Ansicht „${v.label || v.viewId}“`;
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(v.viewId)) errors.push(`${name}: Kennung „${v.viewId}“ ungültig (Buchstaben, Ziffern, _ und -)`);
    if (ids.has(v.viewId)) errors.push(`${name}: Kennung „${v.viewId}“ doppelt`);
    ids.add(v.viewId);
    if (v.imageIndex < 0 || v.imageIndex >= imageCount) errors.push(`${name} verweist auf Bild ${v.imageIndex + 1}, vorhanden sind ${imageCount}`);
    const b = v.box;
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.x < 0 || b.y < 0 || b.w <= 0 || b.h <= 0 || b.x + b.w > 1.0001 || b.y + b.h > 1.0001) errors.push(`${name}: Ausschnitt liegt außerhalb des Bildes (Werte 0…1 erwartet)`);
    if (imageShas && v.imageSha256 && imageShas[v.imageIndex] && v.imageSha256 !== imageShas[v.imageIndex]) errors.push(`${name} gehört zu Bild ${v.imageSha256.slice(0, 12)}…, an dieser Stelle liegt jetzt ${imageShas[v.imageIndex].slice(0, 12)}… – Ausschnitt neu zuordnen`);
    if ((v.direction === 'links' && v.frontInImage === 'rechts') || (v.direction === 'rechts' && v.frontInImage === 'links')) warnings.push(`${name}: Bei einer ${VIEW_DIRECTION_LABEL[v.direction]} zeigt die Vorderseite ${v.direction === 'links' ? 'nach links' : 'nach rechts'} – angegeben ist ${v.frontInImage}. Gespiegelt oder Seite vertauscht?`);
  }
  for (let i = 0; i < views.length; i++)
    for (let j = i + 1; j < views.length; j++) {
      const a = views[i];
      const c = views[j];
      if (a.imageIndex === c.imageIndex && overlap(a.box, c.box) > 0.2 * Math.min(a.box.w * a.box.h, c.box.w * c.box.h)) warnings.push(`Ansichten „${a.label}“ und „${c.label}“ überlappen sich deutlich – Ausschnitte prüfen`);
      if (a.direction === c.direction && ORTHO_DIRECTIONS.includes(a.direction) && a.nature !== 'entwurf' && c.nature !== 'entwurf') warnings.push(`Zwei Ansichten ${VIEW_DIRECTION_LABEL[a.direction]}: „${a.label}“ und „${c.label}“`);
    }
  for (const g of interp.groups)
    for (const bx of g.boxes) {
      if (bx.viewId && !ids.has(bx.viewId)) errors.push(`Baugruppe „${g.name}“: Bildbereich verweist auf unbekannte Ansicht „${bx.viewId}“`);
      const v = bx.viewId ? views.find((x) => x.viewId === bx.viewId) : null;
      if (v && (v.imageIndex !== bx.imageIndex || !inside(bx, v.box))) errors.push(`Baugruppe „${g.name}“: Bildbereich liegt nicht in der Ansicht „${v.label}“`);
      if (!bx.viewId && views.some((x) => x.imageIndex === bx.imageIndex) && !viewOfBox(bx, views)) warnings.push(`Baugruppe „${g.name}“: Bildbereich in Bild ${bx.imageIndex + 1} liegt in keiner Ansicht`);
    }
  // Dieselbe Baugruppe je Ansicht einzeln erfasst? (gleicher Namensstamm, Bildbereiche nur in verschiedenen Ansichten)
  if (views.length > 1) {
    const only = new Map<string, { g: string; view: string }[]>();
    for (const g of interp.groups) {
      const vs = new Set(g.boxes.map((bx) => viewOfBox(bx, views)?.viewId ?? '?'));
      if (vs.size !== 1 || vs.has('?')) continue;
      const s = stem(g.name);
      if (!s) continue;
      only.set(s, [...(only.get(s) ?? []), { g: g.name, view: [...vs][0] }]);
    }
    for (const list of only.values()) if (new Set(list.map((x) => x.view)).size > 1) warnings.push(`Vermutlich dieselbe Baugruppe mehrfach erfasst (je Ansicht einzeln): ${list.map((x) => `„${x.g}“`).join(', ')} – Baugruppen zusammenführen, damit jedes Teil nur einmal vorkommt`);
  }
  return { errors, warnings };
}

// ---- Widersprüche: Angaben der Vorlage untereinander und gegenüber der Zeichnung

/** Liest Verhältnisangaben wie „B ≈ 0,72 L“, „H = 0,38 L“, „L = 1,00“ aus Beschriftungen der Vorlage. */
export function parseRatioAnnotations(texts: string[]): { quantity: 'L' | 'B' | 'H'; value: number; text: string }[] {
  const out: { quantity: 'L' | 'B' | 'H'; value: number; text: string }[] = [];
  for (const t of texts) {
    const m = t.replace(/\s+/g, ' ').match(/\b([LBH])\s*(?:≈|=|~|ca\.?)\s*([0-9]+(?:[.,][0-9]+)?)\s*(L)?\b/i);
    if (!m) continue;
    const q = m[1].toUpperCase() as 'L' | 'B' | 'H';
    const v = Number(m[2].replace(',', '.'));
    if (!Number.isFinite(v)) continue;
    if (q !== 'L' && !m[3]) continue; // B und H nur als Vielfaches von L
    out.push({ quantity: q, value: v, text: t.trim() });
  }
  return out;
}

/** Welche Objektachse zeigt in einer Ansicht nach rechts bzw. nach unten im Bild (Vorzeichen egal: nur Ausdehnungen). */
function screenAxes(v: ImageView): { right: 'L' | 'B' | 'H'; down: 'L' | 'B' | 'H' } | null {
  switch (v.direction) {
    case 'links':
    case 'rechts':
      return { right: 'L', down: 'H' };
    case 'vorne':
    case 'hinten':
      return { right: 'B', down: 'H' };
    case 'oben':
    case 'unten':
      return v.frontInImage === 'links' || v.frontInImage === 'rechts' ? { right: 'L', down: 'B' } : { right: 'B', down: 'L' };
    default:
      return null;
  }
}

const de2 = (n: number) => n.toFixed(2).replace('.', ',');

/**
 * Widersprüche zwischen Ansichten und Beschriftungen, nur als Hinweise (eine Vorlage ist kein Messbeleg):
 * - gleiche Größe in verschiedenen Ansichten unterschiedlich beschriftet,
 * - beschriftetes Verhältnis weicht von der gezeichneten Gesamtausdehnung des Objekts in dieser Ansicht ab (> 15 %),
 * - gezeichnete Verhältnisse verschiedener Ansichten passen nicht zueinander (> 15 %).
 * Entworfene Ansichten werden genannt, aber nicht als Beleg verglichen.
 */
export function viewContradictions(interp: Pick<Interpretation, 'groups' | 'imageViews'>, images: readonly ImageInfo[]): string[] {
  const out: string[] = [];
  const views = interp.imageViews?.views ?? [];
  const stated = new Map<string, { value: number; view: string }[]>();
  for (const v of views) for (const a of parseRatioAnnotations(v.annotations.map((x) => x.text))) if (a.quantity !== 'L') stated.set(a.quantity, [...(stated.get(a.quantity) ?? []), { value: a.value, view: v.label }]);
  for (const [q, list] of stated) {
    const vals = [...new Set(list.map((x) => x.value))];
    if (vals.length > 1) out.push(`Vorlage widersprüchlich beschriftet: ${q} = ${list.map((x) => `${de2(x.value)} L („${x.view}“)`).join(', ')}`);
  }
  // Gezeichnete Ausdehnung des ganzen Objekts je Ansicht (Vereinigung aller Bildbereiche in dieser Ansicht)
  const drawn = new Map<string, Partial<Record<'L' | 'B' | 'H', number>>>();
  for (const v of views) {
    const ax = screenAxes(v);
    const img = images[v.imageIndex];
    if (!ax || !img) continue;
    const boxes = interp.groups.flatMap((g) => g.boxes.filter((bx) => viewOfBox(bx, views)?.viewId === v.viewId));
    if (!boxes.length) continue;
    const x0 = Math.min(...boxes.map((b) => b.x));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    drawn.set(v.viewId, { [ax.right]: (x1 - x0) * img.width, [ax.down]: (y1 - y0) * img.height });
  }
  const ratio = (d: Partial<Record<'L' | 'B' | 'H', number>>, q: 'B' | 'H', ref: 'L' | 'B' | 'H') => (d[q] !== undefined && d[ref] !== undefined ? d[q]! / d[ref]! : null);
  for (const v of views) {
    const d = drawn.get(v.viewId);
    if (!d) continue;
    const tag = v.nature === 'entwurf' ? ' (entworfene Ansicht)' : '';
    for (const a of parseRatioAnnotations(v.annotations.map((x) => x.text))) {
      if (a.quantity === 'L') continue;
      // Verhältnis zu L direkt, sonst über das zweite beschriftete Maß in derselben Ansicht (z. B. vorn: B und H)
      let measured = ratio(d, a.quantity, 'L');
      let expected = a.value;
      let unit = 'L';
      if (measured === null) {
        const other = parseRatioAnnotations(v.annotations.map((x) => x.text)).find((o) => o.quantity !== a.quantity && o.quantity !== 'L');
        if (other && a.quantity === 'H') { measured = ratio(d, 'H', other.quantity); expected = a.value / other.value; unit = other.quantity; }
      }
      if (measured === null) continue;
      if (Math.abs(measured / expected - 1) > 0.15) out.push(`„${v.label}“${tag}: beschriftet ${a.text}, gezeichnet ≈ ${de2(measured)} ${unit === 'L' ? 'L' : `× ${unit}`}${unit === 'L' ? '' : ` (beschriftet ${de2(expected)} × ${unit})`} – Beschriftung und Zeichnung passen nicht zusammen`);
    }
  }
  // Gezeichnete Verhältnisse zwischen Ansichten (nur Darstellungen)
  const est: Record<'B' | 'H', { v: number; view: string }[]> = { B: [], H: [] };
  for (const v of views) {
    if (v.nature === 'entwurf') continue;
    const d = drawn.get(v.viewId);
    if (!d) continue;
    for (const q of ['B', 'H'] as const) { const r = ratio(d, q, 'L'); if (r !== null) est[q].push({ v: r, view: v.label }); }
  }
  for (const q of ['B', 'H'] as const) {
    const l = est[q];
    if (l.length > 1) {
      const lo = l.reduce((a, b) => (b.v < a.v ? b : a));
      const hi = l.reduce((a, b) => (b.v > a.v ? b : a));
      if (hi.v / lo.v > 1.15) out.push(`Gezeichnete ${q === 'B' ? 'Breite' : 'Höhe'} relativ zur Länge weicht zwischen Ansichten ab: ${de2(lo.v)} L („${lo.view}“) bis ${de2(hi.v)} L („${hi.view}“)`);
    }
  }
  for (const v of views) if (v.nature === 'entwurf') out.push(`„${v.label}“ ist eine entworfene Ansicht – kein Beleg für die tatsächliche Form; nicht als Messgrundlage verwendet.`);
  return out;
}

/** Bildbezug setzen: jede Ansicht erhält die Prüfsumme des Bildes, auf das sie sich tatsächlich bezieht. */
export function bindViews<T extends Pick<Interpretation, 'imageViews'>>(interp: T, imageHashes: readonly string[]): T {
  if (!interp.imageViews) return interp;
  return { ...interp, imageViews: { ...interp.imageViews, views: interp.imageViews.views.map((v) => ({ ...v, imageSha256: v.imageSha256 ?? imageHashes[v.imageIndex] })) } };
}

/** Standardansicht für ein Bild ohne erkannte Ansichten (eine Ansicht = ganzes Bild); nur als Vorschlag, Grundlage „assumed“. */
export function wholeImageView(imageIndex: number, sha: string, viewId: string): ImageView {
  return { viewId, imageIndex, imageSha256: sha, box: { x: 0, y: 0, w: 1, h: 1 }, label: `Bild ${imageIndex + 1}`, direction: 'unbekannt', frontInImage: null, nature: 'unbekannt', annotations: [], basis: 'assumed', uncertainty: 'hoch', note: 'ganzes Bild als eine Ansicht angenommen' };
}
