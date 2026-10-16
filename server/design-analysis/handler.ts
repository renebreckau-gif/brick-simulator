// Anbieterunabhängiger Ablauf der Bildanalyse auf dem lokalen Server.
// Der Browser schickt Bilder (Base64) samt Prüfsumme; der Server prüft beides erneut, ruft den
// gekapselten Anbieter auf und validiert dessen Antwort mit demselben Schema wie die Oberfläche.
// Zugangsdaten bleiben ausschließlich auf dem Server.
import { checkImageBytes, MAX_IMAGES, sha256Hex } from '../../src/core/design/images';
import { checkInterpretation, type Interpretation } from '../../src/core/design/interpretation';

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
