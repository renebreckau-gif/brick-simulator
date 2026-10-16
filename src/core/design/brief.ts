// Versionierter Entwurfsauftrag: bestätigte Interpretation einer Bildvorlage plus Anforderungen.
// Er ist Eingabe für die spätere Bausteinkonstruktion (Auftrag 05B) und enthält ausdrücklich
// KEINE Teilinstanzen. Jede Änderung erzeugt eine neue Version mit neuem Inhalts-Hash; Bild-
// wechsel und Korrekturen machen Analyse bzw. Bestätigung nachvollziehbar veraltet.
import { z } from 'zod';
import { cyrb53, stableStringify } from '../model/hash';
import type { DesignProvenance } from '../model/types';
import { MAX_EDGE_PX, MAX_IMAGE_BYTES, MAX_IMAGES, MIN_EDGE_PX } from './images';
import { checkInterpretation, Interpretation } from './interpretation';

export const BRIEF_SCHEMA = 'baustein-sim/design-brief@1';
export const ANALYSIS_METHOD_VERSION = 'design-analysis@1.0.0';

export const VIEW_LABELS = ['unbekannt', 'vorn', 'seitlich', 'hinten', 'oben', 'schräg'] as const;
export type ViewLabel = (typeof VIEW_LABELS)[number];

// ---- Laufzeitschema: Typen und Importprüfung kommen aus derselben Quelle
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'keine SHA-256-Prüfsumme (64 Hex-Zeichen)');
const IsoTime = z.string().refine((t) => !Number.isNaN(Date.parse(t)), 'kein gültiger Zeitpunkt');
const PositiveInt = z.number().int().positive();

export const ImageRefSchema = z.object({
  /** = SHA-256 des Dateiinhalts; gleicher Dateiname mit anderem Inhalt ergibt eine andere Kennung. */
  sha256: Sha256,
  mediaType: z.enum(['image/png', 'image/jpeg']),
  bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
  width: z.number().int().min(MIN_EDGE_PX).max(MAX_EDGE_PX),
  height: z.number().int().min(MIN_EDGE_PX).max(MAX_EDGE_PX),
  /** Nur zur Anzeige; wird nie analysiert. */
  fileName: z.string(),
  view: z.enum(VIEW_LABELS),
  addedAt: IsoTime,
});
export type ImageRef = z.infer<typeof ImageRefSchema>;

export const AnalysisRecordSchema = z.object({
  method: z.enum(['anthropic-vision', 'manual', 'import']),
  /** Dienst bzw. „Nutzer“ beim manuellen Weg. */
  provider: z.string(),
  model: z.string().nullable(),
  methodVersion: z.string(),
  promptVersion: z.string().nullable(),
  /** Prüfsummen der Bilder, auf denen die Interpretation tatsächlich beruht (Reihenfolge = imageIndex). */
  imageHashes: z.array(Sha256),
  /**
   * Ansichtsbezeichnungen, mit denen die Bilder analysiert wurden (Reihenfolge = imageHashes).
   * null = nicht belegt (ältere Datei ohne dieses Feld) – dann gilt die Bindung als nicht nachgewiesen.
   */
  inputViews: z.array(z.enum(VIEW_LABELS)).nullable().default(null),
  /** An die Analyse übergebene Hinweise des Nutzers. */
  notes: z.string().default(''),
  /** Kennung der Analyseanfrage (null beim manuellen Weg). */
  ticketId: z.string().nullable().default(null),
  at: IsoTime,
  requestId: z.string().nullable(),
  status: z.enum(['current', 'stale']),
  staleReason: z.string().nullable(),
});
export type AnalysisRecord = z.infer<typeof AnalysisRecordSchema>;

export const CorrectionSchema = z.object({ at: IsoTime, path: z.string().min(1), before: z.unknown(), after: z.unknown() });
export type Correction = z.infer<typeof CorrectionSchema>;

