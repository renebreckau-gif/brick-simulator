// Anfragen an den lokalen Analyse-Server mit nachvollziehbarer Fehlerdiagnose (Auftrag 05A.5).
//
// Ein Browser meldet jeden Verbindungsfehler gleich („Failed to fetch“): abgelehnte Verbindung, Abbruch
// während der Übertragung, Zeitüberschreitung. Daraus allein lässt sich NICHT ableiten, ob der Server die
// Anfrage erhalten und den kostenpflichtigen Dienst aufgerufen hat. Deshalb wird nach einem Fehler nur
// nachgefragt (Status, Anfrageprotokoll) – nie automatisch wiederholt.

export interface RequestRecord {
  ticketId: string;
  kind: 'analyze' | 'spatial';
  receivedAt: string;
  providerStartedAt: string | null;
  finishedAt: string | null;
  httpStatus: number | null;
  response: unknown | null;
}

export type Probe =
  | { server: 'down'; error: string }
  | { server: 'up'; serverStartedAt: string | null; record: RequestRecord | null; probeError?: string };

export type PostOutcome =
  /** JSON-Antwort des Servers (auch Fehlerantworten wie „nicht eingerichtet“ oder Dienstfehler). */
  | { kind: 'response'; status: number; body: Record<string, unknown>; recovered: boolean }
  /** Antwort ohne JSON: fehlender Endpunkt, statischer Build, anderer Server oder abgeschnittene Antwort. */
  | { kind: 'not-json'; status: number; contentType: string }
  /** Keine Antwort (Verbindung fehlgeschlagen oder abgebrochen) – mit Nachfrage beim Server. */
  | { kind: 'network'; error: string; probe: Probe };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function probe(ticketId: string, f: Fetch): Promise<Probe> {
  let serverStartedAt: string | null = null;
  try {
    const s = await f('/api/design/status', { cache: 'no-store' });
    if (!(s.headers.get('content-type') ?? '').includes('json')) return { server: 'down', error: `Status ohne JSON (HTTP ${s.status})` };
    serverStartedAt = ((await s.json()) as { serverStartedAt?: string }).serverStartedAt ?? null;
  } catch (e) {
    return { server: 'down', error: String((e as Error).message ?? e) };
  }
  try {
    const r = await f(`/api/design/request/${encodeURIComponent(ticketId)}`, { cache: 'no-store' });
    if (!r.ok) return { server: 'up', serverStartedAt, record: null, probeError: `HTTP ${r.status}` };
    const j = (await r.json()) as { serverStartedAt?: string; record?: RequestRecord | null };
    return { server: 'up', serverStartedAt: j.serverStartedAt ?? serverStartedAt, record: j.record ?? null };
  } catch (e) {
    return { server: 'up', serverStartedAt, record: null, probeError: String((e as Error).message ?? e) };
  }
}

/**
 * Sendet genau einmal. Bei fehlender Antwort wird der Server befragt; eine dort bereits fertige Antwort wird
 * abgeholt (kein zweiter Dienstaufruf). Keine automatische Wiederholung des Aufrufs selbst.
 */
