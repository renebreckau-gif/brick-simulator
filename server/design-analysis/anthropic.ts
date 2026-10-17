// Anbieter: Claude API (Anthropic) mit Bildeingabe und strukturierter Ausgabe.
// Läuft nur im lokalen Node-Server (Vite-Entwicklungsserver). Der Schlüssel kommt aus
// ANTHROPIC_API_KEY (z. B. .env.local) und verlässt den Server nie.
//
// Die Basis-URL wird bewusst NICHT aus ANTHROPIC_BASE_URL übernommen (diese Variable kann von
// anderen Werkzeugen gesetzt sein); abweichende Endpunkte nur über BAUSTEIN_ANTHROPIC_BASE_URL.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Interpretation } from '../../src/core/design/interpretation';
import { ProviderError, type AnalysisImage, type AnalysisProvider, type ProviderResult } from './handler';
import { SYSTEM_PROMPT, userText } from './prompt';

export const ANTHROPIC_MODEL = 'claude-opus-5-5';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

export interface AnthropicEnv {
  apiKey?: string;
  baseURL?: string;
}

/** Prüft nur Vorhandensein und Form des Schlüssels – ob er funktioniert, zeigt erst ein echter Aufruf. */
export function apiKeyProblem(apiKey: string | undefined): string | null {
  const k = (apiKey ?? '').trim();
  if (!k) return 'Kein API-Schlüssel konfiguriert (ANTHROPIC_API_KEY fehlt oder ist leer).';
  if (/(…|\.\.\.|<|>|your|dein|xxx|placeholder|changeme|beispiel|example)/i.test(k)) return 'ANTHROPIC_API_KEY enthält einen Platzhalter statt eines echten Schlüssels.';
  if (/\s|["']/.test(k)) return 'ANTHROPIC_API_KEY enthält Leerzeichen oder Anführungszeichen – bitte den Schlüssel ohne Zusätze eintragen.';
  return null;
}

/**
 * env wird bei jedem Aufruf neu gelesen: Ein in .env.local ergänzter Schlüssel gilt ohne Neustart.
 * Automatische Wiederholungen sind abgeschaltet (maxRetries 0), damit kein Fehler unbemerkt kostenpflichtig wiederholt wird.
 */
export function anthropicProvider(env: AnthropicEnv | (() => AnthropicEnv)): AnalysisProvider {
  const read = typeof env === 'function' ? env : () => env;
  let client: { key: string; base: string; c: Anthropic } | null = null;
  return {
    id: 'anthropic',
    label: 'Anthropic Claude API',
    model: ANTHROPIC_MODEL,
    configurationProblem: () => apiKeyProblem(read().apiKey),
    async analyze(images: AnalysisImage[], notes: string): Promise<ProviderResult> {
      const { apiKey = '', baseURL } = read();
      const base = baseURL || DEFAULT_BASE_URL;
      if (!client || client.key !== apiKey.trim() || client.base !== base) client = { key: apiKey.trim(), base, c: new Anthropic({ apiKey: apiKey.trim(), baseURL: base, maxRetries: 0, timeout: 180_000 }) };
      const anthropic = client.c;
      try {
        const response = await anthropic.beta.messages.parse({
          model: ANTHROPIC_MODEL,
          max_tokens: 16000,
          // Bei einer Ablehnung durch Sicherheitsklassifikatoren übernimmt serverseitig ein Ersatzmodell.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'high', format: betaZodOutputFormat(Interpretation) },
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                ...images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType, data: img.data } })),
                { type: 'text' as const, text: userText(images, notes) },
              ],
            },
          ],
        });
        if (response.stop_reason === 'refusal') throw new ProviderError('refusal', 'Der Analysedienst hat die Anfrage abgelehnt.');
        if (response.stop_reason === 'max_tokens') throw new ProviderError('truncated', 'Die Antwort wurde abgeschnitten (Ausgabelimit erreicht).');
        if (response.parsed_output == null) throw new ProviderError('unparseable', 'Die Antwort ließ sich nicht als strukturierte Interpretation lesen.');
        return { raw: response.parsed_output, model: response.model, requestId: (response as { _request_id?: string | null })._request_id ?? null, stopReason: response.stop_reason };
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (e instanceof Anthropic.AuthenticationError) throw new ProviderError('auth_failed', 'Der API-Schlüssel wurde abgelehnt.', 401);
        if (e instanceof Anthropic.RateLimitError) throw new ProviderError('rate_limited', 'Ratenlimit des Analysedienstes erreicht – später erneut versuchen.', 429);
        if (e instanceof Anthropic.APIConnectionError) throw new ProviderError('unreachable', 'Analysedienst nicht erreichbar (Netzwerk oder Zeitüberschreitung).');
        if (e instanceof Anthropic.APIError) throw new ProviderError('provider_error', `Analysedienst meldet Fehler ${e.status ?? ''}: ${e.message}`, e.status ?? null);
        throw new ProviderError('unparseable', `Antwort nicht verarbeitbar: ${String(e)}`);
      }
    },
  };
}