export const RequirementsSchema = z.object({
  partMin: PositiveInt,
  partMax: PositiveInt,
  /** Höchstmaße in Noppen bzw. Steinhöhen; null = keine Vorgabe. */
  maxLengthStuds: PositiveInt.nullable(),
  maxWidthStuds: PositiveInt.nullable(),
  maxHeightBricks: PositiveInt.nullable(),
  preferredSize: z.enum(['klein', 'mittel', 'gross']).nullable(),
  /** Wichtigste wiederzuerkennende Merkmale (Merkmal-IDs der Interpretation), nach Priorität. */
  keyFeatureIds: z.array(z.string()),
  intendedUse: z.enum(['display', 'careful-handling', 'play-goal']),
  notes: z.string(),
});
export type Requirements = z.infer<typeof RequirementsSchema>;

export const ConfirmationSchema = z.object({
  status: z.enum(['unconfirmed', 'confirmed', 'stale']),
  at: IsoTime.nullable(),
  /** Hash des bestätigten Inhalts (ohne Bestätigung und Verlauf). */
  confirmedHash: z.string().nullable(),
  reason: z.string().nullable(),
});
export type Confirmation = z.infer<typeof ConfirmationSchema>;

/** Verständliche deutsche Meldung für eine Schemaabweichung. */
function issueText(i: z.core.$ZodIssue): string {
  const where = i.path.join('.') || '(Wurzel)';
  if (i.code === 'invalid_type' && /received undefined/.test(i.message)) return `${where}: Pflichtfeld fehlt`;
  if (i.code === 'invalid_type') return `${where}: falscher Datentyp (${i.message})`;
  if (i.code === 'invalid_value') return `${where}: unzulässiger Wert`;
  return `${where}: ${i.message}`;
}

export const DesignBriefSchema = z.object({
  schema: z.literal(BRIEF_SCHEMA),
  briefId: z.string().min(1),
  version: PositiveInt,
  title: z.string(),
  images: z.array(ImageRefSchema).max(MAX_IMAGES),
  analysis: AnalysisRecordSchema.nullable(),
  interpretation: Interpretation.nullable(),
  corrections: z.array(CorrectionSchema),
  requirements: RequirementsSchema.nullable(),
  confirmation: ConfirmationSchema,
  history: z.array(z.object({ version: PositiveInt, at: IsoTime, event: z.string() })).min(1),
  contentHash: z.string().min(1),
});
export type DesignBrief = z.infer<typeof DesignBriefSchema>;

const now = () => new Date().toISOString();

/** Inhalt, der bestätigt wird – ohne Bestätigungsstand, Verlauf, Version und Hash. */
export function substanceHash(b: DesignBrief): string {
  return cyrb53(stableStringify({ images: b.images.map((i) => ({ sha256: i.sha256, view: i.view })), analysis: b.analysis && { ...b.analysis, at: undefined }, interpretation: b.interpretation, corrections: b.corrections.map((c) => ({ path: c.path, after: c.after })), requirements: b.requirements, title: b.title }));
}

export function briefHash(b: DesignBrief): string {
  const { contentHash: _ignored, ...rest } = b;
  void _ignored;
  return cyrb53(stableStringify(rest));
}

function next(b: DesignBrief, event: string, patch: Partial<DesignBrief>, at = now()): DesignBrief {
  const n: DesignBrief = { ...b, ...patch, version: b.version + 1, history: [...b.history, { version: b.version + 1, at, event }], contentHash: '' };
  return { ...n, contentHash: briefHash(n) };
}

/** Bestätigung wird veraltet, sobald sich bestätigter Inhalt ändert. */
function staleConfirmation(b: DesignBrief, reason: string): Confirmation {
  return b.confirmation.status === 'confirmed' || b.confirmation.status === 'stale' ? { ...b.confirmation, status: 'stale', reason } : b.confirmation;
}

function staleAnalysis(b: DesignBrief, reason: string): AnalysisRecord | null {
  return b.analysis ? { ...b.analysis, status: 'stale', staleReason: reason } : null;
}

export function newBrief(briefId: string, title = 'Neuer Entwurf', at = now()): DesignBrief {
  const b: DesignBrief = {
    schema: BRIEF_SCHEMA, briefId, version: 1, title, images: [], analysis: null, interpretation: null, corrections: [], requirements: null,
    confirmation: { status: 'unconfirmed', at: null, confirmedHash: null, reason: null }, history: [{ version: 1, at, event: 'angelegt' }], contentHash: '',
  };
  return { ...b, contentHash: briefHash(b) };
}

