// Grenzfälle: vergleicht Validatorbefunde mit den getrennt deklarierten Erwartungen.
// Zwei Modi:
//  - TESTFIXTURE-Katalog: ALLE deklarierten Erwartungen (inkl. Katalogbefunde) unverändert.
//  - ohne Katalog (frischer Checkout): alle nicht-katalogbezogenen Erwartungen unverändert; zusätzlich
//    muss die Katalogschicht ausdrücklich „ungeprüft“ melden und darf keine Katalogaussage treffen.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../src/core/bom/bom';
import { applyEdit, artifactStatus } from '../src/core/model/edit';
import { modelRef } from '../src/core/model/hash';
import type { ValidationReport } from '../src/core/validation/findings';
import { validate } from '../src/core/validation/validate';
import { EDGE_CASES } from '../src/fixtures/edgeCases';
import { bundle, readData, referenceModel, type CatalogMode } from './helpers';

interface Expectation {
  caseId?: string;
  referenceId?: string;
  reason: string;
  include: { code: string; instances?: string[] }[];
  exclude: string[];
  connections?: number;
  tubeConnections?: number;
  noBlockers?: boolean;
  unresolvedBomLines?: number;
  staleAfterEdit?: boolean;
  bom?: { totalInstances: number };
  /** Dieser Befundcode darf für genau diese Instanzen nicht vorkommen. */
  excludeFor?: { code: string; instances: string[] }[];
  /** Anzahl erkannter Verbindungen nach R-UPIN-HOLLOWSTUD. */
  upinConnections?: number;
}

const expectations = JSON.parse(await readData('expectations/edge-cases.json')) as { cases: Expectation[]; references: Expectation[] };

/** Katalogbefunde, die einen geladenen Katalog voraussetzen (Simulationsunterstützung CAT_SIM_* nicht). */
const needsCatalog = (code: string) => code.startsWith('CAT_') && !code.startsWith('CAT_SIM_');
/** Diese Codes sind Katalogaussagen und dürfen ohne Katalog nie entstehen. */
const CATALOG_CLAIMS = ['CAT_PART_UNKNOWN', 'CAT_COLOR_UNMAPPED', 'CAT_COMBO_UNEVIDENCED', 'CAT_COMBO_EVIDENCED'];

function checkExpectation(report: ValidationReport, e: Expectation, label: string, mode: CatalogMode) {
  const codes = report.findings.map((f) => f.code);
  for (const inc of e.include) {
    if (mode === 'none' && needsCatalog(inc.code)) continue; // separat: Katalog muss „ungeprüft“ melden (s. u.)
    const matches = report.findings.filter((f) => f.code === inc.code);
    expect(matches.length, `${label}: erwartet ${inc.code} – ${e.reason}`).toBeGreaterThan(0);
    if (inc.instances) {
      const ok = matches.some((f) => inc.instances!.every((id) => f.affected.instanceIds.some((a) => a === id || a.endsWith(`/${id}`))));
      expect(ok, `${label}: ${inc.code} soll ${inc.instances.join(', ')} betreffen`).toBe(true);
    }
  }
  for (const ex of e.exclude) expect(codes, `${label}: ${ex} darf nicht vorkommen`).not.toContain(ex);
  for (const ef of e.excludeFor ?? []) {
    const hit = report.findings.filter((f) => f.code === ef.code && ef.instances.every((id) => f.affected.instanceIds.some((a) => a === id || a.endsWith(`/${id}`))));
    expect(hit.map((f) => f.title), `${label}: ${ef.code} darf ${ef.instances.join(' & ')} nicht betreffen`).toEqual([]);
  }
  if (e.noBlockers) {
    const blockers = report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed').map((f) => f.code);
    expect(blockers, `${label}: keine Blocker erwartet`).toEqual([]);
  }
  if (mode === 'none') {
    const src = report.findings.filter((f) => f.code === 'CAT_SOURCE_UNAVAILABLE');
    expect(src, `${label}: Katalogschicht muss „ungeprüft“ melden`).toHaveLength(1);
    expect(src[0].status).toBe('unchecked');
    for (const c of CATALOG_CLAIMS) expect(codes, `${label}: ohne Katalog keine Katalogaussage ${c}`).not.toContain(c);
    expect(report.overall).not.toBe('no-blockers-all-checked');
  }
}

describe('Grenzfall-Korpus', () => {
  it('jede Fixture hat genau eine deklarierte Erwartung mit Begründung', () => {
    const ids = EDGE_CASES.map((c) => c.caseId).sort();
    expect(expectations.cases.map((c) => c.caseId).sort()).toEqual(ids);
    for (const c of expectations.cases) expect(c.reason.length).toBeGreaterThan(20);
  });

  for (const mode of ['fixture', 'none'] as const) {
    describe(mode === 'fixture' ? 'mit TESTFIXTURE-Katalog (alle Erwartungen)' : 'ohne Katalog (frischer Checkout)', () => {
      for (const ec of EDGE_CASES) {
        it(ec.caseId, async () => {
          const b = await bundle(mode);
          const e = expectations.cases.find((x) => x.caseId === ec.caseId)!;
          const model = ec.model();
          expect(model.origin.kind).toBe('fixture');
          const r = validate(model, b.catalog);
          checkExpectation(r.report, e, `${ec.caseId} [${mode}]`, mode);
          if (e.connections !== undefined) expect(r.world.connections.length).toBe(e.connections);
          if (e.upinConnections !== undefined) expect(r.world.connections.filter((c) => c.ruleId === 'R-UPIN-HOLLOWSTUD').length).toBe(e.upinConnections);
          if (e.tubeConnections !== undefined) expect(r.world.connections.filter((c) => c.ruleId === 'R-STUD-TUBE').length).toBe(e.tubeConnections);
          if (e.unresolvedBomLines !== undefined) expect(computeBom(model, b.catalog).unresolved.length).toBe(e.unresolvedBomLines);
          if (e.staleAfterEdit) {
            const bom = computeBom(model, b.catalog);
            const edited = applyEdit(model, { kind: 'move', instanceId: ec.staleEdit!.instanceId, delta: ec.staleEdit!.delta });
            const now = modelRef(edited);
            for (const [kind, ref] of [['report', r.report.modelRef], ['bom', bom.modelRef], ['steps', r.report.modelRef], ['procurement', bom.modelRef]] as const)
              expect(artifactStatus(kind, ref, now).state, kind).toBe('stale');
            const r2 = validate(edited, b.catalog);
            expect(artifactStatus('report', r2.report.modelRef, now).state).toBe('current');
            expect(r2.report.findings.some((f) => f.code === 'COL_PENETRATION' || f.code === 'GRAPH_LOOSE')).toBe(true);
          }
        });
      }
    });
  }
});

describe('Referenzen: deklarierte Erwartungen (ohne Katalog)', () => {
  for (const e of expectations.references) {
    it(e.referenceId!, async () => {
      const b = await bundle('none');
      const model = await referenceModel(e.referenceId!);
      const r = validate(model, b.catalog);
      checkExpectation(r.report, e, e.referenceId!, 'none');
      if (e.upinConnections !== undefined) expect(r.world.connections.filter((c) => c.ruleId === 'R-UPIN-HOLLOWSTUD').length).toBe(e.upinConnections);
      if (e.bom) expect(computeBom(model, b.catalog).totalInstances).toBe(e.bom.totalInstances);
    });
  }
});
