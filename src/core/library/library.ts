// Teilebibliothek (Auftrag 05C.1): je Teil getrennt geführte Angaben –
//   Katalogidentität · Geometrie/Maße/Kennwerte · Farbbelege · Anschlüsse (je Quelle) · Unterstützungsgrad · Beschaffungsbelege.
// Eine Geometrie belegt weder eine reale Teil-Farb-Kombination noch Verfügbarkeit. Unbekanntes bleibt „unbekannt“,
// fehlende Anschlussdaten heißen nie „verbindbar“ oder „unverbindbar“.
import type { Vec3 } from '../math';
import type { EvidenceFile, EvidenceLine } from '../procurement/evidence';
import type { ConnectorSource, ConnectorsFile, IdentityReason, LibraryConnector, LibraryEntry, PartsFile, RebrickableColorsFile } from './types';

export const LIBRARY_LOGIC_VERSION = 'library-logic@1.1.0';

/** Aussage des Prüfkerns zu einem Teil (Catalog.part(id).simulation) – dieselbe Quelle, die die Modellprüfung nutzt. */
export type ValidatorSupport = (ldrawId: string) => 'supported' | 'partial' | 'unsupported' | 'none';

export interface LibraryOptions {
  colors?: RebrickableColorsFile | null;
  /** Grund, warum keine Farbbelege vorliegen (z. B. „fehlt“, „beschädigt: …“) – wird angezeigt statt „nicht geladen“. */
  colorsUnavailable?: string;
  evidence?: EvidenceFile | null;
  /** Ohne Prüfkern-Anbindung wird nie „prüfbar“ angezeigt. */
  validator?: ValidatorSupport | null;
}

/** Dreiwertige Aussage plus Widerspruch zwischen Quellen. */
export type Tri = 'ja' | 'nein' | 'unbekannt' | 'widerspruch';

export interface ConnectorSummary {
  /** Noppen nach oben / zur Seite / nach unten */
  studsUp: number;
  studsSide: number;
  studsDown: number;
  /** Noppenaufnahmen mit senkrechter / waagrechter Achse */
  recvVertical: number;
  recvSide: number;
  clips: number;
  bars: number;
  technic: number;
  other: number;
  total: number;
}

export type SupportLevel = 'pruefbar' | 'teilweise-pruefbar' | 'anschluesse-importiert' | 'nur-geometrie' | 'ohne-geometrie' | 'nicht-einzeln';

export const SUPPORT_LABEL: Record<SupportLevel, string> = {
  'pruefbar': 'prüfbar (Prüfkern kennt Körper und Anschlüsse)',
  'teilweise-pruefbar': 'teilweise prüfbar (Prüfkern kennt einzelne Merkmale nicht)',
  'anschluesse-importiert': 'Anschlussdaten importiert – vom Prüfkern noch nicht genutzt',
  'nur-geometrie': 'nur Geometrie – keine Anschlussdaten',
  'ohne-geometrie': 'Geometrie unvollständig',
  'nicht-einzeln': 'nicht einzeln geführt (Druck, Umbenennung, Alias oder Unterteil)',
};

export interface ColorEvidence {
  rebrickableColor: number;
  name: string;
  rgb: string;
  transparent: boolean;
  /** eindeutige Sets (neueste Inventarversion je Set) */
  sets: number;
  setsRecent: number;
  years: [number, number];
  elementId: boolean;
  /** Rebrickable-Teile, aus deren Inventaren der Beleg stammt (Herkunft). */
  sources: string[];
}

export type ColorState =
  | { state: 'nicht-geladen'; reason: string }
  | { state: 'keine-zuordnung'; ambiguous: string[] }
  | { state: 'belegt'; rebrickable: Record<string, IdentityReason[]>; alternatives: string[]; colors: ColorEvidence[] };

const near = (a: number, b: number, tol = 0.15) => Math.abs(a - b) <= tol;

export function summarize(conns: LibraryConnector[]): ConnectorSummary {
  const s: ConnectorSummary = { studsUp: 0, studsSide: 0, studsDown: 0, recvVertical: 0, recvSide: 0, clips: 0, bars: 0, technic: 0, other: 0, total: conns.length };
  for (const c of conns) {
    const vertical = near(Math.abs(c.axis[1]), 1);
    if (c.cls === 'stud') {
      if (vertical && c.axis[1] < 0) s.studsUp++;
      else if (vertical) s.studsDown++;
      else s.studsSide++;
    } else if (c.cls === 'antistud') {
      if (vertical) s.recvVertical++;
      else s.recvSide++;
    } else if (c.cls === 'clip' || c.cls === 'barhole') s.clips++;
    else if (c.cls === 'bar') s.bars++;
    else if (c.cls === 'pin' || c.cls === 'pinhole' || c.cls === 'axle' || c.cls === 'axlehole') s.technic++;
    else s.other++;
  }
  return s;
}

export class PartLibraryIndex {
  readonly parts: Record<string, LibraryEntry>;
  private conn: Partial<Record<ConnectorSource, ConnectorsFile>>;
  private connCache = new Map<string, LibraryConnector[] | null>();
  readonly colors: RebrickableColorsFile | null;
  readonly evidence: EvidenceFile | null;
  private validator: ValidatorSupport | null;
  private colorsUnavailable: string;
  private ambiguousByLdraw = new Map<string, string[]>();

