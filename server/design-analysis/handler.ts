// Anbieterunabhängiger Ablauf der Bildanalyse auf dem lokalen Server.
// Der Browser schickt Bilder (Base64) samt Prüfsumme; der Server prüft beides erneut, ruft den
// gekapselten Anbieter auf und validiert dessen Antwort mit demselben Schema wie die Oberfläche.
// Zugangsdaten bleiben ausschließlich auf dem Server.
import { checkImageBytes, MAX_IMAGES, sha256Hex } from '../../src/core/design/images';
import { checkInterpretation, type Interpretation } from '../../src/core/design/interpretation';
import { checkSpatialProposal, type SpatialProposal } from '../../src/core/design/spatial';

export interface AnalysisImage {
  sha256: string;
  mediaType: 'image/png' | 'image/jpeg';
  data: string;
  view: string;
}

export interface ProviderResult {
  raw: unknown;
  model: string;
  requestId: string | null;
  stopReason: string | null;
}

export type ProviderErrorCode = 'auth_failed' | 'rate_limited' | 'unreachable' | 'provider_error' | 'refusal' | 'truncated' | 'unparseable';

export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, message: string, public status: number | null = null) {
    super(message);
  }
}

export interface AnalysisProvider {
  id: string;
  label: string;
  model: string;
  /** null = einsatzbereit; sonst Erklärung, was fehlt. */
  configurationProblem(): string | null;
  analyze(images: AnalysisImage[], notes: string): Promise<ProviderResult>;
  /** Räumlicher Vorschlag aus Bildern und geprüfter Interpretation (optional je Anbieter). */
  proposeSpatial?(images: AnalysisImage[], interpretation: Interpretation, notes: string): Promise<ProviderResult>;
}

export type AnalyzeResponse = (
  | { ok: true; interpretation: Interpretation; warnings: string[]; meta: { provider: string; model: string; requestId: string | null; promptVersion: string } }
  | { ok: false; code: 'not_configured' | 'invalid_request' | ProviderErrorCode | 'invalid_response' | 'contradictory_response'; message: string; errors?: string[]; candidate?: Interpretation; setup?: string[] }
) & {
  /** Kennung der Anfrage, unverändert zurückgegeben – der Browser ordnet Antworten nur darüber zu. */
  ticketId: string | null;
};

export const SETUP_HINTS = [
  'Im Projektordner eine Datei .env.local anlegen (wird nicht versioniert, siehe .env.example).',
  'Darin ANTHROPIC_API_KEY=… eintragen (Schlüssel aus der Claude Console, https://platform.claude.com/).',
  'Entwicklungsserver neu starten (npm.cmd run dev). Der Schlüssel bleibt auf dem Server und wird nie an den Browser gegeben.',
  'Ohne Schlüssel: „Manuell beschreiben“ verwenden.',
];

/**
 * „Konfiguriert“ heißt nur: ein Schlüssel ist eingetragen. Erst ein echter, erfolgreich beantworteter
 * Aufruf belegt die Funktion. Dieser Status zählt nur tatsächliche Dienstaufrufe dieser Serversitzung.
 */
export interface LiveCheck {
  status: 'unverified' | 'ok' | 'failed';
  at: string | null;
  code: string | null;
  model: string | null;
}
export const LIVE_UNVERIFIED: LiveCheck = { status: 'unverified', at: null, code: null, model: null };

export function nextLiveCheck(prev: LiveCheck, response: AnalyzeResponse | SpatialResponse, at = new Date().toISOString()): LiveCheck {
  if (response.ok) return { status: 'ok', at, code: null, model: response.meta.model };
  // Die Anfrage hat den Dienst nicht erreicht: kein Live-Beleg in die eine oder andere Richtung
  if (response.code === 'not_configured' || response.code === 'invalid_request' || response.code === 'not_supported') return prev;
  // Antwort kam an, war aber widersprüchlich: der Dienst funktioniert, die Antwort muss korrigiert werden
  if (response.code === 'contradictory_response') return { status: 'ok', at, code: response.code, model: null };
  return { status: 'failed', at, code: response.code, model: null };
}

