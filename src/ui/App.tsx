import { useEffect, useMemo, useState } from 'react';
import { computeBom, type Bom } from '../core/bom/bom';
import { loadBundle, type DataBundle } from '../core/data/bundle';
import { exportBomCsv, exportLdraw, exportModelJson, exportReportJson } from '../core/export/exporters';
import { applyEdit, artifactStatus, type ModelEdit } from '../core/model/edit';
import { modelRef } from '../core/model/hash';
import { modelDimensions } from '../core/model/dimensions';
import { generateSpaceship, GeneratorError, VARIANTS, type ShipParams, type ShipPlan } from '../generator/spaceship';
import type { CanonicalModel } from '../core/model/types';
import { initialProcurementState } from '../core/procurement/types';
import { OVERALL_LABEL, validate, type ValidationResult } from '../core/validation/validate';
import { labItems, type LabItem } from './items';
import { BomPanel, ReportPanel, SourcePanel, StepsPanel, type Expectations } from './panels';
import { Viewer } from './Viewer';
import { ShipLab } from './ShipLab';
import { comparisonReferenceId, GENERATED_COMPARISON_NOTE } from './comparison';

type Tab = 'report' | 'steps' | 'bom' | 'source';

interface Validated {
  result: ValidationResult;
  bom: Bom;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [bundle, setBundle] = useState<DataBundle | null>(null);
  const [expectations, setExpectations] = useState<Expectations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [itemId, setItemId] = useState('ref-40013-1');
  const [model, setModel] = useState<CanonicalModel | null>(null);
  const [validated, setValidated] = useState<Validated | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('report');
  const [mode, setMode] = useState<'pruef' | 'schiff'>('pruef');
  const [shipParams, setShipParams] = useState<ShipParams>(VARIANTS.kompakt.params);
  const [shipPlan, setShipPlan] = useState<ShipPlan | null>(null);
  const [shipError, setShipError] = useState<{ message: string; hints: string[] } | null>(null);
  const [shownShipParams, setShownShipParams] = useState<ShipParams | null>(null);

