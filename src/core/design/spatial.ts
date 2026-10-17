// Räumlicher Entwurf (Auftrag 05B.0): Zwischenstufe zwischen bestätigter Bildinterpretation und späterer
// Bausteinkonstruktion. Er beschreibt das Objekt aus einfachen Körpern (Quader, Keil, Zylinder, verjüngter
// Körper) in einem gemeinsamen Koordinatensystem und enthält ausdrücklich KEINE Teilinstanzen.
//
// Koordinatensystem (rechtshändig, Sicht des Objekts):
//   +x = vorn, −x = hinten · +y = links, −y = rechts · +z = oben, −z = unten.
// Maßstab: Länge des Hauptkörpers = 1; Breite und Höhe sind echte Verhältnisse zu dieser Länge
// (keine getrennte Normierung je Achse). Reale Maße sind unbekannt, solange kein Maßstab gesetzt ist;
// ein gesetzter Maßstab ist eine Zielvorgabe des Nutzers, kein aus dem Bild gemessenes Maß.
//
// Grundlage jeder räumlichen Angabe:
//   image-derived = aus Bildbereichen geschätzt (perspektivisch, kein Geometriebeleg),
//   assumed = angenommen (z. B. Tiefe, verdeckte Seiten), user = vom Nutzer gesetzt.
// Eine KI-Schätzung ist nie „beobachtet“: es gibt diese Grundlage im räumlichen Entwurf nicht.
import { z } from 'zod';
import { cyrb53, stableStringify } from '../model/hash';
import type { DesignBrief } from './brief';
import { analysisBound } from './brief';
import { checkInterpretation, type Interpretation } from './interpretation';
import { modelBounds, projectBody, VIEW_BY_ID, type ViewId } from './projection';

export const SPATIAL_SCHEMA = 'baustein-sim/spatial-design@1';
export const SPATIAL_METHOD_VERSION = 'spatial-proposal@1.0.0';
export const SPATIAL_LABEL = 'Räumlicher Entwurf – noch keine Steine, Baubarkeit ungeprüft';
/** 1 Steinhöhe = 1,2 Noppenraster (9,6 mm zu 8 mm). */
export const BRICK_HEIGHT_IN_STUDS = 1.2;

export const AXIS_TEXT = {
  x: 'x: vorn (+) / hinten (−)',
  y: 'y: links (+) / rechts (−), aus Sicht des Objekts',
  z: 'z: oben (+) / unten (−)',
  unit: 'Einheit: Länge des Hauptkörpers = 1 (alle Achsen gleich skaliert)',
};

const Finite = z.number().refine(Number.isFinite, 'keine endliche Zahl');
const IsoTime = z.string().refine((t) => !Number.isNaN(Date.parse(t)), 'kein gültiger Zeitpunkt');
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'kein Farbwert #RRGGBB');
export const Vec3Schema = z.object({ x: Finite, y: Finite, z: Finite });
export type Vec3 = z.infer<typeof Vec3Schema>;

export const SpatialBasis = z.enum(['image-derived', 'assumed', 'user']);
export type SpatialBasis = z.infer<typeof SpatialBasis>;
export const SPATIAL_BASIS_LABEL: Record<SpatialBasis, string> = { 'image-derived': 'aus Bild geschätzt', assumed: 'angenommen', user: 'vom Nutzer gesetzt' };

export const SHAPES = ['box', 'wedge', 'cylinder', 'taper'] as const;
export const SHAPE_LABEL: Record<(typeof SHAPES)[number], string> = { box: 'Quader', wedge: 'Keil', cylinder: 'Zylinder', taper: 'verjüngter Körper' };

export const SpatialBodySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Kennung nur aus Buchstaben, Ziffern, _ und - (1–40 Zeichen)'),
  name: z.string().min(1),
  /** Bezug zur Baugruppe der Bildinterpretation (null = ergänzter Körper, z. B. angenommene Verbindung). */
  groupId: z.string().nullable(),
  /** Hauptkörper: seine Länge ist die Einheit 1. */
  isMain: z.boolean(),
  shape: z.enum(SHAPES),
  center: Vec3Schema,
  /** Ausdehnung entlang lokal x (Länge), y (Breite), z (Höhe) – vor der Drehung. */
  size: z.object({ length: Finite, width: Finite, height: Finite }),
  /** Grad; R = Rz(Gieren) · Ry(Nicken) · Rx(Rollen), rechte-Hand-Regel. */
  rotation: z.object({ yaw: Finite, pitch: Finite, roll: Finite }),
  /** Verjüngung der Vorderseite 0…1 (Keil: Vorderhöhe; verjüngter Körper/Zylinder: Vorderquerschnitt); Quader: 1. */
  taper: Finite,
  color: Hex,
  basis: z.object({ position: SpatialBasis, size: SpatialBasis, rotation: SpatialBasis, shape: SpatialBasis, color: SpatialBasis }),
  assumptions: z.array(z.string()),
  uncertainty: z.enum(['hoch', 'mittel', 'niedrig']),
  /** Spiegelbild (links-rechts) eines anderen Körpers; folgt ihm bei jeder Änderung. */
  mirrorOf: z.string().nullable(),
});
export type SpatialBody = z.infer<typeof SpatialBodySchema>;

export const REF_DIRECTIONS = ['vorne', 'hinten', 'links', 'rechts', 'oben', 'unten', 'schraeg', 'unbekannt'] as const;
export type RefDirection = (typeof REF_DIRECTIONS)[number];
export const REF_DIRECTION_LABEL: Record<RefDirection, string> = { vorne: 'von vorn', hinten: 'von hinten', links: 'von links', rechts: 'von rechts', oben: 'von oben', unten: 'von unten', schraeg: 'schräg (perspektivisch)', unbekannt: 'Richtung unbekannt' };

/** Bildausschnitt, der das Objekt aus einer Richtung zeigt (z. B. Hauptbild oder Heck-Einschub einer Collage). */
export const ReferenceViewSchema = z.object({
  id: z.string().min(1),
  imageIndex: z.number().int().min(0),
  box: z.object({ x: Finite, y: Finite, w: Finite, h: Finite }),
  direction: z.enum(REF_DIRECTIONS),
  /** Nur bei Seiten- und Schrägansichten: Wohin zeigt die Vorderseite im Bildausschnitt? */
  frontInImage: z.enum(['links', 'rechts']).nullable(),
  /** Hauptreferenz für die Ableitung; Einschübe zeigen dasselbe Objekt, keine zusätzliche Baugruppe. */
  primary: z.boolean(),
  basis: SpatialBasis,
  note: z.string(),
});
export type ReferenceView = z.infer<typeof ReferenceViewSchema>;

const ConfirmationSchema = z.object({ status: z.enum(['unconfirmed', 'confirmed', 'stale']), at: IsoTime.nullable(), confirmedHash: z.string().nullable(), reason: z.string().nullable() });

export const SpatialDesignSchema = z.object({
  schema: z.literal(SPATIAL_SCHEMA),
  designId: z.string().min(1),
  version: z.number().int().positive(),
  /** Bezug zum Entwurfsauftrag: Kennung, Version und Teil-Hashes der Grundlage. */
  basedOn: z.object({ briefId: z.string().min(1), briefVersion: z.number().int().positive(), imagesHash: z.string(), interpretationHash: z.string(), requirementsHash: z.string() }),
  origin: z.object({
    method: z.enum(['derived', 'anthropic-vision', 'import']),
    provider: z.string(),
    model: z.string().nullable(),
    methodVersion: z.string(),
    promptVersion: z.string().nullable(),
    at: IsoTime,
    ticketId: z.string().nullable(),
    requestId: z.string().nullable(),
  }),
  status: z.object({ state: z.enum(['current', 'stale']), reason: z.string().nullable() }),
  symmetry: z.object({ kind: z.enum(['none', 'left-right']), basis: SpatialBasis, note: z.string() }),
  /** Zielvorgabe des Nutzers: Hauptkörperlänge in Noppen. null = reale Größe unbekannt. */
  scale: z.object({ mainLengthStuds: Finite, basis: z.literal('user') }).nullable(),
  referenceViews: z.array(ReferenceViewSchema),
  bodies: z.array(SpatialBodySchema),
  /** Vom Vorschlag oder Abgleich benannte Widersprüche zwischen Ansichten. */
  contradictions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  corrections: z.array(z.object({ at: IsoTime, bodyId: z.string(), field: z.string(), before: z.unknown(), after: z.unknown() })),
  confirmation: ConfirmationSchema,
  history: z.array(z.object({ version: z.number().int().positive(), at: IsoTime, event: z.string() })).min(1),
  contentHash: z.string().min(1),
});
export type SpatialDesign = z.infer<typeof SpatialDesignSchema>;

