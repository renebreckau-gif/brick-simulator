// Bereich „Bauanleitung“: Übersicht, Schrittnavigation, Teile je Schritt, Stückliste,
// Druckansicht und PDF – alles aus demselben Anleitungsplan und dessen Modellstand.
import { useEffect, useMemo, useState } from 'react';
import type { Catalog } from '../../core/catalog/catalog';
import type { InstructionPlan, PartLine, PlanStep } from '../../core/instructions/plan';
import type { PartLibrary } from '../../core/ldraw/library';
import { sameModelVersion } from '../../core/model/hash';
import type { CanonicalModel, ModelRef } from '../../core/model/types';
import { designNotes, docStep, facts, fullDocument, LEGEND, lineKey, notice, OVERVIEW_IMAGE, sections, thumbsFor, type DocStep } from './document';
import { instructionPdf } from './pdf';
import { InstructionRenderer, overviewImage } from './render';

interface Props {
  plan: InstructionPlan;
  planModel: CanonicalModel;
  currentRef: ModelRef;
  library: PartLibrary;
  catalog: Catalog;
  /** Neu erstellen für den aktuellen Modellstand (nur sichtbar, wenn veraltet). */
  onRebuild: () => void;
  rebuildError: string | null;
  /** Gesetzt, wenn die Eingaben nicht zum gezeigten Stand passen (z. B. nicht erfüllbar). */
  blockedReason?: string | null;
}