export type SpatialResponse = (
  | { ok: true; proposal: SpatialProposal; meta: { provider: string; model: string; requestId: string | null; promptVersion: string } }
  | { ok: false; code: 'not_configured' | 'not_supported' | 'invalid_request' | ProviderErrorCode | 'invalid_response' | 'contradictory_response'; message: string; errors?: string[]; candidate?: SpatialProposal; setup?: string[] }
) & { ticketId: string | null };

const ticketOf = (body: unknown) => {
  const raw = (body as { ticketId?: unknown } | null)?.ticketId;
  return typeof raw === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? raw : null;
};

/** Bilder erneut prüfen (Inhalt, Format, Prüfsumme) – für den räumlichen Vorschlag wie für die Interpretation. */
async function imageProblem(images: unknown): Promise<string | null> {
  if (!Array.isArray(images) || images.length === 0) return 'Keine Bilder übergeben.';
  if (images.length > MAX_IMAGES) return `Höchstens ${MAX_IMAGES} Bilder je Analyse.`;
  for (const [k, img] of (images as AnalysisImage[]).entries()) {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(String(img.data), 'base64'));
    } catch {
      return `Bild ${k + 1}: keine gültigen Base64-Daten.`;
    }
    const check = checkImageBytes(bytes, img.mediaType);
    if (!check.ok) return `Bild ${k + 1}: ${check.errors.join(' ')}`;
    if ((await sha256Hex(bytes)) !== img.sha256) return `Bild ${k + 1}: Prüfsumme stimmt nicht mit dem Inhalt überein.`;
  }
  return null;
}

/** Räumlicher Vorschlag: sendet Bilder UND Interpretation erneut an den Dienst – nur auf ausdrückliche Nutzeraktion. */
export async function spatialRequest(provider: AnalysisProvider, body: unknown, promptVersion: string): Promise<{ status: number; body: SpatialResponse }> {
  const ticketId = ticketOf(body);
  const r = await spatialInner(provider, body, promptVersion);
  return { status: r.status, body: { ...r.body, ticketId } as SpatialResponse };
}

async function spatialInner(provider: AnalysisProvider, body: unknown, promptVersion: string): Promise<{ status: number; body: DistributiveOmit<SpatialResponse, 'ticketId'> }> {
  const problem = provider.configurationProblem();
  if (problem) return { status: 503, body: { ok: false, code: 'not_configured', message: problem, setup: SETUP_HINTS } };
  if (!provider.proposeSpatial) return { status: 501, body: { ok: false, code: 'not_supported', message: `${provider.label} bietet keinen räumlichen Vorschlag an.` } };
  const b = body as { images?: AnalysisImage[]; interpretation?: unknown; notes?: unknown } | null;
  const imgProblem = await imageProblem(b?.images);
  if (imgProblem) return { status: 400, body: { ok: false, code: 'invalid_request', message: imgProblem } };
  const images = b!.images!;
  const interp = checkInterpretation(b!.interpretation, images.length);
  if (!interp.ok || !interp.value) return { status: 400, body: { ok: false, code: 'invalid_request', message: 'Die übergebene Interpretation ist nicht gültig – zuerst korrigieren.', errors: interp.errors } };
  let result: ProviderResult;
  try {
    result = await provider.proposeSpatial(images, interp.value, typeof b!.notes === 'string' ? b!.notes.slice(0, 4000) : '');
  } catch (e) {
    if (e instanceof ProviderError) return { status: e.code === 'rate_limited' ? 429 : 502, body: { ok: false, code: e.code, message: e.message } };
    return { status: 502, body: { ok: false, code: 'provider_error', message: `Unerwarteter Fehler beim Analysedienst: ${String(e)}` } };
  }
  const check = checkSpatialProposal(result.raw, images.length, interp.value);
  if (!check.value) return { status: 502, body: { ok: false, code: 'invalid_response', message: 'Die Antwort entspricht nicht dem Format eines räumlichen Vorschlags.', errors: check.errors } };
  if (check.errors.length) return { status: 422, body: { ok: false, code: 'contradictory_response', message: 'Der räumliche Vorschlag ist unstimmig. Er kann geprüft und korrigiert, aber nicht ungeprüft übernommen werden.', errors: check.errors, candidate: check.value } };
  return { status: 200, body: { ok: true, proposal: check.value, meta: { provider: provider.label, model: result.model, requestId: result.requestId, promptVersion } } };
}

