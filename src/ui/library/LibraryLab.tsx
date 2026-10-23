// Bereich „Teilebibliothek“ (Auftrag 05C.1): Suche über die gesamte importierte LDraw-Bibliothek.
// Je Teil getrennt: Katalogidentität · Geometrie · Farbbelege · Anschlüsse je Quelle · Unterstützungsgrad · Beschaffung.
import { useEffect, useMemo, useRef, useState } from 'react';
import { dimensions, families, FAMILY_LABEL, GEO_PROP_LABEL, geoProp, presumedUses, SEARCH_FAMILIES, type Family, type GeoProp } from '../../core/library/classify';
import { CAT_LABEL, coverage, crosscheckWithPartMeta, ldrawSystemRefSet, rebrickableRefSet, type CoverageRow, type LayerCount } from '../../core/library/coverage';
import { devServerFetch, loadPartGeometry } from '../../core/library/geometry';
import { PartLibraryIndex, SUPPORT_LABEL, type Tri } from '../../core/library/library';
import { SEARCH_TASKS, searchParts, type SearchQuery } from '../../core/library/search';
import type { BuildInfo, ConnectorSource, ConnectorsFile, PartsFile, RebrickableColorsFile } from '../../core/library/types';
import { EvidenceFileSchema, type EvidenceFile } from '../../core/procurement/evidence';
import { renderPartImage } from './preview';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(path: string): Promise<T | null> {
  const r = await fetch(BASE + path);
  if (r.status === 404 || (r.headers.get('content-type') ?? '').includes('text/html')) return null;
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

interface Loaded {
  lib: PartLibraryIndex;
  info: BuildInfo | null;
  privateColors: boolean;
  evidence: boolean;
}

function useLibrary(): { data: Loaded | null; error: string | null } {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [parts, ldcad, bricknet, info, colors, ev] = await Promise.all([
        getJson<PartsFile>('library/parts.json'),
        getJson<ConnectorsFile>('library/connectors-ldcad.json'),
        getJson<ConnectorsFile>('library/connectors-bricknet.json'),
        getJson<BuildInfo>('library/build-info.json'),
        getJson<RebrickableColorsFile>('library/private/rebrickable-colors.json').catch(() => null),
        getJson<unknown>('procurement/evidence-05b2.json').catch(() => null),
      ]);
      if (!parts) throw new Error('data/library/parts.json fehlt');
      let evidence: EvidenceFile | null = null;
      const parsed = ev ? EvidenceFileSchema.safeParse(ev) : null;
      if (parsed?.success) evidence = parsed.data;
      if (alive) setData({ lib: new PartLibraryIndex(parts, { ldcad, bricknet }, colors, evidence), info, privateColors: !!colors, evidence: !!evidence });
    })().catch((e) => alive && setError(String(e instanceof Error ? e.message : e)));
    return () => { alive = false; };
  }, []);
  return { data, error };
}

// ---------------------------------------------------------------- Geometrie bei Bedarf
const fetchText = devServerFetch(`${import.meta.env.BASE_URL}library-geometry/`);
const imageCache = new Map<string, string | 'fehlt'>();
/** Gemeinsamer Dateispeicher: Primitive (Noppen, Zylinder …) werden nur einmal geladen. */
const sharedFiles = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

function usePartImage(id: string | null, size: number, azimuth = 35): string | 'fehlt' | null {
  const key = `${id}|${size}|${azimuth}`;
  const [url, setUrl] = useState<string | 'fehlt' | null>(id ? imageCache.get(key) ?? null : null);
  useEffect(() => {
    if (!id) return;
    if (imageCache.has(key)) { setUrl(imageCache.get(key)!); return; }
    let alive = true;
    setUrl(null);
    queue = queue.then(async () => {
      if (!alive) return;
      try {
        const g = await loadPartGeometry(id, fetchText, sharedFiles);
        const img = g.files ? renderPartImage(g.library, id, size, azimuth) : null;
        imageCache.set(key, img ?? 'fehlt');
      } catch {
        imageCache.set(key, 'fehlt');
      }
      if (alive) setUrl(imageCache.get(key)!);
    });
    return () => { alive = false; };
  }, [key, id, size, azimuth]);
  return url;
}

