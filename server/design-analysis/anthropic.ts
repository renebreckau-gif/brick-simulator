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

export function anthropicProvider(env: { apiKey?: string; baseURL?: string }): AnalysisProvider {
  let client: Anthropic | null = null;
  return {
    id: 'anthropic',
    label: 'Anthropic Claude API',
    model: ANTHROPIC_MODEL,
    configurationProblem: () => (env.apiKey ? null : 'Kein API-Schlüssel konfiguriert (ANTHROPIC_API_KEY fehlt auf dem lokalen Server).'),
    async analyze(images: AnalysisImage[], notes: string): Promise<ProviderResult> {
      client ??= new Anthropic({ apiKey: env.apiKey, baseURL: env.baseURL || DEFAULT_BASE_URL, maxRetries: 2, timeout: 180_000 });
      try {
        const response = await client.beta.messages.parse({
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
