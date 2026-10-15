import { Fragment, useState } from 'react';
import { compareBom, type Bom } from '../core/bom/bom';
import type { Catalog } from '../core/catalog/catalog';
import type { DataBundle } from '../core/data/bundle';
import type { CanonicalModel } from '../core/model/types';
import type { ProcurementState } from '../core/procurement/types';
import type { AssemblyAnalysis } from '../core/validation/assembly';
import { LAYER_LABEL, type Dimension, type Finding, type ValidationReport } from '../core/validation/findings';
import type { LabItem } from './items';

export interface Expectations {
  cases: { caseId: string; reason: string; include: { code: string; instances?: string[] }[]; exclude: string[] }[];
  references: { referenceId: string; reason: string; include: { code: string }[]; exclude: string[] }[];
}

/** Evidenzstufe als Füllung: voll = bestätigt, schraffiert = heuristisch, Umriss = ungeprüft. */
export function EvidenceGlyph({ f }: { f: Pick<Finding, 'evidenceLevel' | 'status' | 'severity'> }) {
  const tone = f.status === 'passed' ? 'ok' : f.status === 'failed' ? (f.severity === 'blocker' ? 'block' : 'warn') : 'open';
  const label = { confirmed: 'bestätigt', heuristic: 'heuristisch', unchecked: 'ungeprüft' }[f.evidenceLevel];
  return <span className={`glyph ${f.evidenceLevel} ${tone}`} title={label} aria-label={label} />;
}

const STATUS_LABEL: Record<Finding['status'], string> = { passed: 'bestanden', failed: 'beanstandet', unchecked: 'ungeprüft', unsupported: 'nicht unterstützt' };
const DIMENSION_LABEL: Record<Dimension, string> = { assembly: 'Montage', robustness: 'Robustheit', usage: 'Nutzungseignung', data: 'Datenbasis' };

type Filter = 'blocker' | 'warning' | 'open' | 'passed';
function filterOf(f: Finding): Filter {
  if (f.status === 'failed' && f.severity === 'blocker') return 'blocker';
  if (f.status === 'unchecked' || f.status === 'unsupported') return 'open';
  if (f.status === 'failed') return 'warning';
  return 'passed';
}