/** Bildmenge geändert → Interpretation beruht auf anderen Bildern → veraltet. */
export function addImage(b: DesignBrief, img: ImageRef): DesignBrief {
  if (b.images.some((i) => i.sha256 === img.sha256)) return b;
  const reason = `Bild ${img.fileName} (${img.sha256.slice(0, 12)}…) hinzugefügt`;
  return next(b, reason, { images: [...b.images, img], analysis: staleAnalysis(b, reason), confirmation: staleConfirmation(b, reason) });
}

export function replaceImage(b: DesignBrief, oldSha: string, img: ImageRef): DesignBrief {
  if (oldSha === img.sha256) return b;
  const reason = `Bild ${oldSha.slice(0, 12)}… durch ${img.fileName} (${img.sha256.slice(0, 12)}…) ersetzt`;
  return next(b, reason, { images: b.images.map((i) => (i.sha256 === oldSha ? { ...img, view: i.view } : i)), analysis: staleAnalysis(b, reason), confirmation: staleConfirmation(b, reason) });
}

export function removeImage(b: DesignBrief, sha: string): DesignBrief {
  const reason = `Bild ${sha.slice(0, 12)}… entfernt`;
  return next(b, reason, { images: b.images.filter((i) => i.sha256 !== sha), analysis: staleAnalysis(b, reason), confirmation: staleConfirmation(b, reason) });
}

export function setView(b: DesignBrief, sha: string, view: ViewLabel): DesignBrief {
  const img = b.images.find((i) => i.sha256 === sha);
  if (!img || img.view === view) return b;
  const reason = `Ansicht von Bild ${sha.slice(0, 12)}… von „${img.view}“ auf „${view}“ geändert`;
  return next(b, reason, { images: b.images.map((i) => (i.sha256 === sha ? { ...i, view } : i)), analysis: staleAnalysis(b, reason), confirmation: staleConfirmation(b, reason) });
}

export type AnalysisMeta = Pick<AnalysisRecord, 'method' | 'provider' | 'model' | 'promptVersion' | 'at' | 'requestId'>;

/** Worauf sich eine Interpretation bezieht: tatsächlich analysierte Bilder, Ansichten, Hinweise, Anfrage. */
export interface InputBinding {
  imageHashes: string[];
  views: ViewLabel[];
  notes: string;
  ticketId: string | null;
}

export function currentBinding(b: DesignBrief, notes = '', ticketId: string | null = null): InputBinding {
  return { imageHashes: b.images.map((i) => i.sha256), views: b.images.map((i) => i.view), notes, ticketId };
}

/**
 * Einheitliche Bindungsprüfung: Passt eine Interpretation (Prüfsummen, Reihenfolge, Ansichten) zu den
 * aktuellen Bildern? Ohne belegte Ansichten (null) gilt die Bindung als nicht nachgewiesen.
 * Gibt null zurück, wenn alles passt, sonst die Abweichung als Text.
 */
export function bindingMismatch(b: DesignBrief, hashes: readonly string[], views: readonly ViewLabel[] | null): string | null {
  const cur = b.images.map((i) => i.sha256);
  if (stableStringify(hashes) !== stableStringify(cur))
    return [...hashes].sort().join() === [...cur].sort().join()
      ? 'Reihenfolge der Bilder weicht ab'
      : `andere Bilder (${hashes.map((h) => h.slice(0, 12)).join(', ') || 'keine'}) als die aktuellen`;
  if (views === null) return 'Ansichten der Analyse nicht belegt (ältere Datei ohne inputViews)';
  const curViews = b.images.map((i) => i.view);
  if (stableStringify(views) !== stableStringify(curViews))
    return `andere Ansichten (${views.join(', ')}) als die aktuellen (${curViews.join(', ')})`;
  return null;
}

/** Gilt die vorhandene Interpretation als aktuell und an die vorhandenen Bilder und Ansichten gebunden? */
export function analysisBound(b: DesignBrief): boolean {
  return !!b.analysis && b.analysis.status === 'current' && bindingMismatch(b, b.analysis.imageHashes, b.analysis.inputViews) === null;
}

