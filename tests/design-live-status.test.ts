// Auftrag 05A.4: „konfiguriert“ ≠ „live geprüft“. Schlüsselform, frisches Lesen der Umgebung,
// Live-Status nur aus tatsächlichen Dienstantworten. Kein externer Aufruf.
import { describe, expect, it } from 'vitest';
import { anthropicProvider, apiKeyProblem } from '../server/design-analysis/anthropic';
import { LIVE_UNVERIFIED, nextLiveCheck, type AnalyzeResponse } from '../server/design-analysis/handler';

const at = '2026-10-17T09:30:00.000Z';
const fail = (code: string) => ({ ok: false, code, message: 'x' }) as unknown as AnalyzeResponse;
const ok = { ok: true, meta: { model: 'claude-opus-5-5' } } as unknown as AnalyzeResponse;

describe('Schlüsselform (ohne den Schlüssel preiszugeben)', () => {
  it('leer, fehlend oder nur Leerraum: Blocker „fehlt oder ist leer“', () => {
    for (const k of [undefined, '', '   ']) expect(apiKeyProblem(k)).toMatch(/fehlt oder ist leer/);
  });
  it('Platzhalter werden erkannt', () => {
    for (const k of ['sk-ant-...', 'sk-ant-…', '<dein-schluessel>', 'your-api-key', 'sk-ant-xxxxxxxx', 'PLACEHOLDER', 'changeme'])
      expect(apiKeyProblem(k), k).toMatch(/Platzhalter/);
  });
  it('Anführungszeichen oder Leerzeichen im Wert werden gemeldet', () => {
    expect(apiKeyProblem('"sk-ant-api03-abcDEF123"')).toMatch(/Anführungszeichen/);
    expect(apiKeyProblem('sk-ant-api03 abc')).toMatch(/Leerzeichen/);
  });
  it('plausible Form gilt nur als „konfiguriert“', () => {
    expect(apiKeyProblem('sk-ant-api03-AbCdEf0123456789')).toBeNull();
  });
});

describe('Umgebung wird bei jedem Zugriff frisch gelesen', () => {
  it('ein nachträglich eingetragener Schlüssel gilt ohne Neustart', () => {
    let env: { apiKey?: string } = {};
    const p = anthropicProvider(() => env);
    expect(p.configurationProblem()).toMatch(/fehlt/);
    env = { apiKey: 'sk-ant-api03-AbCdEf0123456789' };
    expect(p.configurationProblem()).toBeNull();
    env = {};
    expect(p.configurationProblem()).toMatch(/fehlt/);
  });
});

describe('Live-Status', () => {
  it('startet unbestätigt, auch wenn ein Schlüssel eingetragen ist', () => {
    expect(LIVE_UNVERIFIED.status).toBe('unverified');
  });
  it('Anfragen, die den Dienst nicht erreichen, ändern den Status nicht', () => {
    expect(nextLiveCheck(LIVE_UNVERIFIED, fail('not_configured'), at)).toBe(LIVE_UNVERIFIED);
    expect(nextLiveCheck(LIVE_UNVERIFIED, fail('invalid_request'), at)).toBe(LIVE_UNVERIFIED);
  });
  it('Dienstfehler werden mit Code und Zeit festgehalten', () => {
    for (const code of ['auth_failed', 'unreachable', 'rate_limited', 'provider_error', 'refusal', 'truncated', 'invalid_response'])
      expect(nextLiveCheck(LIVE_UNVERIFIED, fail(code), at)).toEqual({ status: 'failed', at, code, model: null });
  });
  it('nur eine erfolgreich beantwortete Analyse belegt die Funktion', () => {
    const s = nextLiveCheck(LIVE_UNVERIFIED, ok, at);
    expect(s).toEqual({ status: 'ok', at, code: null, model: 'claude-opus-5-5' });
    // späterer Fehler überschreibt den Erfolg sichtbar
    expect(nextLiveCheck(s, fail('rate_limited'), at).status).toBe('failed');
  });
  it('widersprüchliche Antwort: Dienst erreichbar, Antwort aber zu korrigieren', () => {
    expect(nextLiveCheck(LIVE_UNVERIFIED, fail('contradictory_response'), at)).toMatchObject({ status: 'ok', code: 'contradictory_response' });
  });
});
