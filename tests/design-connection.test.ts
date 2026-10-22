// Auftrag 05A.5: Verbindungsabbrüche verständlich und ehrlich melden. Kein Netzwerk, kein Dienstaufruf:
// fetch wird durch eine zählende Attrappe ersetzt; das Anfrageprotokoll des Servers wird direkt geprüft.
import { describe, expect, it } from 'vitest';
import { analyzeRequest, RequestLog, ticketIdOf, withCallHook, type AnalysisProvider } from '../server/design-analysis/handler';
import { describeFailure, fetchStoredResult, postOnce, type PostOutcome } from '../src/ui/design/serverRequest';

const T = 'ticket-conn-0001';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (status: number) => new Response('<!doctype html><p>nicht gefunden</p>', { status, headers: { 'content-type': 'text/html' } });

/** fetch-Attrappe: zählt POSTs; Antworten je Pfad. */
function fakeFetch(routes: { post: () => Response | Promise<Response>; status?: () => Response; request?: () => Response }) {
  const calls: string[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (init?.method === 'POST') return routes.post();
    if (url === '/api/design/status') { if (!routes.status) throw new TypeError('Failed to fetch'); return routes.status(); }
    if (url.startsWith('/api/design/request/')) { if (!routes.request) throw new TypeError('Failed to fetch'); return routes.request(); }
    throw new Error(`unerwartet: ${url}`);
  };
  return { f, calls };
}
const failed = () => { throw new TypeError('Failed to fetch'); };
const startedAt = '2026-10-17T05:00:00.000Z';
const posts = (calls: string[]) => calls.filter((c) => c.startsWith('POST')).length;

describe('Verbindungsfehler beim Senden', () => {
  it('Server nicht erreichbar (wie im gemeldeten Fall): verständlich, nächster Schritt, Kosten NICHT als ausgeschlossen behauptet', async () => {
    const { f, calls } = fakeFetch({ post: failed });
    const o = await postOnce('/api/design/analyze', {}, T, f);
    expect(o).toMatchObject({ kind: 'network', probe: { server: 'down' } });
    const d = describeFailure(o as Exclude<PostOutcome, { kind: 'response' }>, startedAt);
    expect(d.text).toMatch(/lokale Analyse-Server ist nicht erreichbar/);
    expect(d.text).toMatch(/nicht sicher ausgeschlossen/);
    expect(d.text).not.toMatch(/Failed to fetch/);
    expect(d.next).toMatch(/npm\.cmd run dev/);
    expect(d.cost).toBe('possible');
    expect(posts(calls)).toBe(1); // keine automatische Wiederholung
  });
  it('Server lief durchgehend und kennt die Anfrage nicht: Dienst nachweislich nicht aufgerufen', async () => {
    const { f, calls } = fakeFetch({ post: failed, status: () => json(200, { serverStartedAt: '2026-10-17T04:00:00.000Z' }), request: () => json(200, { serverStartedAt: '2026-10-17T04:00:00.000Z', record: null }) });
    const d = describeFailure((await postOnce('/x', {}, T, f)) as Exclude<PostOutcome, { kind: 'response' }>, startedAt);
    expect(d.cost).toBe('excluded');
    expect(d.text).toMatch(/der Dienst wurde nicht aufgerufen/);
    expect(posts(calls)).toBe(1);
  });
  it('Server seit der Anfrage neu gestartet: nicht feststellbar, Kosten möglich', async () => {
    const { f } = fakeFetch({ post: failed, status: () => json(200, { serverStartedAt: '2026-10-17T06:00:00.000Z' }), request: () => json(200, { serverStartedAt: '2026-10-17T06:00:00.000Z', record: null }) });
    const d = describeFailure((await postOnce('/x', {}, T, f)) as Exclude<PostOutcome, { kind: 'response' }>, startedAt);
    expect(d.cost).toBe('possible');
    expect(d.text).toMatch(/neu gestartet/);
  });
  it('Abbruch während des Dienstaufrufs: kostenpflichtig, Ergebnis später abholbar ohne zweiten Aufruf', async () => {
    const rec = { ticketId: T, kind: 'analyze', receivedAt: startedAt, providerStartedAt: '2026-10-17T05:00:01.000Z', finishedAt: null, httpStatus: null, response: null };
    const { f } = fakeFetch({ post: failed, status: () => json(200, { serverStartedAt: '2026-10-17T04:00:00.000Z' }), request: () => json(200, { serverStartedAt: '2026-10-17T04:00:00.000Z', record: rec }) });
    const d = describeFailure((await postOnce('/x', {}, T, f)) as Exclude<PostOutcome, { kind: 'response' }>, startedAt);
    expect(d.cost).toBe('started');
    expect(d.canPoll).toBe(true);
    expect(d.text).toMatch(/kostenpflichtig/);
  });
  it('Antwort lag nach dem Abbruch schon fertig auf dem Server: wird abgeholt (recovered), kein zweiter POST', async () => {
    const rec = { ticketId: T, kind: 'analyze', receivedAt: startedAt, providerStartedAt: startedAt, finishedAt: startedAt, httpStatus: 200, response: { ok: true, ticketId: T, interpretation: {} } };
    const { f, calls } = fakeFetch({ post: failed, status: () => json(200, { serverStartedAt: '2026-10-17T04:00:00.000Z' }), request: () => json(200, { serverStartedAt: '2026-10-17T04:00:00.000Z', record: rec }) });
    const o = await postOnce('/x', {}, T, f);
    expect(o).toMatchObject({ kind: 'response', status: 200, recovered: true, body: { ok: true, ticketId: T } });
    expect(posts(calls)).toBe(1);
    // „Ergebnis abholen“ fragt nur nach
    const again = await fetchStoredResult(T, f);
    expect(again).toMatchObject({ kind: 'response', recovered: true });
    expect(posts(calls)).toBe(1);
  });
});