/**
 * Neue Interpretation (Analyse, manuell oder Import); frühere Korrekturen gelten für die alte und entfallen.
 * Der Bildbezug kommt aus der Bindung (bei Analysen: die tatsächlich gesendeten Bilder), nie stillschweigend
 * aus dem aktuellen Stand. Passt er nicht zu den aktuellen Bildern, ist die Interpretation sofort veraltet.
 */
export function setInterpretation(b: DesignBrief, interpretation: Interpretation, analysis: AnalysisMeta, binding: InputBinding = currentBinding(b)): DesignBrief {
  const reason = analysis.method === 'manual' ? 'Interpretation manuell begonnen' : `Interpretation durch ${analysis.provider}${analysis.model ? ` (${analysis.model})` : ''}`;
  const mismatch = bindingMismatch(b, binding.imageHashes, binding.views);
  const matches = mismatch === null;
  return next(b, reason, {
    interpretation,
    analysis: {
      ...analysis, methodVersion: ANALYSIS_METHOD_VERSION, imageHashes: [...binding.imageHashes], inputViews: [...binding.views], notes: binding.notes, ticketId: binding.ticketId,
      status: matches ? 'current' : 'stale', staleReason: matches ? null : `Interpretation bezieht sich auf ${mismatch}`,
    },
    corrections: [],
    confirmation: staleConfirmation(b, reason),
  });
}

/**
 * Nutzer übernimmt die bestehende Interpretation ausdrücklich für die aktuellen Bilder (z. B. nach dem
 * Austausch gegen eine bessere Aufnahme). Protokolliert; die Herkunft bleibt, die Bildbezüge werden neu gesetzt.
 */
export function rebaseInterpretation(b: DesignBrief, at = now()): DesignBrief {
  if (!b.interpretation || !b.analysis || b.analysis.status !== 'stale') return b;
  const reason = `Interpretation vom Nutzer ausdrücklich für die aktuellen Bilder und Ansichten (${b.images.map((i) => `${i.sha256.slice(0, 12)}…/${i.view}`).join(', ')}) neu bewertet (vorher: ${b.analysis.staleReason})`;
  return next(b, reason, { analysis: { ...b.analysis, imageHashes: b.images.map((i) => i.sha256), inputViews: b.images.map((i) => i.view), status: 'current', staleReason: null }, confirmation: staleConfirmation(b, reason) }, at);
}

// ---- Analyseanfragen: unveränderliche Bindung an den Eingabestand zum Zeitpunkt der Anfrage

/** Eingaben einer Analyse: Bilder samt Reihenfolge und Ansicht. */
export function analysisInputHash(b: DesignBrief): string {
  return cyrb53(stableStringify(b.images.map((i) => [i.sha256, i.view])));
}
/**
 * Stand, den eine eintreffende Antwort überschreiben würde: Interpretation, Korrekturen, Analyseherkunft.
 * Der Veraltet-Status selbst zählt nicht dazu – er folgt aus Bildänderungen, die der Eingabe-Hash erfasst.
 */
export function interpretationStateHash(b: DesignBrief): string {
  const analysis = b.analysis && { ...b.analysis, status: undefined, staleReason: undefined };
  return cyrb53(stableStringify({ interpretation: b.interpretation, corrections: b.corrections, analysis }));
}

export interface AnalysisTicket {
  ticketId: string;
  briefId: string;
  briefVersion: number;
  inputHash: string;
  interpretationHash: string;
  binding: InputBinding;
  startedAt: string;
}

export function createTicket(b: DesignBrief, notes: string, ticketId: string, at = now()): AnalysisTicket {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(ticketId)) throw new BriefError('Ungültige Anfragekennung');
  return Object.freeze({ ticketId, briefId: b.briefId, briefVersion: b.version, inputHash: analysisInputHash(b), interpretationHash: interpretationStateHash(b), binding: Object.freeze(currentBinding(b, notes, ticketId)), startedAt: at }) as AnalysisTicket;
}