function PartCells({ lines, thumbs }: { lines: PartLine[]; thumbs: Map<string, string> }) {
  return (
    <ul className="iparts">
      {lines.map((l) => (
        <li key={lineKey(l)}>
          <img src={thumbs.get(lineKey(l))} alt={`${l.partName} ${l.colorName}`} width={64} height={64} />
          <span className="iqty">{l.quantity}×</span>
          <span>
            {l.partName}
            <br />
            <span className="code">{l.part}</span> · {l.colorName}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StepCard({ d, total }: { d: DocStep; total: number }) {
  const s: PlanStep = d.step;
  return (
    <article className={`istep${s.isModule ? ' module' : ''}`} aria-label={`Schritt ${s.number}`}>
      <header className="istephead">
        <span className="inum">Schritt {s.number} / {total}</span>
        <span className="ititle">{s.title}</span>
        <span className="ictx">{s.isModule ? `Vormontage: ${s.contextName}` : 'Hauptmodell'}</span>
      </header>
      {s.cameraNote && <p className="icam" role="note">↻ {s.cameraNote}</p>}
      <p className="iaction">{s.action}</p>
      <div className={d.images.detail ? 'iimgs withdetail' : 'iimgs'}>
        <img src={d.images.main} alt={`Bauzustand nach Schritt ${s.number}, neue Teile hervorgehoben`} />
        {d.images.detail && (
          <figure>
            <figcaption>Detail: Draufsicht</figcaption>
            <img src={d.images.detail} alt={`Draufsicht Schritt ${s.number}`} />
          </figure>
        )}
      </div>
      <ul className="inotes">
        <li className={s.insertion.checked ? '' : 'open'}><strong>Einsetzen:</strong> {s.insertion.text}</li>
        {s.support.map((x) => <li key={x} className="warnnote"><strong>Hinweis:</strong> {x}</li>)}
        {s.openChecks.map((x) => <li key={x} className="open"><strong>Offen:</strong> {x}</li>)}
      </ul>
      <h4>Neu benötigt</h4>
      {s.attachedModules.map((m) => (
        <p key={m.assemblyId} className="imodule">
          <img src={d.moduleThumbs.get(m.assemblyId)} alt={`Fertige Vormontage ${m.name}`} width={64} height={64} />
          <strong>1× Vormontage „{m.name}“</strong> aus Schritt {m.builtInSteps[0]}–{m.builtInSteps.at(-1)} ({m.instanceCount} Teile – bereits gezählt, nicht erneut entnehmen)
        </p>
      ))}
      {s.newParts.length > 0 && <PartCells lines={s.newParts} thumbs={d.thumbs} />}
    </article>
  );
}

function Overview({ plan, image }: { plan: InstructionPlan; image: string }) {
  return (
    <section className="ioverview" aria-label="Übersicht">
      <img src={image} alt="Fertiges Modell" width={OVERVIEW_IMAGE.width} height={OVERVIEW_IMAGE.height} />
      <dl className="ifacts">
        {facts(plan).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd className={/hash|ID/i.test(k) ? 'code' : ''}>{v}</dd></div>
        ))}
      </dl>
      <p className="inotice" role="note">{notice(plan)}</p>
      <h3>Markierungen in den Bildern</h3>
      <dl className="ilegend">
        {LEGEND.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {(() => {
        const dn = designNotes(plan);
        if (!dn) return null;
        return (
          <>
            <h3>Entwurfsannahmen und Abweichungen</h3>
            <ul>
              {dn.assumptions.map((a) => <li key={a}>Annahme: {a}</li>)}
              {dn.deviations.map((d) => <li key={d}>Abweichung: {d}</li>)}
              {dn.comparison && <li>Visueller Abgleich: {dn.comparison}</li>}
            </ul>
          </>
        );
      })()}
      <h3>Aufbau</h3>
      <ul>{sections(plan).map((s) => <li key={s}>{s}</li>)}</ul>
      <p className="muted small">{plan.sequenceCheck.note}</p>
    </section>
  );
}

function Bom({ plan, thumbs }: { plan: InstructionPlan; thumbs: Map<string, string> }) {
  return (
    <section className="ibom" aria-label="Vollständige Stückliste">
      <h3>Vollständige Stückliste: {plan.totalParts} Teile in {plan.bom.length} Positionen</h3>
      <p className="muted small">
        {plan.catalogState === 'loaded' ? 'Teilenummern nach LDraw; Namen und Farben aus dem lokalen Katalogauszug.' : 'Ohne Katalogauszug: LDraw-Teilenummern und LDraw-Farbnamen; Katalogzuordnung und Teil-Farb-Belege ungeprüft.'} Keine Elementnummern, Preise oder Verfügbarkeit.
      </p>
      <PartCells lines={plan.bom} thumbs={thumbs} />
    </section>
  );
}

export function InstructionView({ plan, planModel, currentRef, library, catalog, onRebuild, rebuildError, blockedReason }: Props) {
  const renderer = useMemo(() => new InstructionRenderer(planModel, library, catalog), [planModel, library, catalog]);
  useEffect(() => () => renderer.dispose(), [renderer]);
  const [page, setPage] = useState(-1); // −1 Übersicht, 0…N−1 Schritte, N Stückliste
  const [print, setPrint] = useState(false);
  const [pdfState, setPdfState] = useState<{ busy: boolean; info: string | null }>({ busy: false, info: null });
  useEffect(() => {
    setPage(-1);
    setPrint(false);
    setPdfState({ busy: false, info: null });
  }, [plan.planHash]);

  const N = plan.steps.length;
  const matches = sameModelVersion(plan.modelRef, currentRef);
  const current = matches && !blockedReason;
  const overview = useMemo(() => overviewImage(renderer, plan, OVERVIEW_IMAGE), [renderer, plan]);
  const stepDoc = useMemo(() => (page >= 0 && page < N ? docStep(renderer, plan, plan.steps[page]) : null), [renderer, plan, page, N]);
  const bomThumbs = useMemo(() => (page === N ? thumbsFor(renderer, plan, plan.bom) : null), [renderer, plan, page, N]);
  const printDoc = useMemo(() => (print ? fullDocument(renderer, plan) : null), [renderer, plan, print]);

  const exportPdf = () => {
    setPdfState({ busy: true, info: null });
    setTimeout(() => {
      const res = instructionPdf(renderer, plan);
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setPdfState({ busy: false, info: `${res.fileName}: ${res.pages} Seiten` });
    }, 30);
  };

  const step = page >= 0 && page < N ? plan.steps[page] : null;
  return (
    <section className="instructions" aria-label="Bauanleitung">
      <header className="ihead">
        <div>
          <h2>Bauanleitung: {plan.modelName}</h2>
          <p className="small muted">
            Plan <span className="code">{plan.planVersion}</span> für Modell <span className="code">{plan.modelRef.modelId}</span> Version {plan.modelRef.version}, Hash <span className="code">{plan.modelRef.contentHash}</span>
          </p>
        </div>
        <div className="iactions">
          <button onClick={() => setPrint((p) => !p)} disabled={!current} aria-pressed={print}>{print ? 'Druckansicht schließen' : 'Druckansicht'}</button>
          {print && <button onClick={() => window.print()} disabled={!current}>Drucken</button>}
          <button className="primary" onClick={exportPdf} disabled={!current || pdfState.busy}>{pdfState.busy ? 'PDF wird erzeugt …' : 'PDF exportieren'}</button>
        </div>
      </header>
      {pdfState.info && <p className="small muted" role="status">Erzeugt: {pdfState.info}</p>}
      {blockedReason && <div className="stalebar" role="alert"><span>{blockedReason}</span></div>}
      {!matches && (
        <div className="stalebar" role="alert">
          <span>
            Diese Anleitung gehört zu Version {plan.modelRef.version} (Hash {plan.modelRef.contentHash}). Das dargestellte Modell ist jetzt Version {currentRef.version} (Hash {currentRef.contentHash}). Die Anleitung ist veraltet; Druck und PDF-Export sind gesperrt.
            {rebuildError && <><br /><strong>Neu erstellen nicht möglich:</strong> {rebuildError}</>}
          </span>
          <button className="primary" onClick={onRebuild}>Anleitung für Version {currentRef.version} erstellen</button>
        </div>
      )}

      {print && printDoc ? (
        <div className="printdoc">
          <section className="printpage">
            <h2>Bauanleitung: {plan.modelName}</h2>
            <Overview plan={plan} image={printDoc.overview} />
          </section>
          {printDoc.steps.map((d) => <StepCard key={d.step.number} d={d} total={N} />)}
          <Bom plan={plan} thumbs={printDoc.bomThumbs} />
          <p className="printfoot">{plan.modelRef.modelId} · Version {plan.modelRef.version} · Modellhash {plan.modelRef.contentHash} · {plan.planVersion}</p>
        </div>
      ) : (
        <>
          <nav className="inav" aria-label="Schrittnavigation">
            <button onClick={() => setPage((p) => Math.max(-1, p - 1))} disabled={page === -1}>Zurück</button>
            <select value={page} onChange={(e) => setPage(Number(e.target.value))} aria-label="Schritt wählen">
              <option value={-1}>Übersicht</option>
              {plan.steps.map((s, i) => <option key={s.number} value={i}>Schritt {s.number}: {s.title}</option>)}
              <option value={N}>Vollständige Stückliste</option>
            </select>
            <button className="primary" onClick={() => setPage((p) => Math.min(N, p + 1))} disabled={page === N}>Weiter</button>
          </nav>
          <div className="iprogress">
            <progress max={N} value={page < 0 ? 0 : Math.min(page + 1, N)} aria-label="Fortschritt" />
            <span className="small">
              {page < 0 ? 'Übersicht' : page === N ? 'Stückliste' : `Schritt ${page + 1} von ${N}`}
              {step && <> · Baugruppe: <strong>{step.isModule ? `${step.contextName} (separat vormontieren)` : 'Hauptmodell'}</strong></>}
            </span>
          </div>
          {page === -1 && <Overview plan={plan} image={overview} />}
          {stepDoc && <StepCard d={stepDoc} total={N} />}
          {page === N && bomThumbs && <Bom plan={plan} thumbs={bomThumbs} />}
        </>
      )}
    </section>
  );
}
