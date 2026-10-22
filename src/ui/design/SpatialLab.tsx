// Abschnitt 5 „Räumlicher Entwurf“ (Auftrag 05B.0): Volumenmodell aus einfachen Körpern, frei drehbare
// 3D-Ansicht und sechs orthografische Ansichten – alle aus derselben Geometrie und mit gemeinsamem Maßstab.
// Verdeckung in den orthografischen Ansichten per Tiefenpuffer (05B.0.1).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesignBrief } from '../../core/design/brief';
import { modelBounds, sharedFrames, type ViewFrame, type ViewId } from '../../core/design/projection';
import { bodyAt, rasterize, shadeRaster, visiblePixels } from '../../core/design/raster';
import {
  addBody, addMirror, applySpatialResult, AXIS_TEXT, BRICK_HEIGHT_IN_STUDS, checkSpatial, compareWithReferences, confirmSpatial, createSpatialTicket, decouple, defaultReferenceViews, deriveSpatialProposal, isSpatialConfirmedCurrent,
  parseSpatial, rebaseSpatial, REF_DIRECTION_LABEL, REF_DIRECTIONS, removeBody, restoreContent, setReferenceViews, setScale, setSymmetry, SHAPE_LABEL, SHAPES, SPATIAL_BASIS_LABEL, SPATIAL_LABEL, spatialBlockers,
  spatialPrerequisite, SpatialError, syncWithBrief, toSpatialLink, unmodelledGroups, updateBody, type BodyPatch, type ReferenceView, type SpatialBasis, type SpatialBody, type SpatialDesign,
} from '../../core/design/spatial';
import { describeFailure, postOnce } from './serverRequest';
import { loadImage, loadSpatial, saveSpatial } from './store';
import { SpatialViewer } from './SpatialViewer';

export interface SpatialService {
  ready: boolean;
  spatial: boolean;
  provider: string;
  model: string;
  promptVersion: string | null;
}

interface Props {
  brief: DesignBrief;
  urls: Record<string, string>;
  service: SpatialService | null;
  onLiveCheck?: (live: unknown) => void;
}