/** Eine nicht automatisch übernommene Analyseantwort – behält ihren ursprünglichen Bildbezug. */
export interface HeldAnalysis {
  ticket: AnalysisTicket;
  interpretation: Interpretation;
  meta: AnalysisMeta;
  reasons: string[];
  /** Fehler bei widersprüchlichen Antworten (Kandidat zur Korrektur). */
  problems: string[];
}

export type ApplyOutcome =
  | { kind: 'applied'; brief: DesignBrief }
  | { kind: 'held'; held: HeldAnalysis }
  | { kind: 'rejected'; reason: string };

/** Gründe, aus denen eine Antwort zu diesem Ticket den aktuellen Stand nicht mehr automatisch ersetzen darf. */
export function ticketConflicts(current: DesignBrief, t: AnalysisTicket): string[] {
  const r: string[] = [];
  if (analysisInputHash(current) !== t.inputHash) r.push('Bilder, ihre Reihenfolge oder Ansichten wurden seit der Anfrage geändert');
  if (interpretationStateHash(current) !== t.interpretationHash) r.push('Die Interpretation wurde seit der Anfrage geändert (Korrektur, neuer Beginn oder Import)');
  return r;
}

/**
 * Wendet eine eintreffende Analyseantwort an – nur, wenn sich der relevante Entwurfsstand seit der Anfrage
 * nicht geändert hat. Sonst wird sie zurückgehalten (mit ursprünglichem Bildbezug) bzw. bei einem anderen
 * Entwurf verworfen. Widersprüchliche Antworten (problems) werden nie automatisch übernommen.
 */
export function applyAnalysisResult(current: DesignBrief, t: AnalysisTicket, interpretation: Interpretation, meta: AnalysisMeta, problems: string[] = []): ApplyOutcome {
  if (current.briefId !== t.briefId) return { kind: 'rejected', reason: `Die Antwort gehört zu Entwurf „${t.briefId}“; inzwischen ist „${current.briefId}“ geöffnet. Sie wurde verworfen.` };
  const reasons = ticketConflicts(current, t);
  if (reasons.length || problems.length) return { kind: 'held', held: { ticket: t, interpretation, meta, reasons, problems } };
  return { kind: 'applied', brief: setInterpretation(current, interpretation, meta, t.binding) };
}

/** Ausdrückliche Übernahme einer zurückgehaltenen Antwort durch den Nutzer – mit ihrem ursprünglichen Bildbezug. */
export function adoptHeldAnalysis(current: DesignBrief, h: HeldAnalysis): DesignBrief {
  if (current.briefId !== h.ticket.briefId) throw new BriefError('Die zurückgehaltene Antwort gehört zu einem anderen Entwurf.');
  return setInterpretation(current, h.interpretation, h.meta, h.ticket.binding);
}

function getAt(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}
function setAt<T>(obj: T, path: string[], value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = [...obj];
    copy[Number(k)] = setAt(copy[Number(k)], rest, value);
    return copy as T;
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  return { ...o, [k]: setAt(o[k], rest, value) } as T;
}

/**
 * Nutzerkorrektur an der Interpretation (Pfad wie „groups.1.relativeSize.height“).
 * Korrigierte Aussagen erhalten die Grundlage „vom Nutzer vorgegeben“, sofern sie eine Grundlage tragen.
 */
export function correct(b: DesignBrief, path: string, value: unknown, at = now()): DesignBrief {
  if (!b.interpretation) throw new Error('Keine Interpretation vorhanden');
  const parts = path.split('.');
  const before = getAt(b.interpretation, parts);
  if (stableStringify(before) === stableStringify(value)) return b;
  let interp = setAt(b.interpretation, parts, value);
  // Grundlage des nächsten Elements mit „basis“ auf „user“ setzen (außer der Nutzer setzt die Grundlage selbst)
  if (parts.at(-1) !== 'basis')
    for (let i = parts.length - 1; i > 0; i--) {
      const owner = getAt(interp, parts.slice(0, i));
      if (owner && typeof owner === 'object' && !Array.isArray(owner) && 'basis' in owner) {
        interp = setAt(interp, [...parts.slice(0, i), 'basis'], 'user');
        break;
      }
    }
  const reason = `Korrektur ${path}`;
  return next(b, reason, { interpretation: interp, corrections: [...b.corrections, { at, path, before: before ?? null, after: value }], confirmation: staleConfirmation(b, reason) }, at);
}