  useEffect(() => {
    // null = Datei existiert nicht (404 oder SPA-Fallback als HTML); andere Fehler werden gemeldet.
    const read = async (p: string): Promise<string | null> => {
      const r = await fetch(`${import.meta.env.BASE_URL}data/${p}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
      if ((r.headers.get('content-type') ?? '').includes('text/html')) return null;
      return r.text();
    };
    loadBundle(read).then(setBundle).catch((e) => setError(String(e)));
    read('expectations/edge-cases.json').then((t) => setExpectations(t ? JSON.parse(t) : null)).catch(() => setExpectations(null));
  }, []);

  const items = useMemo(() => (bundle ? labItems(bundle) : []), [bundle]);
  const item: LabItem | undefined = items.find((i) => i.id === itemId);

  const runValidation = (m: CanonicalModel) => {
    const result = validate(m, bundle!.catalog);
    setValidated({ result, bom: computeBom(m, bundle!.catalog) });
  };

  const resetView = () => {
    setStepIndex(-1);
    setSelected(null);
    setHighlight([]);
  };

  // Raumschiff-Labor: jede Parameteränderung erzeugt einen neuen Modellstand und prüft ihn sofort
  useEffect(() => {
    if (!bundle || mode !== 'schiff') return;
    try {
      const { model: m, plan } = generateSpaceship(shipParams);
      runValidation(m);
      setModel(m);
      setShipPlan(plan);
      setShipError(null);
      setShownShipParams(shipParams);
      resetView();
    } catch (e) {
      if (e instanceof GeneratorError) setShipError({ message: e.message, hints: e.hints });
      else setShipError({ message: String(e), hints: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, mode, shipParams]);

  // Modell laden und prüfen; beim Fall „veralteter Bericht“ anschließend die Änderung anwenden
  useEffect(() => {
    if (!bundle || !item || mode !== 'pruef') return;
    const m = item.make();
    runValidation(m);
    setModel(item.staleEdit ? applyEdit(m, { kind: 'move', ...item.staleEdit }) : m);
    resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, itemId, mode]);

  const ref = model ? modelRef(model) : null;
  const dims = useMemo(() => (bundle && model && model.origin.kind === 'generated' ? modelDimensions(model, bundle.library) : null), [bundle, model]);
  const reportState = ref ? artifactStatus('report', validated?.result.report.modelRef ?? null, ref) : null;
  const stale = reportState?.state === 'stale';
  // Raumschiff-Labor: Eingaben nicht erfüllbar → angezeigter Stand gehört nicht zu den aktuellen Eingaben
  const shipStale = mode === 'schiff' && !!shipError;

  const steps = model?.steps ?? [];
  const { visible, current } = useMemo(() => {
    if (!model) return { visible: new Set<string>(), current: new Set<string>() };
    const all = new Set(model.instances.map((i) => i.instanceId));
    if (stepIndex < 0 || !steps.length) return { visible: all, current: new Set<string>() };
    const vis = new Set<string>();
    steps.slice(0, stepIndex + 1).forEach((s) => s.add.forEach((id) => vis.add(id)));
    const cur = new Set(steps[stepIndex].add);
    // angesetzte Baugruppen im aktuellen Schritt hervorheben
    for (const aid of steps[stepIndex].attach) for (const i of model.instances) if (i.assemblyId === aid || i.assemblyId.startsWith(`${aid}>`)) cur.add(i.instanceId);
    return { visible: vis, current: cur };
  }, [model, stepIndex, steps]);

  const edit = (e: ModelEdit) => {
    if (!model) return;
    setModel(applyEdit(model, e));
  };

  if (error) return <div className="fatal">Daten konnten nicht geladen werden: {error}. Läuft der Entwicklungsserver aus dem Projektordner (npm run dev)?</div>;
  if (!bundle || !model || !validated || !ref) return <div className="loading">Lade LDraw-Teile, Katalogauszug und Referenzen …</div>;

  const report = validated.result.report;
  const blockers = report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed').length;
  const groups = ['Referenzen', 'Grenzfälle', 'Fehlervarianten'] as const;
  const selectedInst = model.instances.find((i) => i.instanceId === selected);

  return (
    <div className="app">
      <aside className="side">
        <h1 className="brand">Baustein-Prüflabor</h1>
        <div className="modes" role="tablist" aria-label="Bereich">
          <button role="tab" aria-selected={mode === 'pruef'} className={mode === 'pruef' ? 'tab active' : 'tab'} onClick={() => setMode('pruef')}>Prüflabor</button>
          <button role="tab" aria-selected={mode === 'schiff'} className={mode === 'schiff' ? 'tab active' : 'tab'} onClick={() => setMode('schiff')}>Raumschiff-Labor</button>
        </div>
        {mode === 'schiff' && (
          <ShipLab params={shipParams} onChange={setShipParams} plan={shipPlan} error={shipError} actualParts={model.origin.kind === 'generated' ? model.instances.length : null} dims={dims} shownParams={shownShipParams} />
        )}
        {mode === 'pruef' && <nav aria-label="Modelle">
          {groups.map((g) => (
            <section key={g} className="navgroup">
              <h2>{g}</h2>
              {g === 'Grenzfälle' && <p className="hint">Synthetische Fixtures, keine Referenzen.</p>}
              {g === 'Fehlervarianten' && <p className="hint">Gezielt beschädigte Kopien der Referenz 40013-1.</p>}
              <ul>
                {items.filter((i) => i.group === g).map((i, idx, arr) => (
                  <li key={i.id}>
                    {i.subgroup && i.subgroup !== arr[idx - 1]?.subgroup && <div className="subgroup">{i.subgroup}</div>}
                    <button className={i.id === itemId ? 'navitem active' : 'navitem'} onClick={() => setItemId(i.id)} aria-current={i.id === itemId}>
                      {i.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>}
        <section className="datastate" aria-label="Datenquellen und Prüfumfang">
          <h2>Datenquellen</h2>
          <ul className="sources">
            {bundle.sources.map((s) => (
              <li key={s.id} className={`source ${s.state}`}>
                <span className="srcstate">{{ loaded: 'geladen', missing: 'fehlt', corrupt: 'beschädigt' }[s.state]}</span>
                <span>
                  {s.label}
                  {!s.required && ' (optional)'}
                  <br />
                  <span className="muted">{s.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <h2>Prüfumfang</h2>
          <p className="small">Verfügbar: Teilgeometrie, Anschlüsse, Verbindungsgraph, Kollision, Montagefolge, Stand und Struktur (heuristisch), Stückliste aus den Modellinstanzen.</p>
          {!bundle.catalog.available && (
            <p className="small open">Ungeprüft ohne Katalog: Katalogexistenz der Teile, Farbzuordnung zu Rebrickable, Teil-Farb-Belege, Inventarabgleich der Referenzen.</p>
          )}
          <h2>Daten- und Regelstand</h2>
          <dl>
            <dt>Katalog</dt><dd className="code">{report.dataVersions.catalog}</dd>
            <dt>Teil-Metadaten</dt><dd className="code">{report.dataVersions.partMeta}</dd>
            <dt>Anschlussregeln</dt><dd className="code">{report.dataVersions.rules}</dd>
            <dt>Validator</dt><dd className="code">{report.dataVersions.validator}</dd>
            <dt>LDraw-Bibliothek</dt><dd>{Object.keys(bundle.manifest.files).length} Dateien, abgerufen {bundle.manifest.fetchedAt.slice(0, 10)}</dd>
          </dl>
        </section>
      </aside>

      <main className="center">
        <header className="modelbar">
          <div className="modeltitle">
            <h2>{model.name}</h2>
            <p className="origin">{model.origin.label}</p>
          </div>
          <div className={`verdict ${report.overall}`} role="status">
            <strong>{OVERALL_LABEL[report.overall]}</strong>
            <span>{blockers} Blocker im Bericht zu Version {report.modelRef.version}</span>
          </div>
        </header>
        {bundle.catalog.source.state === 'missing' && (
          <div className="catalogbar" role="note">
            Kein Katalogauszug geladen: Geometrie, Verbindungen, Montage und Stückliste sind geprüft; Katalogexistenz, Teil-Farb-Belege und Inventarabgleiche bleiben ungeprüft.
          </div>
        )}
        {bundle.catalog.source.state === 'corrupt' && (
          <div className="catalogbar corrupt" role="alert">
            {bundle.catalog.source.error}. Der Auszug wird nicht verwendet; Katalog- und Inventarabgleiche bleiben ungeprüft.
          </div>
        )}
        {stale && (
          <div className="stalebar" role="alert">
            <span>
              Prüfbericht, Baufolgenprüfung, Stückliste und Beschaffungsstand gehören zu Version {report.modelRef.version}. Das Modell ist jetzt Version {model.version} ({model.changeLog.at(-1)?.description}).
            </span>
            <button className="primary" onClick={() => runValidation(model)}>Version {model.version} prüfen</button>
          </div>
        )}
        {shipStale && (
          <div className="stalebar" role="alert">
            <span>Die aktuellen Eingaben sind nicht erfüllbar. Angezeigt werden Modell, Prüfbericht und Stückliste des letzten gültigen Stands ({ref.modelId}); Exporte sind gesperrt, bis die Eingaben wieder erfüllbar sind.</span>
          </div>
        )}
        <div className="viewwrap">
          <Viewer model={model} library={bundle.library} catalog={bundle.catalog} visible={visible} current={current} highlighted={new Set(highlight)} selected={selected} onSelect={setSelected} />
          <div className="provenance">Gerendert aus Modell {ref.modelId}, Version {ref.version}, Hash {ref.contentHash}</div>
          {selectedInst && (
            <div className="inspector">
              <div className="code">{selectedInst.instanceId}</div>
              <div>
                Teil {selectedInst.part} – {bundle.catalog.part(selectedInst.part).name ?? bundle.catalog.part(selectedInst.part).ldrawTitle ?? 'unbekannt'}, Farbe {bundle.catalog.color(selectedInst.color)?.rebrickableName ?? bundle.catalog.color(selectedInst.color)?.ldrawName ?? `Code ${selectedInst.color} (keine Zuordnung)`}
              </div>
              <div className="muted">Simulation: {bundle.catalog.part(selectedInst.part).simulation}</div>
              <div className="actions">
                <button onClick={() => edit({ kind: 'move', instanceId: selectedInst.instanceId, delta: [10, 0, 0] })}>½ Noppe nach +X</button>
                <button onClick={() => edit({ kind: 'move', instanceId: selectedInst.instanceId, delta: [20, 0, 0] })}>1 Noppe nach +X</button>
                <button onClick={() => edit({ kind: 'move', instanceId: selectedInst.instanceId, delta: [0, -8, 0] })}>1 Platte anheben</button>
                <button className="danger" onClick={() => { edit({ kind: 'remove', instanceId: selectedInst.instanceId }); setSelected(null); }}>Entfernen</button>
              </div>
            </div>
          )}
        </div>
        <div className="stepbar" aria-label="Bauschritte">
          {steps.length ? (
            <>
              <button onClick={() => setStepIndex((s) => Math.max(0, (s < 0 ? steps.length : s) - 1))} aria-label="Vorheriger Schritt">Zurück</button>
              <input type="range" min={0} max={steps.length} value={stepIndex < 0 ? steps.length : stepIndex} onChange={(e) => setStepIndex(Number(e.target.value) >= steps.length ? -1 : Number(e.target.value))} aria-label="Schritt wählen" />
              <button onClick={() => setStepIndex((s) => (s < 0 ? -1 : s + 1 >= steps.length ? -1 : s + 1))} aria-label="Nächster Schritt">Weiter</button>
              <span className="steplabel">{stepIndex < 0 ? `Endmodell (${steps.length} Schritte)` : `Schritt ${stepIndex + 1} von ${steps.length}: ${model.assemblies.find((a) => a.assemblyId === steps[stepIndex].assemblyId)?.name ?? ''}`}</span>
            </>
          ) : (
            <span className="steplabel">Keine belegte Baufolge – nur das Endmodell wird geprüft.</span>
          )}
        </div>
        <div className="exports">
          <span>Export</span>
          <button disabled={shipStale} onClick={() => download(`${ref.modelId}-v${ref.version}.model.json`, exportModelJson(model), 'application/json')}>Modell (JSON)</button>
          <button disabled={shipStale} onClick={() => download(`${report.modelRef.modelId}-v${report.modelRef.version}.report.json`, exportReportJson(report), 'application/json')}>
            Prüfbericht v{report.modelRef.version} (JSON){stale ? ' – veraltet' : ''}
          </button>
          <button disabled={shipStale} onClick={() => download(`${validated.bom.modelRef.modelId}-v${validated.bom.modelRef.version}.stueckliste.csv`, exportBomCsv(validated.bom), 'text/csv')}>
            Stückliste v{validated.bom.modelRef.version} (CSV){stale ? ' – veraltet' : ''}
          </button>
          <button disabled={shipStale} onClick={() => download(`${ref.modelId}-v${ref.version}.ldr`, exportLdraw(model), 'text/plain')}>LDraw</button>
        </div>
      </main>

      <section className="panel" aria-label="Prüfung">
        <div className="tabs" role="tablist">
          {([['report', 'Prüfbericht'], ['steps', 'Bauschritte'], ['bom', 'Stückliste'], ['source', 'Herkunft & Erwartung']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className={stale || shipStale ? 'tabbody is-stale' : 'tabbody'}>
          {tab === 'report' && <ReportPanel report={report} onHighlight={(ids) => { setHighlight(ids); }} highlighted={highlight} />}
          {tab === 'steps' && <StepsPanel model={model} analysis={validated.result.assembly} stepIndex={stepIndex} onStep={setStepIndex} catalog={bundle.catalog} stale={stale} />}
          {tab === 'bom' && <BomPanel bom={validated.bom} bundle={bundle} referenceId={comparisonReferenceId(model, item, mode)} comparisonNote={model.origin.kind === 'generated' ? GENERATED_COMPARISON_NOTE : undefined} procurement={initialProcurementState(validated.bom)} onHighlight={setHighlight} />}
          {tab === 'source' && <SourcePanel model={model} bundle={bundle} item={mode === 'pruef' ? item : undefined} expectations={expectations} report={report} />}
        </div>
      </section>
    </div>
  );
}
