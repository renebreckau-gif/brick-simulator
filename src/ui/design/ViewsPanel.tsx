// Ansichten innerhalb der Bilder prüfen und korrigieren (Auftrag 05A.5): beschriftete Ausschnittsvorschauen,
// Richtung, Orientierung, Art, Beschriftung und Ausschnitt bearbeiten, Ansichten ergänzen oder entfernen.
// Jede Änderung ist eine protokollierte Korrektur (brief.ts) und macht Bestätigungen nachvollziehbar veraltet.
import { useEffect, useState } from 'react';
import { addView, removeView, updateView, type DesignBrief } from '../../core/design/brief';
import { checkViews, NATURE_LABEL, VIEW_DIRECTION_LABEL, VIEW_DIRECTIONS, viewContradictions, viewOfBox, type ImageView } from '../../core/design/views';

interface Props {
  brief: DesignBrief;
  urls: Record<string, string>;
  update: (fn: (b: DesignBrief) => DesignBrief) => void;
  onError: (text: string) => void;
}

const BASIS_TEXT = { observed: '◉ aus Bild/Beschriftung erkannt', assumed: '◌ vermutet', user: '✎ vom Nutzer' } as const;

function Txt({ id, label, value, onCommit, multiline }: { id: string; label: string; value: string; onCommit: (v: string) => void; multiline?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  return (
    <label className="dfield" htmlFor={id}>
      <span>{label}</span>
      {multiline ? <textarea id={id} rows={2} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} /> : <input id={id} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />}
    </label>
  );
}

function Frac({ id, label, value, onCommit }: { id: string; label: string; value: number; onCommit: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setV(String(value)); setBad(false); }, [value]);
  const commit = () => {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 1) { setBad(true); return; }
    setBad(false);
    if (n !== value) onCommit(n);
  };
  return (
    <label className="dfield" htmlFor={id}>
      <span>{label}</span>
      <input id={id} inputMode="decimal" value={v} aria-invalid={bad} aria-describedby={bad ? `${id}-err` : undefined} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      {bad && <small id={`${id}-err`} className="ferr">Wert zwischen 0 und 1</small>}
    </label>
  );
}

/** Ausschnitt eines Bildes als Vorschau (CSS-Hintergrund; das Bild bleibt lokal). */
function Crop({ url, v, img }: { url: string | undefined; v: ImageView; img: { width: number; height: number } | undefined }) {
  const b = v.box;
  if (!url || !img || !(b.w > 0 && b.h > 0)) return <div className="vcrop empty">kein Bild</div>;
  const pos = (o: number, s: number) => (s >= 1 ? 0 : (o / (1 - s)) * 100);
  return <div className="vcrop" role="img" aria-label={`Ausschnitt ${v.label}`} style={{ aspectRatio: `${b.w * img.width} / ${b.h * img.height}`, backgroundImage: `url(${url})`, backgroundSize: `${100 / b.w}% ${100 / b.h}%`, backgroundPosition: `${pos(b.x, b.w)}% ${pos(b.y, b.h)}%` }} />;
}