/** Ganze Liste ersetzen (Baugruppe/Farbe/Merkmal hinzufügen oder entfernen) – ebenfalls als Korrektur protokolliert. */
export function correctList(b: DesignBrief, key: 'groups' | 'colors' | 'features' | 'hiddenAreas' | 'openQuestions' | 'simplifications', list: unknown[], at = now()): DesignBrief {
  return correct(b, key, list, at);
}

export function setRequirements(b: DesignBrief, r: Requirements): DesignBrief {
  if (stableStringify(r) === stableStringify(b.requirements)) return b;
  return next(b, 'Anforderungen geändert', { requirements: r, confirmation: staleConfirmation(b, 'Anforderungen geändert') });
}

export function setTitle(b: DesignBrief, title: string): DesignBrief {
  if (title === b.title) return b;
  return next(b, 'Titel geändert', { title, confirmation: staleConfirmation(b, 'Titel geändert') });
}

export interface ReadinessItem {
  ok: boolean;
  label: string;
}

/** Was vor der Bestätigung erfüllt sein muss. */
export function readiness(b: DesignBrief): ReadinessItem[] {
  const check = b.interpretation ? checkInterpretation(b.interpretation, b.images.length) : null;
  const r = b.requirements;
  const featureIds = new Set(b.interpretation?.features.map((f) => f.id) ?? []);
  return [
    { ok: b.images.length > 0, label: 'Mindestens ein Bild vorhanden' },
    { ok: analysisBound(b), label: 'Interpretation beruht auf den aktuellen Bildern und Ansichten' },
    { ok: !!check?.ok, label: check ? (check.ok ? 'Interpretation strukturell gültig und widerspruchsfrei' : `Interpretation fehlerhaft: ${check.errors[0]}`) : 'Interpretation vorhanden' },
    { ok: !!r && Number.isInteger(r.partMin) && Number.isInteger(r.partMax) && r.partMin > 0 && r.partMin <= r.partMax, label: 'Teilezahlbereich angegeben (ganze Zahlen, Minimum ≤ Maximum)' },
    { ok: !!r && r.keyFeatureIds.length > 0 && r.keyFeatureIds.every((id) => featureIds.has(id)), label: 'Wichtigste Merkmale ausgewählt' },
    { ok: !!r && [r.maxLengthStuds, r.maxWidthStuds, r.maxHeightBricks].every((v) => v === null || (Number.isInteger(v) && v > 0)), label: 'Höchstmaße leer oder positive ganze Zahlen' },
  ];
}

export class BriefError extends Error {}

export function confirm(b: DesignBrief, at = now()): DesignBrief {
  const missing = readiness(b).filter((i) => !i.ok);
  if (missing.length) throw new BriefError(`Nicht bestätigbar: ${missing.map((m) => m.label).join('; ')}`);
  return next(b, 'Entwurfsauftrag bestätigt', { confirmation: { status: 'confirmed', at, confirmedHash: substanceHash(b), reason: null } }, at);
}

/** Ist die Bestätigung noch gültig (Inhalt seit der Bestätigung unverändert)? */
/**
 * Fachliche Prüfung eines vollständigen Entwurfsauftrags (über die Strukturprüfung hinaus).
 * Leere Liste = fachlich stimmig. Ein korrekter Inhalts-Hash ersetzt diese Prüfung nicht.
 */
const BOUND_ISSUE = 'Analyse ist als aktuell markiert, passt aber nicht zu den vorhandenen Bildern';