/**
 * Antwortformat eines Analysedienstes für den räumlichen Vorschlag (strukturierte Ausgabe).
 * Bewusst ohne Verfeinerungen, damit es sich als JSON-Schema übergeben lässt; geprüft wird danach.
 */
export const SpatialProposal = z.object({
  referenceViews: z.array(z.object({ imageIndex: z.number().int(), box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }), direction: z.enum(REF_DIRECTIONS), frontInImage: z.enum(['links', 'rechts']).nullable(), primary: z.boolean(), note: z.string() })),
  symmetry: z.object({ kind: z.enum(['none', 'left-right']), note: z.string() }),
  bodies: z.array(z.object({
    id: z.string(), name: z.string(), groupId: z.string().nullable(), isMain: z.boolean(), shape: z.enum(SHAPES),
    center: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    size: z.object({ length: z.number(), width: z.number(), height: z.number() }),
    rotation: z.object({ yaw: z.number(), pitch: z.number(), roll: z.number() }),
    taper: z.number(), color: z.string(),
    basis: z.object({ position: z.enum(['image-derived', 'assumed']), size: z.enum(['image-derived', 'assumed']), rotation: z.enum(['image-derived', 'assumed']), shape: z.enum(['image-derived', 'assumed']), color: z.enum(['image-derived', 'assumed']) }),
    assumptions: z.array(z.string()), uncertainty: z.enum(['hoch', 'mittel', 'niedrig']), mirrorOf: z.string().nullable(),
  })),
  contradictions: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type SpatialProposal = z.infer<typeof SpatialProposal>;

export class SpatialError extends Error {}

const now = () => new Date().toISOString();
const h = (v: unknown) => cyrb53(stableStringify(v));

// ---- Grundlage im Entwurfsauftrag

export interface SpatialBasisHashes { imagesHash: string; interpretationHash: string; requirementsHash: string }

/** Teile des Entwurfsauftrags, von denen der räumliche Entwurf abhängt. */
export function spatialBasisOf(b: DesignBrief): SpatialBasisHashes {
  return {
    imagesHash: h(b.images.map((i) => [i.sha256, i.view])),
    interpretationHash: h(b.interpretation),
    // Relevant sind die Höchstmaße (Zielmaße); Teilezahl und Nutzung ändern die Form nicht
    requirementsHash: h(b.requirements && { maxLengthStuds: b.requirements.maxLengthStuds, maxWidthStuds: b.requirements.maxWidthStuds, maxHeightBricks: b.requirements.maxHeightBricks }),
  };
}

/** Warum der räumliche Entwurf nicht (mehr) zum Entwurfsauftrag passt; null = passt. */
export function spatialMismatch(d: SpatialDesign, b: DesignBrief): string | null {
  if (d.basedOn.briefId !== b.briefId) return `gehört zu Entwurfsauftrag „${d.basedOn.briefId}“, geöffnet ist „${b.briefId}“`;
  const cur = spatialBasisOf(b);
  const r: string[] = [];
  if (cur.imagesHash !== d.basedOn.imagesHash) r.push('Bilder oder Ansichten geändert');
  if (cur.interpretationHash !== d.basedOn.interpretationHash) r.push('Interpretation geändert');
  if (cur.requirementsHash !== d.basedOn.requirementsHash) r.push('Höchstmaße der Anforderungen geändert');
  return r.length ? `${r.join(', ')} (seit Entwurfsauftrag v${d.basedOn.briefVersion})` : null;
}

/** Aktueller Stand gegenüber dem Entwurfsauftrag: veraltet, sobald sich die Grundlage ändert. Nichts wird überschrieben. */
export function syncWithBrief(d: SpatialDesign, b: DesignBrief, at = now()): SpatialDesign {
  const m = spatialMismatch(d, b);
  if (!m) return d;
  if (d.status.state === 'stale' && d.status.reason === m) return d;
  const reason = `Grundlage veraltet: ${m}`;
  return next(d, reason, { status: { state: 'stale', reason: m }, confirmation: staleConfirmation(d, reason) }, at);
}

/** Ausdrückliche Neubewertung durch den Nutzer: Entwurf gilt für den aktuellen Auftrag (protokolliert, Inhalt bleibt). */
export function rebaseSpatial(d: SpatialDesign, b: DesignBrief, at = now()): SpatialDesign {
  if (d.basedOn.briefId !== b.briefId) throw new SpatialError('Der räumliche Entwurf gehört zu einem anderen Entwurfsauftrag.');
  const m = spatialMismatch(d, b);
  if (!m) return d;
  const reason = `Räumlicher Entwurf vom Nutzer ausdrücklich für Entwurfsauftrag v${b.version} neu bewertet (vorher: ${m})`;
  return next(d, reason, { basedOn: { briefId: b.briefId, briefVersion: b.version, ...spatialBasisOf(b) }, status: { state: 'current', reason: null }, confirmation: staleConfirmation(d, reason) }, at);
}

// ---- Versionierung

/** Inhalt, der bestätigt wird – ohne Bestätigungsstand, Verlauf, Version und Hash. */
export function spatialSubstanceHash(d: SpatialDesign): string {
  return h({ basedOn: { ...d.basedOn, briefVersion: undefined }, symmetry: d.symmetry, scale: d.scale, referenceViews: d.referenceViews, bodies: d.bodies });
}
export function spatialHash(d: SpatialDesign): string {
  const { contentHash: _c, ...rest } = d;
  void _c;
  return h(rest);
}
function next(d: SpatialDesign, event: string, patch: Partial<SpatialDesign>, at = now()): SpatialDesign {
  const n: SpatialDesign = { ...d, ...patch, version: d.version + 1, history: [...d.history, { version: d.version + 1, at, event }], contentHash: '' };
  return { ...n, contentHash: spatialHash(n) };
}
function staleConfirmation(d: SpatialDesign, reason: string): SpatialDesign['confirmation'] {
  return d.confirmation.status === 'unconfirmed' ? d.confirmation : { ...d.confirmation, status: 'stale', reason };
}

function create(b: DesignBrief, designId: string, origin: SpatialDesign['origin'], content: Pick<SpatialDesign, 'symmetry' | 'referenceViews' | 'bodies' | 'contradictions' | 'openQuestions'>, event: string): SpatialDesign {
  const d: SpatialDesign = {
    schema: SPATIAL_SCHEMA, designId, version: 1,
    basedOn: { briefId: b.briefId, briefVersion: b.version, ...spatialBasisOf(b) },
    origin, status: { state: 'current', reason: null }, scale: null,
    ...content, corrections: [],
    confirmation: { status: 'unconfirmed', at: null, confirmedHash: null, reason: null },
    history: [{ version: 1, at: origin.at, event }], contentHash: '',
  };
  return { ...d, contentHash: spatialHash(d) };
}

// ---- Voraussetzung: gültige, an die Bilder gebundene Interpretation

