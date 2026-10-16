// Versionierter Entwurfsauftrag: bestätigte Interpretation einer Bildvorlage plus Anforderungen.
// Er ist Eingabe für die spätere Bausteinkonstruktion (Auftrag 05B) und enthält ausdrücklich
// KEINE Teilinstanzen. Jede Änderung erzeugt eine neue Version mit neuem Inhalts-Hash; Bild-
// wechsel und Korrekturen machen Analyse bzw. Bestätigung nachvollziehbar veraltet.
import { cyrb53, stableStringify } from '../model/hash';
import type { DesignProvenance } from '../model/types';
import { checkInterpretation, type Interpretation } from './interpretation';

export const BRIEF_SCHEMA = 'baustein-sim/design-brief@1';
export const ANALYSIS_METHOD_VERSION = 'design-analysis@1.0.0';

export const VIEW_LABELS = ['unbekannt', 'vorn', 'seitlich', 'hinten', 'oben', 'schräg'] as const;
export type ViewLabel = (typeof VIEW_LABELS)[number];

export interface ImageRef {
  /** = SHA-256 des Dateiinhalts; gleicher Dateiname mit anderem Inhalt ergibt eine andere Kennung. */
  sha256: string;
  mediaType: 'image/png' | 'image/jpeg';
  bytes: number;
  width: number;
  height: number;
  /** Nur zur Anzeige; wird nie analysiert. */
  fileName: string;
  view: ViewLabel;
  addedAt: string;
}

export interface AnalysisRecord {
  method: 'anthropic-vision' | 'manual' | 'import';
  /** Dienst bzw. „Nutzer“ beim manuellen Weg. */
  provider: string;
  model: string | null;
  methodVersion: string;
  promptVersion: string | null;
  /** Prüfsummen der Bilder, auf denen die Interpretation beruht (in Reihenfolge der imageIndex-Werte). */
  imageHashes: string[];
  at: string;
  requestId: string | null;
  status: 'current' | 'stale';
  staleReason: string | null;
}

export interface Correction {
  at: string;
  path: string;
  before: unknown;
  after: unknown;
}

export interface Requirements {
  partMin: number;
  partMax: number;
  /** Höchstmaße in Noppen bzw. Steinhöhen; null = keine Vorgabe. */
  maxLengthStuds: number | null;
  maxWidthStuds: number | null;
  maxHeightBricks: number | null;
  preferredSize: 'klein' | 'mittel' | 'gross' | null;
  /** Wichtigste wiederzuerkennende Merkmale (Merkmal-IDs der Interpretation), nach Priorität. */
  keyFeatureIds: string[];
  intendedUse: 'display' | 'careful-handling' | 'play-goal';
  notes: string;
}

export interface Confirmation {
  status: 'unconfirmed' | 'confirmed' | 'stale';
  at: string | null;
  /** Hash des bestätigten Inhalts (ohne Bestätigung und Verlauf). */
  confirmedHash: string | null;
  reason: string | null;
}

export interface DesignBrief {
  schema: typeof BRIEF_SCHEMA;
  briefId: string;
  version: number;
  title: string;
  images: ImageRef[];
  analysis: AnalysisRecord | null;
  interpretation: Interpretation | null;
  corrections: Correction[];
  requirements: Requirements | null;
  confirmation: Confirmation;
  history: { version: number; at: string; event: string }[];
  contentHash: string;
}

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
  const reason = `Ansicht von Bild ${sha.slice(0, 12)}… auf „${view}“ gesetzt`;
  return next(b, reason, { images: b.images.map((i) => (i.sha256 === sha ? { ...i, view } : i)), confirmation: staleConfirmation(b, reason) });
}

/** Neue Interpretation (Analyse, manuell oder Import); frühere Korrekturen gelten für die alte und entfallen. */
export function setInterpretation(b: DesignBrief, interpretation: Interpretation, analysis: Omit<AnalysisRecord, 'status' | 'staleReason' | 'imageHashes' | 'methodVersion'>): DesignBrief {
  const reason = analysis.method === 'manual' ? 'Interpretation manuell begonnen' : `Interpretation durch ${analysis.provider}${analysis.model ? ` (${analysis.model})` : ''}`;
  return next(b, reason, {
    interpretation,
    analysis: { ...analysis, methodVersion: ANALYSIS_METHOD_VERSION, imageHashes: b.images.map((i) => i.sha256), status: 'current', staleReason: null },
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
  const reason = `Interpretation vom Nutzer für die aktuellen Bilder übernommen (vorher: ${b.analysis.staleReason})`;
  return next(b, reason, { analysis: { ...b.analysis, imageHashes: b.images.map((i) => i.sha256), status: 'current', staleReason: null }, confirmation: staleConfirmation(b, reason) }, at);
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
  const sameImages = !!b.analysis && stableStringify(b.analysis.imageHashes) === stableStringify(b.images.map((i) => i.sha256));
  return [
    { ok: b.images.length > 0, label: 'Mindestens ein Bild vorhanden' },
    { ok: !!b.analysis && b.analysis.status === 'current' && sameImages, label: 'Interpretation beruht auf den aktuellen Bildern' },
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
export function isConfirmedCurrent(b: DesignBrief): boolean {
  return b.confirmation.status === 'confirmed' && b.confirmation.confirmedHash === substanceHash(b);
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

/** Prüft eine importierte Datei grob auf das Brief-Schema und den gespeicherten Inhalts-Hash. */
export function parseBrief(text: string): DesignBrief {
  let o: DesignBrief;
  try {
    o = JSON.parse(text) as DesignBrief;
  } catch {
    throw new BriefError('Keine gültige JSON-Datei.');
  }
  if (o?.schema !== BRIEF_SCHEMA) throw new BriefError(`Unbekanntes Schema „${String(o?.schema)}“ (erwartet ${BRIEF_SCHEMA}).`);
  if (!Array.isArray(o.images) || !Array.isArray(o.history) || typeof o.version !== 'number') throw new BriefError('Entwurfsauftrag unvollständig.');
  if (briefHash(o) !== o.contentHash) throw new BriefError('Inhalts-Hash stimmt nicht – die Datei wurde verändert oder ist beschädigt.');
  if (o.interpretation) {
    const c = checkInterpretation(o.interpretation, o.images.length);
    if (!c.value) throw new BriefError(`Interpretation im Import ungültig: ${c.errors[0]}`);
  }
  return o;
}