export function briefIssues(b: DesignBrief): string[] {
  const out: string[] = [];
  const v = DesignBriefSchema.safeParse(b);
  if (!v.success) return v.error.issues.slice(0, 10).map((i) => `Struktur: ${issueText(i)}`);
  const shas = b.images.map((i) => i.sha256);
  if (new Set(shas).size !== shas.length) out.push('Bilder: dieselbe Prüfsumme mehrfach');
  b.history.forEach((h, k) => h.version !== k + 1 && out.push(`Verlauf: Eintrag ${k + 1} trägt Version ${h.version}`));
  if (b.history.at(-1)!.version !== b.version) out.push(`Verlauf endet bei Version ${b.history.at(-1)!.version}, Auftrag hat Version ${b.version}`);
  if (!!b.analysis !== !!b.interpretation) out.push('Analyseherkunft und Interpretation müssen gemeinsam vorhanden sein');
  if (b.analysis) {
    if (b.analysis.inputViews && b.analysis.inputViews.length !== b.analysis.imageHashes.length) out.push('Analyseherkunft: Anzahl der Ansichten passt nicht zu den Bildern');
    const mismatch = bindingMismatch(b, b.analysis.imageHashes, b.analysis.inputViews);
    if (b.analysis.status === 'current' && mismatch) out.push(`${BOUND_ISSUE}: ${mismatch}`);
    if (b.analysis.status === 'stale' && !b.analysis.staleReason) out.push('Veraltete Analyse ohne Begründung');
  }
  if (b.interpretation) {
    const c = checkInterpretation(b.interpretation, b.analysis?.imageHashes.length ?? b.images.length);
    out.push(...c.errors.map((e) => `Interpretation: ${e}`));
  }
  if (b.requirements) {
    const r = b.requirements;
    if (r.partMin > r.partMax) out.push('Anforderungen: Teilezahl-Minimum größer als Maximum');
    const fids = new Set(b.interpretation?.features.map((f) => f.id) ?? []);
    for (const id of r.keyFeatureIds) if (!fids.has(id)) out.push(`Anforderungen: wichtiges Merkmal „${id}“ existiert nicht`);
  }
  const c = b.confirmation;
  if (c.status === 'confirmed' && (!c.at || !c.confirmedHash)) out.push('Bestätigung ohne Zeitpunkt oder bestätigten Hash');
  if (c.status === 'confirmed' && c.confirmedHash !== substanceHash(b)) out.push('Bestätigter Hash passt nicht zum Inhalt');
  if (c.status === 'unconfirmed' && c.confirmedHash) out.push('Unbestätigter Auftrag trägt einen bestätigten Hash');
  return out;
}

/**
 * Gültig bestätigt = bestätigt, Inhalt seit der Bestätigung unverändert, fachlich stimmig und alle
 * Voraussetzungen (u. a. aktuelle Bildzuordnung) erfüllt. Wirft nie, auch nicht bei defekten Daten.
 */
export function isConfirmedCurrent(b: DesignBrief): boolean {
  try {
    return b?.confirmation?.status === 'confirmed' && b.confirmation.confirmedHash === substanceHash(b) && briefIssues(b).length === 0 && readiness(b).every((r) => r.ok);
  } catch {
    return false;
  }
}

/**
 * Entwurfsherkunft für ein später konstruiertes Modell (CanonicalModel.design). Nur aus einem
 * gültig bestätigten Auftrag. Abweichungen entstehen erst bei der Konstruktion (05B) und bleiben hier leer.
 */
export function toDesignProvenance(b: DesignBrief): DesignProvenance {
  if (!isConfirmedCurrent(b) || !b.interpretation || !b.analysis) throw new BriefError('Nur ein gültig bestätigter Entwurfsauftrag kann einem Modell zugeordnet werden.');
  const i = b.interpretation;
  const assumptions: DesignProvenance['assumptions'] = [
    ...i.groups.filter((g) => g.basis === 'assumed').map((g) => ({ id: `group:${g.id}`, statement: `${g.name}: ${g.description}`, basis: 'konstruktiv angenommen' })),
    ...i.hiddenAreas.map((h, k) => ({ id: `hidden:${k + 1}`, statement: h.description, basis: h.basis === 'user' ? 'vom Nutzer vorgegeben' : 'verdeckt – angenommen' })),
    ...(i.symmetry.basis !== 'observed' && i.symmetry.kind !== 'unklar' ? [{ id: 'symmetry', statement: `Symmetrie: ${i.symmetry.kind}`, basis: i.symmetry.basis === 'user' ? 'vom Nutzer vorgegeben' : 'konstruktiv angenommen' }] : []),
  ];
  return {
    schema: 'baustein-sim/design-provenance@1',
    brief: { briefId: b.briefId, version: b.version, contentHash: b.contentHash, confirmedHash: b.confirmation.confirmedHash! },
    sources: b.images.map((img, k) => ({ sourceId: `bild-${k + 1}`, kind: 'concept-image' as const, label: `${img.fileName} (Ansicht ${img.view})`, mediaType: img.mediaType, sha256: img.sha256, rights: 'vom Nutzer bereitgestellt; Rechte beim Nutzer; Bilddaten nicht im Modell' })),
    interpretation: { method: b.analysis.method === 'anthropic-vision' ? `${b.analysis.provider} ${b.analysis.model ?? ''}`.trim() : b.analysis.method === 'manual' ? 'manuelle Beschreibung' : 'importiert', version: b.analysis.methodVersion, notes: `${b.corrections.length} Nutzerkorrektur(en)` },
    assumptions,
    deviations: [],
    visualComparison: { method: 'noch nicht implementiert', version: '0', status: 'unchecked' },
  };
}