export function spatialPrerequisite(b: DesignBrief): string | null {
  if (!b.images.length) return 'Zuerst ein Bild hochladen.';
  if (!b.interpretation) return 'Zuerst eine Interpretation erstellen (automatisch, manuell oder per Import).';
  if (!analysisBound(b)) return 'Die Interpretation passt nicht mehr zu den aktuellen Bildern oder Ansichten – zuerst erneut prüfen.';
  const c = checkInterpretation(b.interpretation, b.images.length);
  if (!c.ok) return `Die Interpretation ist noch nicht stimmig: ${c.errors[0]}`;
  return null;
}

// ---- Lokale Ableitung aus der Interpretation (ohne Dienst, ohne Vorlagen, ohne Dateinamen)

type Box = { imageIndex: number; x: number; y: number; w: number; h: number };
const inside = (b: Box, v: ReferenceView) => b.imageIndex === v.imageIndex && b.x + b.w / 2 >= v.box.x && b.x + b.w / 2 <= v.box.x + v.box.w && b.y + b.h / 2 >= v.box.y && b.y + b.h / 2 <= v.box.y + v.box.h;
const area = (b: Box) => b.w * b.h;

function directionOfLabel(view: string): { direction: RefDirection; note: string } {
  if (view === 'vorn') return { direction: 'vorne', note: 'Ansicht vom Nutzer als „vorn“ bezeichnet' };
  if (view === 'hinten') return { direction: 'hinten', note: 'Ansicht vom Nutzer als „hinten“ bezeichnet' };
  if (view === 'oben') return { direction: 'oben', note: 'Ansicht vom Nutzer als „oben“ bezeichnet' };
  if (view === 'seitlich') return { direction: 'unbekannt', note: 'Seitenansicht – welche Seite, ist nicht angegeben' };
  if (view === 'schräg') return { direction: 'schraeg', note: 'Schrägansicht (perspektivisch)' };
  return { direction: 'unbekannt', note: 'Ansicht nicht bezeichnet – als seitliche bzw. schräge Ansicht behandelt' };
}

/** Standard-Referenzansichten: je Bild das ganze Bild; Einschübe ergänzt der Nutzer oder der Analysedienst. */
export function defaultReferenceViews(b: DesignBrief): ReferenceView[] {
  return b.images.map((img, i) => {
    const d = directionOfLabel(img.view);
    const lateral = d.direction === 'unbekannt' || d.direction === 'schraeg' || d.direction === 'links' || d.direction === 'rechts';
    return { id: `ref-${i + 1}`, imageIndex: i, box: { x: 0, y: 0, w: 1, h: 1 }, direction: d.direction, frontInImage: lateral ? 'links' : null, primary: i === 0, basis: 'assumed', note: d.note + (lateral ? '; Vorderseite im Bild links angenommen' : '') };
  });
}

/** Wie Bildkoordinaten (u nach rechts, v nach unten, in Hauptkörper-Bildlängen) auf Objektachsen abgebildet werden. */
function imageAxes(v: ReferenceView): { u: { axis: 'x' | 'y'; sign: number }; v: { axis: 'x' | 'z'; sign: number }; depth: 'x' | 'y' | 'z' } {
  switch (v.direction) {
    case 'vorne': return { u: { axis: 'y', sign: 1 }, v: { axis: 'z', sign: -1 }, depth: 'x' };
    case 'hinten': return { u: { axis: 'y', sign: -1 }, v: { axis: 'z', sign: -1 }, depth: 'x' };
    case 'oben': return { u: { axis: 'y', sign: -1 }, v: { axis: 'x', sign: -1 }, depth: 'z' };
    case 'unten': return { u: { axis: 'y', sign: 1 }, v: { axis: 'x', sign: -1 }, depth: 'z' };
    default: return { u: { axis: 'x', sign: v.frontInImage === 'rechts' ? 1 : -1 }, v: { axis: 'z', sign: -1 }, depth: 'y' };
  }
}

const SHAPE_WORDS: [RegExp, SpatialBody['shape']][] = [
  [/zylind|rund|röhr|rohr|düse|tonne|walze/i, 'cylinder'],
  [/keil|abgeschrägt|rampe/i, 'wedge'],
  [/verjüng|konisch|zulaufend/i, 'taper'],
];

/**
 * Die Körperform ist aus Bildbereichen nicht bestimmbar. Jeder Körper beginnt deshalb als neutraler Quader
 * (Annahme). Erwähnt die Beschreibung eine Form, erscheint das nur als HINWEIS zur Prüfung – aus Namen oder
 * Wörtern wird keine 3D-Form abgeleitet.
 */