describe('fehlender Endpunkt, ungültige und serverseitige Antworten', () => {
  it('404 ohne JSON: fehlender Endpunkt bzw. statischer Build', async () => {
    const { f } = fakeFetch({ post: () => html(404) });
    const o = await postOnce('/x', {}, T, f);
    expect(o).toMatchObject({ kind: 'not-json', status: 404 });
    expect(describeFailure(o as Exclude<PostOutcome, { kind: 'response' }>, startedAt).text).toMatch(/keinen Analyse-Endpunkt/);
  });
  it('kaputtes JSON bzw. HTML-Fehlerseite mit 500: ungültige Serverantwort, Kosten nicht ausgeschlossen', async () => {
    const { f } = fakeFetch({ post: () => new Response('{"ok":tru', { status: 200, headers: { 'content-type': 'application/json' } }) });
    const o = await postOnce('/x', {}, T, f);
    expect(o.kind).toBe('not-json');
    const d = describeFailure(o as Exclude<PostOutcome, { kind: 'response' }>, startedAt);
    expect(d.text).toMatch(/ungültig geantwortet/);
    expect(d.cost).toBe('possible');
  });
  it('serverseitiger Dienstfehler kommt als JSON-Antwort an (wird von der Oberfläche als Serverfehler gemeldet)', async () => {
    const { f } = fakeFetch({ post: () => json(502, { ok: false, code: 'unreachable', message: 'Analysedienst nicht erreichbar', ticketId: T }) });
    expect(await postOnce('/x', {}, T, f)).toMatchObject({ kind: 'response', status: 502, recovered: false, body: { code: 'unreachable' } });
  });
});

describe('Anfrageprotokoll des Servers', () => {
  const at = (() => { let i = 0; return () => `2026-10-17T05:00:0${i++}.000Z`; })();
  it('ohne Schlüssel: Anfrage erhalten und beendet, Dienst NICHT aufgerufen', async () => {
    const log = new RequestLog(30, at);
    const p: AnalysisProvider = { id: 'f', label: 'Testanbieter (synthetisch)', model: 'm', configurationProblem: () => 'kein Schlüssel', analyze: async () => ({ raw: {}, model: 'm', requestId: null, stopReason: null }) };
    log.received(T, 'analyze');
    const r = await analyzeRequest(withCallHook(p, () => log.providerStarted(T)), { ticketId: T, images: [] }, 'p');
    log.finished(T, r.status, r.body);
    expect(log.get(T)).toMatchObject({ providerStartedAt: null, httpStatus: 503 });
  });
  it('Dienstaufruf wird mit Zeitpunkt vermerkt; Antwort ohne Bilddaten gespeichert; Protokoll begrenzt', async () => {
    const log = new RequestLog(2, at);
    const p: AnalysisProvider = { id: 'f', label: 'Testanbieter (synthetisch)', model: 'm', configurationProblem: () => null, analyze: async () => { throw new Error('simuliert'); } };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 144, 0, 0, 1, 44, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
    const { sha256Hex } = await import('../src/core/design/images');
    const body = { ticketId: T, images: [{ sha256: await sha256Hex(png), mediaType: 'image/png', view: 'vorn', data: Buffer.from(png).toString('base64') }] };
    log.received(T, 'analyze');
    const r = await analyzeRequest(withCallHook(p, () => log.providerStarted(T)), body, 'p');
    log.finished(T, r.status, r.body);
    expect(log.get(T)!.providerStartedAt).not.toBeNull();
    expect(JSON.stringify(log.get(T)!.response)).not.toMatch(/iVBOR|"data"/); // keine Bilddaten
    log.received('ticket-conn-0002', 'analyze');
    log.received('ticket-conn-0003', 'analyze');
    expect(log.get(T)).toBeNull(); // älteste Einträge fallen heraus
  });
  it('Anfragekennung wird nur in gültiger Form übernommen', () => {
    expect(ticketIdOf({ ticketId: T })).toBe(T);
    expect(ticketIdOf({ ticketId: '../../etc' })).toBeNull();
  });
});