export interface LoadedBrief {
  brief: DesignBrief;
  /** Fachliche Probleme; der Auftrag ist dann höchstens unbestätigt zur Korrektur geladen. */
  issues: string[];
  /** true = eine vorhandene Bestätigung oder ein „aktueller“ Analysestand wurde beim Laden aufgehoben. */
  downgraded: boolean;
}

/**
 * Lädt einen Entwurfsauftrag (Import oder lokale Wiederherstellung) mit vollständiger Laufzeitprüfung:
 * 1. JSON, Schema-Kennung, Struktur aller Felder (zod) – sonst Ablehnung mit Meldung;
 * 2. Inhalts-Hash – sonst Ablehnung;
 * 3. fachliche Prüfung – Probleme führen nicht zur Ablehnung, aber eine Bestätigung bzw. ein als aktuell
 *    markierter Analysestand wird nachvollziehbar aufgehoben (neue Version, Eintrag im Verlauf).
 */
export function parseBrief(text: string, at = now()): LoadedBrief {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BriefError('Keine gültige JSON-Datei.');
  }
  const schema = (raw as { schema?: unknown } | null)?.schema;
  if (schema !== BRIEF_SCHEMA) throw new BriefError(`Unbekanntes Schema „${String(schema)}“ (erwartet ${BRIEF_SCHEMA}).`);
  const parsed = DesignBriefSchema.safeParse(raw);
  if (!parsed.success) throw new BriefError(`Entwurfsauftrag strukturell ungültig: ${parsed.error.issues.slice(0, 3).map(issueText).join('; ')}`);
  // Hash über die Rohdaten (nicht über ergänzte Standardwerte), damit veränderte Dateien auffallen
  if (briefHash(raw as DesignBrief) !== parsed.data.contentHash) throw new BriefError('Inhalts-Hash stimmt nicht – die Datei wurde verändert oder ist beschädigt.');
  let brief = parsed.data;
  if (briefHash(brief) !== brief.contentHash) brief = { ...brief, contentHash: briefHash(brief) }; // ältere Datei: Standardwerte ergänzt
  const issues = briefIssues(brief);
  if (!issues.length) return { brief, issues, downgraded: false };
  const reason = `Beim Laden fachlich ungültig: ${issues[0]}${issues.length > 1 ? ` (+${issues.length - 1} weitere)` : ''}`;
  const confirmed = brief.confirmation.status === 'confirmed';
  // Ein als „aktuell“ markierter Analysestand wird nur aufgehoben, wenn er nicht zu den Bildern passt
  const currentAnalysis = brief.analysis?.status === 'current' && issues.some((i) => i.startsWith(BOUND_ISSUE));
  if (!confirmed && !currentAnalysis) return { brief, issues, downgraded: false };
  brief = next(brief, reason, {
    confirmation: confirmed ? { ...brief.confirmation, status: 'stale', reason } : brief.confirmation,
    analysis: currentAnalysis && brief.analysis ? { ...brief.analysis, status: 'stale', staleReason: reason } : brief.analysis,
  }, at);
  return { brief, issues, downgraded: true };
}
