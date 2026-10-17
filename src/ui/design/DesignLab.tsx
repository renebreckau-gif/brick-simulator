// Bereich „Aus Bild entwerfen“: Bildvorlage → nachvollziehbare Interpretation → bestätigter Entwurfsauftrag.
// Noch keine Steine: Konstruktion, Bauanleitung und Stückliste entstehen erst aus einem echten Modell (05B).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addImage, adoptHeldAnalysis, applyAnalysisResult, checkRequirements, confirm, confirmationBlockers, correct, createTicket, EMPTY_REQUIREMENTS, isConfirmedCurrent, newBrief, parseBrief, readiness, rebaseInterpretation, removeImage, replaceImage, setInterpretation, setRequirements, setTitle, setView, toRequirements,
  substanceHash, toDesignProvenance, VIEW_LABELS, type AnalysisMeta, type Blocker, type DesignBrief, type FieldProblem, type HeldAnalysis, type ImageRef, type Requirements, type RequirementsDraft, type RequirementsField, type ViewLabel,
} from '../../core/design/brief';
import { checkImageBytes, MAX_IMAGES, sha256Hex } from '../../core/design/images';
import { BASIS_LABEL, checkInterpretation, manualInterpretationTemplate, type Basis, type Interpretation } from '../../core/design/interpretation';
import { clearAll, deleteImage, loadBrief, loadImage, saveBrief, saveImage } from './store';

interface ServerStatus {
  provider: string;
  model: string;
  configured: boolean;
  problem: string | null;
  setup: string[];
  promptVersion: string;
  liveCheck?: { status: 'unverified' | 'ok' | 'failed'; at: string | null; code: string | null; model: string | null };
}

/** „Konfiguriert“ und „live geprüft“ getrennt anzeigen – ein Schlüssel allein belegt keine funktionierende Analyse. */
function liveText(s: ServerStatus): string {
  const base = `Analysedienst: ${s.provider}, Modell ${s.model} – Schlüssel eingerichtet`;
  const lc = s.liveCheck;
  if (!lc || lc.status === 'unverified') return `${base}; in dieser Serversitzung noch nicht live geprüft (der erste Aufruf zeigt, ob er funktioniert).`;
  const when = lc.at ? lc.at.slice(11, 16) : '';
  if (lc.status === 'ok') return `${base}; zuletzt erfolgreich live aufgerufen (${when} UTC${lc.model ? `, ${lc.model}` : ''}).`;
  return `${base}; letzter Live-Aufruf fehlgeschlagen (${lc.code ?? 'unbekannt'}, ${when} UTC).`;
}

