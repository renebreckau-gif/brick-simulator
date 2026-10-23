// Konstruktionsnachweis (Auftrag 05B.1): Bug und Kanzel aus realen Teilinstanzen. Die Formvorgabe stammt aus
// einer Vorlage im lokalen Entwurfsspeicher (nur gelesen) oder aus einer ausdrücklich synthetischen Testform.
import { useEffect, useMemo, useState } from 'react';
import type { Bom } from '../../core/bom/bom';
import { BOW_TECHNIQUE_VERSION } from '../../core/construct/bowTechnique';
import { buildCockpitBow, COCKPIT_TECHNIQUE_VERSION } from '../../core/construct/cockpitTechnique';
import { isCockpitPlan, VARIANT_LABEL, type AnyPlan, type ConstructVariant } from '../../core/construct/variants';
import { coverageFor, EvidenceFileSchema, massEstimate, type EvidenceFile } from '../../core/procurement/evidence';
import type { CanonicalModel } from '../../core/model/types';
import type { Rgba } from '../../core/construct/silhouette';
import { syntheticBowTarget, type BowTarget } from '../../core/construct/shapeTarget';
import { bowTargetFromTemplate, viewAssignmentOrigin, type TemplateMeasurement } from '../../core/construct/templateTarget';
import { parseBrief, type DesignBrief } from '../../core/design/brief';
import type { ModelDimensions } from '../../core/model/dimensions';
import { loadBrief, loadImage } from '../design/store';

export type ConstructSource = 'vorlage' | 'synth-a' | 'synth-b';
export interface ConstructParams { source: ConstructSource; variant: ConstructVariant; width: number; canopyGroupId: string | null; hollow: boolean; openingRows: number | null }
export const DEFAULT_CONSTRUCT: ConstructParams = { source: 'vorlage', variant: 'cockpit', width: 8, canopyGroupId: null, hollow: true, openingRows: null };

