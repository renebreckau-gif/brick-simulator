// Raumschiff-Labor: wenige Eingaben, drei Varianten, Plan- und Ist-Werte aus dem konstruierten Modell.
import type { ModelDimensions } from '../core/model/dimensions';
import { HULL_LENGTHS, PALETTES, SPANS, VARIANTS, GENERATOR_VERSION, type PaletteId, type ShipParams, type ShipPlan } from '../generator/spaceship';

interface Props {
  params: ShipParams;
  onChange: (p: ShipParams) => void;
  plan: ShipPlan | null;
  error: { message: string; hints: string[] } | null;
  actualParts: number | null;
  dims: ModelDimensions | null;
  shownParams: ShipParams | null;
}

export function ShipLab({ params, onChange, plan, error, actualParts, dims, shownParams }: Props) {
  const set = (patch: Partial<ShipParams>) => onChange({ ...params, ...patch });
  const activeVariant = Object.entries(VARIANTS).find(([, v]) => JSON.stringify(v.params) === JSON.stringify(params))?.[0];
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);
  return (
    <section className="shiplab" aria-label="Raumschiff-Labor">
      <p className="hint">Eigener Entwurf aus dem vorhandenen Teileumfang – kein offizielles LEGO-Modell, keine Referenz.</p>
      <h2>Variante</h2>
      <div className="variants" role="group" aria-label="Vorgaben">
        {Object.entries(VARIANTS).map(([k, v]) => (
          <button key={k} className={activeVariant === k ? 'navitem active' : 'navitem'} aria-pressed={activeVariant === k} onClick={() => onChange({ ...v.params, palette: params.palette })}>
            {v.label}
          </button>
        ))}
      </div>
      <h2>Eingaben</h2>
      <div className="form">
        <label>
          Rumpflänge (Noppen)
          <select value={params.hullLength} onChange={(e) => set({ hullLength: Number(e.target.value) })}>
            {HULL_LENGTHS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label>
          Spannweite (Noppen)
          <select value={params.span} onChange={(e) => set({ span: Number(e.target.value) })}>
            {SPANS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Teilezahl von
          <input type="number" min={1} value={params.partMin} onChange={(e) => set({ partMin: num(e.target.value, params.partMin) })} />
        </label>
        <label>
          bis
          <input type="number" min={1} value={params.partMax} onChange={(e) => set({ partMax: num(e.target.value, params.partMax) })} />
        </label>
        <label className="wide">
          Farbpalette
          <select value={params.palette} onChange={(e) => set({ palette: e.target.value as PaletteId })}>
            {Object.values(PALETTES).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="wide">
          Variantenkennung (Seed)
          <input type="number" min={0} step={1} value={params.seed} onChange={(e) => set({ seed: Math.max(0, Math.floor(num(e.target.value, params.seed))) })} />
        </label>
      </div>
      {error && (
        <div className="shiperror" role="alert">
          <strong>Nicht erfüllbar:</strong> {error.message}
          {error.hints.length > 0 && <ul>{error.hints.map((h) => <li key={h}>{h}</li>)}</ul>}
          {shownParams && <p className="small">Angezeigt bleibt der letzte gültige Stand (Rumpf {shownParams.hullLength}, Spannweite {shownParams.span}, Seed {shownParams.seed}); er passt nicht zu den aktuellen Eingaben.</p>}
        </div>
      )}
      {!error && plan && dims && (
        <dl className="shipfacts">
          <dt>Teilezahl geplant</dt><dd>{plan.target} (erreichbar {plan.achievable[0]}–{plan.achievable[1]}; Grundgerüst {plan.mandatory})</dd>
          <dt>Teilezahl tatsächlich</dt><dd>{actualParts}</dd>
          <dt>Außenmaße</dt><dd>{dims.studs.length} × {dims.studs.width} Noppen, Höhe {dims.ldu.height} LDU (≈ {dims.mm.length} × {dims.mm.width} × {dims.mm.height} mm)</dd>
          <dt>Generator</dt><dd className="code">{GENERATOR_VERSION}</dd>
          <dt>Rumpfverband</dt><dd>Versuch {plan.hullAttempt + 1}; {plan.relaxations.length ? plan.relaxations.join('; ') : 'streng versetzt'}</dd>
        </dl>
      )}
      <p className="muted small">Maße aus der LDraw-Geometrie der verbauten Teile. Preise und Kaufverfügbarkeit werden nicht angegeben.</p>
    </section>
  );
}
