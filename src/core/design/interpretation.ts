// Räumliche Interpretation einer Bildvorlage (Stufe 1–2 der Zielarchitektur A18).
//
// Jede Aussage trägt ihre Grundlage:
//   observed = im Bild beobachtet, assumed = konstruktiv angenommen, user = vom Nutzer vorgegeben.
// Ein Bild belegt weder Rückseite noch Innenkonstruktion, reale Abmessungen, Teilenummern oder
// Stabilität. Die Prüfung unten weist Widersprüche zurück, statt sie stillschweigend zu glätten.
import { z } from 'zod';

export const INTERPRETATION_SCHEMA = 'baustein-sim/image-interpretation@1';

export const Basis = z.enum(['observed', 'assumed', 'user']);
export type Basis = z.infer<typeof Basis>;
export const BASIS_LABEL: Record<Basis, string> = { observed: 'im Bild beobachtet', assumed: 'konstruktiv angenommen', user: 'vom Nutzer vorgegeben' };

/** Bildbereich, normiert auf 0…1 (x nach rechts, y nach unten) im Bild mit Index imageIndex. */
export const ImageBox = z.object({ imageIndex: z.number().int(), x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const Group = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['hauptkoerper', 'baugruppe', 'detail']),
  description: z.string(),
  basis: Basis,
  boxes: z.array(ImageBox),
  /** Relative Größe bezogen auf den Hauptkörper (Hauptkörper = 1 in jeder Richtung); keine realen Maße. */
  relativeSize: z.object({ length: z.number(), width: z.number(), height: z.number() }),
  colorIds: z.array(z.string()),
  confidence: z.enum(['hoch', 'mittel', 'niedrig']),
});
export type Group = z.infer<typeof Group>;

export const Interpretation = z.object({
  subject: z.string(),
  summary: z.string(),
  silhouette: z.object({ description: z.string(), aspectWidthToHeight: z.number(), basis: Basis }),
  groups: z.array(Group),
  colors: z.array(z.object({ id: z.string(), name: z.string(), hex: z.string(), areaShare: z.number(), basis: Basis })),
  features: z.array(z.object({ id: z.string(), description: z.string(), basis: Basis, groupIds: z.array(z.string()) })),
  symmetry: z.object({ kind: z.enum(['keine', 'links-rechts', 'vorn-hinten', 'rotation', 'unklar']), basis: Basis, note: z.string() }),
  hiddenAreas: z.array(z.object({ description: z.string(), basis: Basis })),
  openQuestions: z.array(z.object({ id: z.string(), question: z.string() })),
  /** Merkmale, die mit dem unterstützten Teileumfang vermutlich nur vereinfacht darstellbar sind. */
  simplifications: z.array(z.object({ feature: z.string(), reason: z.string() })),
  /** Was sich aus dem Bild ausdrücklich nicht ableiten lässt. */
  notInferable: z.array(z.string()),
});
export type Interpretation = z.infer<typeof Interpretation>;

export interface InterpretationCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Prüft Struktur und Widerspruchsfreiheit einer Interpretation – unabhängig davon, ob sie vom
 * Analysedienst, aus einer importierten Datei oder aus manueller Eingabe stammt.
 */