function shapeFor(g: Interpretation['groups'][number]): { shape: SpatialBody['shape']; note: string } {
  const hint = SHAPE_WORDS.find(([re]) => re.test(g.description));
  return { shape: 'box', note: `Form nicht aus dem Bild bestimmt – Quader als neutrale Annahme${hint ? `; die Beschreibung erwähnt „${g.description.match(hint[0])![0]}“, ggf. „${SHAPE_LABEL[hint[1]]}“ wählen` : ''}` };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const de = (n: number) => String(n).replace('.', ',');
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Erster räumlicher Vorschlag aus der tatsächlichen Interpretation:
 * - Hauptkörper: Länge 1; Höhe aus dem Seitenverhältnis seines Bildbereichs (perspektivisch geschätzt);
 *   Breite ist aus einer Seiten- oder Schrägansicht nicht ableitbar und wird angenommen.
 * - Baugruppen: Größe = relative Größe × Hauptkörpermaß; Lage aus dem größten Bildbereich in der
 *   Hauptreferenz (Einschübe zählen nicht – sie zeigen dasselbe Objekt aus anderer Richtung).
 * - Tiefe (Achse senkrecht zum Bild) ist unbekannt: 0, außer bei gleich großen Paaren, die bei
 *   angenommener Links-rechts-Symmetrie seitlich gespiegelt angeordnet werden.
 * - Details (Rolle „detail“) werden nicht als Körper übernommen; sie tragen kaum zur Silhouette bei.
 */
export function deriveSpatialProposal(b: DesignBrief, opts: { designId: string; referenceViews?: ReferenceView[]; at?: string }): SpatialDesign {
  const pre = spatialPrerequisite(b);
  if (pre) throw new SpatialError(pre);
  const at = opts.at ?? now();
  const interp = b.interpretation!;
  const refs = opts.referenceViews?.length ? opts.referenceViews : defaultReferenceViews(b);
  const primary = refs.find((r) => r.primary) ?? refs[0];
  const insets = refs.filter((r) => r !== primary);
  const img = b.images[primary.imageIndex];
  const aspect = img ? img.width / img.height : 1; // Bildpunkte: w normiert · Breite, h normiert · Höhe
  const ax = imageAxes(primary);
  const inPrimary = (bx: Box) => inside(bx, primary) && !insets.some((v) => v.imageIndex === primary.imageIndex && inside(bx, v) && area(v.box as Box) < area(primary.box as Box));
  const best = (g: Interpretation['groups'][number]) => g.boxes.filter(inPrimary).sort((p, q) => area(q) - area(p))[0] ?? null;
  const colorOf = (g: Interpretation['groups'][number]) => interp.colors.find((c) => c.id === g.colorIds[0])?.hex ?? '#9aa5b1';
  const main = interp.groups.find((g) => g.role === 'hauptkoerper')!;
  const mb = best(main);
  const questions: string[] = [];
  const symmetric = interp.symmetry.kind === 'links-rechts';

  // Alle Bildmaße in Bildhöhen-Einheiten (waagerecht · Seitenverhältnis), dann in Hauptkörperlängen.
  // Seiten-/Schrägansicht: Bildbreite des Hauptkörpers ≈ Länge, Bildhöhe ≈ Höhe; Breite unbekannt.
  // Front-/Heckansicht: Bildbreite ≈ Breite, Bildhöhe ≈ Höhe; Länge unbekannt (Breite 0,5 angenommen).
  // Drauf-/Untersicht: Bildhöhe ≈ Länge, Bildbreite ≈ Breite; Höhe unbekannt.
  const lateral = ax.u.axis === 'x';
  const topDown = ax.v.axis === 'x';
  const clamp = (n: number) => Math.min(Math.max(n, 0.05), 2);
  const ASSUMED_W = 0.5;
  const ASSUMED_H = 0.4;
  const unitPx = !mb ? 1 : lateral ? mb.w * aspect : topDown ? mb.h : (mb.w * aspect) / ASSUMED_W;
  const mainHeight = !mb || topDown ? ASSUMED_H : clamp(mb.h / unitPx);
  const mainWidth = !mb || lateral ? ASSUMED_W : topDown ? clamp((mb.w * aspect) / unitPx) : ASSUMED_W;
  const viewWord = primary.direction === 'schraeg' ? 'einer Schrägansicht' : lateral ? 'einer Seitenansicht' : topDown ? 'einer Drauf- bzw. Untersicht' : 'einer Front- bzw. Heckansicht';
  if (lateral) questions.push(`Breite des Hauptkörpers „${main.name}“: aus ${viewWord} nicht messbar, ${de(ASSUMED_W)} × Länge angenommen. Bitte prüfen.`);
  if (topDown) questions.push(`Höhe des Hauptkörpers „${main.name}“: aus ${viewWord} nicht messbar, ${de(ASSUMED_H)} × Länge angenommen. Bitte prüfen.`);
  if (!lateral && !topDown) questions.push(`Länge des Hauptkörpers „${main.name}“: aus ${viewWord} nicht messbar; Breite ${de(ASSUMED_W)} × Länge angenommen, Höhe im Verhältnis zur Breite aus dem Bild geschätzt.`);
  if (lateral) questions.push('Vorderseite: Zeigt sie in der Hauptreferenz nach links (angenommen) oder nach rechts?');
  if (!mb) questions.push(`Hauptkörper „${main.name}“ hat keinen Bildbereich in der Hauptreferenz – Höhe 0,4 × Länge angenommen.`);
  if (primary.direction === 'schraeg' || primary.direction === 'unbekannt') questions.push('Die Hauptreferenz ist perspektivisch bzw. ohne Richtungsangabe: Lagen und Proportionen sind Schätzungen, keine Messungen.');

  const toModel = (bx: Box) => {
    // Bildmittelpunkt relativ zum Hauptkörper, in Hauptkörperlängen
    const du = mb ? ((bx.x + bx.w / 2 - (mb.x + mb.w / 2)) * aspect) / unitPx : 0;
    const dv = mb ? (bx.y + bx.h / 2 - (mb.y + mb.h / 2)) / unitPx : 0;
    const c = { x: 0, y: 0, z: 0 };
    c[ax.u.axis] = du * ax.u.sign;
    c[ax.v.axis] = dv * ax.v.sign;
    return c;
  };

  const groups = interp.groups.filter((g) => g.role !== 'detail');
  const skipped = interp.groups.filter((g) => g.role === 'detail');
  // Gleich große Baugruppen als Paarkandidaten (nur bei angenommener bzw. beobachteter Links-rechts-Symmetrie)
  const same = (p: Interpretation['groups'][number], q: Interpretation['groups'][number]) => (['length', 'width', 'height'] as const).every((k) => Math.abs(p.relativeSize[k] - q.relativeSize[k]) <= 0.05 * Math.max(p.relativeSize[k], q.relativeSize[k]));
  const pairOf = new Map<string, string>();
  if (symmetric && lateral) {
    const cands = groups.filter((g) => g.role === 'baugruppe');
    for (const p of cands) for (const q of cands) if (p.id < q.id && !pairOf.has(p.id) && !pairOf.has(q.id) && same(p, q)) { pairOf.set(p.id, q.id); pairOf.set(q.id, p.id); }
  }

  const bodies: SpatialBody[] = [];
  const idFor = (g: Interpretation['groups'][number]) => `k-${g.id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
  for (const g of groups) {
    const isMain = g === main;
    const bx = best(g);
    const { shape, note } = shapeFor(g);
    const size = isMain ? { length: 1, width: r3(mainWidth), height: r3(mainHeight) } : { length: r3(g.relativeSize.length), width: r3(g.relativeSize.width * mainWidth), height: r3(g.relativeSize.height * mainHeight) };
    const center = isMain || !bx ? { x: 0, y: 0, z: 0 } : toModel(bx);
    const assumptions = [note];
    if (!isMain) assumptions.push(`Größe aus der relativen Größe der Interpretation (${de(g.relativeSize.length)} / ${de(g.relativeSize.width)} / ${de(g.relativeSize.height)} des Hauptkörpers)`);
    if (!isMain && !bx) { assumptions.push('Kein Bildbereich in der Hauptreferenz – Lage in der Mitte angenommen'); questions.push(`Lage von „${g.name}“ fehlt (kein Bildbereich in der Hauptreferenz).`); }
    if (lateral && !pairOf.has(g.id) && !isMain) assumptions.push('Seitliche Lage (Tiefe) aus der Ansicht nicht bestimmbar – mittig angenommen');
    bodies.push({
      id: idFor(g), name: g.name, groupId: g.id, isMain, shape, center: { x: r3(center.x), y: r3(center.y), z: r3(center.z) }, size,
      rotation: { yaw: 0, pitch: 0, roll: 0 }, taper: shape === 'wedge' ? 0.25 : shape === 'taper' ? 0.6 : 1, color: colorOf(g),
      basis: { position: isMain ? 'assumed' : bx ? 'image-derived' : 'assumed', size: isMain ? (mb ? 'image-derived' : 'assumed') : 'image-derived', rotation: 'assumed', shape: 'assumed', color: g.colorIds.length ? 'image-derived' : 'assumed' },
      assumptions, uncertainty: bx && g.confidence === 'hoch' ? 'mittel' : 'hoch', mirrorOf: null,
    });
  }
  // Paare seitlich anordnen: der Körper mit dem größeren Bildbereich liegt auf der Kameraseite
  const camSideSign = lateral ? (ax.u.sign === -1 ? 1 : -1) : 1; // Vorderseite links ⇒ man sieht die linke Seite (+y)
  for (const [a, c] of pairOf) {
    if (a > c) continue;
    const ga = groups.find((g) => g.id === a)!;
    const gc = groups.find((g) => g.id === c)!;
    const [near, far] = (best(ga) ? area(best(ga)!) : 0) >= (best(gc) ? area(best(gc)!) : 0) ? [ga, gc] : [gc, ga];
    const bn = bodies.find((x) => x.groupId === near.id)!;
    const bf = bodies.find((x) => x.groupId === far.id)!;
    const y = r3(camSideSign * (mainWidth / 2 + bn.size.width / 2));
    bn.center = { ...bn.center, y };
    bn.basis = { ...bn.basis, position: 'assumed' };
    bn.assumptions.push(`Paar gleicher relativer Größe mit „${far.name}“: seitlich ${y > 0 ? 'links' : 'rechts'} am Hauptkörper angenommen (Kameraseite, Lage längs aus dem Bildbereich)`);
    Object.assign(bf, mirrorPose(bn), { mirrorOf: bn.id });
    bf.basis = MIRROR_BASIS;
    bf.assumptions.push(`Gekoppeltes Spiegelbild von „${near.name}“ – Symmetrieannahme (Interpretation: ${interp.symmetry.basis === 'observed' ? 'beobachtet' : 'angenommen'}), kein Beleg, dass beide Seiten im Original gleich sind`);
  }
  if (pairOf.size) questions.push('Gekoppelte Paare (z. B. seitliche Gondeln) beruhen auf einer Symmetrieannahme – kein Beleg, dass beide Seiten im Original gleich sind. Bei Abweichungen Kopplung lösen.');
  if (skipped.length) questions.push(`Nicht als Körper übernommen (Details): ${skipped.map((g) => g.name).join(', ')}. Bei Bedarf als Körper ergänzen.`);
  for (const q of interp.openQuestions) questions.push(`Aus der Interpretation: ${q.question}`);

  const origin: SpatialDesign['origin'] = { method: 'derived', provider: 'Lokale Ableitung (Bildbereiche der Hauptreferenz + relative Größen der Interpretation; keine 3D-Erkennung)', model: null, methodVersion: SPATIAL_METHOD_VERSION, promptVersion: null, at, ticketId: null, requestId: null };
  return create(b, opts.designId, origin, {
    symmetry: symmetric ? { kind: 'left-right', basis: interp.symmetry.basis === 'user' ? 'user' : 'assumed', note: `Aus der Interpretation (${interp.symmetry.basis}): ${interp.symmetry.note}` } : { kind: 'none', basis: 'assumed', note: `Interpretation: ${interp.symmetry.kind}` },
    referenceViews: refs, bodies, contradictions: [], openQuestions: questions,
  }, 'Räumlicher Entwurf lokal aus der Interpretation abgeleitet');
}

// ---- Vorschlag eines Analysedienstes

export interface SpatialMeta { provider: string; model: string | null; promptVersion: string | null; requestId: string | null; at: string }

export function designFromProposal(b: DesignBrief, p: SpatialProposal, meta: SpatialMeta, opts: { designId: string; ticketId: string | null }): SpatialDesign {
  const d = create(b, opts.designId, { method: 'anthropic-vision', provider: meta.provider, model: meta.model, methodVersion: SPATIAL_METHOD_VERSION, promptVersion: meta.promptVersion, at: meta.at, ticketId: opts.ticketId, requestId: meta.requestId }, {
    symmetry: { kind: p.symmetry.kind, basis: 'assumed', note: p.symmetry.note },
    referenceViews: p.referenceViews.map((r, i) => ({ ...r, id: `ref-${i + 1}`, basis: 'assumed' as const })),
    bodies: p.bodies.map((x) => ({ ...x, color: /^#[0-9a-fA-F]{6}$/.test(x.color) ? x.color : '#9aa5b1' })),
    contradictions: p.contradictions,
    openQuestions: p.openQuestions,
  }, `Räumlicher Vorschlag durch ${meta.provider}${meta.model ? ` (${meta.model})` : ''}`);
  return d;
}

// ---- Prüfung

export interface SpatialFinding { level: 'error' | 'warning' | 'info'; message: string; bodyId?: string }

const MIRROR_TOL = 1e-6;
/** Ein gekoppeltes Spiegelbild beruht vollständig auf der Symmetrieannahme – nie „aus Bild“ oder „vom Nutzer“. */
export const MIRROR_BASIS: SpatialBody['basis'] = { position: 'assumed', size: 'assumed', rotation: 'assumed', shape: 'assumed', color: 'assumed' };

/** Lage eines Spiegelbilds (y → −y): Gieren und Rollen wechseln das Vorzeichen, Nicken bleibt. */
export function mirrorPose(src: SpatialBody): Pick<SpatialBody, 'center' | 'rotation' | 'size' | 'shape' | 'taper' | 'color'> {
  return { center: { ...src.center, y: -src.center.y }, rotation: { yaw: -src.rotation.yaw || 0, pitch: src.rotation.pitch, roll: -src.rotation.roll || 0 }, size: { ...src.size }, shape: src.shape, taper: src.taper, color: src.color };
}

/**
 * Fachliche Prüfung. Überlappungen oder getrennte Körper sind KEIN Befund: Entwurfskörper sind keine
 * Bausteine, eine Überlappung ist keine Kollision und eine Lücke kein Beleg für fehlende Verbindungen.
 */
export function checkSpatial(d: SpatialDesign, b: DesignBrief | null): SpatialFinding[] {
  const f: SpatialFinding[] = [];
  const err = (message: string, bodyId?: string) => f.push({ level: 'error', message, bodyId });
  const warn = (message: string, bodyId?: string) => f.push({ level: 'warning', message, bodyId });
  const ids = new Set<string>();
  for (const x of d.bodies) {
    if (ids.has(x.id)) err(`Körperkennung „${x.id}“ doppelt`, x.id);
    ids.add(x.id);
  }
  if (!d.bodies.length) err('Keine Körper vorhanden');
  const mains = d.bodies.filter((x) => x.isMain);
  if (mains.length !== 1) err(`Genau ein Hauptkörper erwartet, gefunden: ${mains.length}`);
  else if (Math.abs(mains[0].size.length - 1) > 1e-9) err(`Hauptkörper „${mains[0].name}“: Länge muss 1 sein (Bezugsmaß aller Angaben), ist ${mains[0].size.length}`, mains[0].id);
  const groupIds = new Set(b?.interpretation?.groups.map((g) => g.id) ?? []);
  for (const x of d.bodies) {
    for (const k of ['length', 'width', 'height'] as const) if (!(x.size[k] > 0) || !Number.isFinite(x.size[k])) err(`„${x.name}“: ${k === 'length' ? 'Länge' : k === 'width' ? 'Breite' : 'Höhe'} muss eine positive, endliche Zahl sein`, x.id);
    for (const k of ['x', 'y', 'z'] as const) if (!Number.isFinite(x.center[k])) err(`„${x.name}“: Position ${k} ist keine endliche Zahl`, x.id);
    for (const k of ['yaw', 'pitch', 'roll'] as const) if (!Number.isFinite(x.rotation[k]) || Math.abs(x.rotation[k]) > 180) err(`„${x.name}“: Drehung ${k === 'yaw' ? 'Gieren' : k === 'pitch' ? 'Nicken' : 'Rollen'} muss zwischen −180° und 180° liegen`, x.id);
    if (!(x.taper >= 0 && x.taper <= 1)) err(`„${x.name}“: Verjüngung muss zwischen 0 und 1 liegen`, x.id);
    if (x.shape === 'box' && x.taper !== 1) warn(`„${x.name}“: Quader ignoriert die Verjüngung (${x.taper})`, x.id);
    if (Math.max(x.size.length, x.size.width, x.size.height) > 20) warn(`„${x.name}“: mehr als 20 × Hauptkörperlänge – Maßstab prüfen`, x.id);
    if (b?.interpretation && x.groupId !== null && !groupIds.has(x.groupId)) err(`„${x.name}“ verweist auf Baugruppe „${x.groupId}“, die es in der Interpretation nicht gibt`, x.id);
    if (x.isMain && b?.interpretation) {
      const g = b.interpretation.groups.find((gg) => gg.id === x.groupId);
      if (!g || g.role !== 'hauptkoerper') err(`Hauptkörper „${x.name}“ muss auf den Hauptkörper der Interpretation verweisen`, x.id);
    }
    if (x.mirrorOf !== null) {
      const src = d.bodies.find((s) => s.id === x.mirrorOf);
      if (d.symmetry.kind !== 'left-right') err(`„${x.name}“ ist als Spiegelbild gekoppelt, aber keine Links-rechts-Symmetrie ist vorgegeben oder angenommen`, x.id);
      if (!src) err(`„${x.name}“: Spiegelvorlage „${x.mirrorOf}“ fehlt`, x.id);
      else if (src.id === x.id || src.mirrorOf !== null) err(`„${x.name}“: Spiegelvorlage „${src.name}“ ist selbst gespiegelt oder identisch (keine Ketten)`, x.id);
      else {
        const m = mirrorPose(src);
        const off = Math.abs(m.center.x - x.center.x) + Math.abs(m.center.y - x.center.y) + Math.abs(m.center.z - x.center.z) + Math.abs(m.rotation.yaw - x.rotation.yaw) + Math.abs(m.rotation.pitch - x.rotation.pitch) + Math.abs(m.rotation.roll - x.rotation.roll) + Math.abs(m.size.length - x.size.length) + Math.abs(m.size.width - x.size.width) + Math.abs(m.size.height - x.size.height) + Math.abs(m.taper - x.taper);
        if (off > MIRROR_TOL || m.shape !== x.shape) err(`„${x.name}“ ist nicht das Spiegelbild von „${src.name}“ (Lage, Drehung, Maß oder Form weichen ab)`, x.id);
        if (Math.abs(src.center.y) < 1e-6) warn(`„${x.name}“ und „${src.name}“ liegen beide auf der Mittelebene (y = 0) und decken sich`, x.id);
      }
    }
  }
  const refIds = new Set<string>();
  for (const r of d.referenceViews) {
    if (refIds.has(r.id)) err(`Referenzansicht „${r.id}“ doppelt`);
    refIds.add(r.id);
    if (b && (r.imageIndex < 0 || r.imageIndex >= b.images.length)) err(`Referenzansicht „${r.id}“ verweist auf Bild ${r.imageIndex + 1}, vorhanden sind ${b.images.length}`);
    if (r.box.x < 0 || r.box.y < 0 || r.box.w <= 0 || r.box.h <= 0 || r.box.x + r.box.w > 1.0001 || r.box.y + r.box.h > 1.0001) err(`Referenzansicht „${r.id}“: Ausschnitt liegt außerhalb des Bildes (0…1)`);
  }
  if (d.referenceViews.length && d.referenceViews.filter((r) => r.primary).length !== 1) err('Genau eine Hauptreferenz (primär) erwartet');
  if (d.scale) {
    if (!(d.scale.mainLengthStuds > 0)) err('Maßstab: Hauptkörperlänge in Noppen muss größer als 0 sein');
    else if (b?.requirements && d.bodies.length) {
      const s = modelBounds(d).size.map((v) => v * d.scale!.mainLengthStuds);
      const r = b.requirements;
      if (r.maxLengthStuds && s[0] > r.maxLengthStuds + 1e-9) err(`Zielmaß überschritten: Länge ${s[0].toFixed(1)} Noppen > höchstens ${r.maxLengthStuds}`);
      if (r.maxWidthStuds && s[1] > r.maxWidthStuds + 1e-9) err(`Zielmaß überschritten: Breite ${s[1].toFixed(1)} Noppen > höchstens ${r.maxWidthStuds}`);
      if (r.maxHeightBricks && s[2] / BRICK_HEIGHT_IN_STUDS > r.maxHeightBricks + 1e-9) err(`Zielmaß überschritten: Höhe ${(s[2] / BRICK_HEIGHT_IN_STUDS).toFixed(1)} Steine > höchstens ${r.maxHeightBricks}`);
    }
  } else if (b?.requirements && (b.requirements.maxLengthStuds || b.requirements.maxWidthStuds || b.requirements.maxHeightBricks)) f.push({ level: 'info', message: 'Höchstmaße sind vorgegeben, aber kein Maßstab gesetzt – Zielmaße werden erst mit Maßstab geprüft.' });
  if (b) {
    const m = spatialMismatch(d, b);
    if (m) err(`Grundlage veraltet: ${m}`);
  }
  f.push({ level: 'info', message: 'Überlappende oder getrennte Körper sind kein Befund: Es sind Entwurfskörper, keine Bausteine (keine Kollisions- oder Verbindungsprüfung).' });
  return f;
}

// ---- Abgleich mit Referenzansichten (benennt Abweichungen, misst nicht)

const ORTHO: Partial<Record<RefDirection, ViewId>> = { vorne: 'vorne', hinten: 'hinten', links: 'links', rechts: 'rechts', oben: 'oben', unten: 'unten' };

/**
 * Vergleicht Bildbereiche der Interpretation mit der Projektion der zugehörigen Körper in Ansichten mit
 * bekannter Richtung (z. B. Heck-Einschub „von hinten“). Perspektivische Bilder sind keine Messgrundlage;
 * deshalb nur grobe Hinweise: Seitenverhältnis (Faktor > 1,5) und vertauschte Seiten.
 */
export function compareWithReferences(d: SpatialDesign, b: DesignBrief): string[] {
  const out: string[] = [];
  const interp = b.interpretation;
  if (!interp) return out;
  for (const r of d.referenceViews) {
    const viewId = ORTHO[r.direction];
    if (!viewId) continue;
    const img = b.images[r.imageIndex];
    if (!img) continue;
    const view = VIEW_BY_ID[viewId];
    const mainBody = d.bodies.find((x) => x.isMain);
    const mainGroup = interp.groups.find((g) => g.id === mainBody?.groupId);
    const mainBox = mainGroup?.boxes.find((bx) => inside(bx, r));
    for (const x of d.bodies) {
      if (x.isMain && !mainBox) continue;
      const g = interp.groups.find((gg) => gg.id === x.groupId);
      const bx = g?.boxes.find((bb) => inside(bb, r));
      if (!g || !bx) continue;
      const p = projectBody(x, view);
      const modelAspect = (p.bbox.u1 - p.bbox.u0) / Math.max(p.bbox.v1 - p.bbox.v0, 1e-9);
      const imageAspect = (bx.w * img.width) / Math.max(bx.h * img.height, 1e-9);
      const ratio = modelAspect / imageAspect;
      if (ratio > 1.5 || ratio < 1 / 1.5) out.push(`„${x.name}“ ${REF_DIRECTION_LABEL[r.direction]} (Ausschnitt ${r.id}): Breite : Höhe im Bild ≈ ${de(r2(imageAspect))}, im Modell ${de(r2(modelAspect))}`);
      if (!x.isMain && mainBox && mainBody) {
        const pm = projectBody(mainBody, view);
        const imgSide = Math.sign(bx.x + bx.w / 2 - (mainBox.x + mainBox.w / 2));
        const modSide = Math.sign((p.bbox.u0 + p.bbox.u1) / 2 - (pm.bbox.u0 + pm.bbox.u1) / 2);
        const offImg = Math.abs(bx.x + bx.w / 2 - (mainBox.x + mainBox.w / 2)) > 0.1 * mainBox.w;
        const offMod = Math.abs((p.bbox.u0 + p.bbox.u1) / 2 - (pm.bbox.u0 + pm.bbox.u1) / 2) > 0.1 * (pm.bbox.u1 - pm.bbox.u0);
        if (offImg && offMod && imgSide !== modSide) out.push(`„${x.name}“ ${REF_DIRECTION_LABEL[r.direction]} (Ausschnitt ${r.id}): im Bild ${imgSide > 0 ? 'rechts' : 'links'}, im Modell ${modSide > 0 ? 'rechts' : 'links'} – Seiten vertauscht oder Richtung falsch?`);
      }
    }
  }
  return out;
}

// ---- Bearbeiten (jede Änderung: neue Version, protokolliert, Grundlage „vom Nutzer gesetzt“)

export type BodyPatch = Partial<Pick<SpatialBody, 'name' | 'groupId' | 'shape' | 'center' | 'size' | 'rotation' | 'taper' | 'color' | 'assumptions' | 'uncertainty'>>;

const BASIS_FIELD: Partial<Record<keyof BodyPatch, keyof SpatialBody['basis']>> = { center: 'position', size: 'size', rotation: 'rotation', shape: 'shape', taper: 'shape', color: 'color' };

function applyMirrors(bodies: SpatialBody[]): SpatialBody[] {
  return bodies.map((x) => {
    if (!x.mirrorOf) return x;
    const src = bodies.find((s) => s.id === x.mirrorOf);
    return src && !src.mirrorOf ? { ...x, ...mirrorPose(src), basis: MIRROR_BASIS } : x;
  });
}

export function updateBody(d: SpatialDesign, id: string, patch: BodyPatch, at = now()): SpatialDesign {
  const x = d.bodies.find((b) => b.id === id);
  if (!x) throw new SpatialError(`Körper „${id}“ fehlt`);
  if (x.mirrorOf && Object.keys(patch).some((k) => k in BASIS_FIELD)) throw new SpatialError(`„${x.name}“ ist ein gekoppeltes Spiegelbild – bitte die Vorlage ändern oder die Kopplung lösen.`);
  if (x.isMain && patch.size && patch.size.length !== 1) throw new SpatialError('Die Länge des Hauptkörpers ist das Bezugsmaß und bleibt 1.');
  const corrections: SpatialDesign['corrections'] = [];
  const basis = { ...x.basis };
  for (const [k, v] of Object.entries(patch) as [keyof BodyPatch, unknown][]) {
    if (stableStringify(x[k]) === stableStringify(v)) continue;
    corrections.push({ at, bodyId: id, field: k, before: x[k], after: v });
    const bf = BASIS_FIELD[k];
    if (bf) basis[bf] = 'user';
  }
  if (!corrections.length) return d;
  const bodies = applyMirrors(d.bodies.map((b) => (b.id === id ? { ...b, ...patch, basis } : b)));
  const reason = `„${x.name}“ korrigiert: ${corrections.map((c) => c.field).join(', ')}`;
  return next(d, reason, { bodies, corrections: [...d.corrections, ...corrections], confirmation: staleConfirmation(d, reason) }, at);
}

export function addBody(d: SpatialDesign, body: Omit<SpatialBody, 'basis' | 'isMain' | 'mirrorOf' | 'assumptions'> & { assumptions?: string[] }, at = now()): SpatialDesign {
  if (d.bodies.some((b) => b.id === body.id)) throw new SpatialError(`Körperkennung „${body.id}“ existiert bereits`);
  const full: SpatialBody = { ...body, isMain: false, mirrorOf: null, basis: { position: 'user', size: 'user', rotation: 'user', shape: 'user', color: 'user' }, assumptions: body.assumptions ?? [] };
  const reason = `Körper „${body.name}“ ergänzt`;
  return next(d, reason, { bodies: [...d.bodies, full], corrections: [...d.corrections, { at, bodyId: body.id, field: 'added', before: null, after: full }], confirmation: staleConfirmation(d, reason) }, at);
}

export function removeBody(d: SpatialDesign, id: string, at = now()): SpatialDesign {
  const x = d.bodies.find((b) => b.id === id);
  if (!x) return d;
  if (x.isMain) throw new SpatialError('Der Hauptkörper kann nicht entfernt werden (Bezugsmaß).');
  const reason = `Körper „${x.name}“ entfernt`;
  // Spiegelbilder dieses Körpers verlieren ihre Kopplung und bleiben, wo sie sind
  const bodies = d.bodies.filter((b) => b.id !== id).map((b) => (b.mirrorOf === id ? { ...b, mirrorOf: null } : b));
  return next(d, reason, { bodies, corrections: [...d.corrections, { at, bodyId: id, field: 'removed', before: x, after: null }], confirmation: staleConfirmation(d, reason) }, at);
}

/** Erzeugt ein gekoppeltes Spiegelbild (nur bei vorgegebener bzw. angenommener Links-rechts-Symmetrie). */
export function addMirror(d: SpatialDesign, id: string, newId: string, at = now()): SpatialDesign {
  if (d.symmetry.kind !== 'left-right') throw new SpatialError('Spiegeln ist erst möglich, wenn Links-rechts-Symmetrie vorgegeben oder angenommen ist.');
  const src = d.bodies.find((b) => b.id === id);
  if (!src) throw new SpatialError(`Körper „${id}“ fehlt`);
  if (src.isMain || src.mirrorOf) throw new SpatialError('Hauptkörper und Spiegelbilder lassen sich nicht erneut spiegeln.');
  if (d.bodies.some((b) => b.mirrorOf === id)) throw new SpatialError(`„${src.name}“ hat bereits ein Spiegelbild.`);
  if (d.bodies.some((b) => b.id === newId)) throw new SpatialError(`Körperkennung „${newId}“ existiert bereits`);
  const m: SpatialBody = { ...src, ...mirrorPose(src), basis: MIRROR_BASIS, id: newId, name: `${src.name} (gespiegelt)`, mirrorOf: src.id, assumptions: [`Gekoppeltes Spiegelbild von „${src.name}“ – Symmetrieannahme, kein Beleg für Gleichheit beider Seiten`] };
  const reason = `Spiegelbild von „${src.name}“ ergänzt`;
  return next(d, reason, { bodies: [...d.bodies, m], corrections: [...d.corrections, { at, bodyId: newId, field: 'added', before: null, after: m }], confirmation: staleConfirmation(d, reason) }, at);
}

export function decouple(d: SpatialDesign, id: string, at = now()): SpatialDesign {
  const x = d.bodies.find((b) => b.id === id);
  if (!x?.mirrorOf) return d;
  const reason = `Spiegelkopplung von „${x.name}“ gelöst`;
  return next(d, reason, { bodies: d.bodies.map((b) => (b.id === id ? { ...b, mirrorOf: null } : b)), corrections: [...d.corrections, { at, bodyId: id, field: 'mirrorOf', before: x.mirrorOf, after: null }], confirmation: staleConfirmation(d, reason) }, at);
}

/** Symmetrie setzen. Aufheben löst alle Kopplungen; Setzen ist eine Nutzervorgabe. */
export function setSymmetry(d: SpatialDesign, kind: 'none' | 'left-right', at = now()): SpatialDesign {
  if (d.symmetry.kind === kind) return d;
  const reason = kind === 'left-right' ? 'Links-rechts-Symmetrie vom Nutzer vorgegeben' : 'Symmetrie vom Nutzer aufgehoben (Kopplungen gelöst)';
  return next(d, reason, { symmetry: { kind, basis: 'user', note: reason }, bodies: kind === 'none' ? d.bodies.map((b) => ({ ...b, mirrorOf: null })) : d.bodies, confirmation: staleConfirmation(d, reason) }, at);
}

export function setScale(d: SpatialDesign, mainLengthStuds: number | null, at = now()): SpatialDesign {
  const scale = mainLengthStuds === null ? null : { mainLengthStuds, basis: 'user' as const };
  if (stableStringify(scale) === stableStringify(d.scale)) return d;
  const reason = scale ? `Maßstab als Zielvorgabe gesetzt: Hauptkörperlänge = ${mainLengthStuds} Noppen` : 'Maßstab entfernt (reale Größe unbekannt)';
  return next(d, reason, { scale, confirmation: staleConfirmation(d, reason) }, at);
}

export function setReferenceViews(d: SpatialDesign, refs: ReferenceView[], at = now()): SpatialDesign {
  if (stableStringify(refs) === stableStringify(d.referenceViews)) return d;
  const reason = 'Referenzansichten geändert';
  return next(d, reason, { referenceViews: refs, confirmation: staleConfirmation(d, reason) }, at);
}

/** Rückgängig/Wiederholen: stellt den Inhalt eines früheren Stands als NEUE Version wieder her (Verlauf bleibt lückenlos). */
export function restoreContent(d: SpatialDesign, snapshot: SpatialDesign, label: string, at = now()): SpatialDesign {
  if (snapshot.designId !== d.designId) throw new SpatialError('Stand gehört zu einem anderen räumlichen Entwurf.');
  return next(d, label, { bodies: snapshot.bodies, symmetry: snapshot.symmetry, scale: snapshot.scale, referenceViews: snapshot.referenceViews, corrections: snapshot.corrections, confirmation: staleConfirmation(d, label) }, at);
}

// ---- Bestätigung

export function spatialBlockers(d: SpatialDesign, b: DesignBrief): string[] {
  const pre = spatialPrerequisite(b);
  return [...(pre ? [pre] : []), ...checkSpatial(d, b).filter((x) => x.level === 'error').map((x) => x.message)];
}

/** Bestätigt die räumliche Form – nicht Stabilität, Montage oder Kaufverfügbarkeit. */
export function confirmSpatial(d: SpatialDesign, b: DesignBrief, at = now()): SpatialDesign {
  const bl = spatialBlockers(d, b);
  if (bl.length) throw new SpatialError(`Nicht bestätigbar: ${bl.join('; ')}`);
  return next(d, 'Räumliche Form bestätigt (keine Aussage zu Stabilität, Montage oder Verfügbarkeit)', { confirmation: { status: 'confirmed', at, confirmedHash: spatialSubstanceHash(d), reason: null } }, at);
}

export function isSpatialConfirmedCurrent(d: SpatialDesign, b: DesignBrief): boolean {
  try {
    return d.confirmation.status === 'confirmed' && d.confirmation.confirmedHash === spatialSubstanceHash(d) && d.status.state === 'current' && spatialMismatch(d, b) === null && spatialBlockers(d, b).length === 0;
  } catch {
    return false;
  }
}

// ---- Analyseanfragen für den räumlichen Vorschlag: Bindung an Auftrag, Grundlage und Entwurfsstand

export interface SpatialTicket {
  ticketId: string;
  briefId: string;
  basis: SpatialBasisHashes;
  /** Stand des vorhandenen räumlichen Entwurfs beim Absenden (null = keiner); Nutzerkorrekturen werden nie überschrieben. */
  designHash: string | null;
  startedAt: string;
}

export function createSpatialTicket(b: DesignBrief, d: SpatialDesign | null, ticketId: string, at = now()): SpatialTicket {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(ticketId)) throw new SpatialError('Ungültige Anfragekennung');
  return Object.freeze({ ticketId, briefId: b.briefId, basis: Object.freeze(spatialBasisOf(b)), designHash: d ? spatialSubstanceHash(d) : null, startedAt: at }) as SpatialTicket;
}

export type SpatialApplyOutcome =
  | { kind: 'applied'; design: SpatialDesign }
  | { kind: 'held'; candidate: SpatialDesign; reasons: string[] }
  | { kind: 'rejected'; reason: string };

/**
 * Eintreffende Antwort zuordnen: anderer Auftrag → verworfen; geänderte Grundlage → verworfen (passt nicht
 * mehr zu Bildern/Interpretation); vorhandener Entwurf seit dem Absenden geändert oder mit Nutzerkorrekturen
 * → zurückgehalten (nur ausdrücklich übernehmbar). Sonst übernommen.
 */
export function applySpatialResult(b: DesignBrief, current: SpatialDesign | null, t: SpatialTicket, p: SpatialProposal, meta: SpatialMeta, designId: string): SpatialApplyOutcome {
  if (b.briefId !== t.briefId) return { kind: 'rejected', reason: `Die Antwort gehört zu Entwurfsauftrag „${t.briefId}“; geöffnet ist „${b.briefId}“. Sie wurde verworfen.` };
  const cur = spatialBasisOf(b);
  if (stableStringify(cur) !== stableStringify(t.basis)) return { kind: 'rejected', reason: 'Bilder, Interpretation oder Höchstmaße wurden seit der Anfrage geändert – die Antwort passt nicht mehr und wurde verworfen.' };
  const candidate = designFromProposal(b, p, meta, { designId, ticketId: t.ticketId });
  const reasons: string[] = [];
  if (current && current.basedOn.briefId === b.briefId) {
    if (spatialSubstanceHash(current) !== t.designHash) reasons.push('Der räumliche Entwurf wurde seit der Anfrage geändert');
    if (current.corrections.length) reasons.push(`Der vorhandene Entwurf enthält ${current.corrections.length} Nutzerkorrektur(en), die nicht automatisch überschrieben werden`);
  }
  const problems = checkSpatial(candidate, b).filter((x) => x.level === 'error').map((x) => x.message);
  if (problems.length) reasons.push(`Der Vorschlag ist nicht stimmig: ${problems.slice(0, 3).join('; ')}`);
  return reasons.length ? { kind: 'held', candidate, reasons } : { kind: 'applied', design: candidate };
}

/** Prüft die strukturierte Antwort eines Dienstes (Schema + Regeln); „vom Nutzer“ darf der Dienst nie setzen. */
export function checkSpatialProposal(raw: unknown, imageCount: number, interp: Interpretation): { value: SpatialProposal | null; errors: string[] } {
  const p = SpatialProposal.safeParse(raw);
  if (!p.success) return { value: null, errors: p.error.issues.slice(0, 20).map((i) => `Struktur: ${i.path.join('.') || '(Wurzel)'} – ${i.message}`) };
  const errors: string[] = [];
  const groups = new Set(interp.groups.map((g) => g.id));
  for (const x of p.data.bodies) {
    if (x.groupId !== null && !groups.has(x.groupId)) errors.push(`Körper „${x.name}“ verweist auf unbekannte Baugruppe „${x.groupId}“`);
    for (const k of ['length', 'width', 'height'] as const) if (!(x.size[k] > 0)) errors.push(`Körper „${x.name}“: ${k} muss größer als 0 sein`);
  }
  for (const r of p.data.referenceViews) if (r.imageIndex < 0 || r.imageIndex >= imageCount) errors.push(`Referenzansicht verweist auf Bild ${r.imageIndex + 1}, vorhanden sind ${imageCount}`);
  if (p.data.bodies.filter((x) => x.isMain).length !== 1) errors.push('Genau ein Hauptkörper erwartet');
  return { value: p.data, errors };
}

// ---- Laden und Import

export interface LoadedSpatial { design: SpatialDesign; issues: string[]; downgraded: boolean }

/**
 * Vollständige Prüfung: JSON → Schema → Hash → Fachregeln. Unstimmige Entwürfe werden nur zur Korrektur
 * geladen (Bestätigung aufgehoben); eine passende Grundlage wird nie stillschweigend unterstellt.
 */
export function parseSpatial(text: string, b: DesignBrief | null, at = now()): LoadedSpatial {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SpatialError('Keine gültige JSON-Datei.');
  }
  if ((raw as { schema?: unknown })?.schema !== SPATIAL_SCHEMA) throw new SpatialError(`Kein räumlicher Entwurf (Schema „${SPATIAL_SCHEMA}“ erwartet).`);
  const parsed = SpatialDesignSchema.safeParse(raw);
  if (!parsed.success) throw new SpatialError(`Struktur ungültig: ${parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(Wurzel)'}: ${i.message}`).join('; ')}`);
  let d = parsed.data;
  if (spatialHash(d) !== d.contentHash) throw new SpatialError('Inhalts-Hash stimmt nicht – die Datei wurde verändert oder ist beschädigt.');
  const issues = checkSpatial(d, b).filter((x) => x.level === 'error' && !x.message.startsWith('Grundlage veraltet')).map((x) => x.message);
  if (d.confirmation.status === 'confirmed' && d.confirmation.confirmedHash !== spatialSubstanceHash(d)) issues.push('Bestätigter Inhalt weicht vom Bestätigungs-Hash ab');
  let downgraded = false;
  if (issues.length && d.confirmation.status === 'confirmed') {
    d = next(d, `Beim Laden: Bestätigung aufgehoben (${issues[0]})`, { confirmation: { ...d.confirmation, status: 'stale', reason: issues[0] } }, at);
    downgraded = true;
  }
  if (b) d = syncWithBrief(d, b, at);
  return { design: d, issues, downgraded };
}

/** Verknüpfung für das spätere kanonische Modell. */
export function toSpatialLink(d: SpatialDesign): { designId: string; version: number; contentHash: string; confirmedHash: string | null } {
  return { designId: d.designId, version: d.version, contentHash: d.contentHash, confirmedHash: d.confirmation.confirmedHash };
}

/**
 * Baugruppen der Interpretation ohne eigenen Körper. Ein Name in der Liste ist kein dargestellter Körper:
 * diese Teile fehlen im räumlichen Entwurf, bis der Nutzer sie ergänzt.
 */
export function unmodelledGroups(d: SpatialDesign, interp: Interpretation | null): { id: string; name: string; role: string }[] {
  if (!interp) return [];
  const used = new Set(d.bodies.map((b) => b.groupId));
  return interp.groups.filter((g) => !used.has(g.id)).map((g) => ({ id: g.id, name: g.name, role: g.role }));
}
