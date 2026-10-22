// Sechs Ansichten derselben Teilinstanzen (orthografisch, LDraw-Geometrie), je neben dem passenden
// Ausschnitt der Vorlage in deren Ausrichtung, dazu der Umrissvergleich der gemessenen Ansichten.
import { useEffect, useMemo, useState } from 'react';
import type { Catalog } from '../../core/catalog/catalog';
import { largestDeviation, ldrawScreenAxes, modelProfile, profileOverlap, type Profile } from '../../core/construct/compare';
import type { PixelRect } from '../../core/construct/silhouette';
import type { MeasuredView } from '../../core/construct/templateTarget';
import type { ViewId } from '../../core/design/projection';
import type { PartLibrary } from '../../core/ldraw/library';
import type { CanonicalModel } from '../../core/model/types';
import { InstructionRenderer } from '../instructions/render';

const ORDER: { id: ViewId; label: string; front: 'links' | 'rechts' | 'oben' | 'unten' | null }[] = [
  { id: 'oben', label: 'Oben', front: 'oben' },
  { id: 'unten', label: 'Unten', front: 'oben' },
  { id: 'links', label: 'Linke Seite', front: 'links' },
  { id: 'rechts', label: 'Rechte Seite', front: 'rechts' },
  { id: 'vorne', label: 'Vorne', front: null },
  { id: 'hinten', label: 'Hinten', front: null },
];

const USE_LABEL: Record<MeasuredView['use'], string> = {
  quelle: 'Quelle der Formvorgabe',
  vergleich: 'gemessen, nur Vergleich',
  'nur-ansicht': 'nur Ansicht, nicht gemessen',
  'keine-quelle': 'entworfene Ansicht – keine Quelle',
};

interface Props {
  model: CanonicalModel;
  library: PartLibrary;
  catalog: Catalog;
  rows: number;
  views: MeasuredView[] | null;
  imageUrls: string[];
}

function useCrops(views: MeasuredView[] | null, urls: string[]): Map<string, string> {
  const [crops, setCrops] = useState(new Map<string, string>());
  useEffect(() => {
    if (!views?.length || !urls.length) { setCrops(new Map()); return; }
    let cancelled = false;
    const imgs = urls.map((u) => { const i = new Image(); i.src = u; return i; });
    Promise.all(imgs.map((i) => i.decode())).then(() => {
      if (cancelled) return;
      const out = new Map<string, string>();
      for (const v of views) {
        const r: PixelRect = v.rect;
        const c = document.createElement('canvas');
        const s = Math.min(1, 520 / Math.max(1, r.x1 - r.x0));
        c.width = Math.max(1, Math.round((r.x1 - r.x0) * s));
        c.height = Math.max(1, Math.round((r.y1 - r.y0) * s));
        c.getContext('2d')!.drawImage(imgs[v.imageIndex], r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 0, 0, c.width, c.height);
        out.set(v.viewId, c.toDataURL('image/jpeg', 0.9));
      }
      setCrops(out);
    }).catch(() => setCrops(new Map()));
    return () => { cancelled = true; };
  }, [views, urls]);
  return crops;
}

/** Normiertes Profil als Fläche (Modell) bzw. Linie (Vorlage); Spitze links, hinteres Ende rechts. */
function ProfilePlot({ model, template }: { model: Profile; template: Profile }) {
  const W = 300;
  const H = 120;
  const n = model.samples.length;
  const all = [...model.samples, ...template.samples].filter((s): s is { lo: number; hi: number } => !!s);
  const centered = model.kind === 'breite';
  const norm = (s: { lo: number; hi: number }) => (centered ? { lo: -(s.hi - s.lo) / 2, hi: (s.hi - s.lo) / 2 } : s);
  const vMax = Math.max(...all.map((s) => norm(s).hi), 0.01);
  const vMin = Math.min(...all.map((s) => norm(s).lo), 0);
  const x = (k: number) => ((k + 0.5) / n) * W;
  const y = (v: number) => H - 6 - ((v - vMin) / (vMax - vMin)) * (H - 12);
  const band = (p: Profile) => {
    const pts = p.samples.map((s, k) => (s ? { k, ...norm(s) } : null)).filter((q): q is { k: number; lo: number; hi: number } => !!q);
    return [...pts.map((q) => `${x(q.k)},${y(q.hi)}`), ...pts.reverse().map((q) => `${x(q.k)},${y(q.lo)}`)].join(' ');
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="profileplot" role="img" aria-label="Umrissvergleich: Fläche = Teilemodell, Linie = Vorlage">
      <polygon points={band(model)} className="pm" />
      <polygon points={band(template)} className="pt" />
      <text x={4} y={12} className="pl">Spitze</text>
      <text x={W - 4} y={12} className="pl" textAnchor="end">hinten</text>
    </svg>
  );
}

