// Lokale Endpunkte der Bildanalyse – nur im Entwicklungsserver (configureServer), nie im statischen Build:
//   GET  /api/design/status   → Anbieter, Modell, ob konfiguriert (ohne Schlüssel preiszugeben)
//   POST /api/design/analyze  → { images: [{ sha256, mediaType, data, view }], notes } → AnalyzeResponse
//   POST /api/design/spatial  → { images, interpretation, notes, ticketId } → SpatialResponse (räumlicher Vorschlag)
//   GET  /api/design/request/<ticketId> → Was ist mit dieser Anfrage passiert? (nach Verbindungsabbruch; ohne Bilddaten)
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { MAX_IMAGE_BYTES, MAX_IMAGES } from '../../src/core/design/images';
import { anthropicProvider, type AnthropicEnv } from './anthropic';
import { analyzeRequest, LIVE_UNVERIFIED, nextLiveCheck, RequestLog, SETUP_HINTS, spatialRequest, ticketIdOf, withCallHook, type AnalysisProvider, type LiveCheck } from './handler';
import { PROMPT_VERSION, SPATIAL_PROMPT_VERSION } from './prompt';

const BODY_LIMIT = Math.ceil(MAX_IMAGES * MAX_IMAGE_BYTES * 1.4) + 64 * 1024;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new Error('Anfrage zu groß'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Kein gültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** readEnv wird bei jedem Zugriff aufgerufen (z. B. loadEnv), damit Änderungen an .env.local ohne Neustart gelten. */
export function designAnalysisApi(readEnv: () => Record<string, string>, providerOverride?: AnalysisProvider): Plugin {
  const env = (): AnthropicEnv => {
    const e = readEnv();
    return { apiKey: e.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY, baseURL: e.BAUSTEIN_ANTHROPIC_BASE_URL };
  };
  const provider = providerOverride ?? anthropicProvider(env);
  let live: LiveCheck = LIVE_UNVERIFIED;
  const log = new RequestLog();
  const serverStartedAt = new Date().toISOString();
  return {
    name: 'baustein-design-analysis',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/api/design/')) return next();
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        if (url === '/api/design/status' && req.method === 'GET') {
          const problem = provider.configurationProblem();
          return send(200, { provider: provider.label, providerId: provider.id, model: provider.model, configured: !problem, problem, setup: problem ? SETUP_HINTS : [], liveCheck: live, serverStartedAt, spatial: !!provider.proposeSpatial, promptVersion: PROMPT_VERSION, spatialPromptVersion: SPATIAL_PROMPT_VERSION, maxImages: MAX_IMAGES, maxImageBytes: MAX_IMAGE_BYTES });
        }
        if (url === '/api/design/analyze' && req.method === 'POST') {
          let body: unknown;
          try {
            body = await readJson(req);
          } catch (e) {
            return send(400, { ok: false, code: 'invalid_request', message: String((e as Error).message) });
          }
          const ticket = ticketIdOf(body);
          if (ticket) log.received(ticket, 'analyze');
          const r = await analyzeRequest(ticket ? withCallHook(provider, () => log.providerStarted(ticket)) : provider, body, PROMPT_VERSION);
          live = nextLiveCheck(live, r.body);
          if (ticket) log.finished(ticket, r.status, r.body);
          return send(r.status, { ...r.body, liveCheck: live });
        }
        if (url === '/api/design/spatial' && req.method === 'POST') {
          let body: unknown;
          try {
            body = await readJson(req);
          } catch (e) {
            return send(400, { ok: false, code: 'invalid_request', message: String((e as Error).message) });
          }
          const ticket = ticketIdOf(body);
          if (ticket) log.received(ticket, 'spatial');
          const r = await spatialRequest(ticket ? withCallHook(provider, () => log.providerStarted(ticket)) : provider, body, SPATIAL_PROMPT_VERSION);
          live = nextLiveCheck(live, r.body);
          if (ticket) log.finished(ticket, r.status, r.body);
          return send(r.status, { ...r.body, liveCheck: live });
        }
        const m = url.match(/^\/api\/design\/request\/([A-Za-z0-9-]{8,64})$/);
        if (m && req.method === 'GET') return send(200, { serverStartedAt, record: log.get(m[1]) });
        send(404, { ok: false, code: 'invalid_request', message: 'Unbekannter Endpunkt' });
      });
    },
  };
}