const newId = () => `entwurf-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Text-/Zahlfeld, das erst beim Verlassen übernimmt (eine Korrektur je Änderung, nicht je Tastendruck). */
function Field({ label, value, onCommit, type = 'text', step, multiline }: { label: string; value: string | number; onCommit: (v: string) => void; type?: string; step?: string; multiline?: boolean }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => v !== String(value) && onCommit(v);
  return (
    <label className="dfield">
      <span>{label}</span>
      {multiline ? (
        <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} rows={2} />
      ) : (
        <input type={type} step={step} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      )}
    </label>
  );
}

function BasisSelect({ value, onChange, allowObserved = true }: { value: Basis; onChange: (b: Basis) => void; allowObserved?: boolean }) {
  return (
    <label className="dfield basis">
      <span>Grundlage</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Basis)} className={`basis-${value}`}>
        {(['observed', 'assumed', 'user'] as Basis[]).filter((b) => allowObserved || b !== 'observed').map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
      </select>
    </label>
  );
}

const BasisTag = ({ b }: { b: Basis }) => <span className={`btag basis-${b}`}>{{ observed: '◉ beobachtet', assumed: '◌ angenommen', user: '✎ Vorgabe' }[b]}</span>;

export function DesignLab() {
  const [brief, setBrief] = useState<DesignBrief | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<ServerStatus | null | 'none'>(null);
  const [consent, setConsent] = useState<{ open: boolean; agreed: boolean; notes: string }>({ open: false, agreed: false, notes: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string; errors?: string[]; setup?: string[] } | null>(null);
  /** Zurückgehaltene Analyseantwort (Eingaben inzwischen geändert oder Antwort widersprüchlich) – mit ursprünglichem Bildbezug. */
  const [held, setHeld] = useState<HeldAnalysis | null>(null);
  // Anforderungen: Eingabestand (nie vorbelegt), Fehleranzeige nach Übernahme-/Bestätigungsversuch
  const [reqDraft, setReqDraft] = useState<RequirementsDraft>(EMPTY_REQUIREMENTS);
  const [showReqErrors, setShowReqErrors] = useState(false);
  /** Ergebnis des letzten Bestätigungsversuchs; die Liste der Lücken wird live aus dem Kern berechnet. */
  const [attempt, setAttempt] = useState<'blocked' | 'confirmed' | 'already' | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState(0);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const replaceFor = useRef<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  // Aktueller Stand für eintreffende Antworten (Closures laufender Anfragen sehen sonst einen alten Stand)
  const briefRef = useRef<DesignBrief | null>(null);
  briefRef.current = brief;

  // Wiederherstellen aus der lokalen Ablage (Hash geprüft); Bilder nach Prüfsumme
  useEffect(() => {
    (async () => {
      let b: DesignBrief | null = null;
      try {
        const t = await loadBrief();
        if (t) {
          const loaded = parseBrief(t);
          b = loaded.brief;
          if (loaded.issues.length) setMessage({ kind: 'error', text: `Gespeicherter Entwurf ist fachlich nicht stimmig und wurde nur zur Korrektur geladen${loaded.downgraded ? ' (Bestätigung bzw. aktueller Analysestand aufgehoben)' : ''}.`, errors: loaded.issues });
        }
      } catch (e) {
        setMessage({ kind: 'error', text: `Gespeicherter Entwurf nicht lesbar: ${(e as Error).message} Ein neuer Entwurf wurde angelegt.` });
      }
      b ??= newBrief(newId());
      const u: Record<string, string> = {};
      const miss: string[] = [];
      for (const img of b.images) {
        const blob = await loadImage(img.sha256).catch(() => null);
        if (blob) u[img.sha256] = URL.createObjectURL(blob);
        else miss.push(img.sha256);
      }
      setUrls(u);
      setMissing(miss);
      setBrief(b);
    })();
    fetch('/api/design/status').then(async (r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? setStatus(await r.json()) : setStatus('none'))).catch(() => setStatus('none'));
  }, []);
  useEffect(() => {
    if (brief) saveBrief(brief).catch(() => setMessage({ kind: 'error', text: 'Lokales Speichern fehlgeschlagen (Browser-Speicher nicht verfügbar).' }));
  }, [brief]);

  const check = useMemo(() => (brief?.interpretation ? checkInterpretation(brief.interpretation, brief.images.length) : null), [brief]);
  const savedReqKey = JSON.stringify(brief?.requirements ?? null);
  useEffect(() => {
    setReqDraft(brief?.requirements ? { ...brief.requirements } : EMPTY_REQUIREMENTS);
  }, [brief?.briefId, savedReqKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!brief) return <section className="design"><p>Lade lokalen Entwurf …</p></section>;
  const interp = brief.interpretation;
  const update = (fn: (b: DesignBrief) => DesignBrief) => setBrief((b) => (b ? fn(b) : b));
  const fix = (path: string, value: unknown) => update((b) => correct(b, path, value));

  const ingest = async (file: File): Promise<ImageRef | null> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const c = checkImageBytes(bytes, file.type);
    if (!c.ok || !c.type) {
      setUploadErrors((e) => [...e, `${file.name}: ${c.errors.join(' ')}`]);
      return null;
    }
    // Tatsächliche Lesbarkeit: der Browser muss das Bild dekodieren können
    const blob = new Blob([bytes], { type: c.type });
    try {
      const bmp = await createImageBitmap(blob);
      const ok = bmp.width === c.width && bmp.height === c.height;
      bmp.close();
      if (!ok) throw new Error('Maße widersprechen dem Dateikopf');
    } catch (e) {
      setUploadErrors((er) => [...er, `${file.name}: Bild lässt sich nicht dekodieren (${(e as Error).message ?? 'beschädigt'}).`]);
      return null;
    }
    const sha = await sha256Hex(bytes);
    await saveImage(sha, blob);
    setUrls((u) => ({ ...u, [sha]: URL.createObjectURL(blob) }));
    setMissing((m) => m.filter((x) => x !== sha));
    return { sha256: sha, mediaType: c.type, bytes: bytes.length, width: c.width!, height: c.height!, fileName: file.name, view: 'unbekannt', addedAt: new Date().toISOString() };
  };

  const onFiles = async (files: FileList | null) => {
    setUploadErrors([]);
    for (const f of [...(files ?? [])]) {
      if (brief.images.length >= MAX_IMAGES) {
        setUploadErrors((e) => [...e, `${f.name}: höchstens ${MAX_IMAGES} Bilder je Entwurf.`]);
        break;
      }
      const ref = await ingest(f);
      if (ref) {
        if (brief.images.some((i) => i.sha256 === ref.sha256)) setUploadErrors((e) => [...e, `${f.name}: dieses Bild (gleicher Inhalt) ist bereits vorhanden.`]);
        update((b) => addImage(b, ref));
      }
    }
  };
  const onReplace = async (files: FileList | null) => {
    const old = replaceFor.current;
    const f = files?.[0];
    if (!old || !f) return;
    setUploadErrors([]);
    const ref = await ingest(f);
    if (ref) update((b) => replaceImage(b, old, ref));
  };
  const onRemove = async (sha: string) => {
    update((b) => removeImage(b, sha));
    await deleteImage(sha).catch(() => undefined);
    setSel(0);
  };

  const runAnalysis = async () => {
    setBusy(true);
    setMessage(null);
    setHeld(null);
    // Anfrage unveränderlich an Entwurf, Eingabestand, Bilder, Ansichten, Hinweise und Kennung binden
    const ticket = createTicket(brief, consent.notes, crypto.randomUUID());
    const sent = brief.images.map((i) => ({ ...i }));
    const meta = (m: { provider: string; model: string | null; promptVersion: string | null; requestId: string | null }): AnalysisMeta => ({ method: 'anthropic-vision', provider: m.provider, model: m.model, promptVersion: m.promptVersion, at: new Date().toISOString(), requestId: m.requestId });
    try {
      const images = [];
      for (const img of sent) {
        const blob = await loadImage(img.sha256);
        if (!blob) throw new Error(`Bild ${img.fileName} fehlt lokal`);
        images.push({ sha256: img.sha256, mediaType: img.mediaType, view: img.view, data: toBase64(new Uint8Array(await blob.arrayBuffer())) });
      }
      const r = await fetch('/api/design/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticketId: ticket.ticketId, images, notes: ticket.binding.notes }) });
      const body = await r.json().catch(() => null);
      // Antwort gegen den Stand zum Eintreffen prüfen, nicht gegen den Stand beim Absenden
      const current = briefRef.current!;
      if (!body) setMessage({ kind: 'error', text: `Analysedienst nicht erreichbar (HTTP ${r.status}). Im statischen Build gibt es keinen Analyse-Endpunkt.` });
      else if (body.ticketId !== ticket.ticketId) setMessage({ kind: 'error', text: 'Antwort gehört nicht zu dieser Anfrage (Anfragekennung abweichend) und wurde verworfen.' });
      else if (body.ok || body.code === 'contradictory_response') {
        const interpretation = body.ok ? body.interpretation : body.candidate;
        const svc = status && status !== 'none' ? status : null;
        const m = body.ok ? meta(body.meta) : meta({ provider: svc?.provider ?? 'Analysedienst', model: svc?.model ?? null, promptVersion: svc?.promptVersion ?? null, requestId: null });
        const outcome = applyAnalysisResult(current, ticket, interpretation, m, body.ok ? [] : body.errors ?? []);
        if (outcome.kind === 'applied') {
          setBrief(outcome.brief);
          setMessage({ kind: 'info', text: `Interpretation von ${m.provider}${m.model ? ` (${m.model})` : ''} übernommen. Bitte prüfen und korrigieren.`, errors: body.warnings });
        } else if (outcome.kind === 'held') setHeld(outcome.held);
        else setMessage({ kind: 'error', text: outcome.reason });
      } else setMessage({ kind: 'error', text: body.message, errors: body.errors, setup: body.setup });
    } catch (e) {
      setMessage({ kind: 'error', text: `Analyse fehlgeschlagen: ${(e as Error).message}` });
    } finally {
      setBusy(false);
      setConsent((c) => ({ ...c, open: false, agreed: false }));
    }
  };

  const startManual = () => update((b) => setInterpretation(b, manualInterpretationTemplate(), { method: 'manual', provider: 'Nutzer (manuelle Beschreibung)', model: null, promptVersion: null, at: new Date().toISOString(), requestId: null }));

  const featureIds = brief.interpretation?.features.map((f) => f.id) ?? [];
  const reqProblems: FieldProblem[] = checkRequirements(reqDraft, featureIds);
  const reqDirty = JSON.stringify(reqDraft) !== JSON.stringify(brief.requirements ? { ...brief.requirements } : EMPTY_REQUIREMENTS);
  type UiBlocker = Blocker | { group: 'unsaved'; target: 'req-save'; message: string };
  // Lücken aus dem Kern; dazu nur der Hinweis, dass Eingaben noch nicht übernommen sind (keine eigene Prüflogik)
  // Bei nicht übernommenen Eingaben beziehen sich die Anforderungs-Lücken auf den Eingabestand (gleiche Kernprüfung)
  const editing = reqDirty && !!brief.interpretation;
  const blockers: UiBlocker[] = [
    ...confirmationBlockers(brief).filter((x) => !(editing && x.target.startsWith('req-'))),
    ...(editing ? reqProblems.map((p) => ({ group: 'partRange' as const, target: `req-${p.field}` as const, message: p.message })) : []),
    ...(editing ? [{ group: 'unsaved' as const, target: 'req-save' as const, message: 'Anforderungen eingegeben, aber noch nicht übernommen: „Anforderungen übernehmen“ wählen.' }] : []),
  ];
  const targetId = (t: UiBlocker['target']) => (t === 'images' ? 'd-images' : t === 'interpretation' ? 'd-interpretation' : document.getElementById(t) ? t : 'd-interpretation');
  const goTo = (t: UiBlocker['target']) => {
    const el = document.getElementById(targetId(t));
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  };
  const saveRequirements = () => {
    setShowReqErrors(true);
    const r = toRequirements(reqDraft, featureIds);
    if (!r) {
      const first = reqProblems[0];
      if (first) setTimeout(() => goTo(`req-${first.field}`), 0);
      return;
    }
    update((b) => setRequirements(b, r));
  };
  const tryConfirm = () => {
    if (isConfirmedCurrent(brief)) {
      setAttempt('already');
      return;
    }
    setShowReqErrors(true);
    if (blockers.length) {
      setAttempt('blocked');
      setTimeout(() => goTo(blockers[0].target), 0);
      return;
    }
    setBrief(confirm(brief));
    setAttempt('confirmed');
  };
  const notConfigured = status === 'none' || (status !== null && !status.configured);
  const img = brief.images[sel];
  const confirmedCurrent = isConfirmedCurrent(brief);
  const ready = readiness(brief);
  const colorOf = (g: Interpretation['groups'][number]) => interp?.colors.find((c) => c.id === g.colorIds[0])?.hex ?? '#9aa5b1';

  return (
    <section className="design" aria-label="Aus Bild entwerfen">
      <header className="dhead">
        <div>
          <h2>Aus Bild entwerfen</h2>
          <p className="small muted">Bildvorlage → nachvollziehbare Interpretation → bestätigter Entwurfsauftrag. Noch keine Steine: die Konstruktion folgt in einem späteren Schritt.</p>
        </div>
        <Field label="Titel des Entwurfs" value={brief.title} onCommit={(v) => update((b) => setTitle(b, v))} />
      </header>
      {message && (
        <div className={message.kind === 'error' ? 'stalebar' : 'catalogbar'} role={message.kind === 'error' ? 'alert' : 'status'}>
          <span>
            {message.text}
            {message.errors && message.errors.length > 0 && <ul>{message.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
            {message.setup && <ol>{message.setup.map((s) => <li key={s}>{s}</li>)}</ol>}
          </span>
        </div>
      )}
      {held && (
        <div className="stalebar" role="alert">
          <span>
            <strong>Analyseantwort zurückgehalten</strong> (Anfrage {held.ticket.ticketId.slice(0, 8)}…, analysierte Bilder {held.ticket.binding.imageHashes.map((h) => `${h.slice(0, 10)}…`).join(', ')}). Sie wurde nicht automatisch übernommen:
            <ul>
              {held.reasons.map((r) => <li key={r}>{r}</li>)}
              {held.problems.length > 0 && <li>Die Antwort ist unvollständig oder widersprüchlich: {held.problems.join('; ')}</li>}
            </ul>
            Bei Übernahme behält sie ihren ursprünglichen Bildbezug; passt der nicht zu den aktuellen Bildern, ist sie sofort als veraltet markiert. Bestätigen lässt sie sich erst nach Prüfung bzw. Korrektur.
          </span>
          <span className="dbtns">
            <button className="primary" onClick={() => { try { setBrief(adoptHeldAnalysis(briefRef.current!, held)); setHeld(null); } catch (e) { setMessage({ kind: 'error', text: (e as Error).message }); setHeld(null); } }}>Trotzdem übernehmen</button>
            <button onClick={() => setHeld(null)}>Verwerfen</button>
          </span>
        </div>
      )}

      {/* 1. Bilder */}
      <section className="dsec" aria-label="Bilder" id="d-images" tabIndex={-1}>
        <h3>1. Bildvorlagen</h3>
        <p className="small muted">PNG oder JPEG, höchstens {MAX_IMAGES} Bilder, je höchstens 5 MB. Geprüft werden Dateiinhalt (nicht die Endung), Dekodierbarkeit und Maße; identifiziert wird jedes Bild über seine SHA-256-Prüfsumme. Die Bilder bleiben in diesem Browser (lokaler Speicher) und gelangen weder in Git noch in den Build oder Modell-Exporte.</p>
        <label className="dupload">
          <span>Bilder hinzufügen</span>
          <input type="file" accept="image/png,image/jpeg" multiple onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} aria-label="Bilder hinzufügen" />
        </label>
        <input ref={replaceInput} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { onReplace(e.target.files); e.target.value = ''; }} aria-label="Bild ersetzen" />
        {uploadErrors.length > 0 && <ul className="derrors" role="alert">{uploadErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {missing.length > 0 && <p className="stalebar" role="alert">Lokal fehlende Bilder (Prüfsumme {missing.map((m) => m.slice(0, 12)).join(', ')} …): bitte dieselbe Datei erneut hochladen.</p>}
        <ul className="dimages">
          {brief.images.map((im, k) => (
            <li key={im.sha256} className={k === sel ? 'active' : ''}>
              <button className="dthumb" onClick={() => setSel(k)} aria-label={`Bild ${k + 1} anzeigen`}>
                {urls[im.sha256] ? <img src={urls[im.sha256]} alt={`Vorlage ${k + 1}`} /> : <span>fehlt</span>}
              </button>
              <div className="small">
                <strong>Bild {k + 1}</strong> · {im.fileName}<br />
                {im.mediaType.replace('image/', '').toUpperCase()}, {im.width} × {im.height} px, {(im.bytes / 1024).toFixed(0)} KB<br />
                <span className="code">SHA-256 {im.sha256.slice(0, 16)}…</span>
              </div>
              <label className="dfield"><span>Ansicht</span>
                <select value={im.view} onChange={(e) => update((b) => setView(b, im.sha256, e.target.value as ViewLabel))}>{VIEW_LABELS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
              </label>
              <div className="dbtns">
                <button onClick={() => { replaceFor.current = im.sha256; replaceInput.current?.click(); }}>Ersetzen</button>
                <button className="danger" onClick={() => onRemove(im.sha256)}>Entfernen</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 2. Interpretation */}
      <section className="dsec" aria-label="Interpretation" id="d-interpretation" tabIndex={-1}>
        <h3>2. Interpretation</h3>
        {brief.images.length === 0 && <p className="small muted">Zuerst ein Bild hochladen (Abschnitt 1).</p>}
        {brief.images.length > 0 && !interp && (
          <div className="dnext" role="status">
            <p><strong>Bild hochgeladen. Als Nächstes das Bild interpretieren.</strong></p>
            {notConfigured && <p>Automatische Analyse nicht eingerichtet. Beschreibe den Entwurf manuell oder importiere einen vorhandenen Entwurfsauftrag.</p>}
            <div className="dbtns">
              <button className="primary" onClick={startManual}>Manuell beschreiben</button>
              <button onClick={() => importInput.current?.click()}>Entwurfsauftrag importieren</button>
            </div>
          </div>
        )}
        {brief.analysis && (
          <p className={brief.analysis.status === 'stale' ? 'stalebar' : 'small muted'} role={brief.analysis.status === 'stale' ? 'alert' : undefined}>
            Herkunft: {brief.analysis.provider}{brief.analysis.model ? ` (${brief.analysis.model})` : ''}, Verfahren {brief.analysis.methodVersion}{brief.analysis.promptVersion ? `, ${brief.analysis.promptVersion}` : ''}, {brief.corrections.length} Korrektur(en).
            {brief.analysis.status === 'stale' && <> <strong>Veraltet:</strong> {brief.analysis.staleReason}. Neu analysieren, manuell neu beginnen oder <button className="linklike" onClick={() => update(rebaseInterpretation)}>bestehende Interpretation ausdrücklich für die aktuellen Bilder und Ansichten neu bewerten</button> (wird protokolliert; Bildbereiche bitte prüfen).</>}
          </p>
        )}
        <div className="dactions">
          <button className="primary" disabled={!brief.images.length || busy || missing.length > 0} onClick={() => setConsent({ open: true, agreed: false, notes: consent.notes })}>Automatisch analysieren …</button>
          <button onClick={startManual} disabled={busy}>{interp ? 'Manuell neu beginnen' : 'Manuell beschreiben'}</button>
          <span className="small muted">
            {status === null ? 'Prüfe Analysedienst …' : status === 'none' ? 'Kein lokaler Analyse-Endpunkt (z. B. statischer Build) – nur manueller Weg.' : !status.configured ? `Analysedienst ${status.provider}: nicht eingerichtet (${status.problem}).` : liveText(status)}
          </span>
        </div>
        {consent.open && (
          <div className="dconsent" role="dialog" aria-label="Einwilligung zur Bildanalyse">
            <h4>Vor der Analyse: Welche Daten gehen wohin?</h4>
            {status && status !== 'none' ? (
              <ul>
                <li>Dienst: <strong>{status.provider}</strong>, Modell <span className="code">{status.model}</span>, über den lokalen Entwicklungsserver (der API-Schlüssel liegt nur dort).</li>
                <li>Gesendet werden: {brief.images.length} Bild(er) als Bilddaten ({brief.images.map((i) => `${i.sha256.slice(0, 10)}…`).join(', ')}), ihre Ansichtsbezeichnung und Ihre Hinweise unten. Dateinamen werden nicht gesendet.</li>
                <li>Es gelten die Bedingungen und Aufbewahrungsregeln des Dienstes. Bitte nur Bilder senden, die Sie dafür verwenden dürfen.</li>
              </ul>
            ) : <p>Kein Analysedienst erreichbar.</p>}
            {status && status !== 'none' && !status.configured && <ol>{status.setup.map((s) => <li key={s}>{s}</li>)}</ol>}
            <Field label="Hinweise an die Analyse (werden als Nutzervorgaben behandelt)" value={consent.notes} onCommit={(v) => setConsent((c) => ({ ...c, notes: v }))} multiline />
            <label className="dcheck"><input type="checkbox" checked={consent.agreed} onChange={(e) => setConsent((c) => ({ ...c, agreed: e.target.checked }))} /> Ich bin einverstanden und berechtigt, diese Bilder an den genannten Dienst zu senden.</label>
            <div className="dbtns">
              <button className="primary" disabled={!consent.agreed || busy || !status || status === 'none' || !status.configured} onClick={runAnalysis}>{busy ? 'Analyse läuft …' : 'Bilder senden und analysieren'}</button>
              <button onClick={() => setConsent((c) => ({ ...c, open: false }))}>Abbrechen</button>
            </div>
          </div>
        )}

        {interp && (
          <div className="dsplit">
            <div className="dimagepane">
              {img && urls[img.sha256] ? (
                <figure className="doverlay">
                  <div className="dimgwrap">
                  <img src={urls[img.sha256]} alt={`Vorlage ${sel + 1}`} />
                  <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Bildbereiche der Baugruppen">
                    {interp.groups.flatMap((g) => g.boxes.filter((b) => b.imageIndex === sel).map((b, k) => (
                      <rect key={`${g.id}-${k}`} x={b.x} y={b.y} width={b.w} height={b.h} className={focusGroup === g.id ? 'focus' : ''} vectorEffect="non-scaling-stroke" strokeDasharray={g.basis === 'observed' ? undefined : '4 3'} />
                    )))}
                  </svg>
                  </div>
                  <figcaption className="small">Bild {sel + 1}: Rahmen = Bildbereiche der Baugruppen (durchgezogen beobachtet, gestrichelt angenommen/vorgegeben)</figcaption>
                </figure>
              ) : <p className="muted">Kein Bild ausgewählt.</p>}
              <figure className="dschema">
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ aspectRatio: img ? `${img.width} / ${img.height}` : '1' }} aria-label="Eingefärbte 2D-Bildbereiche der Baugruppen">
                  {/* je Baugruppe nur der erste (Haupt-)Bildbereich; groß zuerst, damit kleine Teile sichtbar bleiben */}
                  {interp.groups
                    .map((g) => ({ g, b: g.boxes.find((x) => x.imageIndex === sel) }))
                    .filter((x): x is { g: Interpretation['groups'][number]; b: Interpretation['groups'][number]['boxes'][number] } => !!x.b)
                    .sort((p, q) => q.b.w * q.b.h - p.b.w * p.b.h)
                    .map(({ g, b }) => (
                      <rect key={g.id} x={b.x} y={b.y} width={b.w} height={b.h} fill={colorOf(g)} fillOpacity={g.role === 'detail' ? 0.9 : 0.75} stroke="#18212c" strokeWidth={0.004} strokeDasharray={g.basis === 'observed' ? undefined : '0.02 0.012'}><title>{g.name}</title></rect>
                    ))}
                </svg>
                <figcaption className="small"><strong>Eingefärbte 2D-Bildbereiche – keine räumliche Rekonstruktion, keine Steine.</strong> Je Baugruppe nur das markierte Rechteck im Bild, gefüllt mit ihrer ersten Farbe. Tiefe, Form und Proportionen sind darin nicht enthalten und nicht geprüft; Rechtecke aus Teilansichten (z. B. Einsatzbildern) stehen an ihrer Bildposition.</figcaption>
              </figure>
            </div>
            <div className="deditor">
              {check && !check.ok && <div className="derrors" role="alert"><strong>Noch nicht bestätigbar:</strong><ul>{check.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
              {check && check.warnings.length > 0 && <ul className="dwarn">{check.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
              <Field label="Gegenstand" value={interp.subject} onCommit={(v) => fix('subject', v)} />
              <Field label="Zusammenfassung" value={interp.summary} onCommit={(v) => fix('summary', v)} multiline />
              <fieldset><legend>Silhouette <BasisTag b={interp.silhouette.basis} /></legend>
                <Field label="Beschreibung" value={interp.silhouette.description} onCommit={(v) => fix('silhouette.description', v)} multiline />
                <Field label="Seitenverhältnis Breite : Höhe" type="number" step="0.05" value={interp.silhouette.aspectWidthToHeight} onCommit={(v) => fix('silhouette.aspectWidthToHeight', Number(v))} />
              </fieldset>

              <fieldset><legend>Baugruppen und Proportionen (relativ zum Hauptkörper)</legend>
                {interp.groups.map((g, gi) => (
                  <div key={g.id} className={`ditem${focusGroup === g.id ? ' focus' : ''}`} onFocus={() => setFocusGroup(g.id)}>
                    <div className="ditemhead"><strong>{g.name || g.id}</strong> <BasisTag b={g.basis} /> <span className="small muted">{g.role === 'hauptkoerper' ? 'Hauptkörper' : g.role}</span></div>
                    <div className="dgrid">
                      <Field label="Name" value={g.name} onCommit={(v) => fix(`groups.${gi}.name`, v)} />
                      <label className="dfield"><span>Rolle</span><select value={g.role} onChange={(e) => fix(`groups.${gi}.role`, e.target.value)}><option value="hauptkoerper">Hauptkörper</option><option value="baugruppe">Baugruppe</option><option value="detail">Detail</option></select></label>
                      <BasisSelect value={g.basis} onChange={(b) => fix(`groups.${gi}.basis`, b)} />
                      {(['length', 'width', 'height'] as const).map((k) => <Field key={k} label={{ length: 'rel. Länge', width: 'rel. Breite', height: 'rel. Höhe' }[k]} type="number" step="0.05" value={g.relativeSize[k]} onCommit={(v) => fix(`groups.${gi}.relativeSize.${k}`, Number(v))} />)}
                    </div>
                    <Field label="Beschreibung" value={g.description} onCommit={(v) => fix(`groups.${gi}.description`, v)} multiline />
                    <div className="dchips">Farben: {interp.colors.map((c) => (
                      <label key={c.id} className="dchip"><input type="checkbox" checked={g.colorIds.includes(c.id)} onChange={(e) => fix(`groups.${gi}.colorIds`, e.target.checked ? [...g.colorIds, c.id] : g.colorIds.filter((x) => x !== c.id))} /> <span className="swatch" style={{ background: c.hex }} /> {c.name}</label>
                    ))}</div>
                    <div className="small">Bildbereiche: {g.boxes.length === 0 ? 'keine' : g.boxes.map((b, bi) => (
                      <span key={bi} className="dbox">Bild {b.imageIndex + 1}
                        {(['x', 'y', 'w', 'h'] as const).map((k) => <input key={k} aria-label={`${k} Bildbereich ${bi + 1}`} type="number" step="0.01" min={0} max={1} defaultValue={b[k]} onBlur={(e) => Number(e.target.value) !== b[k] && fix(`groups.${gi}.boxes.${bi}.${k}`, Number(e.target.value))} />)}
                        <button className="linklike" onClick={() => fix(`groups.${gi}.boxes`, g.boxes.filter((_, x) => x !== bi))}>entfernen</button>
                      </span>
                    ))}
                      {brief.images.length > 0 && <button className="linklike" onClick={() => fix(`groups.${gi}.boxes`, [...g.boxes, { imageIndex: sel, x: 0.25, y: 0.25, w: 0.5, h: 0.5 }])}>+ Bildbereich in Bild {sel + 1}</button>}
                    </div>
                    {g.role !== 'hauptkoerper' && <button className="linklike danger" onClick={() => fix('groups', interp.groups.filter((x) => x.id !== g.id))}>Baugruppe entfernen</button>}
                  </div>
                ))}
                <button onClick={() => fix('groups', [...interp.groups, { id: `g${Date.now().toString(36)}`, name: 'Neue Baugruppe', role: 'baugruppe', description: '', basis: 'user', boxes: [], relativeSize: { length: 0.5, width: 0.5, height: 0.5 }, colorIds: [], confidence: 'mittel' }])}>+ Baugruppe</button>
              </fieldset>

              <fieldset><legend>Farbflächen</legend>
                {interp.colors.map((c, ci) => (
                  <div key={c.id} className="dgrid ditem">
                    <Field label="Name" value={c.name} onCommit={(v) => fix(`colors.${ci}.name`, v)} />
                    <label className="dfield"><span>Farbe</span><input type="color" value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#888888'} onChange={(e) => fix(`colors.${ci}.hex`, e.target.value)} /></label>
                    <Field label="Flächenanteil (0–1)" type="number" step="0.05" value={c.areaShare} onCommit={(v) => fix(`colors.${ci}.areaShare`, Number(v))} />
                    <BasisSelect value={c.basis} onChange={(b) => fix(`colors.${ci}.basis`, b)} />
                    <button className="linklike danger" onClick={() => fix('colors', interp.colors.filter((x) => x.id !== c.id))}>entfernen</button>
                  </div>
                ))}
                <button onClick={() => fix('colors', [...interp.colors, { id: `c${Date.now().toString(36)}`, name: 'Neue Farbe', hex: '#888888', areaShare: 0, basis: 'user' }])}>+ Farbe</button>
              </fieldset>

              <fieldset><legend>Charakteristische Merkmale</legend>
                {interp.features.map((f, fi) => (
                  <div key={f.id} className="ditem">
                    <div className="ditemhead"><BasisTag b={f.basis} /></div>
                    <Field label="Merkmal" value={f.description} onCommit={(v) => fix(`features.${fi}.description`, v)} />
                    <BasisSelect value={f.basis} onChange={(b) => fix(`features.${fi}.basis`, b)} />
                    <button className="linklike danger" onClick={() => fix('features', interp.features.filter((x) => x.id !== f.id))}>entfernen</button>
                  </div>
                ))}
                <button onClick={() => fix('features', [...interp.features, { id: `f${Date.now().toString(36)}`, description: 'Neues Merkmal', basis: 'user', groupIds: [] }])}>+ Merkmal</button>
              </fieldset>

              <fieldset><legend>Symmetrie <BasisTag b={interp.symmetry.basis} /></legend>
                <div className="dgrid">
                  <label className="dfield"><span>Art</span><select value={interp.symmetry.kind} onChange={(e) => fix('symmetry.kind', e.target.value)}>{['keine', 'links-rechts', 'vorn-hinten', 'rotation', 'unklar'].map((k) => <option key={k}>{k}</option>)}</select></label>
                  <BasisSelect value={interp.symmetry.basis} onChange={(b) => fix('symmetry.basis', b)} />
                </div>
                <Field label="Anmerkung" value={interp.symmetry.note} onCommit={(v) => fix('symmetry.note', v)} />
              </fieldset>

              <fieldset><legend>Verdeckte Bereiche (nie „beobachtet“)</legend>
                {interp.hiddenAreas.map((h, hi) => (
                  <div key={hi} className="ditem">
                    <Field label="Bereich" value={h.description} onCommit={(v) => fix(`hiddenAreas.${hi}.description`, v)} />
                    <BasisSelect value={h.basis} allowObserved={false} onChange={(b) => fix(`hiddenAreas.${hi}.basis`, b)} />
                    <button className="linklike danger" onClick={() => fix('hiddenAreas', interp.hiddenAreas.filter((_, x) => x !== hi))}>entfernen</button>
                  </div>
                ))}
                <button onClick={() => fix('hiddenAreas', [...interp.hiddenAreas, { description: 'Neuer verdeckter Bereich', basis: 'assumed' }])}>+ Bereich</button>
              </fieldset>

              <fieldset><legend>Vermutlich nur vereinfacht darstellbar</legend>
                {interp.simplifications.map((s, si) => (
                  <div key={si} className="dgrid ditem">
                    <Field label="Merkmal" value={s.feature} onCommit={(v) => fix(`simplifications.${si}.feature`, v)} />
                    <Field label="Grund" value={s.reason} onCommit={(v) => fix(`simplifications.${si}.reason`, v)} />
                    <button className="linklike danger" onClick={() => fix('simplifications', interp.simplifications.filter((_, x) => x !== si))}>entfernen</button>
                  </div>
                ))}
                <button onClick={() => fix('simplifications', [...interp.simplifications, { feature: '', reason: 'keine Schrägen/Rundungen im unterstützten Teileumfang' }])}>+ Vereinfachung</button>
              </fieldset>

              <fieldset><legend>Offene Fragen</legend>
                {interp.openQuestions.map((q, qi) => (
                  <div key={q.id} className="ditem">
                    <Field label={`Frage ${qi + 1}`} value={q.question} onCommit={(v) => fix(`openQuestions.${qi}.question`, v)} />
                    <button className="linklike danger" onClick={() => fix('openQuestions', interp.openQuestions.filter((x) => x.id !== q.id))}>als geklärt entfernen</button>
                  </div>
                ))}
                <button onClick={() => fix('openQuestions', [...interp.openQuestions, { id: `q${Date.now().toString(36)}`, question: 'Neue Frage' }])}>+ Frage</button>
              </fieldset>
              <p className="small muted">Nicht aus dem Bild ableitbar: {interp.notInferable.join(', ') || '–'}.</p>
            </div>
          </div>
        )}
      </section>

      {/* 3. Anforderungen */}
      {interp ? (
        <RequirementsForm brief={brief} draft={reqDraft} setDraft={setReqDraft} problems={reqProblems} showErrors={showReqErrors} dirty={reqDirty} onSave={saveRequirements} />
      ) : (
        <section className="dsec" aria-label="Anforderungen"><h3>3. Anforderungen</h3><p className="small muted">Anforderungen lassen sich angeben, sobald eine Interpretation vorliegt.</p></section>
      )}

      {/* 4. Bestätigung */}
      <section className="dsec" aria-label="Bestätigung">
        <h3>4. Entwurfsauftrag bestätigen</h3>
        <ul className="dready">{ready.map((r) => <li key={r.label} className={r.ok ? 'ok' : 'open'}>{r.ok ? '✓' : '○'} {r.label}</li>)}</ul>
        <p className="small">
          Version {brief.version} · Inhalts-Hash <span className="code">{brief.contentHash}</span> · Stand:{' '}
          <strong>{confirmedCurrent ? `bestätigt (${brief.confirmation.at?.slice(0, 16).replace('T', ' ')})` : brief.confirmation.status === 'stale' ? `Bestätigung veraltet – ${brief.confirmation.reason}` : 'unbestätigt'}</strong>
        </p>
        <div className="dactions">
          <button className="primary" onClick={tryConfirm} aria-describedby={attempt ? 'confirm-feedback' : undefined}>Interpretation und Anforderungen bestätigen</button>
          <button onClick={() => download(`${brief.briefId}-v${brief.version}.entwurfsauftrag.json`, JSON.stringify(brief, null, 2))}>Entwurfsauftrag exportieren (JSON, ohne Bilddaten)</button>
          <label className="dupload"><span>Importieren</span><input ref={importInput} type="file" accept="application/json,.json" aria-label="Entwurfsauftrag importieren" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const loaded = parseBrief(await f.text());
              const b = loaded.brief;
              const u: Record<string, string> = {};
              const miss: string[] = [];
              for (const im of b.images) { const blob = await loadImage(im.sha256); if (blob) u[im.sha256] = URL.createObjectURL(blob); else miss.push(im.sha256); }
              setUrls(u); setMissing(miss); setBrief(b); setSel(0);
              setHeld(null);
              if (loaded.issues.length) setMessage({ kind: 'error', text: `Entwurfsauftrag ${b.briefId} importiert, aber fachlich nicht stimmig – nur zur Korrektur geladen${loaded.downgraded ? '; Bestätigung bzw. aktueller Analysestand aufgehoben' : ''}.${miss.length ? ` ${miss.length} Bild(er) fehlen lokal.` : ''}`, errors: loaded.issues });
              else setMessage({ kind: 'info', text: `Entwurfsauftrag ${b.briefId} Version ${b.version} importiert (Struktur, Hash und Inhalt geprüft).${miss.length ? ` ${miss.length} Bild(er) fehlen lokal.` : ''}` });
            } catch (er) { setMessage({ kind: 'error', text: `Import abgelehnt: ${(er as Error).message}` }); }
          }} /></label>
          <button className="danger" onClick={async () => { if (window.confirm('Lokalen Entwurf und alle lokal gespeicherten Bilder löschen?')) { await clearAll(); setUrls({}); setMissing([]); setBrief(newBrief(newId())); setMessage(null); setHeld(null); setAttempt(null); setShowReqErrors(false); } }}>Neuer Entwurf</button>
        </div>
        {attempt === 'blocked' && blockers.length > 0 && (
          <div id="confirm-feedback" className="dfeedback" role="alert">
            <p><strong>Noch nicht bestätigbar.</strong> Es fehlen bzw. stimmen noch nicht ({blockers.length}):</p>
            <ol>{blockers.map((b, k) => <li key={`${k}-${b.message}`}><span aria-hidden="true">{k + 1}.</span><button className="linklike" onClick={() => goTo(b.target)}>{b.message}</button></li>)}</ol>
          </div>
        )}
        {attempt === 'blocked' && blockers.length === 0 && !confirmedCurrent && (
          <p id="confirm-feedback" className="dfeedback" role="status">Alle Angaben sind jetzt vollständig – „Interpretation und Anforderungen bestätigen“ erneut wählen.</p>
        )}
        {(attempt === 'confirmed' || attempt === 'already') && confirmedCurrent && (
          <div id="confirm-feedback" className="dfeedback ok" role="status">
            <p><strong>{attempt === 'already' ? 'Dieser Stand ist bereits bestätigt.' : 'Entwurfsauftrag bestätigt.'}</strong></p>
            <p>Die Konstruktion eines Bausteinmodells ist noch nicht verfügbar. Es gibt daher noch keine Bauanleitung und keine Stückliste.</p>
          </div>
        )}
        <p className="inotice small">
          Ein bestätigter Entwurfsauftrag ist eine <strong>Anforderung</strong>, keine Zusage der Machbarkeit. Er enthält keine Steine. Bauanleitung und Stückliste gibt es erst, wenn daraus ein echtes kanonisches Modell mit geprüfter Baufolge konstruiert ist (nächster Schritt). Es wird keine Alters- oder Sicherheitsfreigabe abgeleitet.
          {confirmedCurrent && <> Verknüpfung für das spätere Modell (<span className="code">CanonicalModel.design.brief</span>): {brief.briefId} v{toDesignProvenance(brief).brief!.version}, bestätigter Inhalt <span className="code">{substanceHash(brief)}</span>.</>}
        </p>
        <details>
          <summary className="small">Verlauf ({brief.history.length})</summary>
          <ol className="small">{brief.history.slice(-30).map((h) => <li key={h.version} value={h.version}>{h.at.slice(0, 19).replace('T', ' ')} – {h.event}</li>)}</ol>
        </details>
      </section>
    </section>
  );
}

const FIELD_LABEL: Record<RequirementsField, string> = { partMin: 'Teilezahl von', partMax: 'bis', maxLengthStuds: 'max. Länge (Noppen)', maxWidthStuds: 'max. Breite (Noppen)', maxHeightBricks: 'max. Höhe (Steine)', keyFeatureIds: 'Wichtigste Merkmale', intendedUse: 'Nutzung' };

/** Anforderungen: Eingabestand liegt bei DesignLab; Feldfehler kommen aus checkRequirements (Kern), nicht aus eigener Logik. */
function RequirementsForm({ brief, draft, setDraft, problems, showErrors, dirty, onSave }: {
  brief: DesignBrief; draft: RequirementsDraft; setDraft: (d: RequirementsDraft) => void; problems: FieldProblem[]; showErrors: boolean; dirty: boolean; onSave: () => void;
}) {
  const interp = brief.interpretation!;
  const r = draft;
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const toggle = (id: string) => setDraft({ ...r, keyFeatureIds: r.keyFeatureIds.includes(id) ? r.keyFeatureIds.filter((y) => y !== id) : [...r.keyFeatureIds, id] });
  const move = (id: string, d: -1 | 1) => {
    const a = [...r.keyFeatureIds];
    const i = a.indexOf(id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setDraft({ ...r, keyFeatureIds: a });
  };
  const errOf = (f: RequirementsField) => (showErrors ? problems.filter((p) => p.field === f).map((p) => p.message) : []);
  const errProps = (f: RequirementsField) => {
    const e = errOf(f);
    return e.length ? { 'aria-invalid': true as const, 'aria-describedby': `req-${f}-err` } : {};
  };
  const Err = ({ f }: { f: RequirementsField }) => {
    const e = errOf(f);
    return e.length ? <span id={`req-${f}-err`} className="ferr">{e.join(' ')}</span> : null;
  };
  const NumField = ({ f, min = 1 }: { f: 'partMin' | 'partMax' | 'maxLengthStuds' | 'maxWidthStuds' | 'maxHeightBricks'; min?: number }) => (
    <label className="dfield">
      <span>{FIELD_LABEL[f]}{f === 'partMin' || f === 'partMax' ? ' *' : ''}</span>
      <input id={`req-${f}`} type="number" min={min} value={r[f] ?? ''} onChange={(e) => setDraft({ ...r, [f]: num(e.target.value) })} {...errProps(f)} />
      <Err f={f} />
    </label>
  );
  return (
    <section className="dsec" aria-label="Anforderungen" id="d-requirements">
      <h3>3. Anforderungen</h3>
      <p className="small muted">Wünsche an die spätere Konstruktion – keine Zusage, dass sie erfüllbar sind. Maße in Noppen (1 Noppe ≈ 8 mm) und Steinhöhen. Pflichtangaben sind mit * markiert und nicht vorbelegt.</p>
      <div className="dgrid">
        {NumField({ f: 'partMin' })}
        {NumField({ f: 'partMax' })}
        {NumField({ f: 'maxLengthStuds' })}
        {NumField({ f: 'maxWidthStuds' })}
        {NumField({ f: 'maxHeightBricks' })}
        <label className="dfield"><span>Bevorzugte Größe</span><select value={r.preferredSize ?? ''} onChange={(e) => setDraft({ ...r, preferredSize: (e.target.value || null) as Requirements['preferredSize'] })}><option value="">keine Vorgabe</option><option value="klein">klein</option><option value="mittel">mittel</option><option value="gross">groß</option></select></label>
        <label className="dfield"><span>Nutzung *</span>
          <select id="req-intendedUse" value={r.intendedUse ?? ''} onChange={(e) => setDraft({ ...r, intendedUse: (e.target.value || null) as RequirementsDraft['intendedUse'] })} {...errProps('intendedUse')}>
            <option value="">bitte wählen</option><option value="display">Ausstellungsmodell</option><option value="careful-handling">vorsichtige Handhabung</option><option value="play-goal">Spielmodell (Ziel, nicht geprüft)</option>
          </select>
          <Err f="intendedUse" />
        </label>
      </div>
      <fieldset id="req-keyFeatureIds" tabIndex={-1} {...errProps('keyFeatureIds')}><legend>Wichtigste wiederzuerkennende Merkmale * (Reihenfolge = Priorität)</legend>
        <Err f="keyFeatureIds" />
        {interp.features.length === 0 && <p className="small muted">Erst Merkmale in der Interpretation anlegen (Abschnitt 2, „Charakteristische Merkmale“).</p>}
        <ol className="dprio">
          {r.keyFeatureIds.filter((id) => interp.features.some((f) => f.id === id)).map((id) => (
            <li key={id}>{interp.features.find((f) => f.id === id)!.description} <button className="linklike" onClick={() => move(id, -1)} aria-label="höher">▲</button><button className="linklike" onClick={() => move(id, 1)} aria-label="niedriger">▼</button><button className="linklike" onClick={() => toggle(id)}>entfernen</button></li>
          ))}
        </ol>
        {interp.features.filter((f) => !r.keyFeatureIds.includes(f.id)).map((f) => <button key={f.id} className="linklike" onClick={() => toggle(f.id)}>+ {f.description}</button>)}
      </fieldset>
      <label className="dfield"><span>Weitere Hinweise</span><textarea rows={2} value={r.notes} onChange={(e) => setDraft({ ...r, notes: e.target.value })} /></label>
      <div className="dbtns">
        <button id="req-save" className="primary" onClick={onSave}>Anforderungen übernehmen</button>
        {dirty && <span className="small muted">Eingaben noch nicht übernommen.</span>}
      </div>
    </section>
  );
}