export async function analyzeRequest(provider: AnalysisProvider, body: unknown, promptVersion: string): Promise<{ status: number; body: AnalyzeResponse }> {
  const raw = (body as { ticketId?: unknown } | null)?.ticketId;
  const ticketId = typeof raw === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? raw : null;
  const r = await analyzeInner(provider, body, promptVersion);
  return { status: r.status, body: { ...r.body, ticketId } as AnalyzeResponse };
}

type InnerResponse = { status: number; body: DistributiveOmit<AnalyzeResponse, 'ticketId'> };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

async function analyzeInner(provider: AnalysisProvider, body: unknown, promptVersion: string): Promise<InnerResponse> {
  const problem = provider.configurationProblem();
  if (problem) return { status: 503, body: { ok: false, code: 'not_configured', message: problem, setup: SETUP_HINTS } };
  const b = body as { images?: AnalysisImage[]; notes?: unknown } | null;
  if (!b || !Array.isArray(b.images) || b.images.length === 0) return { status: 400, body: { ok: false, code: 'invalid_request', message: 'Keine Bilder übergeben.' } };
  if (b.images.length > MAX_IMAGES) return { status: 400, body: { ok: false, code: 'invalid_request', message: `Höchstens ${MAX_IMAGES} Bilder je Analyse.` } };
  for (const [k, img] of b.images.entries()) {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(String(img.data), 'base64'));
    } catch {
      return { status: 400, body: { ok: false, code: 'invalid_request', message: `Bild ${k + 1}: keine gültigen Base64-Daten.` } };
    }
    const check = checkImageBytes(bytes, img.mediaType);
    if (!check.ok) return { status: 400, body: { ok: false, code: 'invalid_request', message: `Bild ${k + 1}: ${check.errors.join(' ')}` } };
    if ((await sha256Hex(bytes)) !== img.sha256) return { status: 400, body: { ok: false, code: 'invalid_request', message: `Bild ${k + 1}: Prüfsumme stimmt nicht mit dem Inhalt überein.` } };
  }
  let result: ProviderResult;
  try {
    result = await provider.analyze(b.images, typeof b.notes === 'string' ? b.notes.slice(0, 4000) : '');
  } catch (e) {
    if (e instanceof ProviderError) return { status: e.code === 'auth_failed' ? 502 : e.code === 'rate_limited' ? 429 : 502, body: { ok: false, code: e.code, message: e.message } };
    return { status: 502, body: { ok: false, code: 'provider_error', message: `Unerwarteter Fehler beim Analysedienst: ${String(e)}` } };
  }
  const check = checkInterpretation(result.raw, b.images.length);
  if (!check.value) return { status: 502, body: { ok: false, code: 'invalid_response', message: 'Die Antwort des Analysedienstes entspricht nicht dem erwarteten Format.', errors: check.errors } };
  if (!check.ok) return { status: 422, body: { ok: false, code: 'contradictory_response', message: 'Die Antwort ist unvollständig oder widersprüchlich. Sie kann als Entwurf übernommen und korrigiert werden; bestätigen lässt sie sich erst nach der Korrektur.', errors: check.errors, candidate: check.value } };
  return { status: 200, body: { ok: true, interpretation: check.value, warnings: check.warnings, meta: { provider: provider.label, model: result.model, requestId: result.requestId, promptVersion } } };
}
