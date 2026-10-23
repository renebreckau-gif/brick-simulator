// Variantenvergleich (Auftrag 05B.2): A, B und C bei gleicher Breite aus derselben Formvorgabe – Seitenansicht,
// Draufsicht und 3D-Ansicht der tatsächlichen Teilinstanzen neben dem Vorlagenausschnitt. Bugoberkante,
// Bugunterkante und Kanzel werden getrennt bewertet; die Umrissüberdeckung ist nur eine begrenzte Kennzahl.
import { useEffect, useMemo, useState } from 'react';
import type { Catalog } from '../../core/catalog/catalog';
import { scaleTarget } from '../../core/construct/bowTechnique';
import { edgeDeviation, ldrawScreenAxes, modelProfile, profileOverlap } from '../../core/construct/compare';
import type { BowTarget } from '../../core/construct/shapeTarget';
import type { MeasuredView } from '../../core/construct/templateTarget';
import { buildVariant, VARIANT_LABEL, VARIANT_SHORT, type ConstructVariant } from '../../core/construct/variants';
import type { PartLibrary } from '../../core/ldraw/library';
import type { Vec3 } from '../../core/math';
import { coverageFor, massEstimate, type EvidenceFile } from '../../core/procurement/evidence';
import { validate } from '../../core/validation/validate';
import { InstructionRenderer } from '../instructions/render';
import { useCrops } from './SixViews';

const VARIANTS: ConstructVariant[] = ['keilplatten', 'schraegsteine', 'cockpit'];

/** Schrägansicht von vorn links oben (LDraw: vorn = −z, links = +x, oben = −y). */
function isoAxes(): { right: Vec3; down: Vec3; toCamera: Vec3 } {
  const n = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
  const tc = n([1, -0.9, -1.2]);
  const upRaw: Vec3 = [0, -1, 0];
  const k = upRaw[0] * tc[0] + upRaw[1] * tc[1] + upRaw[2] * tc[2];
  const up = n([upRaw[0] - k * tc[0], upRaw[1] - k * tc[1], upRaw[2] - k * tc[2]]);
  const right: Vec3 = [up[1] * tc[2] - up[2] * tc[1], up[2] * tc[0] - up[0] * tc[2], up[0] * tc[1] - up[1] * tc[0]];
  return { right, down: [-up[0], -up[1], -up[2]], toCamera: tc };
}

interface Props { target: BowTarget; width: number; library: PartLibrary; catalog: Catalog; views: MeasuredView[] | null; imageUrls: string[]; evidence: EvidenceFile | null }