function PartImage({ id, size, azimuth, label }: { id: string; size: number; azimuth?: number; label?: string }) {
  const url = usePartImage(id, size, azimuth);
  if (url === 'fehlt') return <div className="libthumb missing" style={{ width: size, height: size }}>Geometrie nicht lokal verfügbar</div>;
  if (!url) return <div className="libthumb loading" style={{ width: size, height: size }} aria-label="Vorschau wird erzeugt" />;
  return <img className="libthumb" src={url} width={size} height={size} alt={label ?? `Vorschau ${id}`} />;
}

// ---------------------------------------------------------------- Kleine Bausteine
const TRI_LABEL: Record<Tri, string> = { ja: 'ja', nein: 'nein', unbekannt: 'unbekannt', widerspruch: 'widersprüchlich' };
const TriBadge = ({ v }: { v: Tri }) => <span className={`tri tri-${v}`}>{TRI_LABEL[v]}</span>;
const pct = (c: LayerCount) => `${c.n} / ${c.of} (${((100 * c.n) / Math.max(c.of, 1)).toFixed(1)} %)${c.weighted != null ? ` · gewichtet ${(100 * c.weighted).toFixed(1)} %` : ''}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
const PROPS: GeoProp[] = ['geneigt', 'eckneigung', 'gekruemmt', 'runde_wand', 'schraege_kante', 'glatte_oberseite', 'noppen_seitlich', 'aufnahme_seitlich', 'transparent_belegt'];
const SOURCES: { id: ConnectorSource; label: string }[] = [{ id: 'ldcad', label: 'LDCad Shadow Library' }, { id: 'bricknet', label: 'BrickNet v1' }];

// ---------------------------------------------------------------- Hauptkomponente
export function LibraryLab() {
  const { data, error } = useLibrary();
  const [view, setView] = useState<'suche' | 'abdeckung'>('suche');
  const [text, setText] = useState('');
  const [fams, setFams] = useState<Family[]>([]);
  const [props, setProps] = useState<GeoProp[]>([]);
  const [maxStuds, setMaxStuds] = useState<string>('');
  const [task, setTask] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const query: SearchQuery = useMemo(() => ({ text, families: fams, props, maxStuds: maxStuds ? Number(maxStuds) : undefined, limit: 120 }), [text, fams, props, maxStuds]);
  const result = useMemo(() => (data ? searchParts(data.lib, query) : null), [data, query]);

  if (error) return <div className="fatal">Teilebibliothek konnte nicht geladen werden: {error}</div>;
  if (!data || !result) return <div className="loading">Lade Teilebibliothek (Katalogindex und Anschlussdaten, ca. 16 MB) …</div>;
  const lib = data.lib;

  const applyTask = (id: string) => {
    const t = SEARCH_TASKS.find((x) => x.id === id)!;
    setTask(id);
    setText(t.query.text ?? '');
    setFams(t.query.families ?? []);
    setProps(t.query.props ?? []);
    setMaxStuds('');
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="libwrap">
      <header className="libhead">
        <div>
          <h2>Teilebibliothek</h2>
          <p className="muted small">
            LDraw {lib.partsFile.source.release ?? '?'} · {Object.keys(lib.parts).length.toLocaleString('de-DE')} Dateien · Anschlüsse: LDCad {lib.sourceInfo('ldcad')?.commit.slice(0, 7) ?? 'fehlt'}, BrickNet {lib.sourceInfo('bricknet')?.commit.slice(0, 7) ?? 'fehlt'} ·
            Farbbelege {data.privateColors ? 'lokal geladen (privat)' : 'nicht geladen'} · Beschaffungsbelege {data.evidence ? 'geladen (05B.2)' : 'nicht geladen'}
          </p>
        </div>
        <div className="libviews" role="tablist">
          <button role="tab" aria-selected={view === 'suche'} className={view === 'suche' ? 'tab active' : 'tab'} onClick={() => setView('suche')}>Suche</button>
          <button role="tab" aria-selected={view === 'abdeckung'} className={view === 'abdeckung' ? 'tab active' : 'tab'} onClick={() => setView('abdeckung')}>Abdeckung</button>
        </div>
      </header>

      {view === 'abdeckung' ? <CoverageView lib={lib} onPick={(id) => { setSelected(id); setView('suche'); }} /> : (
        <div className="libgrid">
          <section className="libsearch" aria-label="Suche">
            <label className="libfield">Text (Nummer, Titel, Schlüsselwort)
              <input type="search" value={text} onChange={(e) => { setText(e.target.value); setTask(null); }} placeholder="z. B. slope 2 x 2, 3062" />
            </label>
            <fieldset className="libfs">
              <legend>Suchaufgaben (05C.1)</legend>
              {SEARCH_TASKS.map((t) => (
                <button key={t.id} className={task === t.id ? 'chip active' : 'chip'} onClick={() => applyTask(t.id)} title={t.note}>{t.label}</button>
              ))}
              {task && <p className="hint">{SEARCH_TASKS.find((t) => t.id === task)!.note}</p>}
            </fieldset>
            <fieldset className="libfs">
              <legend>Katalogfamilie <span className="muted">(LDraw-Kategorie/Titel)</span></legend>
              {SEARCH_FAMILIES.map((f) => (
                <button key={f} className={fams.includes(f) ? 'chip active' : 'chip'} aria-pressed={fams.includes(f)} onClick={() => { setFams(toggle(fams, f)); setTask(null); }}>{FAMILY_LABEL[f]}</button>
              ))}
            </fieldset>
            <fieldset className="libfs">
              <legend>Eigenschaften <span className="muted">(gemessen bzw. aus Anschlussdaten; nur „ja“ erfüllt)</span></legend>
              {PROPS.map((p) => (
                <label key={p} className="libcheck" title={GEO_PROP_LABEL[p].basis}>
                  <input type="checkbox" checked={props.includes(p)} onChange={() => { setProps(toggle(props, p)); setTask(null); }} disabled={p === 'transparent_belegt' && !data.privateColors} />
                  {GEO_PROP_LABEL[p].label}
                </label>
              ))}
            </fieldset>
            <label className="libfield">Höchstens … Noppen breit/tief
              <input type="number" min={1} max={32} value={maxStuds} onChange={(e) => setMaxStuds(e.target.value)} />
            </label>
          </section>

          <section className="libresults" aria-label="Treffer">
            <p className="small">
              <strong>{result.total.toLocaleString('de-DE')}</strong> Treffer{result.total > result.hits.length ? ` (erste ${result.hits.length})` : ''} aus {result.scanned.toLocaleString('de-DE')} geführten Teilen.
              {result.undecided.length > 0 && <> {result.undecided.length} weitere Teile sind wegen „unbekannt“/„widersprüchlich“ nicht entschieden – das heißt nicht, dass ihnen die Eigenschaft fehlt.</>}
            </p>
            <ul className="liblist">
              {result.hits.map((h) => {
                const d = dimensions(lib.parts[h.id]);
                return (
                  <li key={h.id}>
                    <button className={selected === h.id ? 'libhit active' : 'libhit'} onClick={() => setSelected(h.id)}>
                      <PartImage id={h.id} size={64} />
                      <span className="libhittext">
                        <span><span className="code">{h.id}</span> {h.title}</span>
                        <span className="muted small">
                          {d ? `${fmt(d.widthStuds)} × ${fmt(d.depthStuds)} Noppen, ${fmt(d.heightPlates)} Platten${d.approx ? ' (genähert)' : ''}` : 'Maße unbekannt'} · {h.families.map((f) => FAMILY_LABEL[f]).join(', ')}
                        </span>
                        <span className={`support s-${h.support}`}>{SUPPORT_LABEL[h.support]}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="libdetail" aria-label="Teil">
            {selected ? <PartDetail lib={lib} id={selected} /> : <p className="muted">Teil wählen, um Katalog-, Geometrie-, Farb-, Anschluss- und Beschaffungsangaben getrennt zu sehen.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Teiledetails
function PartDetail({ lib, id }: { lib: PartLibraryIndex; id: string }) {
  const e = lib.entry(id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.parentElement?.scrollTo({ top: 0 });
  }, [id]);
  if (!e) return <p>Unbekannte Nummer {id}.</p>;
  const d = dimensions(e);
  const fam = families(e);
  const colors = lib.colorEvidence(id);
  const offers = lib.procurement(id);
  const pointing = Object.entries(lib.parts).filter(([, x]) => (x.ty === 'moved' || x.ty === 'alias') && x.to === id).map(([k]) => k);
  const prints = Object.entries(lib.parts).filter(([, x]) => x.pr === id).length;
  const same = Object.entries(lib.parts).filter(([, x]) => x.same === id).map(([k]) => k);
  return (
    <div className="libpart" ref={ref}>
      <h3><span className="code">{id}</span> {e.t}</h3>
      <div className="libviews2">
        <PartImage id={id} size={180} azimuth={35} label={`${id} von vorn links`} />
        <PartImage id={id} size={180} azimuth={215} label={`${id} von hinten rechts`} />
      </div>
      <p className="hint">Vorschau aus der LDraw-Geometrie, neutral eingefärbt – sie belegt keine reale Farbe.</p>

      <h4>Katalogidentität</h4>
      <dl className="libdl">
        <dt>LDraw</dt><dd>{id}.dat · Typ {e.ty} · Kategorie {e.c ?? '–'} · Update {e.u ?? '–'} · Lizenz {e.lic ?? '–'}</dd>
        {e.k?.length ? <><dt>Schlüsselwörter</dt><dd>{e.k.join(', ')}</dd></> : null}
        {pointing.length ? <><dt>Alte Nummern / Aliase</dt><dd>{pointing.join(', ')}</dd></> : null}
        {same.length ? <><dt>Geometriegleich (BrickNet)</dt><dd>{same.join(', ')}</dd></> : null}
        <dt>Druckvarianten</dt><dd>{prints ? `${prints} eigene LDraw-Dateien (eigene Geometrie, nicht zusammengelegt)` : 'keine'}</dd>
        <dt>Rebrickable</dt><dd>{colors.state === 'belegt' ? `${colors.rebrickable.join(', ')} – ${colors.mapping.join('; ')}` : colors.state === 'nicht-geladen' ? 'nicht geladen (private Daten fehlen)' : 'keine Zuordnung gefunden'}</dd>
      </dl>

      <h4>Geometrie</h4>
      <dl className="libdl">
        <dt>Maße (Körper)</dt><dd>{d ? `${fmt(d.widthStuds)} × ${fmt(d.depthStuds)} Noppen × ${fmt(d.heightPlates)} Platten (${d.ldu.map(fmt).join(' × ')} LDU)${d.approx ? ' – genähert (schief gedrehte Unterdateien)' : ''}` : 'unbekannt'}</dd>
        <dt>Flächenanteile</dt><dd>{e.f ? `waagrecht ${pc(e.f.h)}, senkrecht ${pc(e.f.va)}, schräg senkrecht ${pc(e.f.ov)}, geneigt ${pc(e.f.i)}, gekrümmt ${pc(e.f.cv)} (davon senkrecht ${pc(e.f.cvv)})` : 'unbekannt'}</dd>
        {e.gm && <><dt>Unvollständig</dt><dd>fehlende Unterdateien: {e.gm.join(', ')}</dd></>}
      </dl>

      <h4>Katalogfamilie</h4>
      <p>{fam.map((f) => FAMILY_LABEL[f]).join(', ')}</p>
      <h4>Geometrische Eigenschaften</h4>
      <table className="libtable">
        <tbody>
          {PROPS.map((p) => {
            const v = geoProp(lib, id, p);
            const by = p === 'glatte_oberseite' || p === 'noppen_seitlich' || p === 'aufnahme_seitlich'
              ? lib.connectorFact(id, p === 'glatte_oberseite' ? (s) => s.studsUp === 0 : p === 'noppen_seitlich' ? (s) => s.studsSide > 0 : (s) => s.recvSide > 0).bySource : null;
            return (
              <tr key={p}>
                <th>{GEO_PROP_LABEL[p].label}</th>
                <td><TriBadge v={v} /></td>
                <td className="muted small">{GEO_PROP_LABEL[p].basis}{by ? ` – ${SOURCES.map((s) => `${s.label}: ${by[s.id] === undefined ? 'keine Daten' : by[s.id] ? 'ja' : 'nein'}`).join(', ')}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h4>Vermutete Verwendungen</h4>
      <p>{presumedUses(lib, id).join(' · ') || '–'} <span className="muted small">(Vermutung aus Familie und Eigenschaften, keine Prüfaussage)</span></p>

      <h4>Farbbelege</h4>
      {colors.state === 'belegt' ? (
        <table className="libtable">
          <thead><tr><th>Farbe (Rebrickable)</th><th>Sets</th><th>ab {lib.colors?.definition.recentFrom}</th><th>Jahre</th><th>Element-ID</th></tr></thead>
          <tbody>
            {colors.colors.sort((a, b) => b.setsRecent - a.setsRecent || b.sets - a.sets).map((c) => (
              <tr key={c.rebrickableColor}>
                <td><span className="swatch" style={{ background: `#${c.rgb}` }} /> {c.name}{c.transparent ? ' (transparent)' : ''} <span className="muted">#{c.rebrickableColor}</span></td>
                <td>{c.sets}</td><td>{c.setsRecent}</td><td>{c.years[0]}–{c.years[1]}</td><td>{c.elementId ? 'ja' : 'unbekannt'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">{colors.state === 'nicht-geladen' ? 'Nicht geladen: Farbbelege stammen aus lokalen Rebrickable-Daten (npm run library:import mit data-raw/rebrickable/). Ohne Beleg gilt keine Farbe als belegt.' : 'Keine Zuordnung zu Rebrickable – keine Farbe belegt.'}</p>}
      <p className="hint">Ein Farbbeleg zeigt, dass die Kombination in einem Set-Inventar vorkam – nicht, dass sie heute erhältlich ist.</p>

      <h4>Anschlüsse</h4>
      {SOURCES.map((s) => {
        const conns = lib.connectors(id, s.id);
        const sum = lib.summary(id, s.id);
        return (
          <details key={s.id} className="libconn">
            <summary>{s.label}: {sum ? `${sum.total} Anschlüsse – Noppen oben ${sum.studsUp}, seitlich ${sum.studsSide}, unten ${sum.studsDown}; Aufnahmen senkrecht ${sum.recvVertical}, seitlich ${sum.recvSide}; Clips/Halter ${sum.clips}; Stangen ${sum.bars}; Technic ${sum.technic}; sonstige ${sum.other}` : 'keine Daten – weder „verbindbar“ noch „unverbindbar“'}</summary>
            {conns && (
              <table className="libtable code">
                <thead><tr><th>Klasse</th><th>Rohform</th><th>Position (LDU)</th><th>Steckachse</th></tr></thead>
                <tbody>{conns.map((c, i) => <tr key={i}><td>{c.cls}</td><td>{c.raw}</td><td>{c.pos.map(fmt).join(', ')}</td><td>{c.axis.map(fmt).join(', ')}</td></tr>)}</tbody>
              </table>
            )}
          </details>
        );
      })}

      <h4>Unterstützungsgrad</h4>
      <p><span className={`support s-${lib.support(id)}`}>{SUPPORT_LABEL[lib.support(id)]}</span></p>

      <h4>Beschaffung</h4>
      {offers.length ? (
        <ul className="small">
          {offers.map((l) => (
            <li key={`${l.ldraw.part}-${l.ldraw.color}`}>
              LDraw-Farbe {l.ldraw.color} ({l.bricklink.colorName}): {l.offers.length ? l.offers.map((o) => `${o.quantityAvailable} Stk. ${o.condition === 'new' ? 'neu' : o.condition} bei ${o.seller.name} (${o.shipsFromRegion}), geprüft ${o.checkedAt.slice(0, 16).replace('T', ' ')} UTC`).join('; ') : 'kein Angebot'}
            </li>
          ))}
        </ul>
      ) : <p className="muted">Kein Beschaffungsbeleg – unbekannt gilt als nicht verfügbar.</p>}
    </div>
  );
}

const pc = (v?: number) => `${Math.round((v ?? 0) * 100)} %`;

// ---------------------------------------------------------------- Abdeckung
function CoverageView({ lib, onPick }: { lib: PartLibraryIndex; onPick: (id: string) => void }) {
  const rows = useMemo<CoverageRow[]>(() => {
    const r = [coverage(lib, ldrawSystemRefSet(lib))];
    const rb = rebrickableRefSet(lib);
    if (rb) r.push(coverage(lib, rb));
    return r;
  }, [lib]);
  const cross = useMemo(() => crosscheckWithPartMeta(lib), [lib]);
  const tasks = useMemo(() => SEARCH_TASKS.map((t) => ({ t, r: searchParts(lib, { ...t.query, limit: 8 }) })), [lib]);
  const layers: [keyof CoverageRow, string][] = [
    ['catalog', 'Katalog (LDraw-Datei zugeordnet)'], ['geometry', 'Geometrie vollständig'], ['ldcad', 'Anschlüsse LDCad'], ['bricknet', 'Anschlüsse BrickNet'],
    ['anyConnectors', 'Anschlüsse aus mindestens einer Quelle'], ['bothConnectors', 'Anschlüsse aus beiden Quellen'], ['bothAgree', 'beide Quellen einig (Noppen oben, Aufnahmen unten)'], ['checkable', 'Verbindungen bereits prüfbar (Prüfkern)'],
  ];
  return (
    <div className="libcov">
      <p className="small">Zählbasis ist je Zeile eine definierte Referenzmenge; Unterteile, Primitive, Drucke, Umbenennungen und Aliase zählen nicht mit. „Gewichtet“ = nach Anzahl der Sets.</p>
      <table className="libtable">
        <thead><tr><th>Ebene</th>{rows.map((r) => <th key={r.refset.id} title={r.refset.definition}>{r.refset.label} ({r.refset.size}{r.refset.unmapped ? ` + ${r.refset.unmapped} ohne LDraw` : ''})</th>)}</tr></thead>
        <tbody>{layers.map(([k, label]) => <tr key={k}><th>{label}</th>{rows.map((r) => <td key={r.refset.id}>{pct(r[k] as LayerCount)}</td>)}</tr>)}</tbody>
      </table>
      {rows.length < 2 && <p className="hint">Die Referenzmenge „in aktuellen Sets verwendete Teile“ braucht die lokalen Rebrickable-Daten und fehlt daher hier.</p>}

      <h4>Abgleich mit den geprüften Teil-Metadaten des Prüfkerns</h4>
      <table className="libtable">
        <thead><tr><th>Teil</th><th>Anschlussart</th><th>Prüfkern</th><th>LDCad</th><th>BrickNet</th></tr></thead>
        <tbody>
          {cross.map((c) => (
            <tr key={`${c.id}-${c.cat}`} className={(c.ldcad && !c.ldcad.match) || (c.bricknet && !c.bricknet.match) ? 'dev' : ''}>
              <td><button className="linkish code" onClick={() => onPick(c.libraryId)}>{c.id}</button>{c.libraryId !== c.id && <span className="muted small"> → {c.libraryId}</span>}</td><td>{CAT_LABEL[c.cat]}</td><td>{c.meta}</td>
              <td>{c.ldcad ? `${c.ldcad.n} ${c.ldcad.match ? '✓' : '≠'}` : 'keine Daten'}</td>
              <td>{c.bricknet ? `${c.bricknet.n} ${c.bricknet.match ? '✓' : '≠'}` : 'keine Daten'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Suchaufgaben</h4>
      {tasks.map(({ t, r }) => (
        <div key={t.id} className="libtask">
          <p><strong>{t.label}</strong>: {r.total} Treffer{r.undecided.length ? `, ${r.undecided.length} unentschieden` : ''} <span className="muted small">– {t.note}</span></p>
          <div className="libtaskrow">{r.hits.map((h) => <button key={h.id} className="libmini" onClick={() => onPick(h.id)} title={h.title}><PartImage id={h.id} size={72} /><span className="code">{h.id}</span></button>)}</div>
        </div>
      ))}
    </div>
  );
}