const fmt = (n: number, d = 2) => n.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const newDesignId = () => `raum-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const BasisMark = ({ b }: { b: SpatialBasis }) => <span className={`btag sbasis-${b}`}>{{ 'image-derived': '◔ aus Bild geschätzt', assumed: '◌ angenommen', user: '✎ vom Nutzer' }[b]}</span>;

/** Zahleneingabe: übernimmt nur endliche Zahlen (bei Enter oder Verlassen); sonst Hinweis am Feld. */
function Num({ id, label, value, onCommit, step = 0.01, disabled, min }: { id: string; label: string; value: number; onCommit: (n: number) => void; step?: number; disabled?: boolean; min?: number }) {
  const [v, setV] = useState(String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setV(String(value)); setBad(false); }, [value]);
  const commit = () => {
    const n = Number(v.replace(',', '.'));
    if (v.trim() === '' || !Number.isFinite(n) || (min !== undefined && n < min)) { setBad(true); return; }
    setBad(false);
    if (n !== value) onCommit(n);
  };
  return (
    <label className="dfield" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="text" inputMode="decimal" value={v} disabled={disabled} aria-invalid={bad} aria-describedby={bad ? `${id}-err` : undefined} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} data-step={step} />
      {bad && <small id={`${id}-err`} className="ferr">Bitte eine endliche Zahl{min !== undefined ? ` ≥ ${min}` : ''} eingeben.</small>}
    </label>
  );
}

const VW = 240;
const VH = 170;
const MARGIN = 14;

/** Auflösungsfaktor der Ansichtsbilder (Bildpunkte je CSS-Pixel); der Maßstab wird mitskaliert. */
const RES = 2;

/**
 * Eine orthografische Ansicht. Maßstab und Mittelpunkt kommen von außen (für alle Ansichten gleich).
 * Verdeckung per Tiefenpuffer je Bildpunkt (raster.ts); die Auswahl per Klick liest denselben Puffer.
 */
function OrthoView({ frame, scale, design, selected, onSelect }: { frame: ViewFrame; scale: number; design: SpatialDesign; selected: string | null; onSelect: (id: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const raster = useMemo(() => rasterize(design, { view: frame.view, scale: scale * RES, center: frame.center, width: VW * RES, height: VH * RES }), [design, frame.view, frame.center, scale]);
  const visible = useMemo(() => [...visiblePixels(raster)].map(([id, n]) => ({ id, n, name: design.bodies.find((b) => b.id === id)?.name ?? id })), [raster, design]);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const img = ctx.createImageData(raster.width, raster.height);
    img.data.set(shadeRaster(raster, design.bodies.map((b) => b.color), design.bodies.findIndex((b) => b.id === selected)));
    ctx.putImageData(img, 0, 0);
    // Maßstabsbalken 0,25 Hauptkörperlängen (gleicher Maßstab in allen Ansichten)
    const bar = 0.25 * scale * RES;
    ctx.fillStyle = '#18212c';
    ctx.fillRect(8 * RES, (VH - 9) * RES, bar, 2 * RES);
    ctx.font = `${10 * RES}px sans-serif`;
    ctx.fillText('0,25', 8 * RES + bar + 3 * RES, (VH - 5) * RES);
  }, [raster, design, selected, scale]);
  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = bodyAt(raster, ((e.clientX - r.left) / r.width) * raster.width, ((e.clientY - r.top) / r.height) * raster.height);
    if (id) onSelect(id);
  };
  return (
    <figure className="spview" data-view={frame.view.id} data-visible={visible.map((v) => `${v.id}:${v.n}`).join(',')}>
      <figcaption><strong>{frame.view.label}</strong> <span className="small muted">→ {frame.view.axisRight} · ↑ {frame.view.axisUp}</span></figcaption>
      <canvas ref={canvas} width={VW * RES} height={VH * RES} onClick={pick} role="img" aria-label={`Orthografische Ansicht ${frame.view.label}: rechts ${frame.view.axisRight}, oben ${frame.view.axisUp}. Sichtbar: ${visible.map((v) => v.name).join(', ') || 'nichts'}`} />
    </figure>
  );
}

export function SpatialLab({ brief, urls, service, onLiveCheck }: Props) {
  const [design, setDesign] = useState<SpatialDesign | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [past, setPast] = useState<SpatialDesign[]>([]);
  const [future, setFuture] = useState<SpatialDesign[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string; errors?: string[] } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<'derive' | 'service' | null>(null);
  const [consent, setConsent] = useState<{ open: boolean; agreed: boolean; notes: string }>({ open: false, agreed: false, notes: '' });
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<{ candidate: SpatialDesign; reasons: string[] } | null>(null);
  const [attempt, setAttempt] = useState<'blocked' | 'confirmed' | null>(null);
  const [refView, setRefView] = useState<string | null>(null);
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const designRef = useRef(design);
  designRef.current = design;

  // Wiederherstellen (vollständig geprüft); veraltete Grundlage wird sichtbar markiert, nichts überschrieben
  useEffect(() => {
    (async () => {
      try {
        const t = await loadSpatial();
        if (t) {
          const l = parseSpatial(t, briefRef.current);
          setDesign(l.design);
          if (l.issues.length) setMessage({ kind: 'error', text: `Gespeicherter räumlicher Entwurf ist nicht stimmig und wurde nur zur Korrektur geladen${l.downgraded ? ' (Bestätigung aufgehoben)' : ''}.`, errors: l.issues });
        }
      } catch (e) {
        setMessage({ kind: 'error', text: `Gespeicherter räumlicher Entwurf nicht lesbar: ${(e as Error).message}` });
      }
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (loaded && design) saveSpatial(JSON.stringify(design)).catch(() => setMessage({ kind: 'error', text: 'Räumlichen Entwurf lokal zu speichern ist fehlgeschlagen.' }));
  }, [design, loaded]);
  // Grundlage geändert (Bilder, Interpretation, Höchstmaße) → sichtbar veraltet
  useEffect(() => {
    setDesign((d) => (d ? syncWithBrief(d, brief) : d));
  }, [brief]);

  const pre = spatialPrerequisite(brief);
  const findings = useMemo(() => (design ? checkSpatial(design, brief) : []), [design, brief]);
  const deviations = useMemo(() => (design ? compareWithReferences(design, brief) : []), [design, brief]);
  const frames = useMemo(() => (design ? sharedFrames(design, { width: VW, height: VH, margin: MARGIN }) : null), [design]);
  const bounds = design ? modelBounds(design) : null;
  const confirmedCurrent = design ? isSpatialConfirmedCurrent(design, brief) : false;
  const blockers = design ? spatialBlockers(design, brief) : [];
  const sel = design?.bodies.find((b) => b.id === selected) ?? null;

  const commit = (fn: (d: SpatialDesign) => SpatialDesign) => {
    if (!design) return;
    try {
      const n = fn(design);
      if (n === design) return;
      setPast((p) => [...p.slice(-49), design]);
      setFuture([]);
      setDesign(n);
      setMessage(null);
      setAttempt(null);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof SpatialError ? e.message : `Änderung nicht möglich: ${(e as Error).message}` });
    }
  };
  const undo = () => {
    if (!design || !past.length) return;
    const snap = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, design]);
    // Innerhalb eines Entwurfs als neue Version; über einen ersetzten Entwurf hinweg den früheren Entwurf selbst
    setDesign(snap.designId === design.designId ? restoreContent(design, snap, `Rückgängig (Inhalt von v${snap.version} wiederhergestellt)`) : snap);
  };
  const redo = () => {
    if (!design || !future.length) return;
    const snap = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, design]);
    setDesign(snap.designId === design.designId ? restoreContent(design, snap, `Wiederholen (Inhalt von v${snap.version} wiederhergestellt)`) : snap);
  };
  const replaceWith = (d: SpatialDesign, text: string) => {
    if (design) setPast((p) => [...p.slice(-49), design]);
    setFuture([]);
    setDesign(d);
    setSelected(null);
    setAttempt(null);
    setConfirmReplace(null);
    setMessage({ kind: 'info', text });
  };

  const hasCorrections = !!design && design.corrections.length > 0 && design.basedOn.briefId === brief.briefId;
  const derive = (force = false) => {
    if (hasCorrections && !force) return setConfirmReplace('derive');
    try {
      // vorhandene Referenzansichten (z. B. vom Nutzer ergänzte Einschübe) bleiben Grundlage der Neuableitung
      const refs = design && design.basedOn.briefId === brief.briefId ? design.referenceViews : undefined;
      const d = deriveSpatialProposal(brief, { designId: newDesignId(), referenceViews: refs });
      replaceWith(d, 'Räumlicher Entwurf lokal aus der Interpretation abgeleitet – ohne Datenübertragung. Alle Lagen und Maße sind Schätzungen bzw. Annahmen; bitte prüfen und korrigieren.');
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const runService = async () => {
    setBusy(true);
    setMessage(null);
    setHeld(null);
    const ticket = createSpatialTicket(brief, design, crypto.randomUUID());
    try {
      const images = [];
      for (const img of brief.images) {
        const blob = await loadImage(img.sha256);
        if (!blob) throw new Error(`Bild ${img.fileName} fehlt lokal`);
        images.push({ sha256: img.sha256, mediaType: img.mediaType, view: img.view, data: toBase64(new Uint8Array(await blob.arrayBuffer())) });
      }
      const startedAt = new Date().toISOString();
      // Genau ein Versand; bei Verbindungsfehlern nur Nachfrage beim Server, keine Wiederholung
      const res = await postOnce('/api/design/spatial', { ticketId: ticket.ticketId, images, interpretation: brief.interpretation, notes: consent.notes }, ticket.ticketId);
      if (res.kind !== 'response') {
        const f = describeFailure(res, startedAt, 'Vorschlags');
        setMessage({ kind: 'error', text: `${f.text} Nächster Schritt: ${f.next}` });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = res.body as any;
      if (body?.liveCheck) onLiveCheck?.(body.liveCheck);
      if (body.ticketId !== ticket.ticketId) setMessage({ kind: 'error', text: 'Antwort gehört nicht zu dieser Anfrage (Anfragekennung abweichend) und wurde verworfen.' });
      else if (body.ok || body.code === 'contradictory_response') {
        const proposal = body.ok ? body.proposal : body.candidate;
        const meta = { provider: body.meta?.provider ?? service?.provider ?? 'Analysedienst', model: body.meta?.model ?? service?.model ?? null, promptVersion: body.meta?.promptVersion ?? service?.promptVersion ?? null, requestId: body.meta?.requestId ?? null, at: new Date().toISOString() };
        // Gegen den Stand beim Eintreffen prüfen, nicht gegen den beim Absenden
        const out = applySpatialResult(briefRef.current, designRef.current, ticket, proposal, meta, newDesignId());
        if (out.kind === 'applied') replaceWith(out.design, `Räumlicher Vorschlag von ${meta.provider}${meta.model ? ` (${meta.model})` : ''} übernommen. Eine KI-Schätzung ist kein Geometriebeleg – bitte prüfen und korrigieren.`);
        else if (out.kind === 'held') setHeld({ candidate: out.candidate, reasons: [...out.reasons, ...(body.ok ? [] : body.errors ?? [])] });
        else setMessage({ kind: 'error', text: out.reason });
      } else setMessage({ kind: 'error', text: `Der lokale Server meldet einen Fehler (HTTP ${res.status}): ${body.message ?? 'ohne Beschreibung'}`, errors: body.errors });
    } catch (e) {
      setMessage({ kind: 'error', text: `Räumlicher Vorschlag nicht gestartet: ${(e as Error).message}` });
    } finally {
      setBusy(false);
      setConsent((c) => ({ ...c, open: false, agreed: false }));
    }
  };

  const tryConfirm = () => {
    if (!design) return;
    if (blockers.length) {
      setAttempt('blocked');
      return;
    }
    commit((d) => confirmSpatial(d, brief));
    setAttempt('confirmed');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  };

  const patchSel = (p: BodyPatch) => sel && commit((d) => updateBody(d, sel.id, p));
  const refs = design?.referenceViews ?? [];
  const activeRef = refs.find((r) => r.id === refView) ?? refs.find((r) => r.primary) ?? null;
  const refImg = activeRef ? brief.images[activeRef.imageIndex] : null;
  const refFrame = activeRef && frames ? frames.frames.find((f) => f.view.id === (activeRef.direction as ViewId)) ?? null : null;
  const stale = design && design.status.state === 'stale';
  const counts = design ? design.bodies.reduce((a, b) => { for (const v of Object.values(b.basis)) a[v] = (a[v] ?? 0) + 1; return a; }, {} as Record<SpatialBasis, number>) : null;

  if (!loaded) return <section className="dsec"><h3>5. Räumlicher Entwurf</h3><p>Lade räumlichen Entwurf …</p></section>;

  return (
    <section className="dsec spatial" aria-label="Räumlicher Entwurf" id="d-spatial" tabIndex={-1} onKeyDown={onKey}>
      <h3>5. Räumlicher Entwurf</h3>
      <p className="splabel" role="note"><strong>{SPATIAL_LABEL}</strong></p>

      {pre ? (
        <div className="dnext"><p><strong>Noch nicht möglich.</strong> {pre}</p><p className="small">Der räumliche Entwurf beruht auf einer gültigen, an die aktuellen Bilder gebundenen Interpretation (Abschnitt 2).</p></div>
      ) : !design ? (
        <div className="dnext">
          <p><strong>Interpretation liegt vor. Als Nächstes: räumlichen Entwurf erstellen.</strong></p>
          <p className="small">Lokal, ohne Datenübertragung. Verfahren: Lage längs und in der Höhe aus den Bildbereichen der Hauptreferenz (relativ zum Hauptkörper), Größen aus den relativen Größen der Interpretation; Tiefe und Breite angenommen; jede Form zunächst als Quader. Keine 3D-Erkennung. Tiefe, verdeckte Formen und Innenkonstruktion sind aus einem Bild nicht eindeutig ableitbar und erscheinen als sichtbare Annahmen.</p>
          <div className="dactions"><button className="primary" onClick={() => derive()}>Räumlichen Entwurf erstellen</button>{service?.ready && service.spatial && <button onClick={() => setConsent((c) => ({ ...c, open: true }))}>Räumlichen Vorschlag vom Analysedienst anfordern …</button>}</div>
        </div>
      ) : null}

      {message && (
        <div className={message.kind === 'error' ? 'derrors' : 'dnext'} role={message.kind === 'error' ? 'alert' : 'status'}>
          <p>{message.text}</p>
          {message.errors && <ul>{message.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}

      {consent.open && service && (
        <div className="dconsent" role="dialog" aria-label="Vor dem räumlichen Vorschlag: Welche Daten gehen wohin?">
          <p><strong>Vor dem Senden: Welche Daten gehen wohin?</strong></p>
          <ul className="small">
            <li>Dienst: <strong>{service.provider}</strong>, Modell <span className="code">{service.model}</span>, über den lokalen Entwicklungsserver.</li>
            <li>Gesendet werden <strong>erneut</strong>: {brief.images.length} Bild(er) als Bilddaten ({brief.images.map((i) => `${i.sha256.slice(0, 8)}…`).join(', ')}) mit Ansichtsbezeichnung, die aktuelle Interpretation als Text und Ihre Hinweise. Dateinamen werden nicht gesendet.</li>
            <li>Genau ein Aufruf; keine automatische Wiederholung. Nichts wird bei Reglerbewegungen gesendet.</li>
            <li>Die Antwort ist eine Schätzung, kein Geometriebeleg. Ein bestehender, korrigierter Entwurf wird nicht automatisch überschrieben.</li>
          </ul>
          <label className="dfield"><span>Hinweise an den Dienst (als Vorgaben behandelt)</span><textarea rows={2} value={consent.notes} onChange={(e) => setConsent((c) => ({ ...c, notes: e.target.value }))} /></label>
          <label className="dcheck"><input type="checkbox" checked={consent.agreed} onChange={(e) => setConsent((c) => ({ ...c, agreed: e.target.checked }))} /> Ich bin einverstanden und berechtigt, diese Bilder und die Interpretation an den genannten Dienst zu senden.</label>
          <div className="dactions"><button className="primary" disabled={!consent.agreed || busy} onClick={runService}>{busy ? 'Warte auf Antwort …' : 'Bilder und Interpretation senden'}</button><button onClick={() => setConsent((c) => ({ ...c, open: false, agreed: false }))}>Abbrechen</button></div>
        </div>
      )}

      {held && (
        <div className="dfeedback" role="alert">
          <p><strong>Räumlicher Vorschlag zurückgehalten.</strong> Er wurde nicht automatisch übernommen:</p>
          <ul>{held.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <div className="dactions"><button onClick={() => { replaceWith(syncWithBrief(held.candidate, brief), 'Zurückgehaltener Vorschlag ausdrücklich übernommen.'); setHeld(null); }}>Vorschlag trotzdem übernehmen (ersetzt den aktuellen Entwurf)</button><button onClick={() => setHeld(null)}>Verwerfen</button></div>
        </div>
      )}

      {confirmReplace && (
        <div className="dfeedback" role="alert">
          <p><strong>Der aktuelle Entwurf enthält {design?.corrections.length} Korrektur(en).</strong> Ein neuer Vorschlag ersetzt sie (Rückgängig bleibt möglich).</p>
          <div className="dactions"><button className="danger" onClick={() => (confirmReplace === 'derive' ? derive(true) : (setConfirmReplace(null), setConsent((c) => ({ ...c, open: true }))))}>Trotzdem neu {confirmReplace === 'derive' ? 'ableiten' : 'anfordern'}</button><button onClick={() => setConfirmReplace(null)}>Abbrechen</button></div>
        </div>
      )}

      {design && (
        <>
          {stale && (
            <div className="dfeedback" role="alert">
              <p><strong>Räumlicher Entwurf veraltet:</strong> {design.status.reason}. Inhalt und Korrekturen bleiben erhalten; nichts wurde überschrieben.</p>
              <div className="dactions">
                {design.basedOn.briefId === brief.briefId && !pre && <button onClick={() => commit((d) => rebaseSpatial(d, brief))}>Für den aktuellen Entwurfsauftrag neu bewerten</button>}
                {!pre && <button onClick={() => derive()}>Neu ableiten</button>}
              </div>
            </div>
          )}

          <div className="dsplit spsplit">
            <div className="spref">
              <h4>Referenz</h4>
              {refImg && urls[refImg.sha256] ? (
                <figure className="spimg">
                  <div className="dimgwrap">
                    <img src={urls[refImg.sha256]} alt={`Bildvorlage ${activeRef!.imageIndex + 1}`} />
                    <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                      {refs.filter((r) => r.imageIndex === activeRef!.imageIndex).map((r) => <rect key={r.id} x={r.box.x} y={r.box.y} width={r.box.w} height={r.box.h} className={r.id === activeRef!.id ? 'focus' : undefined} vectorEffect="non-scaling-stroke" />)}
                    </svg>
                  </div>
                  <figcaption className="small">Ausschnitt {activeRef!.id}: {REF_DIRECTION_LABEL[activeRef!.direction]}{activeRef!.primary ? ' · Hauptreferenz' : ''}. Perspektivische Bilder sind keine orthografische Messgrundlage.</figcaption>
                </figure>
              ) : <p className="small muted">Bild nicht lokal vorhanden.</p>}
              {refFrame && frames && (
                <div className="spcompare">
                  <p className="small"><strong>Vergleich:</strong> Modellprojektion „{refFrame.view.label}“ neben dem Ausschnitt (nebeneinander, keine Überlagerung – eine Überlagerung bräuchte eine ausdrücklich eingestellte Kamera).</p>
                  <OrthoView frame={refFrame} scale={frames.scale} design={design} selected={selected} onSelect={setSelected} />
                </div>
              )}
              <SpatialViewer design={design} selected={selected} onSelect={setSelected} />
              <p className="small muted">3D: rot = +x vorn · grün = +y links · blau = +z oben. Ziehen dreht, Klick wählt aus.</p>
            </div>

            <div className="speditor">
              <div className="dactions">
                <button onClick={undo} disabled={!past.length} aria-keyshortcuts="Control+Z">Rückgängig</button>
                <button onClick={redo} disabled={!future.length} aria-keyshortcuts="Control+Y">Wiederholen</button>
                <span className="small muted">Version {design.version} · {design.origin.provider}{design.origin.model ? ` (${design.origin.model})` : ''}</span>
              </div>
              <p className="small">{AXIS_TEXT.x} · {AXIS_TEXT.y} · {AXIS_TEXT.z}. {AXIS_TEXT.unit}.</p>
              {bounds && (
                <p className="small" id="sp-dims">
                  Gesamtausdehnung (dimensionslos): Länge {fmt(bounds.size[0])} · Breite {fmt(bounds.size[1])} · Höhe {fmt(bounds.size[2])}
                  {design.scale ? <> · als Zielvorgabe ≈ {fmt(bounds.size[0] * design.scale.mainLengthStuds, 1)} × {fmt(bounds.size[1] * design.scale.mainLengthStuds, 1)} Noppen, Höhe ≈ {fmt((bounds.size[2] * design.scale.mainLengthStuds) / BRICK_HEIGHT_IN_STUDS, 1)} Steine (kein Messwert)</> : ' · reale Größe unbekannt (kein Maßstab)'}
                </p>
              )}
              {counts && <p className="small">Grundlagen: {(['image-derived', 'assumed', 'user'] as SpatialBasis[]).map((k) => `${counts[k] ?? 0} × ${SPATIAL_BASIS_LABEL[k]}`).join(' · ')}</p>}

              <fieldset className="spbodies">
                <legend>Körper ({design.bodies.length})</legend>
                <ul>
                  {design.bodies.map((b) => (
                    <li key={b.id}>
                      <button className={b.id === selected ? 'spitem sel' : 'spitem'} aria-pressed={b.id === selected} onClick={() => setSelected(b.id)}>
                        <span className="spswatch" style={{ background: b.color }} aria-hidden="true" />
                        {b.name} <span className="small muted">· {SHAPE_LABEL[b.shape]}{b.isMain ? ' · Hauptkörper (Länge = 1)' : ''}{b.mirrorOf ? ` · Spiegelbild von ${design.bodies.find((x) => x.id === b.mirrorOf)?.name}` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="dactions">
                  <button onClick={() => { const id = `k-neu-${design.bodies.length + 1}-${Math.random().toString(36).slice(2, 5)}`; commit((d) => addBody(d, { id, name: 'Neuer Körper', groupId: null, shape: 'box', center: { x: 0, y: 0, z: 0 }, size: { length: 0.2, width: 0.2, height: 0.2 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, taper: 1, color: '#8a8f99', uncertainty: 'hoch', assumptions: ['vom Nutzer ergänzt'] })); setSelected(id); }}>+ Körper</button>
                </div>
              </fieldset>

              {sel ? (
                <fieldset className="spbody" aria-label={`Körper ${sel.name} bearbeiten`}>
                  <legend>{sel.name}</legend>
                  {sel.mirrorOf && <p className="small dwarn">Gekoppeltes Spiegelbild – folgt „{design.bodies.find((x) => x.id === sel.mirrorOf)?.name}“. Lage und Maße dort ändern oder <button className="linklike" onClick={() => commit((d) => decouple(d, sel.id))}>Kopplung lösen</button>.</p>}
                  <div className="dgrid">
                    <label className="dfield"><span>Name</span><input key={sel.id + sel.name} defaultValue={sel.name} onBlur={(e) => e.target.value.trim() && patchSel({ name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
                    <label className="dfield"><span>Baugruppe der Interpretation</span>
                      <select value={sel.groupId ?? ''} disabled={sel.isMain} onChange={(e) => patchSel({ groupId: e.target.value || null })}>
                        <option value="">– ergänzt (ohne Baugruppe) –</option>
                        {brief.interpretation?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </label>
                    <label className="dfield"><span>Form</span><select value={sel.shape} disabled={!!sel.mirrorOf} onChange={(e) => { const shape = e.target.value as SpatialBody['shape']; patchSel({ shape, taper: shape === 'wedge' ? 0.25 : shape === 'taper' ? 0.6 : 1 }); }}>{SHAPES.map((s) => <option key={s} value={s}>{SHAPE_LABEL[s]}</option>)}</select></label>
                    <label className="dfield"><span>Farbe</span><input type="color" value={sel.color} disabled={!!sel.mirrorOf} onChange={(e) => patchSel({ color: e.target.value })} /></label>
                  </div>
                  <p className="small">Lage (Mittelpunkt) <BasisMark b={sel.basis.position} /></p>
                  <div className="dgrid">
                    {(['x', 'y', 'z'] as const).map((k) => <Num key={k} id={`sp-c${k}`} label={{ x: 'x (vorn +)', y: 'y (links +)', z: 'z (oben +)' }[k]} value={sel.center[k]} disabled={!!sel.mirrorOf} onCommit={(n) => patchSel({ center: { ...sel.center, [k]: n } })} />)}
                  </div>
                  <p className="small">Maße (Hauptkörperlänge = 1) <BasisMark b={sel.basis.size} /></p>
                  <div className="dgrid">
                    {(['length', 'width', 'height'] as const).map((k) => <Num key={k} id={`sp-s${k}`} label={{ length: 'Länge', width: 'Breite', height: 'Höhe' }[k]} value={sel.size[k]} min={0.001} disabled={!!sel.mirrorOf || (sel.isMain && k === 'length')} onCommit={(n) => patchSel({ size: { ...sel.size, [k]: n } })} />)}
                    {sel.shape !== 'box' && <Num id="sp-taper" label="Verjüngung vorn (0–1)" value={sel.taper} min={0} disabled={!!sel.mirrorOf} onCommit={(n) => patchSel({ taper: n })} />}
                  </div>
                  <p className="small">Orientierung in Grad <BasisMark b={sel.basis.rotation} /></p>
                  <div className="dgrid">
                    {(['yaw', 'pitch', 'roll'] as const).map((k) => <Num key={k} id={`sp-r${k}`} label={{ yaw: 'Gieren (um z)', pitch: 'Nicken (um y)', roll: 'Rollen (um x)' }[k]} value={sel.rotation[k]} step={1} disabled={!!sel.mirrorOf} onCommit={(n) => patchSel({ rotation: { ...sel.rotation, [k]: n } })} />)}
                  </div>
                  {sel.assumptions.length > 0 && <details open><summary className="small">Annahmen und Unsicherheit ({sel.uncertainty})</summary><ul className="small">{sel.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></details>}
                  <div className="dactions">
                    {design.symmetry.kind === 'left-right' && !sel.isMain && !sel.mirrorOf && !design.bodies.some((x) => x.mirrorOf === sel.id) && <button onClick={() => commit((d) => addMirror(d, sel.id, `${sel.id}-sp`.slice(0, 40)))}>Spiegelbild ergänzen (links ↔ rechts)</button>}
                    {!sel.isMain && <button className="danger" onClick={() => { commit((d) => removeBody(d, sel.id)); setSelected(null); }}>Körper entfernen</button>}
                  </div>
                </fieldset>
              ) : <p className="small muted">Körper in der Liste, in der 3D-Ansicht oder in einer der sechs Ansichten anklicken, um ihn zu bearbeiten.</p>}

              <fieldset>
                <legend>Symmetrie und Maßstab</legend>
                <p className="small">Symmetrie: <strong>{design.symmetry.kind === 'left-right' ? 'links-rechts' : 'keine'}</strong> ({SPATIAL_BASIS_LABEL[design.symmetry.basis]}) – {design.symmetry.note}</p>
                <div className="dactions">
                  {design.symmetry.kind === 'left-right' ? <button onClick={() => commit((d) => setSymmetry(d, 'none'))}>Symmetrie aufheben (Kopplungen lösen)</button> : <button onClick={() => commit((d) => setSymmetry(d, 'left-right'))}>Links-rechts-Symmetrie vorgeben</button>}
                </div>
                <div className="dgrid">
                  <Num id="sp-scale" label="Maßstab: Hauptkörperlänge in Noppen (Zielvorgabe, leer = unbekannt)" value={design.scale?.mainLengthStuds ?? 0} min={0} onCommit={(n) => commit((d) => setScale(d, n > 0 ? n : null))} />
                </div>
              </fieldset>

              <fieldset>
                <legend>Referenzansichten</legend>
                <p className="small">Ein Einschub (z. B. Heckansicht einer Collage) zeigt dasselbe Objekt aus anderer Richtung – keine zusätzliche Baugruppe.</p>
                {refs.map((r, k) => {
                  const setRef = (p: Partial<ReferenceView>) => commit((d) => setReferenceViews(d, d.referenceViews.map((x) => (x.id === r.id ? { ...x, ...p, basis: 'user' } : p.primary ? { ...x, primary: false } : x))));
                  return (
                    <div key={r.id} className={`spreflist${activeRef?.id === r.id ? ' sel' : ''}`}>
                      <div className="ditemhead"><button className="linklike" onClick={() => setRefView(r.id)}>Ausschnitt {r.id} (Bild {r.imageIndex + 1})</button><BasisMark b={r.basis} />{r.primary && <span className="small">Hauptreferenz</span>}</div>
                      <div className="dgrid">
                        <label className="dfield"><span>Richtung</span><select value={r.direction} onChange={(e) => setRef({ direction: e.target.value as ReferenceView['direction'] })}>{REF_DIRECTIONS.map((x) => <option key={x} value={x}>{REF_DIRECTION_LABEL[x]}</option>)}</select></label>
                        <label className="dfield"><span>Vorderseite im Bild</span><select value={r.frontInImage ?? ''} onChange={(e) => setRef({ frontInImage: (e.target.value || null) as ReferenceView['frontInImage'] })}><option value="">– (Front/Heck/oben/unten)</option><option value="links">links</option><option value="rechts">rechts</option></select></label>
                        {(['x', 'y', 'w', 'h'] as const).map((key) => <Num key={key} id={`sp-ref${k}-${key}`} label={{ x: 'x (0–1)', y: 'y (0–1)', w: 'Breite (0–1)', h: 'Höhe (0–1)' }[key]} value={r.box[key]} min={0} onCommit={(n) => setRef({ box: { ...r.box, [key]: n } })} />)}
                      </div>
                      <div className="dactions">
                        {!r.primary && <button onClick={() => setRef({ primary: true })}>Als Hauptreferenz</button>}
                        {!r.primary && <button className="danger" onClick={() => commit((d) => setReferenceViews(d, d.referenceViews.filter((x) => x.id !== r.id)))}>Entfernen</button>}
                      </div>
                    </div>
                  );
                })}
                <div className="dactions">
                  <button onClick={() => commit((d) => setReferenceViews(d, [...d.referenceViews, { id: `ref-${d.referenceViews.length + 1}-${Math.random().toString(36).slice(2, 5)}`, imageIndex: 0, box: { x: 0.7, y: 0.7, w: 0.3, h: 0.3 }, direction: 'hinten', frontInImage: null, primary: false, basis: 'user', note: 'vom Nutzer ergänzter Ausschnitt' }]))}>+ Ausschnitt (z. B. Einschub)</button>
                  <button onClick={() => commit((d) => setReferenceViews(d, defaultReferenceViews(brief)))}>Auf ganze Bilder zurücksetzen</button>
                  <button onClick={() => derive()}>Vorschlag mit diesen Ansichten neu ableiten</button>
                  {service?.ready && service.spatial && <button onClick={() => (hasCorrections ? setConfirmReplace('service') : setConsent((c) => ({ ...c, open: true })))}>Vorschlag vom Analysedienst anfordern …</button>}
                </div>
              </fieldset>
            </div>
          </div>

          {frames && (
            <div>
              <h4>Sechs Ansichten – dieselbe Geometrie, ein gemeinsamer Maßstab</h4>
              <p className="small muted">Orthografisch, alle Fenster mit demselben Maßstab (Maßstabsbalken 0,25 Hauptkörperlängen). Keine Ansicht ist einzeln gestreckt; keine ist separat erzeugt.</p>
              <div className="spviews">{frames.frames.map((f) => <OrthoView key={f.view.id} frame={f} scale={frames.scale} design={design} selected={selected} onSelect={setSelected} />)}</div>
            </div>
          )}

          <div>
            <h4>Prüfung und offene Angaben</h4>
            <ul className="spfind">
              {findings.map((f, k) => <li key={k} className={f.level}><span className="sr">{f.level === 'error' ? 'Fehler' : f.level === 'warning' ? 'Hinweis' : 'Info'}:</span> {f.level === 'error' ? '✗ ' : f.level === 'warning' ? '! ' : 'i '}{f.bodyId ? <button className="linklike" onClick={() => setSelected(f.bodyId!)}>{f.message}</button> : f.message}</li>)}
            </ul>
            {(design.contradictions.length > 0 || deviations.length > 0) && (
              <>
                <p className="small"><strong>Abweichungen und Widersprüche zur Vorlage</strong> (perspektivisch, grobe Hinweise):</p>
                <ul className="small">{[...design.contradictions, ...deviations].map((c) => <li key={c}>{c}</li>)}</ul>
              </>
            )}
            {(() => {
              const missing = unmodelledGroups(design, brief.interpretation);
              return missing.length > 0 ? (
                <div id="sp-unmodelled">
                  <p className="small"><strong>Noch nicht räumlich modelliert ({missing.length}):</strong> diese Baugruppen der Interpretation haben keinen Körper und fehlen in allen Ansichten.</p>
                  <ul className="small">{missing.map((g) => <li key={g.id}>{g.name} <span className="muted">({g.role === 'detail' ? 'Detail' : g.role === 'hauptkoerper' ? 'Hauptkörper' : 'Baugruppe'})</span> – <button className="linklike" onClick={() => { const id = `k-${g.id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40); commit((d) => addBody(d, { id, name: g.name, groupId: g.id, shape: 'box', center: { x: 0, y: 0, z: 0 }, size: { length: 0.1, width: 0.1, height: 0.1 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, taper: 1, color: brief.interpretation?.colors.find((c) => c.id === brief.interpretation?.groups.find((x) => x.id === g.id)?.colorIds[0])?.hex ?? '#8a8f99', uncertainty: 'hoch', assumptions: ['vom Nutzer als Körper ergänzt; Lage und Maße noch festzulegen'] })); setSelected(id); }}>als Körper ergänzen</button></li>)}</ul>
                </div>
              ) : <p className="small" id="sp-unmodelled">Alle Baugruppen der Interpretation haben einen Körper.</p>;
            })()}
            {design.openQuestions.length > 0 && (
              <details open>
                <summary className="small"><strong>Offene räumliche Angaben ({design.openQuestions.length})</strong></summary>
                <ul className="small">{design.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
              </details>
            )}
          </div>

          <div className="dactions">
            <button className="primary" onClick={tryConfirm} aria-describedby={attempt ? 'sp-feedback' : undefined}>Räumliche Form bestätigen</button>
            <button onClick={() => download(`${design.designId}-v${design.version}.raumentwurf.json`, JSON.stringify(design, null, 2))}>Räumlichen Entwurf exportieren (JSON)</button>
            <label className="dupload"><span>Importieren</span><input type="file" accept="application/json,.json" aria-label="Räumlichen Entwurf importieren" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const l = parseSpatial(await f.text(), brief);
                replaceWith(l.design, `Räumlicher Entwurf ${l.design.designId} v${l.design.version} importiert (Struktur, Hash und Regeln geprüft).`);
                if (l.issues.length) setMessage({ kind: 'error', text: `Importiert, aber nicht stimmig – nur zur Korrektur geladen${l.downgraded ? '; Bestätigung aufgehoben' : ''}.`, errors: l.issues });
              } catch (er) { setMessage({ kind: 'error', text: `Import abgelehnt: ${(er as Error).message}` }); }
            }} /></label>
          </div>
          <p className="small">Stand: <strong>{confirmedCurrent ? `Form bestätigt (${design.confirmation.at?.slice(0, 16).replace('T', ' ')})` : design.confirmation.status === 'stale' ? `Bestätigung veraltet – ${design.confirmation.reason}` : 'unbestätigt'}</strong> · Inhalts-Hash <span className="code">{design.contentHash}</span></p>
          {attempt === 'blocked' && blockers.length > 0 && (
            <div id="sp-feedback" className="dfeedback" role="alert">
              <p><strong>Noch nicht bestätigbar ({blockers.length}):</strong></p>
              <ol>{blockers.map((b, k) => <li key={k}><span aria-hidden="true">{k + 1}.</span>{b}</li>)}</ol>
            </div>
          )}
          {attempt === 'confirmed' && confirmedCurrent && (
            <div id="sp-feedback" className="dfeedback ok" role="status">
              <p><strong>Räumliche Form bestätigt.</strong></p>
              <p>Bestätigt ist nur die Form – weder Stabilität noch Montage noch Kaufverfügbarkeit. Es gibt noch keine Steine, keine Bauanleitung und keine Stückliste.</p>
              <p className="small">Verknüpfung für das spätere Modell (<span className="code">CanonicalModel.design.spatial</span>): {toSpatialLink(design).designId} v{toSpatialLink(design).version}.</p>
            </div>
          )}
          <details>
            <summary className="small">Verlauf ({design.history.length}) und Korrekturen ({design.corrections.length})</summary>
            <ol className="small">{design.history.slice(-30).map((h) => <li key={h.version} value={h.version}>{h.at.slice(0, 19).replace('T', ' ')} – {h.event}</li>)}</ol>
          </details>
        </>
      )}
    </section>
  );
}