export function ReportPanel({ report, onHighlight, highlighted }: { report: ValidationReport; onHighlight: (ids: string[]) => void; highlighted: string[] }) {
  const [filters, setFilters] = useState<Set<Filter>>(new Set(['blocker', 'warning', 'open']));
  const [openId, setOpenId] = useState<string | null>(null);
  const counts: Record<Filter, number> = { blocker: 0, warning: 0, open: 0, passed: 0 };
  report.findings.forEach((f) => counts[filterOf(f)]++);
  const toggle = (k: Filter) => setFilters((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const shown = report.findings.filter((f) => filters.has(filterOf(f)));
  const dims: Dimension[] = ['assembly', 'robustness', 'usage', 'data'];
  return (
    <div className="report">
      <div className="legend" aria-label="Legende Evidenzstufe">
        <span><EvidenceGlyph f={{ evidenceLevel: 'confirmed', status: 'passed', severity: 'info' }} /> bestätigt</span>
        <span><EvidenceGlyph f={{ evidenceLevel: 'heuristic', status: 'passed', severity: 'info' }} /> heuristisch</span>
        <span><EvidenceGlyph f={{ evidenceLevel: 'unchecked', status: 'unchecked', severity: 'info' }} /> ungeprüft</span>
      </div>
      <table className="layers">
        <caption>Prüfschichten (Bericht zu Version {report.modelRef.version})</caption>
        <tbody>
          {report.layers.map((l) => (
            <tr key={l.layer}>
              <th scope="row" title={l.scope}>{LAYER_LABEL[l.layer]}</th>
              <td><span className={`pill ${l.status}`}>{{ passed: 'bestanden', failed: 'beanstandet', flagged: 'heuristische Hinweise', partial: 'teilweise geprüft', unchecked: 'ungeprüft' }[l.status]}</span></td>
              <td className="muted small">{l.scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="filters" role="group" aria-label="Befunde filtern">
        {([['blocker', 'Blocker'], ['warning', 'Warnungen'], ['open', 'Ungeprüft / nicht unterstützt'], ['passed', 'Bestanden']] as const).map(([k, l]) => (
          <label key={k} className={`chk ${k}`}>
            <input type="checkbox" checked={filters.has(k)} onChange={() => toggle(k)} /> {l} ({counts[k]})
          </label>
        ))}
      </div>
      {dims.map((d) => {
        const fs = shown.filter((f) => f.dimension === d);
        if (!fs.length) return null;
        return (
          <section key={d} className="dimension">
            <h3>{DIMENSION_LABEL[d]}</h3>
            <ul className="findings">
              {fs.map((f) => {
                const active = f.affected.instanceIds.length > 0 && f.affected.instanceIds.every((i) => highlighted.includes(i)) && highlighted.length === f.affected.instanceIds.length;
                return (
                  <li key={f.id} className={`finding ${filterOf(f)}${active ? ' active' : ''}`}>
                    <button className="fhead" onClick={() => { setOpenId(openId === f.id ? null : f.id); onHighlight(active ? [] : f.affected.instanceIds); }} aria-expanded={openId === f.id}>
                      <EvidenceGlyph f={f} />
                      <span className="ftitle">{f.title}</span>
                      <span className="fstatus">{STATUS_LABEL[f.status]}</span>
                    </button>
                    <p className="fmsg">{f.message}</p>
                    {openId === f.id && (
                      <div className="fdetail">
                        <dl>
                          <dt>Kategorie</dt><dd>{LAYER_LABEL[f.layer]} ({f.code})</dd>
                          <dt>Evidenz</dt><dd>{{ confirmed: 'bestätigt (deterministisch im Regelumfang)', heuristic: 'heuristische Einschätzung', unchecked: 'ungeprüft' }[f.evidenceLevel]}</dd>
                          <dt>Regelversion</dt><dd className="code">{f.ruleVersion}</dd>
                          {f.affected.instanceIds.length > 0 && (<><dt>Betroffene Teile</dt><dd className="code">{f.affected.instanceIds.join(', ')}</dd></>)}
                          {f.affected.stepIds.length > 0 && (<><dt>Schritte</dt><dd className="code">{f.affected.stepIds.join(', ')}</dd></>)}
                          {f.limitation && (<><dt>Einschränkung</dt><dd>{f.limitation}</dd></>)}
                          {f.remedy && (<><dt>Mögliche Abhilfe</dt><dd>{f.remedy}</dd></>)}
                        </dl>
                        <details><summary>Rohdaten der Evidenz</summary><pre>{JSON.stringify(f.evidence, null, 1)}</pre></details>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!shown.length && <p className="muted">Keine Befunde für die gewählten Filter.</p>}
    </div>
  );
}

const dirText = (d: [number, number, number] | null) => (!d ? '–' : d[1] > 0.5 ? 'von oben' : d[1] < -0.5 ? 'von unten' : 'seitlich');
const UNIT_STATUS: Record<string, string> = { ok: 'frei', blocked: 'Weg blockiert', conflict: 'Klemmposition', mismatch: 'Richtung widerspricht', unchecked: 'ungeprüft' };

export function StepsPanel({ model, analysis, stepIndex, onStep, catalog, stale }: { model: CanonicalModel; analysis: AssemblyAnalysis; stepIndex: number; onStep: (i: number) => void; catalog: Catalog; stale: boolean }) {
  if (!model.steps.length) return <p className="empty">Für dieses Modell ist keine Baufolge belegt. Die Montageprüfung bleibt ungeprüft; ein automatischer Baufolgenplaner ist nicht Teil dieser Phase.</p>;
  return (
    <div className="steps">
      <p className="muted small">Quelle der Baufolge: {{ 'source-file': 'Quelldatei (0 STEP / Untermodelle)', 'fixture-declared': 'Fixture-Deklaration', 'instructions-mapped': 'LEGO-Anleitung, eigene Zuordnung der Schritte auf die OMR-Instanzen', none: '–' }[model.stepsSource]}. Einschubrichtungen sind, wo nicht deklariert, aus den Steckverbindungen abgeleitet.{stale ? ' Achtung: Die Prüfergebnisse unten gehören zur vorherigen Modellversion.' : ''}</p>
      <ol>
        {model.steps.map((s, i) => {
          const r = analysis.steps.find((x) => x.stepId === s.stepId);
          const asm = model.assemblies.find((a) => a.assemblyId === s.assemblyId);
          const bad = r?.units.some((u) => u.status !== 'ok' && u.status !== 'unchecked');
          const open = r?.units.some((u) => u.status === 'unchecked');
          return (
            <li key={s.stepId} className={`step${i === stepIndex ? ' active' : ''}${bad ? ' bad' : open ? ' open' : ''}`}>
              <button className="stephead" onClick={() => onStep(i)}>
                <span className="stepno">{i + 1}</span>
                <span>{asm?.name ?? s.assemblyId}{asm?.builtSeparately ? ' (separat vormontiert)' : ''}</span>
              </button>
              <ul className="units">
                {(r?.units ?? []).map((u) => {
                  const inst = model.instances.find((x) => x.instanceId === u.unitId);
                  const name = inst ? `${inst.part} ${catalog.color(inst.color)?.rebrickableName ?? catalog.color(inst.color)?.ldrawName ?? inst.color}` : `Baugruppe ${model.assemblies.find((a) => a.assemblyId === u.unitId)?.name ?? u.unitId}`;
                  return (
                    <li key={u.unitId} className={`unit ${u.status}`}>
                      <span>{name}</span>
                      <span className="muted">{dirText(u.direction)}{u.directionSource === 'declared' ? ' (deklariert)' : u.directionSource === 'derived' ? ' (abgeleitet)' : u.directionSource === 'free' ? ' (ohne Verbindung abgelegt)' : ''}</span>
                      <span className="ustatus">{UNIT_STATUS[u.status]}</span>
                    </li>
                  );
                })}
              </ul>
              {s.support && <p className="support">Unterstützung ({s.support.kind === 'hand' ? 'Hand' : 'Hilfsstütze'}): {s.support.note} – Quelle: {s.support.source}</p>}
              {s.notes?.map((n) => <p key={n} className="note">Hinweis: {n}</p>)}
              {r && r.componentsAfter > 1 && <p className="note">Danach {r.componentsAfter} getrennte Teilgruppen.</p>}
              <p className="muted small code">{s.source}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function BomPanel({ bom, bundle, referenceId, procurement, onHighlight }: { bom: Bom; bundle: DataBundle; referenceId?: string; procurement: ProcurementState; onHighlight: (ids: string[]) => void }) {
  const ref = bundle.references.find((r) => r.referenceId === referenceId);
  const cmp = ref ? compareBom(bom, ref.setNumber, bundle.catalog) : null;
  const total = bom.lines.reduce((a, l) => a + l.quantity, 0);
  return (
    <div className="bom">
      <p className="muted small">Exakt aus Modellversion {bom.modelRef.version} (Hash <span className="code">{bom.modelRef.contentHash}</span>). {total} aufgelöste Teile in {bom.lines.length} Zeilen; Beschaffung: {procurement.status === 'not-checked' ? 'nicht geprüft' : procurement.status}.</p>
      <table className="bomtable">
        <thead><tr><th>Anzahl</th><th>Teil</th><th>Farbe</th><th>Rebrickable</th><th>Kombination</th><th>Simulation</th></tr></thead>
        <tbody>
          {bom.lines.map((l) => (
            <tr key={`${l.ldrawPart}|${l.ldrawColor}`} onClick={() => onHighlight(l.instanceIds)}>
              <td className="num">{l.quantity}</td>
              <td><span className="code">{l.ldrawPart}</span> {l.partName}</td>
              <td><span className="swatch" style={{ background: bundle.catalog.displayColor(l.ldrawColor).value }} /> {l.colorName}</td>
              <td className="code">{l.rebrickablePart === null ? '– (ungeprüft)' : `${l.rebrickablePart} / ${l.rebrickableColor ?? '–'}`}</td>
              <td className={l.combination === 'unchecked' ? 'open' : ''}>
                {l.combination === 'evidenced'
                  ? `belegt${bundle.catalog.source.state === 'loaded' && bundle.catalog.source.kind === 'test-fixture' ? ' (nur Testfixture)' : l.elementIds.length ? ` (Element ${l.elementIds.slice(0, 2).join(', ')})` : ' (Set-Inventar)'}`
                  : l.combination === 'unchecked' ? 'ungeprüft (kein Katalog)' : 'nicht belegt'}
              </td>
              <td>{{ supported: 'unterstützt', partial: 'teilweise', unsupported: 'nicht unterstützt', none: 'nicht unterstützt' }[l.simulation]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Nicht auflösbare Einträge</h3>
      {bom.unresolved.length ? (
        <ul className="unresolved">
          {bom.unresolved.map((u) => (
            <li key={`${u.ldrawPart}|${u.ldrawColor}`}><button className="linklike" onClick={() => onHighlight(u.instanceIds)}>{u.quantity} × {u.ldrawPart}, Farbcode {u.ldrawColor}</button>: {u.reasons.join('; ')}</li>
          ))}
        </ul>
      ) : <p className="muted">Keine.</p>}
      {ref && !cmp && (
        <>
          <h3>Unabhängiger Abgleich</h3>
          <p className="open">
            Ungeprüft: {bundle.catalog.source.state === 'corrupt' ? 'Der Katalogauszug ist beschädigt und wird nicht verwendet.' : 'Kein Katalogauszug geladen.'} Der Abgleich gegen das Rebrickable-Inventar von {ref.setNumber} findet nicht statt; daraus folgt weder Übereinstimmung noch Abweichung.
          </p>
        </>
      )}
      {cmp && (
        <>
          <h3>Unabhängiger Abgleich</h3>
          <p className="muted small">{cmp.source}. Modell {cmp.summary.modelTotal} Teile, Inventar {cmp.summary.referenceTotal} (ohne {cmp.summary.spareExcluded} Ersatzteile). {cmp.summary.differing ? `${cmp.summary.differing} abweichende Zeile(n).` : 'Alle Zeilen stimmen überein.'}</p>
          <table className="bomtable">
            <thead><tr><th>Teil</th><th>Farbe</th><th>Modell</th><th>Inventar</th><th>Ergebnis</th></tr></thead>
            <tbody>
              {cmp.lines.map((l) => (
                <tr key={`${l.rebrickablePart}|${l.color}`} className={l.status === 'match' ? '' : 'diff'}>
                  <td><span className="code">{l.rebrickablePart}</span> {l.partName}</td>
                  <td>{l.colorName}</td>
                  <td className="num">{l.modelQty}</td>
                  <td className="num">{l.referenceQty}</td>
                  <td>{{ match: 'übereinstimmend', 'quantity-differs': 'Menge abweichend', 'only-in-model': 'nur im Modell', 'only-in-reference': 'nur im Inventar', 'variant-of': 'Formvariante' }[l.status]}{l.note ? ` – ${l.note}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function SourcePanel({ model, bundle, item, expectations, report }: { model: CanonicalModel; bundle: DataBundle; item?: LabItem; expectations: Expectations | null; report: ValidationReport }) {
  const ref = bundle.references.find((r) => r.referenceId === item?.referenceId);
  const exp = item?.caseId ? expectations?.cases.find((c) => c.caseId === item.caseId) : ref ? expectations?.references.find((r) => r.referenceId === ref.referenceId) : undefined;
  const codes = new Set(report.findings.map((f) => f.code));
  const u = model.usage;
  return (
    <div className="source">
      {ref && (
        <section>
          <h3>Referenz {ref.setNumber}: {ref.name}</h3>
          <dl>
            <dt>Variante</dt><dd>{ref.variant}</dd>
            {Object.entries(ref.source).map(([k, v]) => (<Fragment key={k}><dt>{SOURCE_KEYS[k] ?? k}</dt><dd className={k === 'sha256' ? 'code' : ''}>{v}</dd></Fragment>))}
          </dl>
          <h4>Datengewinnung</h4><ul>{ref.dataAcquisition.map((x) => <li key={x}>{x}</li>)}</ul>
          <h4>Unabhängiger Abgleich</h4><ul>{ref.crossCheck.map((x) => <li key={x}>{x}</li>)}</ul>
          <h4>Durch die Quelle gedeckt</h4><ul>{ref.coveredBySource.map((x) => <li key={x}>{x}</li>)}</ul>
          <h4>Nicht gedeckt / ungeprüft</h4><ul>{ref.notCovered.map((x) => <li key={x}>{x}</li>)}</ul>
          {ref.knownDiscrepancies.length > 0 && (<><h4>Bekannte Abweichungen zwischen Quellen</h4><ul>{ref.knownDiscrepancies.map((x) => <li key={x}>{x}</li>)}</ul></>)}
          {ref.instructionComparison && (
            <>
              <h4>Abgleich mit Originalanleitung: {ref.instructionComparison.status}</h4>
              <p>{ref.instructionComparison.summary}</p>
              <p className="muted small">Quellenabgleich am Dokument – kein physischer Probebau.</p>
              <h4>Geprüfte Abschnitte</h4><ul>{ref.instructionComparison.checkedSections.map((x) => <li key={x}>{x}</li>)}</ul>
              {ref.instructionComparison.confirmed.length > 0 && (<><h4>Bestätigt</h4><ul>{ref.instructionComparison.confirmed.map((x) => <li key={x}>{x}</li>)}</ul></>)}
              {ref.instructionComparison.contradictory.length > 0 && (<><h4>Abweichend oder widersprüchlich</h4><ul>{ref.instructionComparison.contradictory.map((x) => <li key={x}>{x}</li>)}</ul></>)}
              <h4>Weiterhin ungeprüft</h4><ul className="open">{ref.instructionComparison.unchecked.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
          <h4>Nutzung und Weitergabe</h4><p>{ref.usageStatus}</p>
          <h4>Anleitung (nur verlinkt)</h4><ul>{ref.instructions.map((x) => <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer">{x.label}</a></li>)}</ul>
          <p className="muted small">Eine veröffentlichte Baufolge ist eine positive Referenz für den Ablauf, kein Nachweis für Haltbarkeit oder Kindersicherheit.</p>
        </section>
      )}
      {exp && (
        <section>
          <h3>Deklarierte Erwartung</h3>
          <p>{exp.reason}</p>
          <ul className="expect">
            {exp.include.map((i) => <li key={`i${i.code}`} className={codes.has(i.code) ? 'met' : 'unmet'}>erwartet: <span className="code">{i.code}</span> – {codes.has(i.code) ? 'erfüllt' : 'nicht erfüllt'}</li>)}
            {exp.exclude.map((c) => <li key={`e${c}`} className={!codes.has(c) ? 'met' : 'unmet'}>ausgeschlossen: <span className="code">{c}</span> – {!codes.has(c) ? 'erfüllt' : 'nicht erfüllt'}</li>)}
          </ul>
          <p className="muted small">Erwartungen liegen getrennt vom Validator in data/expectations/edge-cases.json. Diese Anzeige bezieht sich auf den angezeigten Bericht (Version {report.modelRef.version}).</p>
        </section>
      )}
      <section>
        <h3>Nutzungsprofil</h3>
        <dl>
          <dt>Nutzungsziel</dt><dd>{{ display: 'Display', 'careful-handling': 'vorsichtige Handhabung', 'play-goal': 'Spielmodell als Entwicklungsziel', unspecified: 'nicht angegeben' }[u.intendedUse]}</dd>
          <dt>Vorgesehene Nutzer</dt><dd>{u.intendedUsers.minAgeYears !== null ? `ab ${u.intendedUsers.minAgeYears} Jahren` : 'nicht angegeben'} (Quelle: {u.intendedUsers.source})</dd>
          <dt>Alterseignung</dt><dd>{u.ageSuitability.status === 'not-assessed' ? 'nicht bewertet – kein Eignungsurteil' : `${u.ageSuitability.value} (${u.ageSuitability.source})`}</dd>
        </dl>
        {ref?.source.manufacturerAge && <p className="muted small">Altersangabe des Originalsets: {ref.source.manufacturerAge}. Sie wird nicht als Eignungsurteil für dieses Modell übernommen.</p>}
      </section>
      <section>
        <h3>Modell</h3>
        <dl>
          <dt>Modell-ID</dt><dd className="code">{model.modelId}</dd>
          <dt>Version</dt><dd>{model.version}</dd>
          <dt>Einheiten</dt><dd>LDU, LDraw-Koordinaten (rechtshändig, −Y oben), Schwerkraft +Y</dd>
          <dt>Baugruppen</dt><dd>{model.assemblies.map((a) => a.name).join('; ')}</dd>
        </dl>
        {model.changeLog.length > 0 && (<><h4>Änderungsprotokoll</h4><ul>{model.changeLog.map((c) => <li key={c.toVersion}>v{c.fromVersion} → v{c.toVersion}: {c.description}</li>)}</ul></>)}
      </section>
    </div>
  );
}

const SOURCE_KEYS: Record<string, string> = {
  geometryAndSteps: 'Geometrie und Baufolge',
  fileUrl: 'Datei',
  author: 'Autor',
  license: 'Lizenz',
  fetchedAt: 'Abgerufen',
  sha256: 'SHA-256',
  independentInventory: 'Unabhängiges Inventar',
  manufacturerAge: 'Altersangabe Originalset',
};