export function VariantCompare({ target, width, library, catalog, views, imageUrls, evidence }: Props) {
  const crops = useCrops(views, imageUrls);
  const side = views?.find((v) => v.direction === 'links' && v.profile) ?? null;
  const top = views?.find((v) => v.direction === 'oben' && v.profile) ?? null;
  const built = useMemo(() => VARIANTS.map((variant) => {
    try {
      const r = buildVariant(target, { variant, widthStuds: width });
      const v = validate(r.model, catalog);
      return { variant, ...r, blockers: v.report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed').length, warnings: v.report.findings.filter((f) => f.severity === 'warning' && f.status === 'failed').length, error: null as string | null };
    } catch (e) {
      return { variant, model: null, plan: null, blockers: 0, warnings: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }), [target, width, catalog]);
  const [shots, setShots] = useState<Record<string, { side: string; top: string; iso: string }>>({});
  useEffect(() => {
    const out: Record<string, { side: string; top: string; iso: string }> = {};
    for (const b of built) {
      if (!b.model) continue;
      const r = new InstructionRenderer(b.model, library, catalog);
      out[b.variant] = {
        side: r.axisShot(ldrawScreenAxes('links', side?.frontInImage ?? 'links'), 420, 190),
        top: r.axisShot(ldrawScreenAxes('oben', top?.frontInImage ?? 'oben'), 200, 300),
        iso: r.axisShot(isoAxes(), 420, 300),
      };
      r.dispose();
    }
    setShots(out);
  }, [built, library, catalog, side, top]);

  const scaled = useMemo(() => scaleTarget(target, width).target, [target, width]);
  const N = scaled.rows;
  const c = scaled.canopy;
  const dOf = (row: number) => (N - row - 0.5) / N; // Abstand der Reihenmitte von der Spitze (normiert)
  const canopyRange: [number, number] | null = c ? [dOf(c.toRow) - 0.5 / N, dOf(c.fromRow) + 0.5 / N] : null;
  const toPlates = (x: number) => x * N * 2.5;

  return (
    <div className="sixviews">
      <p className="small muted">
        Alle Varianten aus derselben Formvorgabe „{target.label}“ bei {width} Noppen Breite; Bilder aus den tatsächlichen Teilinstanzen (LDraw-Geometrie). Kennzahlen: mittlere (größte) Abweichung der Kante in Plattenhöhen gegenüber dem gemessenen Vorlagenprofil; Überdeckung nur als grober Hinweis.
      </p>
      <div className="cmpgrid">
        <figure className="sixcell">
          <figcaption><strong>Vorlage</strong> (lokal, nicht veröffentlicht)</figcaption>
          {side && crops.get(side.viewId) ? <img src={crops.get(side.viewId)} alt="Vorlage Seitenansicht" /> : <p className="small muted">Keine Vorlage (synthetische Testform)</p>}
          {top && crops.get(top.viewId) && <img src={crops.get(top.viewId)} alt="Vorlage Draufsicht" className="cmptop" />}
        </figure>
        {built.map((b) => {
          const s = shots[b.variant];
          const mp = b.model && side ? modelProfile(b.model, library, 'seite', b.plan!.rows) : null;
          const mt = b.model && top ? modelProfile(b.model, library, 'oben', b.plan!.rows) : null;
          const upper = mp && side?.profile ? edgeDeviation(mp, side.profile, 'hi', 0, canopyRange ? canopyRange[0] : 1) : null;
          const lower = mp && side?.profile ? edgeDeviation(mp, side.profile, 'lo', 0, 1) : null;
          const canopy = mp && side?.profile && canopyRange ? edgeDeviation(mp, side.profile, 'hi', canopyRange[0], canopyRange[1]) : null;
          const cov = b.model ? coverageFor(b.model, evidence) : null;
          const mass = b.model ? massEstimate(b.model, evidence) : null;
          const fmt = (x: { mean: number; max: number } | null) => (x ? `${toPlates(x.mean).toFixed(1)} (${toPlates(x.max).toFixed(1)})` : '–');
          return (
            <figure key={b.variant} className="sixcell">
              <figcaption><strong>{VARIANT_SHORT[b.variant]}</strong> · {VARIANT_LABEL[b.variant]}</figcaption>
              {b.error ? <p className="shiperror">{b.error}</p> : (
                <>
                  {s ? <><img src={s.side} alt={`${VARIANT_SHORT[b.variant]} Seitenansicht`} /><div className="cmprow"><img src={s.top} alt={`${VARIANT_SHORT[b.variant]} Draufsicht`} className="cmptop" /><img src={s.iso} alt={`${VARIANT_SHORT[b.variant]} 3D-Ansicht`} /></div></> : <p className="small muted">Rendere …</p>}
                  <dl className="shipfacts small">
                    <dt>Teile / Prüfung</dt><dd>{b.model!.instances.length} Teile · {b.blockers} Blocker · {b.warnings} Warnungen</dd>
                    <dt>Bugoberkante</dt><dd>{fmt(upper)} Platten</dd>
                    <dt>Bugunterkante</dt><dd>{fmt(lower)} Platten</dd>
                    <dt>Kanzel</dt><dd>{fmt(canopy)} Platten</dd>
                    <dt>Überdeckung</dt><dd>{mt && top?.profile ? `Draufsicht ${(profileOverlap(mt, top.profile) * 100).toFixed(0)} %` : '–'}{mp && side?.profile ? ` · Seite ${(profileOverlap(mp, side.profile) * 100).toFixed(0)} %` : ''}</dd>
                    <dt>Innenraum</dt><dd>{b.variant === 'cockpit' ? 'Cockpit mit abnehmbarer Kanzel (Funktionsprüfung im Bericht)' : 'keiner (massiv)'}</dd>
                    <dt>Masse</dt><dd>{mass && !mass.missing.length ? `≈ ${mass.grams.toFixed(0)} g` : `nicht schätzbar (keine Katalogmasse für ${mass?.missing.join(', ')})`}</dd>
                    <dt>Beschaffung</dt><dd className={cov?.complete ? '' : 'open'}>{!evidence ? 'nicht geprüft' : cov?.complete ? 'alle Positionen belegt und gedeckt' : `${cov?.lines.filter((l) => l.status !== 'gedeckt').length} Position(en) nicht belegt/gedeckt`}</dd>
                  </dl>
                </>
              )}
            </figure>
          );
        })}
      </div>
    </div>
  );
}