/** Teil-Farb-Belege und Angebote (nur im Entwicklungsserver bzw. Repository, nicht im öffentlichen Build). */
export function useEvidence(): { evidence: EvidenceFile | null; error: string | null } {
  const [state, setState] = useState<{ evidence: EvidenceFile | null; error: string | null }>({ evidence: null, error: null });
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/procurement/evidence-05b2.json`)
      .then(async (r) => {
        if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) throw new Error('Belegdatei nicht verfügbar (nur im Entwicklungsserver; nicht Teil des öffentlichen Builds)');
        return EvidenceFileSchema.parse(await r.json());
      })
      .then((evidence) => setState({ evidence, error: null }))
      .catch((e) => setState({ evidence: null, error: e instanceof Error ? e.message : String(e) }));
  }, []);
  return state;
}

const SOURCE_LABEL: Record<ConstructSource, string> = {
  vorlage: 'Vorlage (lokaler Entwurf)',
  'synth-a': 'Testform A (synthetisch)',
  'synth-b': 'Testform B (synthetisch)',
};

const SYNTH: Record<'synth-a' | 'synth-b', BowTarget> = {
  'synth-a': syntheticBowTarget({ rows: 14, width: 6, noseRows: 8, rearTop: 9, tipTop: 3, canopy: { fromRow: 1, toRow: 4, width: 4, height: 4 }, label: 'Synthetische Testform A' }),
  'synth-b': syntheticBowTarget({ rows: 14, width: 6, noseRows: 7, rearTop: 9, tipTop: 2, canopy: { fromRow: 3, toRow: 6, width: 4, height: 4 }, label: 'Synthetische Testform B' }),
};

export interface TemplateState {
  brief: DesignBrief | null;
  issues: string[];
  /** Objekt-URLs der Bilder (für die Ausschnitte im Vergleich). */
  imageUrls: string[];
  measurement: TemplateMeasurement | null;
  error: string | null;
  loading: boolean;
}

async function blobPixels(blob: Blob): Promise<Rgba> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const d = g.getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: d.width, height: d.height };
}

/** Formvorgabe für die aktuellen Eingaben; die Vorlage wird nur gelesen (Entwurf und Bilder bleiben unverändert). */
export function useConstructionTarget(p: ConstructParams, active: boolean): { target: BowTarget | null; template: TemplateState } {
  const [loaded, setLoaded] = useState<{ brief: DesignBrief | null; issues: string[]; pixels: Rgba[]; urls: string[]; error: string | null; loading: boolean }>({ brief: null, issues: [], pixels: [], urls: [], error: null, loading: false });
  const wantTemplate = active && p.source === 'vorlage';
  useEffect(() => {
    if (!wantTemplate) return;
    let cancelled = false;
    const urls: string[] = [];
    setLoaded((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const text = await loadBrief();
      if (!text) throw new Error('Im lokalen Entwurfsspeicher liegt kein Entwurf. Unter „Aus Bild entwerfen“ ein Bild hinzufügen und die Ansichten erfassen.');
      const { brief, issues } = parseBrief(text);
      const pixels: Rgba[] = [];
      for (const im of brief.images) {
        const blob = await loadImage(im.sha256);
        if (!blob) throw new Error(`Bild ${im.fileName} fehlt im lokalen Speicher`);
        pixels.push(await blobPixels(blob));
        urls.push(URL.createObjectURL(blob));
      }
      if (!cancelled) setLoaded({ brief, issues, pixels, urls, error: null, loading: false });
    })().catch((e) => { if (!cancelled) setLoaded({ brief: null, issues: [], pixels: [], urls: [], error: e instanceof Error ? e.message : String(e), loading: false }); });
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [wantTemplate]);

  const measured = useMemo(() => {
    if (!wantTemplate || !loaded.brief || !p.canopyGroupId) return { m: null, error: null };
    try {
      return { m: bowTargetFromTemplate(loaded.brief, (i) => loaded.pixels[i], { canopyGroupId: p.canopyGroupId, widthStuds: p.width }), error: null };
    } catch (e) {
      return { m: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [wantTemplate, loaded, p.canopyGroupId, p.width]);

  const target = p.source === 'vorlage' ? measured.m?.target ?? null : SYNTH[p.source];
  return { target, template: { brief: loaded.brief, issues: loaded.issues, imageUrls: loaded.urls, measurement: measured.m, error: loaded.error ?? measured.error, loading: loaded.loading } };
}

interface Props {
  params: ConstructParams;
  onChange: (p: ConstructParams) => void;
  template: TemplateState;
  target: BowTarget | null;
  plan: AnyPlan | null;
  model: CanonicalModel | null;
  error: string | null;
  parts: number | null;
  dims: ModelDimensions | null;
  bom: Bom | null;
  catalogLoaded: boolean;
  evidence: EvidenceFile | null;
  evidenceError: string | null;
}

export function ConstructionLab({ params, onChange, template, target, plan, model, error, parts, dims, bom, catalogLoaded, evidence, evidenceError }: Props) {
  const cov = useMemo(() => (model ? coverageFor(model, evidence) : null), [model, evidence]);
  // Massenvergleich: gleiche Außenform massiv gebaut (nur Variante C)
  const massive = useMemo(() => {
    if (!target || params.variant !== 'cockpit' || !params.hollow) return null;
    try {
      const m = buildCockpitBow(target, { widthStuds: params.width, req: { hollow: false, openingRows: params.openingRows } }).model;
      return { parts: m.instances.length, mass: massEstimate(m, evidence) };
    } catch {
      return null;
    }
  }, [target, params.variant, params.hollow, params.width, params.openingRows, evidence]);
  const mass = model ? massEstimate(model, evidence) : null;
  const total = cov?.lines.length ?? bom?.lines.length ?? 0;
  const set = (patch: Partial<ConstructParams>) => onChange({ ...params, ...patch });
  const b = template.brief;
  const groups = b?.interpretation?.groups.filter((g) => g.role !== 'hauptkoerper') ?? [];
  const suggestion = groups.find((g) => /kanzel|cockpit|canopy/i.test(g.name));
  const origin = b ? viewAssignmentOrigin(b) : null;
  const unevidenced = bom?.lines.filter((l) => l.combination !== 'evidenced') ?? [];
  return (
    <section className="shiplab construct" aria-label="Konstruktionsnachweis">
      <p className="hint">Bug und Kanzel aus realen Teilen (LDraw-Geometrie), eigener Entwurf – kein offizielles LEGO-Modell. Geprüft im Prüfkern; physische Belastbarkeit nicht erprobt.</p>
      <h2>Formvorgabe</h2>
      <div className="variants" role="group" aria-label="Quelle der Formvorgabe">
        {(Object.keys(SOURCE_LABEL) as ConstructSource[]).map((s) => (
          <button key={s} className={params.source === s ? 'navitem active' : 'navitem'} aria-pressed={params.source === s} onClick={() => set({ source: s })}>{SOURCE_LABEL[s]}</button>
        ))}
      </div>
      {params.source !== 'vorlage' && <p className="small open">Synthetische Testform – keine Vorlagenmessung. Dient dem Nachweis, dass die Konstruktion auf eine geänderte Form reagiert{params.source === 'synth-b' ? ' (B: Spitze kürzer, Kanzel weiter vorn als A)' : ''}.</p>}
      {params.source === 'vorlage' && (
        <div className="small">
          {template.loading && <p>Lade Entwurf und Bilder aus dem lokalen Speicher …</p>}
          {b && (
            <dl className="shipfacts">
              <dt>Entwurf</dt><dd>{b.title || b.briefId} (nur gelesen, unverändert)</dd>
              <dt>Ansichtszuordnung</dt><dd>{origin?.text}</dd>
              <dt>Automatische Erkennung</dt><dd className={origin?.kind === 'live-extended' ? '' : 'open'}>{origin?.kind === 'live-extended' ? 'mit erweitertem Ansichtsformat gelaufen' : 'nicht nachgewiesen (die Ansichten stammen nicht aus einer Live-Analyse im erweiterten Format)'}</dd>
            </dl>
          )}
          {b && (
            <label className="wide">
              Kanzel-Baugruppe (Auswahl durch Sie)
              <select value={params.canopyGroupId ?? ''} onChange={(e) => set({ canopyGroupId: e.target.value || null })}>
                <option value="">– bitte wählen –</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          )}
          {b && !params.canopyGroupId && suggestion && (
            <p>Vorschlag nach Namensabgleich (ungeprüft): <button className="linklike" onClick={() => set({ canopyGroupId: suggestion.id })}>„{suggestion.name}“ übernehmen</button></p>
          )}
        </div>
      )}
      {template.error && params.source === 'vorlage' && <div className="shiperror" role="alert">{template.error}</div>}

      <h2>Variante</h2>
      <div className="variants" role="group" aria-label="Bautechnik">
        {(Object.keys(VARIANT_LABEL) as ConstructVariant[]).map((v) => (
          <button key={v} className={params.variant === v ? 'navitem active' : 'navitem'} aria-pressed={params.variant === v} onClick={() => set({ variant: v })}>{VARIANT_LABEL[v]}</button>
        ))}
      </div>
      <div className="form">
        <label className="wide">
          Breite (Noppen)
          <select value={params.width} onChange={(e) => set({ width: Number(e.target.value) })}>
            <option value={6}>6 (erste Testgröße)</option>
            <option value={8}>8{params.variant === 'cockpit' ? ' (gewählt für Variante C)' : ' (größere Ausführung)'}</option>
            <option value={10}>10 (Vergleich)</option>
          </select>
        </label>
        {params.variant === 'cockpit' && (
          <>
            <label className="wide">
              Bauweise
              <select value={params.hollow ? 'hohl' : 'massiv'} onChange={(e) => set({ hollow: e.target.value === 'hohl' })}>
                <option value="hohl">Hohlbau mit Cockpit-Innenraum</option>
                <option value="massiv">Massiv (Vergleich, gleiche Außenform)</option>
              </select>
            </label>
            <label className="wide">
              Cockpitöffnung (Funktionsanforderung)
              <select value={params.openingRows ?? ''} onChange={(e) => set({ openingRows: e.target.value ? Number(e.target.value) : null })}>
                <option value="">aus der Kanzellage der Vorlage</option>
                {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} Reihen lang</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      {error && <div className="shiperror" role="alert"><strong>Nicht baubar:</strong> {error}</div>}
      {plan && target && !error && (
        <>
          <dl className="shipfacts">
            <dt>Teile</dt><dd>{parts}</dd>
            {dims && <><dt>Außenmaße</dt><dd>{dims.studs.length} × {dims.studs.width} Noppen, Höhe {dims.ldu.height} LDU (≈ {dims.mm.length} × {dims.mm.width} × {dims.mm.height} mm)</dd></>}
            <dt>Lagen</dt><dd>{plan.layers.map((l) => `${l.name}: ${l.parts}`).join(' · ')}</dd>
            <dt>Bautechnik</dt><dd className="code">{isCockpitPlan(plan) ? COCKPIT_TECHNIQUE_VERSION : BOW_TECHNIQUE_VERSION}</dd>
            {isCockpitPlan(plan) && plan.cockpit && (
              <><dt>Nutzbarer Innenraum</dt><dd>Grundfläche {plan.cockpit.widthStuds} × {plan.cockpit.lengthStuds} Noppen ({plan.cockpit.mm.width} × {plan.cockpit.mm.length} mm), Höhe {plan.cockpit.wellPlates} Platten bis Randhöhe + {plan.cockpit.headroomPlates} unter dem Dach (≈ {plan.cockpit.mm.height} mm); Vorschlag, kein Minifigurenmaßstab vorausgesetzt</dd></>
            )}
            {isCockpitPlan(plan) && <><dt>Kanzel</dt><dd>{plan.canopyParts} Teile, als Baugruppe gerade nach oben abnehmbar (Prüfung „Funktion“ im Prüfbericht)</dd></>}
            {mass && <><dt>Masse (Schätzung)</dt><dd>{mass.missing.length ? `unvollständig – keine Katalogmasse für ${mass.missing.join(', ')}` : `≈ ${mass.grams.toFixed(0)} g`}{massive && !massive.mass.missing.length && <> · massiv gleicher Außenform: {massive.parts} Teile, ≈ {massive.mass.grams.toFixed(0)} g</>}</dd></>}
          </dl>
          {mass && <p className="small muted">Schätzverfahren: Summe der BrickLink-Katalogmassen je Teil (Belegdatei); keine Wägung, keine Stabilitätszusage.</p>}
          <details open>
            <summary>Entscheidungen ({plan.decisions.length})</summary>
            <ul className="small">{plan.decisions.map((d) => <li key={d}>{d}</li>)}</ul>
          </details>
          <details open>
            <summary>Abweichungen von der Formvorgabe ({plan.deviations.length})</summary>
            {plan.deviations.length ? <ul className="small">{plan.deviations.map((d) => <li key={d}>{d}</li>)}</ul> : <p className="small muted">Keine über der Meldeschwelle (Breite &gt; 1 Noppe, Höhe &gt; 2 Platten).</p>}
          </details>
          <details>
            <summary>Herkunft der Formvorgabe ({target.sources.length} Quellen, {target.notes.length} Hinweise)</summary>
            <p className="small">{target.origin.description}</p>
            <ul className="small">{target.sources.map((s) => <li key={s.field}><strong>{s.field}:</strong> {s.source} – {s.method}</li>)}</ul>
            {target.notes.length > 0 && <ul className="small">{target.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          </details>
        </>
      )}
      {bom && (
        <>
          <h2>Teilestatus</h2>
          <dl className="shipfacts">
            <dt>Teilegeometrie</dt><dd>alle {total} Positionen aus LDraw-Dateien (Herkunft und Prüfsummen in data/ldraw)</dd>
            <dt>Katalogauszug</dt><dd className={catalogLoaded && !bom.unresolved.length ? '' : 'open'}>{catalogLoaded ? `${bom.lines.length} von ${total} Positionen im lokalen Auszug${bom.unresolved.length ? `, ${bom.unresolved.length} nicht enthalten (dort ungeprüft)` : ''}${unevidenced.length ? `; ${unevidenced.length} davon ohne Teil-Farb-Beleg im Auszug` : ''}` : 'ungeprüft (kein Katalogauszug geladen)'}</dd>
            <dt>Teil-Farb-Beleg</dt><dd className={cov && evidence && cov.lines.every((l) => l.existenceEvidenced) ? '' : 'open'}>{!cov || !evidence ? 'ungeprüft (keine Belegdatei)' : cov.lines.every((l) => l.existenceEvidenced) ? `alle ${total} Positionen mit LEGO-Element-ID belegt (Belegdatei)` : `${cov.lines.filter((l) => !l.existenceEvidenced).length} Position(en) ohne Beleg: ${cov.lines.filter((l) => !l.existenceEvidenced).map((l) => `${l.ldrawPart}/${l.ldrawColor}`).join(', ')} – Farben nicht als real bestätigt`}</dd>
            <dt>Kaufverfügbarkeit</dt><dd className={cov?.complete ? '' : 'open'}>{!evidence ? `nicht geprüft – ${evidenceError ?? 'lade Belege …'}` : cov?.complete ? `alle ${cov.lines.length} Positionen belegt und durch Angebote gedeckt (Lieferland ${cov.region}, Stand ${cov.checkedAt}; vor einer Bestellung erneut prüfen)` : `${cov?.lines.filter((l) => l.status !== 'gedeckt').length} von ${cov?.lines.length} Positionen nicht belegt oder nicht gedeckt – Nachweis unvollständig`}</dd>
          </dl>
          {cov && evidence && (
            <details>
              <summary>Belege und Angebote je Position</summary>
              <table className="bomtable small">
                <thead><tr><th>Teil</th><th>Farbe</th><th>Bedarf</th><th>Beleg</th><th>Angebot</th><th>Status</th></tr></thead>
                <tbody>
                  {cov.lines.map((l) => (
                    <tr key={`${l.ldrawPart}|${l.ldrawColor}`} className={l.status === 'gedeckt' ? '' : 'diff'}>
                      <td className="code">{l.ldrawPart}{l.evidence && l.evidence.bricklink.part !== l.ldrawPart ? ` (BL ${l.evidence.bricklink.part})` : ''}</td>
                      <td>{l.evidence ? `${l.evidence.bricklink.colorName} (LDraw ${l.ldrawColor}, RB ${l.evidence.rebrickable.color}, BL ${l.evidence.bricklink.color})` : `LDraw ${l.ldrawColor}`}</td>
                      <td className="num">{l.needed}</td>
                      <td>{l.existenceEvidenced ? `Element ${l.evidence!.rebrickable.elementIds.slice(0, 2).join(', ')}` : 'kein Beleg'}</td>
                      <td>{l.used.length ? l.used.map((u) => `${u.offer.seller.name}: ${u.take} von ${u.offer.quantityAvailable}, ${u.offer.condition === 'new' ? 'neu' : 'gebraucht'}, ${u.offer.unitPrice.amount.toFixed(2)} € (${u.offer.checkedAt.slice(0, 16).replace('T', ' ')} UTC)`).join('; ') : '–'}</td>
                      <td>{{ gedeckt: 'gedeckt', teilweise: 'teilweise gedeckt', 'kein-angebot': 'kein Angebot', 'kein-existenzbeleg': 'nicht belegt' }[l.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </section>
  );
}