export async function postOnce(url: string, payload: unknown, ticketId: string, f: Fetch = (i, o) => fetch(i, o)): Promise<PostOutcome> {
  let res: Response;
  try {
    res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (e) {
    const p = await probe(ticketId, f);
    if (p.server === 'up' && p.record?.finishedAt && p.record.response && typeof p.record.response === 'object') return { kind: 'response', status: p.record.httpStatus ?? 200, body: p.record.response as Record<string, unknown>, recovered: true };
    return { kind: 'network', error: String((e as Error).message ?? e), probe: p };
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) return { kind: 'not-json', status: res.status, contentType: ct };
  try {
    return { kind: 'response', status: res.status, body: (await res.json()) as Record<string, unknown>, recovered: false };
  } catch {
    return { kind: 'not-json', status: res.status, contentType: `${ct} (ungültiges JSON)` };
  }
}

/** Ist ein kostenpflichtiger Dienstaufruf zu dieser Anfrage ausgeschlossen, möglich oder erfolgt? */
export type CostState = 'excluded' | 'possible' | 'started';

export interface FailureText {
  text: string;
  next: string;
  cost: CostState;
  /** Kann ein späteres Abholen helfen (Dienst läuft bzw. lief noch)? */
  canPoll: boolean;
}

/**
 * Verständliche Meldung samt nächstem Schritt. Aussagen über Kosten nur, wenn das Anfrageprotokoll des Servers
 * sie belegt; ohne Beleg heißt es ausdrücklich „nicht sicher ausgeschlossen“.
 */
export function describeFailure(o: Exclude<PostOutcome, { kind: 'response' }>, requestStartedAt: string, what = 'Analyse'): FailureText {
  if (o.kind === 'not-json') {
    if (o.status === 404) return { text: `Unter dieser Adresse gibt es keinen Analyse-Endpunkt (HTTP 404) – z. B. statischer Build oder ein anderer Server.`, next: 'Für die automatische Analyse die App über den Entwicklungsserver öffnen (npm.cmd run dev) oder den manuellen Weg nutzen.', cost: 'excluded', canPoll: false };
    return { text: `Der Server hat ungültig geantwortet (HTTP ${o.status}, ${o.contentType || 'ohne Inhaltstyp'}).`, next: 'Serverausgabe im Terminal prüfen. Ob der Dienst aufgerufen wurde, ist aus dieser Antwort nicht erkennbar; vor einem neuen Versuch den Server prüfen.', cost: 'possible', canPoll: false };
  }
  const p = o.probe;
  const noRetry = 'Es wurde nichts automatisch wiederholt.';
  if (p.server === 'down')
    return {
      text: `Der lokale Analyse-Server ist nicht erreichbar (Verbindung fehlgeschlagen; auch die Statusabfrage antwortet nicht). Wahrscheinlich läuft der Entwicklungsserver nicht mehr. Ob die ${what}-Anfrage vor dem Abbruch noch den Server erreicht hat, lässt sich von hier aus nicht feststellen – ein kostenpflichtiger Dienstaufruf ist daher nicht sicher ausgeschlossen. ${noRetry}`,
      next: 'Entwicklungsserver starten (npm.cmd run dev) und diese Seite neu laden. Entwurf und Bilder bleiben im Browser gespeichert.',
      cost: 'possible', canPoll: false,
    };
  const r = p.record;
  if (!r) {
    const restarted = !p.serverStartedAt || Date.parse(p.serverStartedAt) > Date.parse(requestStartedAt);
    if (restarted || p.probeError)
      return { text: `Die Verbindung zum lokalen Server ist abgebrochen; der Server wurde inzwischen neu gestartet bzw. kennt die Anfrage nicht mehr. Ob der Dienst aufgerufen wurde, ist nicht feststellbar – ein kostenpflichtiger Aufruf ist nicht sicher ausgeschlossen. ${noRetry}`, next: 'Seite neu laden und die Analyse bei Bedarf bewusst erneut starten.', cost: 'possible', canPoll: false };
    return { text: `Die Verbindung ist abgebrochen, bevor der lokale Server die Anfrage vollständig erhalten hat. Der Server lief durchgehend und kennt diese Anfrage nicht – der Dienst wurde nicht aufgerufen. ${noRetry}`, next: `${what} erneut starten.`, cost: 'excluded', canPoll: false };
  }
  if (!r.providerStartedAt && r.finishedAt) return { text: `Die Verbindung ist abgebrochen; der Server hatte die Anfrage ohne Dienstaufruf beendet (HTTP ${r.httpStatus}). ${noRetry}`, next: `${what} erneut starten.`, cost: 'excluded', canPoll: false };
  if (!r.providerStartedAt) return { text: `Die Verbindung ist abgebrochen; der Server bearbeitet die Anfrage noch und hat den Dienst bisher nicht aufgerufen. ${noRetry}`, next: 'Gleich „Ergebnis abholen“ wählen – das löst keinen neuen Dienstaufruf aus.', cost: 'possible', canPoll: true };
  if (!r.finishedAt) return { text: `Die Verbindung ist abgebrochen, während der Server den Analysedienst aufruft (seit ${r.providerStartedAt.slice(11, 19)} UTC). Dieser Aufruf ist kostenpflichtig. ${noRetry}`, next: '„Ergebnis abholen“ wählen, sobald der Server fertig ist – das löst keinen zweiten Dienstaufruf aus.', cost: 'started', canPoll: true };
  return { text: `Die Verbindung ist abgebrochen, nachdem der Dienst aufgerufen wurde (kostenpflichtig). Die Antwort liegt auf dem Server nicht mehr vor. ${noRetry}`, next: 'Bei Bedarf bewusst neu analysieren.', cost: 'started', canPoll: false };
}

/** Ergebnis einer früheren Anfrage beim Server abholen (kein Dienstaufruf). */
export async function fetchStoredResult(ticketId: string, f: Fetch = (i, o) => fetch(i, o)): Promise<PostOutcome | null> {
  const p = await probe(ticketId, f);
  if (p.server === 'up' && p.record?.finishedAt && p.record.response && typeof p.record.response === 'object') return { kind: 'response', status: p.record.httpStatus ?? 200, body: p.record.response as Record<string, unknown>, recovered: true };
  return { kind: 'network', error: 'Ergebnis noch nicht verfügbar', probe: p };
}