export function ViewsPanel({ brief, urls, update, onError }: Props) {
  const interp = brief.interpretation;
  if (!interp) return null;
  const views = interp.imageViews?.views ?? [];
  // Änderung zuerst berechnen (Fehler sichtbar melden), dann übernehmen
  const run = (fn: (b: DesignBrief) => DesignBrief) => { try { const n = fn(brief); update(() => n); } catch (e) { onError((e as Error).message); } };
  const check = checkViews(interp, brief.images.length, brief.images.map((i) => i.sha256));
  const contra = viewContradictions(interp, brief.images);
  const newId = () => `v-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  return (
    <fieldset className="dviews" id="d-views">
      <legend>Ansichten in den Bildern <span className="small muted">(baustein-sim/image-views@1)</span></legend>
      {views.length === 0 ? (
        <p className="small">Keine Ansichten erfasst – nichts über Blickrichtungen ist belegt. Zeigt ein Bild mehrere Ansichten (z. B. eine Tafel mit Oben, Seiten, Vorne), bitte je Ansicht einen Ausschnitt ergänzen.</p>
      ) : (
        <p className="small">{views.length} Ansicht(en) in {new Set(views.map((v) => v.imageIndex)).size} Bild(ern). Baugruppen gehören zum EINEN Objekt; jede Baugruppe hat je Ansicht höchstens einen Bildbereich.</p>
      )}
      <ul className="vlist">
        {views.map((v, k) => {
          const img = brief.images[v.imageIndex];
          const visible = interp.groups.filter((g) => g.boxes.some((bx) => viewOfBox(bx, views)?.viewId === v.viewId)).map((g) => g.name);
          const set = (patch: Partial<ImageView>) => run((b) => updateView(b, v.viewId, patch));
          return (
            <li key={v.viewId} className={`vitem${v.nature === 'entwurf' ? ' entwurf' : ''}`}>
              <figure>
                <Crop url={img ? urls[img.sha256] : undefined} v={v} img={img} />
                <figcaption>
                  <strong>{v.label || v.viewId}</strong> · {VIEW_DIRECTION_LABEL[v.direction]}{v.frontInImage ? ` · Vorderseite ${v.frontInImage}` : ''} · Bild {v.imageIndex + 1}
                  <br />
                  {v.nature === 'entwurf' ? <span className="vtag entwurf">Entworfene Ansicht – kein Beleg, nicht als Messgrundlage</span> : <span className="vtag">{NATURE_LABEL[v.nature]}</span>}{' '}
                  <span className="small muted">{BASIS_TEXT[v.basis]} · Unsicherheit {v.uncertainty}</span>
                </figcaption>
              </figure>
              {v.annotations.length > 0 && <p className="small">Angaben der Vorlage (nicht geprüft): {v.annotations.map((a) => `„${a.text}“`).join(', ')}</p>}
              <p className="small">Sichtbare Baugruppen: {visible.length ? visible.join(', ') : 'keine zugeordnet'}</p>
              <details>
                <summary className="small">Ansicht bearbeiten</summary>
                <div className="dgrid">
                  <Txt id={`vw-${k}-label`} label="Beschriftung" value={v.label} onCommit={(t) => set({ label: t })} />
                  <label className="dfield"><span>Blickrichtung</span><select value={v.direction} onChange={(e) => set({ direction: e.target.value as ImageView['direction'] })}>{VIEW_DIRECTIONS.map((d) => <option key={d} value={d}>{VIEW_DIRECTION_LABEL[d]}</option>)}</select></label>
                  <label className="dfield"><span>Vorderseite im Ausschnitt</span><select value={v.frontInImage ?? ''} onChange={(e) => set({ frontInImage: (e.target.value || null) as ImageView['frontInImage'] })}><option value="">nicht erkennbar</option><option value="links">links</option><option value="rechts">rechts</option><option value="oben">oben</option><option value="unten">unten</option></select></label>
                  <label className="dfield"><span>Art</span><select value={v.nature} onChange={(e) => set({ nature: e.target.value as ImageView['nature'] })}><option value="darstellung">Darstellung</option><option value="entwurf">entworfen (kein Beleg)</option><option value="unbekannt">unbekannt</option></select></label>
                  <label className="dfield"><span>Bild</span><select value={v.imageIndex} onChange={(e) => set({ imageIndex: Number(e.target.value) })}>{brief.images.map((_, i) => <option key={i} value={i}>Bild {i + 1}</option>)}</select></label>
                  {(['x', 'y', 'w', 'h'] as const).map((key) => <Frac key={key} id={`vw-${k}-${key}`} label={{ x: 'Ausschnitt x', y: 'Ausschnitt y', w: 'Breite', h: 'Höhe' }[key]} value={v.box[key]} onCommit={(n) => set({ box: { ...v.box, [key]: n } })} />)}
                </div>
                <Txt id={`vw-${k}-ann`} label="Angaben der Vorlage (eine je Zeile, wörtlich)" multiline value={v.annotations.map((a) => a.text).join('\n')} onCommit={(t) => set({ annotations: t.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => ({ text: x, kind: /\b[LBH]\s*(≈|=|~)/.test(x) ? 'mass' as const : 'beschriftung' as const })) })} />
                <div className="dactions"><button className="danger" onClick={() => run((b) => removeView(b, v.viewId))}>Ansicht entfernen</button></div>
              </details>
            </li>
          );
        })}
      </ul>
      <div className="dactions">
        {brief.images.map((img, i) => <button key={img.sha256} onClick={() => run((b) => addView(b, { viewId: newId(), imageIndex: i, box: { x: 0, y: 0, w: 1, h: 1 }, label: `Bild ${i + 1}`, direction: 'unbekannt', frontInImage: null, nature: 'unbekannt', annotations: [], uncertainty: 'hoch', note: 'vom Nutzer ergänzt' }))}>+ Ansicht in Bild {i + 1}</button>)}
      </div>
      {(check.errors.length > 0 || check.warnings.length > 0 || contra.length > 0) && (
        <div className="vcontra">
          <p className="small"><strong>Widersprüche und Hinweise zu den Ansichten</strong> (Vorlagen sind keine Messbelege):</p>
          <ul className="small">
            {check.errors.map((e) => <li key={e} className="err">✗ {e}</li>)}
            {[...check.warnings, ...contra].map((w) => <li key={w}>! {w}</li>)}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
