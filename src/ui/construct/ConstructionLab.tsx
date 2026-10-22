// Konstruktionsnachweis (Auftrag 05B.1): Bug und Kanzel aus realen Teilinstanzen. Die Formvorgabe stammt aus
// einer Vorlage im lokalen Entwurfsspeicher (nur gelesen) oder aus einer ausdrücklich synthetischen Testform.
import { useEffect, useMemo, useState } from 'react';
import type { Bom } from '../../core/bom/bom';
import { BOW_TECHNIQUE_VERSION, BOW_VARIANT_LABEL, type BowPlan, type BowVariant } from '../../core/construct/bowTechnique';
import type { Rgba } from '../../core/construct/silhouette';
import { syntheticBowTarget, type BowTarget } from '../../core/construct/shapeTarget';
import { bowTargetFromTemplate, viewAssignmentOrigin, type TemplateMeasurement } from '../../core/construct/templateTarget';
import { parseBrief, type DesignBrief } from '../../core/design/brief';
import type { ModelDimensions } from '../../core/model/dimensions';
import { loadBrief, loadImage } from '../design/store';

export type ConstructSource = 'vorlage' | 'synth-a' | 'synth-b';
export interface ConstructParams { source: ConstructSource; variant: BowVariant; width: 6 | 8; canopyGroupId: string | null }
export const DEFAULT_CONSTRUCT: ConstructParams = { source: 'vorlage', variant: 'keilplatten', width: 6, canopyGroupId: null };

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
  plan: BowPlan | null;
  error: string | null;
  parts: number | null;
  dims: ModelDimensions | null;
  bom: Bom | null;
  catalogLoaded: boolean;
}

export function ConstructionLab({ params, onChange, template, target, plan, error, parts, dims, bom, catalogLoaded }: Props) {
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
        {(Object.keys(BOW_VARIANT_LABEL) as BowVariant[]).map((v) => (
          <button key={v} className={params.variant === v ? 'navitem active' : 'navitem'} aria-pressed={params.variant === v} onClick={() => set({ variant: v })}>{BOW_VARIANT_LABEL[v]}</button>
        ))}
      </div>
      <div className="form">
        <label className="wide">
          Breite (Noppen)
          <select value={params.width} onChange={(e) => set({ width: Number(e.target.value) as 6 | 8 })}>
            <option value={6}>6 (erste Testgröße)</option>
            <option value={8}>8 (größere Ausführung)</option>
          </select>
        </label>
      </div>
      {error && <div className="shiperror" role="alert"><strong>Nicht baubar:</strong> {error}</div>}
      {plan && target && !error && (
        <>
          <dl className="shipfacts">
            <dt>Teile</dt><dd>{parts}</dd>
            {dims && <><dt>Außenmaße</dt><dd>{dims.studs.length} × {dims.studs.width} Noppen, Höhe {dims.ldu.height} LDU (≈ {dims.mm.length} × {dims.mm.width} × {dims.mm.height} mm)</dd></>}
            <dt>Lagen</dt><dd>{plan.layers.map((l) => `${l.name}: ${l.parts}`).join(' · ')}</dd>
            <dt>Bautechnik</dt><dd className="code">{BOW_TECHNIQUE_VERSION}</dd>
          </dl>
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
            <dt>Teilegeometrie</dt><dd>alle {bom.lines.length} Positionen aus LDraw-Dateien (Herkunft und Prüfsummen in data/ldraw)</dd>
            <dt>Katalogexistenz</dt><dd className={catalogLoaded ? '' : 'open'}>{catalogLoaded ? `${bom.lines.filter((l) => l.rebrickablePart !== null).length} von ${bom.lines.length} Positionen im Katalogauszug gefunden` : 'ungeprüft (kein Katalogauszug geladen)'}</dd>
            <dt>Teil-Farb-Beleg</dt><dd className={unevidenced.length ? 'open' : ''}>{unevidenced.length ? `${unevidenced.length} Position(en) ohne Beleg: ${unevidenced.map((l) => `${l.ldrawPart} in ${l.colorName}`).join(', ')} – Farben nicht als real bestätigt` : 'alle Positionen belegt'}</dd>
            <dt>Kaufverfügbarkeit</dt><dd className="open">nicht geprüft (keine Händlerdaten)</dd>
          </dl>
        </>
      )}
    </section>
  );
}
