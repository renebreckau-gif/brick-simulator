// Auftrag 05B.0: Endpunkt für den räumlichen Vorschlag. Ausdrücklich benannter Testanbieter, kein externer Aufruf.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextLiveCheck, LIVE_UNVERIFIED, spatialRequest, type AnalysisProvider } from '../server/design-analysis/handler';
import { sha256Hex } from '../src/core/design/images';
import type { Interpretation } from '../src/core/design/interpretation';

const interp = () => (JSON.parse(readFileSync('tests/fixtures/design/interpretation-synthetic.json', 'utf8')) as { interpretation: Interpretation }).interpretation;
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(36);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return b;
}
const imgPayload = async () => {
  const bytes = png(400, 300);
  return { sha256: await sha256Hex(bytes), mediaType: 'image/png' as const, view: 'seitlich', data: Buffer.from(bytes).toString('base64') };
};
const proposal = () => ({
  referenceViews: [{ imageIndex: 0, box: { x: 0, y: 0, w: 1, h: 1 }, direction: 'unbekannt', frontInImage: 'links', primary: true, note: '' }],
  symmetry: { kind: 'left-right', note: 'synthetisch' },
  bodies: [{ id: 'k-g1', name: 'Hauptkörper', groupId: 'g1', isMain: true, shape: 'box', center: { x: 0, y: 0, z: 0 }, size: { length: 1, width: 0.5, height: 0.4 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, taper: 1, color: '#888888', basis: { position: 'assumed', size: 'image-derived', rotation: 'assumed', shape: 'assumed', color: 'image-derived' }, assumptions: [], uncertainty: 'mittel', mirrorOf: null }],
  contradictions: [], openQuestions: [],
});
const fake = (raw: unknown, problem: string | null = null, spatial = true): AnalysisProvider & { calls: number } => {
  const p = {
    id: 'fake', label: 'Testanbieter (synthetisch)', model: 'kein-modell', calls: 0,
    configurationProblem: () => problem,
    analyze: async () => ({ raw: {}, model: 'x', requestId: null, stopReason: null }),
    proposeSpatial: spatial ? async () => { p.calls++; return { raw, model: 'm', requestId: 'r1', stopReason: 'end_turn' }; } : undefined,
  };
  return p;
};

describe('POST /api/design/spatial (Handler)', () => {
  it('nicht eingerichtet: 503, kein Aufruf', async () => {
    const p = fake(proposal(), 'kein Schlüssel');
    const r = await spatialRequest(p, { images: [await imgPayload()], interpretation: interp(), ticketId: 'ticket-0001' }, 'sp');
    expect(r.body).toMatchObject({ ok: false, code: 'not_configured', ticketId: 'ticket-0001' });
    expect(p.calls).toBe(0);
  });
  it('Anbieter ohne räumlichen Vorschlag: 501', async () => {
    const r = await spatialRequest(fake(proposal(), null, false), { images: [await imgPayload()], interpretation: interp() }, 'sp');
    expect(r.status).toBe(501);
    expect(nextLiveCheck(LIVE_UNVERIFIED, r.body)).toBe(LIVE_UNVERIFIED);
  });
  it('ungültige Interpretation oder Prüfsumme: abgewiesen, kein Aufruf', async () => {
    const p = fake(proposal());
    const bad = interp();
    bad.groups = [];
    expect((await spatialRequest(p, { images: [await imgPayload()], interpretation: bad }, 'sp')).body).toMatchObject({ code: 'invalid_request' });
    expect((await spatialRequest(p, { images: [{ ...(await imgPayload()), sha256: '0'.repeat(64) }], interpretation: interp() }, 'sp')).body).toMatchObject({ code: 'invalid_request', message: expect.stringMatching(/Prüfsumme/) });
    expect(p.calls).toBe(0);
  });
  it('gültiger Vorschlag: übernommen mit Herkunft; Ticket wird zurückgegeben', async () => {
    const r = await spatialRequest(fake(proposal()), { images: [await imgPayload()], interpretation: interp(), ticketId: 'ticket-0002' }, 'spatial-prompt@test');
    expect(r.body).toMatchObject({ ok: true, ticketId: 'ticket-0002', meta: { provider: 'Testanbieter (synthetisch)', model: 'm', requestId: 'r1', promptVersion: 'spatial-prompt@test' } });
  });
  it('falsches Format → invalid_response; unbekannte Baugruppe → contradictory_response mit Kandidat', async () => {
    expect((await spatialRequest(fake({ foo: 1 }), { images: [await imgPayload()], interpretation: interp() }, 'sp')).body).toMatchObject({ ok: false, code: 'invalid_response' });
    const p = proposal();
    p.bodies[0].groupId = 'erfunden';
    const r = await spatialRequest(fake(p), { images: [await imgPayload()], interpretation: interp() }, 'sp');
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'contradictory_response', candidate: expect.any(Object) });
  });
  it('genau ein Dienstaufruf je Anfrage (keine automatischen Wiederholungen)', async () => {
    const p = fake({ foo: 1 });
    await spatialRequest(p, { images: [await imgPayload()], interpretation: interp() }, 'sp');
    expect(p.calls).toBe(1);
  });
});