export function checkInterpretation(raw: unknown, imageCount: number): InterpretationCheck & { value: Interpretation | null } {
  const parsed = Interpretation.safeParse(raw);
  if (!parsed.success)
    return { ok: false, value: null, warnings: [], errors: parsed.error.issues.slice(0, 20).map((i) => `Struktur: ${i.path.join('.') || '(Wurzel)'} – ${i.message}`) };
  const v = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const dup = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id.trim()) errors.push(`${what}: leere Kennung`);
      else if (seen.has(id)) errors.push(`${what}: Kennung „${id}“ doppelt`);
      seen.add(id);
    }
  };
  dup(v.groups.map((g) => g.id), 'Baugruppen');
  dup(v.colors.map((c) => c.id), 'Farben');
  dup(v.features.map((f) => f.id), 'Merkmale');
  dup(v.openQuestions.map((q) => q.id), 'Offene Fragen');
  const colorIds = new Set(v.colors.map((c) => c.id));
  const groupIds = new Set(v.groups.map((g) => g.id));
  const mains = v.groups.filter((g) => g.role === 'hauptkoerper');
  if (mains.length !== 1) errors.push(`Genau ein Hauptkörper erwartet, gefunden: ${mains.length}`);
  if (!(v.silhouette.aspectWidthToHeight > 0)) errors.push('Silhouette: Seitenverhältnis muss größer als 0 sein');
  for (const g of v.groups) {
    for (const c of g.colorIds) if (!colorIds.has(c)) errors.push(`Baugruppe „${g.name}“ verweist auf unbekannte Farbe „${c}“`);
    for (const k of ['length', 'width', 'height'] as const) if (!(g.relativeSize[k] > 0)) errors.push(`Baugruppe „${g.name}“: relative ${k === 'length' ? 'Länge' : k === 'width' ? 'Breite' : 'Höhe'} muss größer als 0 sein`);
    for (const b of g.boxes) {
      if (b.imageIndex < 0 || b.imageIndex >= imageCount) errors.push(`Baugruppe „${g.name}“: Bildbereich verweist auf Bild ${b.imageIndex + 1}, vorhanden sind ${imageCount}`);
      if (b.x < 0 || b.y < 0 || b.w <= 0 || b.h <= 0 || b.x + b.w > 1.0001 || b.y + b.h > 1.0001) errors.push(`Baugruppe „${g.name}“: Bildbereich liegt außerhalb des Bildes (Werte 0…1 erwartet)`);
    }
    // Widerspruch: „beobachtet“ ohne zugehörigen Bildbereich
    if (g.basis === 'observed' && g.boxes.length === 0) errors.push(`Baugruppe „${g.name}“ ist als beobachtet markiert, hat aber keinen Bildbereich`);
  }
  if (mains.length === 1) {
    const m = mains[0];
    if (m.relativeSize.length !== 1 || m.relativeSize.width !== 1 || m.relativeSize.height !== 1) errors.push('Hauptkörper muss die Bezugsgröße 1 × 1 × 1 haben (alle anderen Größen sind relativ dazu)');
  }
  for (const c of v.colors) {
    if (!HEX.test(c.hex)) errors.push(`Farbe „${c.name}“: Farbwert „${c.hex}“ ist kein #RRGGBB`);
    if (c.areaShare < 0 || c.areaShare > 1) errors.push(`Farbe „${c.name}“: Flächenanteil ${c.areaShare} außerhalb 0…1`);
  }
  const share = v.colors.reduce((a, c) => a + c.areaShare, 0);
  if (share > 1.05) errors.push(`Flächenanteile der Farben ergeben ${(share * 100).toFixed(0)} % (mehr als 100 %)`);
  for (const f of v.features) for (const g of f.groupIds) if (!groupIds.has(g)) errors.push(`Merkmal „${f.description}“ verweist auf unbekannte Baugruppe „${g}“`);
  // Widerspruch: verdeckter Bereich kann nicht beobachtet sein
  for (const h of v.hiddenAreas) if (h.basis === 'observed') errors.push(`Verdeckter Bereich „${h.description}“ ist als „beobachtet“ markiert – verdeckte Bereiche können nur angenommen oder vorgegeben sein`);
  if (v.groups.length === 0) errors.push('Keine Baugruppe beschrieben');
  // Grenzen eines Einzelbildes: reale Maße und Teilenummern sind nicht ableitbar
  const texts = [v.summary, v.silhouette.description, ...v.groups.map((g) => g.description), ...v.features.map((f) => f.description)];
  if (texts.some((t) => /\b\d+([.,]\d+)?\s?(mm|cm|m)\b/.test(t))) warnings.push('Die Beschreibung nennt reale Maße – ein Bild belegt keine realen Abmessungen. Bitte als Annahme behandeln oder entfernen.');
  if (texts.some((t) => /\b(teil(e)?nummer|part\s?(no|number)|element\s?id)\b/i.test(t))) warnings.push('Die Beschreibung nennt Teilenummern – ein Bild belegt keine konkreten Teile.');
  if (imageCount === 1 && v.hiddenAreas.length === 0) warnings.push('Bei einem einzelnen Bild sind Rückseite und Innenkonstruktion verdeckt – es ist kein verdeckter Bereich eingetragen.');
  return { ok: errors.length === 0, value: v, errors, warnings };
}

/** Vorlage für den manuellen Interpretationsweg: ein Hauptkörper, sonst leer – alle Angaben vom Nutzer. */
export function manualInterpretationTemplate(): Interpretation {
  return {
    subject: '',
    summary: '',
    silhouette: { description: '', aspectWidthToHeight: 1, basis: 'user' },
    groups: [{ id: 'g1', name: 'Hauptkörper', role: 'hauptkoerper', description: '', basis: 'user', boxes: [], relativeSize: { length: 1, width: 1, height: 1 }, colorIds: [], confidence: 'mittel' }],
    colors: [],
    features: [],
    symmetry: { kind: 'unklar', basis: 'user', note: '' },
    hiddenAreas: [{ description: 'Rückseite und Innenkonstruktion (aus der Vorlage nicht erkennbar)', basis: 'assumed' }],
    openQuestions: [],
    simplifications: [],
    notInferable: ['reale Abmessungen', 'konkrete Teilenummern', 'Innenkonstruktion', 'mechanische Stabilität'],
  };
}