  constructor(readonly partsFile: PartsFile, connectors: Partial<Record<ConnectorSource, ConnectorsFile | null>>, opts: LibraryOptions = {}) {
    this.parts = partsFile.parts;
    this.conn = {};
    for (const [k, v] of Object.entries(connectors)) if (v) this.conn[k as ConnectorSource] = v;
    this.colors = opts.colors ?? null;
    this.evidence = opts.evidence ?? null;
    this.validator = opts.validator ?? null;
    this.colorsUnavailable = opts.colorsUnavailable ?? 'nicht geladen';
    for (const [rb, lds] of Object.entries(this.colors?.ambiguous ?? {})) for (const ld of lds) this.ambiguousByLdraw.set(ld, [...(this.ambiguousByLdraw.get(ld) ?? []), rb]);
  }

  /** Ist der Prüfkern angebunden? Ohne ihn gibt es keine Aussage „prüfbar“. */
  get validatorAvailable(): boolean {
    return !!this.validator;
  }

  /** true nur, wenn der Prüfkern selbst das Teil als unterstützt oder teilweise unterstützt führt. */
  validatorKnows(id: string): boolean {
    const s = this.validator?.(id.toLowerCase());
    return s === 'supported' || s === 'partial';
  }

  ids(): string[] {
    return Object.keys(this.parts);
  }

  entry(id: string): LibraryEntry | undefined {
    return this.parts[id.toLowerCase()];
  }

  /** Folgt Umbenennungen und Aliasen bis zum geführten Teil (höchstens 8 Schritte). */
  canonical(id: string): string {
    let cur = id.toLowerCase();
    for (let i = 0; i < 8; i++) {
      const e = this.parts[cur];
      if (!e || !(e.ty === 'moved' || e.ty === 'alias') || !e.to || e.to === cur) return cur;
      cur = e.to;
    }
    return cur;
  }

  hasSource(src: ConnectorSource): boolean {
    return !!this.conn[src];
  }

  sourceInfo(src: ConnectorSource): ConnectorsFile['source'] & { licence: string } | null {
    const f = this.conn[src];
    return f ? { ...f.source, licence: f.licence } : null;
  }

  /** Anschlüsse einer Quelle; null = Quelle hat für dieses Teil keine Daten (≠ „keine Anschlüsse“). */
  connectors(id: string, src: ConnectorSource): LibraryConnector[] | null {
    const key = `${src}|${id}`;
    if (this.connCache.has(key)) return this.connCache.get(key)!;
    const f = this.conn[src];
    const rows = f?.parts[id.toLowerCase()];
    const out = rows
      ? rows.map((r) => {
          const [cls, raw] = f!.types[r[0]];
          return { cls, raw, pos: [r[1], r[2], r[3]] as Vec3, axis: [r[4], r[5], r[6]] as Vec3 };
        })
      : null;
    this.connCache.set(key, out);
    return out;
  }

  summary(id: string, src: ConnectorSource): ConnectorSummary | null {
    const c = this.connectors(id, src);
    return c ? summarize(c) : null;
  }

  /** Aussage über alle geladenen Anschlussquellen: stimmen sie nicht überein, heißt das Ergebnis „widerspruch“. */
  connectorFact(id: string, test: (s: ConnectorSummary) => boolean): { value: Tri; bySource: Partial<Record<ConnectorSource, boolean>> } {
    const bySource: Partial<Record<ConnectorSource, boolean>> = {};
    for (const src of ['ldcad', 'bricknet'] as ConnectorSource[]) {
      const s = this.summary(id, src);
      if (s) bySource[src] = test(s);
    }
    const vals = Object.values(bySource);
    const value: Tri = vals.length === 0 ? 'unbekannt' : vals.every((v) => v) ? 'ja' : vals.every((v) => !v) ? 'nein' : 'widerspruch';
    return { value, bySource };
  }

  support(id: string): SupportLevel {
    const e = this.entry(id);
    // Aussage des Prüfkerns selbst (dieselbe Auflösung wie bei der Modellprüfung), nicht eine eigene Liste
    const v = this.validator?.(id.toLowerCase());
    if (v === 'supported' && e && e.ty !== 'moved' && e.ty !== 'alias') return 'pruefbar';
    if (v === 'partial' && e && e.ty !== 'moved' && e.ty !== 'alias') return 'teilweise-pruefbar';
    if (!e || !(e.ty === 'part' || e.ty === 'shortcut')) return 'nicht-einzeln';
    if (!e.bb || e.gm) return 'ohne-geometrie';
    if (this.connectors(id, 'ldcad') || this.connectors(id, 'bricknet')) return 'anschluesse-importiert';
    return 'nur-geometrie';
  }

  colorEvidence(id: string): ColorState {
    if (!this.colors) return { state: 'nicht-geladen', reason: this.colorsUnavailable };
    const p = this.colors.parts[id.toLowerCase()];
    if (!p) return { state: 'keine-zuordnung', ambiguous: this.ambiguousByLdraw.get(id.toLowerCase()) ?? [] };
    return {
      state: 'belegt',
      rebrickable: p.rb,
      alternatives: p.alternatives,
      colors: p.colors.map(([col, sets, setsRecent, y0, y1, el, sources]) => {
        const c = this.colors!.colors[String(col)] ?? ['unbekannt', '', false];
        return { rebrickableColor: col, name: c[0], rgb: c[1], transparent: c[2], sets, setsRecent, years: [y0, y1] as [number, number], elementId: el, sources };
      }),
    };
  }

  /** Transparent belegt: mindestens eine Farbe mit Set-Beleg ist transparent. */
  transparentEvidenced(id: string): Tri {
    const c = this.colorEvidence(id);
    if (c.state === 'nicht-geladen') return 'unbekannt';
    if (c.state === 'keine-zuordnung') return 'unbekannt';
    return c.colors.some((x) => x.transparent) ? 'ja' : 'nein';
  }

  procurement(id: string): EvidenceLine[] {
    return this.evidence?.lines.filter((l) => l.ldraw.part.toLowerCase() === id.toLowerCase()) ?? [];
  }
}