export function SixViews({ model, library, catalog, rows, views, imageUrls }: Props) {
  const crops = useCrops(views, imageUrls);
  const [shots, setShots] = useState<Map<ViewId, string>>(new Map());
  const orient = useMemo(() => ORDER.map((o) => {
    const tv = views?.find((v) => v.direction === o.id) ?? null;
    return { ...o, tv, front: tv ? tv.frontInImage : o.front };
  }), [views]);
  useEffect(() => {
    const r = new InstructionRenderer(model, library, catalog);
    const out = new Map<ViewId, string>();
    for (const o of orient) {
      const crop = o.tv ? o.tv.rect : null;
      const aspect = crop ? (crop.x1 - crop.x0) / Math.max(1, crop.y1 - crop.y0) : o.id === 'links' || o.id === 'rechts' ? 2.2 : 1;
      const w = 520;
      out.set(o.id, r.axisShot(ldrawScreenAxes(o.id, o.front), w, Math.max(80, Math.round(w / Math.min(4, Math.max(0.4, aspect))))));
    }
    r.dispose();
    setShots(out);
  }, [model, library, catalog, orient]);
  const profiles = useMemo(() => ({ oben: modelProfile(model, library, 'oben', rows), seite: modelProfile(model, library, 'seite', rows) }), [model, library, rows]);

  return (
    <div className="sixviews">
      <p className="small muted">
        Alle sechs Bilder zeigen dieselben {model.instances.length} Teilinstanzen von Modell <span className="code">{model.modelId}</span> (orthografisch, ausgerichtet wie die jeweilige Ansicht der Vorlage).
        {views ? ' Daneben der Ausschnitt der Vorlage; bei gemessenen Ansichten der Abschnitt von der Spitze bis hinter die Kanzel.' : ' Keine Vorlage: Formvorgabe ist eine synthetische Testform.'}
      </p>
      <div className="sixgrid">
        {orient.map((o) => {
          const tv = o.tv;
          const mp = tv?.profile ? (tv.direction === 'oben' ? profiles.oben : profiles.seite) : null;
          const dev = mp && tv?.profile ? largestDeviation(mp, tv.profile) : null;
          const unit = tv?.direction === 'oben' ? { f: rows, u: 'Noppen' } : { f: rows * 2.5, u: 'Plattenhöhen' };
          return (
            <figure key={o.id} className="sixcell">
              <figcaption><strong>{o.label}</strong>{tv && <> · Vorlage „{tv.label}“ – {USE_LABEL[tv.use]}</>}</figcaption>
              <div className="sixpair">
                <div>
                  <div className="sixtag">Teilemodell</div>
                  {shots.get(o.id) ? <img src={shots.get(o.id)} alt={`Teilemodell ${o.label}`} /> : <div className="muted small">Rendere …</div>}
                </div>
                <div>
                  <div className="sixtag">Vorlage</div>
                  {tv && crops.get(tv.viewId) ? <img src={crops.get(tv.viewId)} alt={`Vorlage ${tv.label}`} className={tv.use === 'keine-quelle' ? 'dim' : ''} /> : <div className="muted small">{views ? 'keine passende Ansicht in der Vorlage' : '–'}</div>}
                </div>
              </div>
              {tv && <p className="small muted">{tv.note}</p>}
              {mp && tv?.profile && (
                <div className="sixcmp">
                  <ProfilePlot model={mp} template={tv.profile} />
                  <p className="small">
                    Fläche: Teilemodell · gestrichelt: Vorlage. Umrissüberdeckung {(profileOverlap(mp, tv.profile) * 100).toFixed(0)} % (grob, auf die Abschnittslänge normiert).
                    {dev && <> Größte Abweichung bei {(dev.d * 100).toFixed(0)} % der Länge ab Spitze: Modell {(dev.model * unit.f).toFixed(1)}, Vorlage {(dev.template * unit.f).toFixed(1)} {unit.u}.</>}
                  </p>
                </div>
              )}
            </figure>
          );
        })}
      </div>
    </div>
  );
}
