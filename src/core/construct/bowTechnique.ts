// Bautechnik-Vorlage „spitz zulaufender Bug mit Kanzel“ (Auftrag 05B.1).
//
// Kein festes Modell: Die Vorlage setzt eine Formvorgabe (shapeTarget.ts) mit wenigen, ausdrücklich
// benannten Entscheidungen in reale Teile um. Diese Entscheidungen sind genau die, die später für andere
// Baugruppen verallgemeinert werden müssen:
//   1. Maßstab: Breite in Noppen legt den Maßstab fest; Länge und Höhe folgen proportional.
//   2. Rasterung: Breiten auf gerade Noppenzahlen (symmetrisch), Höhen auf Plattenhöhen bzw. Steinlagen.
//   3. Lagenaufbau von unten nach oben; jede Lage liegt innerhalb der Lage darunter (keine Überhänge ohne Halt).
//   4. Kontur: Variante A mit Keilplattenpaaren (Grundriss), Variante B mit Schrägsteinen (Seitenprofil).
//   5. Verband: Lagen wechseln Ausrichtung bzw. Lagentyp, damit Fugen sich kreuzen.
//   6. Jedes Teil sitzt auf Noppen der Lage darunter; ob das stimmt, prüft der unabhängige Validator.
import { partMeta } from '../connectivity/partMeta';
import { apply, rotY90, IDENTITY, type Mat3, type Vec3 } from '../math';
import { defaultUsage, MODEL_SCHEMA, type Assembly, type CanonicalModel, type DesignProvenance, type PartInstance, type StepDef } from '../model/types';
import { cyrb53, stableStringify } from '../model/hash';
import { cellKey, packCells, BRICKS, PLATES, type CandidateScore, type RectPart, type RectPlacement } from './packing';
import { checkBowTarget, TargetError, type BowTarget } from './shapeTarget';

export const BOW_TECHNIQUE_VERSION = 'bow-technique@1.0.0';

export type BowVariant = 'keilplatten' | 'schraegsteine';
export const BOW_VARIANT_LABEL: Record<BowVariant, string> = {
  keilplatten: 'Variante A – Platten mit Keilplattenkontur',
  schraegsteine: 'Variante B – Steinlagen mit Schrägsteinprofil',
};

export interface BowColors { hull: number; accent: number; canopy: number }
export const DEFAULT_BOW_COLORS: BowColors = { hull: 72, accent: 330, canopy: 40 };

export interface BowOptions { variant: BowVariant; widthStuds: number; colors?: Partial<BowColors> }

export interface RowReport { row: number; targetWidth: number; builtWidth: number; targetTop: number; builtTop: number }

export interface BowPlan {
  variant: BowVariant;
  widthStuds: number;
  rows: number;
  scale: number;
  layers: { name: string; kind: string; parts: number }[];
  rowsReport: RowReport[];
  decisions: string[];
  deviations: string[];
}

const PLATE = 8;
const BRICK = 24;
const HEIGHT: Record<string, number> = Object.fromEntries([...PLATES.map((p) => [p.part, PLATE]), ...BRICKS.map((p) => [p.part, BRICK]), ['3298', BRICK], ['4286', BRICK], ['3039', BRICK], ['41769a', PLATE], ['41770a', PLATE], ['43722a', PLATE], ['43723a', PLATE]]);

/** Formvorgabe auf eine Breite skalieren (Länge und Höhe proportional, lineare Interpolation je Reihe). */
export function scaleTarget(t: BowTarget, widthStuds: number): { target: BowTarget; factor: number } {
  const f = widthStuds / Math.max(...t.width);
  const rows = Math.max(4, Math.round(t.rows * f));
  const sample = (arr: number[], j: number) => {
    const x = ((j + 0.5) / rows) * t.rows - 0.5;
    const a = Math.max(0, Math.min(t.rows - 1, Math.floor(x)));
    const b = Math.min(t.rows - 1, a + 1);
    const w = Math.max(0, Math.min(1, x - a));
    return arr[a] * (1 - w) + arr[b] * w;
  };
  const width = Array.from({ length: rows }, (_, j) => sample(t.width, j) * f);
  const top = Array.from({ length: rows }, (_, j) => sample(t.top, j) * f);
  const canopy = t.canopy && { fromRow: Math.round(t.canopy.fromRow * f), toRow: Math.min(rows - 1, Math.round(t.canopy.toRow * f)), width: t.canopy.width * f, height: t.canopy.height * f };
  return { target: { ...t, rows, width, top, canopy, studsPerL: t.studsPerL === null ? null : t.studsPerL * f }, factor: f };
}

interface Placed { part: string; color: number; position: Vec3; rotation: Mat3; layer: string }

/**
 * Bauzustand mit Verbandsbewertung: Union-Find über alle gesetzten Teile, verbunden über Noppen der darunter
 * liegenden Lage. Noppen- und Aufnahmezellen kommen aus den Teil-Metadaten (keine Annahme je Teiltyp) – eine
 * Keilplatte trägt also nur auf ihrer vollen Reihe, ein Schrägstein nur auf seiner flachen Reihe.
 */
/** Lexikografischer Vergleich der Bewertungen (kleiner = besser). */
const lexLess = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

class Stack {
  placed: Placed[] = [];
  private studsAt = new Map<number, Map<string, number>>();
  /** Zelle → Teil je Oberkante (alle Grundrisszellen, für den Fugenvergleich). */
  private cellsAt = new Map<number, Map<string, number>>();
  private parent: number[] = [];
  constructor(private readonly W: number) {}
  clone(): Stack {
    const c = new Stack(this.W);
    c.placed = [...this.placed];
    c.parent = [...this.parent];
    for (const [k, m] of this.studsAt) c.studsAt.set(k, new Map(m));
    for (const [k, m] of this.cellsAt) c.cellsAt.set(k, new Map(m));
    return c;
  }
  private cell(x: number, z: number) {
    return cellKey(Math.round((x + this.W * 10) / 20 - 0.5), Math.round(-z / 20 - 0.5));
  }
  private cellsOfKind(p: Placed, kinds: string[]): string[] {
    const meta = partMeta(p.part);
    if (!meta) throw new Error(`Teil ${p.part} ohne Metadaten`);
    return [...new Set(meta.connectors.filter((c) => kinds.includes(c.kind)).map((c) => { const w = apply(p.rotation, c.position); return this.cell(w[0] + p.position[0], w[2] + p.position[2]); }))];
  }
  find(x: number): number {
    while (this.parent[x] !== x) x = this.parent[x] = this.parent[this.parent[x]];
    return x;
  }
  /** Anzahl getrennter Gruppen (über Noppen verbundene Teile). */
  components(): number {
    return new Set(this.parent.map((_, i) => this.find(i))).size;
  }
  /** Teile, deren Noppen auf Höhe `level` unter den Zellen liegen. */
  below(level: number, cells: string[]): number[] {
    const m = this.studsAt.get(level);
    return m ? [...new Set(cells.map((c) => m.get(c)).filter((x): x is number => x !== undefined))] : [];
  }
  /** Bewertung für die Belegung einer Lage, deren Unterkante auf `level` liegt: Anzahl verbundener Gruppen. */
  score(level: number): CandidateScore {
    return (cells) => {
      if (level === 0) return 1;
      const b = this.below(level, cells);
      return b.length ? new Set(b.map((x) => this.find(x))).size : null;
    };
  }
  add(p: Placed, bottomLevel: number, topLevel: number): number {
    const idx = this.placed.length;
    this.placed.push(p);
    this.parent.push(idx);
    for (const q of this.below(bottomLevel, this.cellsOfKind(p, ['antistud', 'tube']))) this.parent[this.find(q)] = this.find(idx);
    const m = this.studsAt.get(topLevel) ?? this.studsAt.set(topLevel, new Map()).get(topLevel)!;
    for (const c of this.cellsOfKind(p, ['stud'])) m.set(c, idx);
    const cm = this.cellsAt.get(topLevel) ?? this.cellsAt.set(topLevel, new Map()).get(topLevel)!;
    for (const c of this.cellsOfKind(p, ['antistud', 'stud'])) cm.set(c, idx);
    return idx;
  }
  /** Zelle → Teil für alle Teile mit Oberkante `level` (Grundriss aus Noppen und Aufnahmen). */
  topCells(level: number): Map<string, number> {
    return new Map(this.cellsAt.get(level) ?? []);
  }
  /** Fugen, die in dieser Lage (Oberkante top) genau über Fugen der Lage darunter (Oberkante bottom) liegen. */
  alignedSeams(bottom: number, top: number): number {
    const a = this.cellsAt.get(top);
    const b = this.cellsAt.get(bottom);
    if (!a || !b) return 0;
    let n = 0;
    for (const [k, pa] of a) {
      const [i, j] = k.split(',').map(Number);
      for (const nk of [cellKey(i + 1, j), cellKey(i, j + 1)]) {
        const qa = a.get(nk);
        if (qa === undefined || qa === pa) continue;
        const pb = b.get(k);
        const qb = b.get(nk);
        if (pb !== undefined && qb !== undefined && pb !== qb) n++;
      }
    }
    return n;
  }
  /**
   * Rechteckteile einer Lage belegen. Mehrere Strategien (Ausrichtung, Reihen-/Spaltenversatz, Brücken an
   * Breitensprüngen) werden auf einer Kopie erprobt; gewählt wird die mit den wenigsten getrennten Gruppen,
   * dann den wenigsten übereinanderliegenden Fugen, dann den wenigsten Teilen. Mit `lookahead` zählt zuerst, wie
   * viele getrennte Gruppen nach Aufbau der nächsten Lage auf dieser Belegung bleiben (für die Grundplatte, deren
   * Fugen erst die Lage darüber verbindet). Ob das Ergebnis trägt, entscheidet danach unabhängig der Validator.
   */
  packLayer(cells: Set<string>, palette: RectPart[], layerIndex: number, bottomLevel: number, color: number, layer: string, lookahead?: (trial: Stack) => number, score?: CandidateScore): number {
    if (!cells.size) return 0;
    const height = Math.max(...palette.map((p) => HEIGHT[p.part])) / PLATE;
    let best: { stack: Stack; key: number[]; n: number } | null = null;
    for (const preferAlong of [layerIndex % 2 === 0, layerIndex % 2 !== 0])
      for (const rowOffset of [0, 1])
        for (const colOffset of [0, 1])
          // unterste Lage: immer Brücken – dort sind noch alle Teile getrennt, die Bewertung sieht den Nutzen erst in der Lage darüber
          for (const bridges of bottomLevel === 0 ? [true] : [layerIndex % 2 === 1, layerIndex % 2 !== 1])
            // eine übergebene Bewertung ist eine zusätzliche Strategie, kein Ersatz für die gewöhnliche
            for (const sc of score ? [undefined, score] : [undefined]) {
              const trial = this.clone();
              let n: number;
              try {
                n = trial.fillLayer(new Set(cells), palette, preferAlong, { rowOffset, colOffset }, bridges, bottomLevel, color, layer, sc);
              } catch {
                continue;
              }
              const key = [lookahead ? lookahead(trial.clone()) : 0, trial.components(), trial.alignedSeams(bottomLevel, bottomLevel + height), n];
              if (!best || lexLess(key, best.key)) best = { stack: trial, key, n };
            }
    if (!best) throw new Error(`${layer}: keine Belegung gefunden`);
    this.placed = best.stack.placed;
    this.parent = best.stack.parent;
    this.studsAt = best.stack.studsAt;
    this.cellsAt = best.stack.cellsAt;
    return best.n;
  }
  /** Eine Belegungsstrategie ausführen (Brücken an Breitensprüngen, dann gierig mit Verbandsbewertung). */
  private fillLayer(cells: Set<string>, palette: RectPart[], preferAlong: boolean, stagger: { rowOffset: number; colOffset: number }, bridges: boolean, bottomLevel: number, color: number, layer: string, score?: CandidateScore): number {
    let n = 0;
    if (bridges) {
      const colsAt = new Map<number, number[]>();
      for (const k of cells) {
        const [i, j] = k.split(',').map(Number);
        (colsAt.get(j) ?? colsAt.set(j, []).get(j)!).push(i);
      }
      for (const bRow of [...colsAt.keys()].sort((x, y) => x - y)) {
        const prev = colsAt.get(bRow - 1);
        const cur = colsAt.get(bRow)!.sort((x, y) => x - y);
        if (!prev || cur.length >= prev.length || !cur.every((c) => prev.includes(c))) continue;
        if (cur[cur.length - 1] - cur[0] + 1 !== cur.length) continue;
        let i = cur[0];
        while (i <= cur[cur.length - 1]) {
          const rest = cur[cur.length - 1] - i + 1;
          const part = [...palette].filter((pp) => pp.sz === 2 && pp.sx <= rest).sort((x, y) => y.sx - x.sx)[0];
          if (!part) break;
          const pl: RectPlacement = { part: part.part, i0: i, j0: bRow - 1, cols: part.sx, rows: 2, rotated: false };
          const pc: string[] = [];
          for (let a = pl.i0; a < pl.i0 + pl.cols; a++) for (let r = pl.j0; r < pl.j0 + 2; r++) pc.push(cellKey(a, r));
          if (!pc.every((c) => cells.has(c)) || (bottomLevel > 0 && this.score(bottomLevel)(pc) === null)) break;
          for (const c of pc) cells.delete(c);
          this.add(rectInstance(pl, this.W, bottomLevel, color, layer), bottomLevel, bottomLevel + HEIGHT[pl.part] / PLATE);
          n++;
          i += part.sx;
        }
      }
    }
    if (!cells.size) return n;
    packCells(cells, palette, preferAlong, stagger, score ?? this.score(bottomLevel), (pl) => {
      this.add(rectInstance(pl, this.W, bottomLevel, color, layer), bottomLevel, bottomLevel + HEIGHT[pl.part] / PLATE);
      n++;
    });
    return n;
  }
}

/** Rechteckteil aus der Belegung in Weltkoordinaten (LDraw: x quer, −z = vorn, −y = oben). */
function rectInstance(p: RectPlacement, W: number, level: number, color: number, layer: string): Placed {
  const h = HEIGHT[p.part];
  const cx = (p.i0 + p.cols / 2) * 20 - W * 10;
  const cz = -(p.j0 + p.rows / 2) * 20;
  return { part: p.part, color, position: [cx, -PLATE * level - h, cz], rotation: p.rotated ? rotY90(1) : IDENTITY, layer };
}

const evenClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, 2 * Math.round(v / 2)));

/** Rumpfbreite und -höhe je Reihe gerastert und zur Spitze hin nicht zunehmend. */
function quantize(t: BowTarget, W: number, deviations: string[]) {
  const Wq: number[] = [];
  const Hq: number[] = [];
  for (let j = 0; j < t.rows; j++) {
    let w = evenClamp(t.width[j], 2, W);
    let h = Math.max(1, Math.round(t.top[j]));
    if (j > 0 && w > Wq[j - 1]) w = Wq[j - 1];
    if (j > 0 && h > Hq[j - 1]) {
      deviations.push(`Reihe ${j}: Vorgabe steigt zur Spitze hin an (${t.top[j].toFixed(1)} Platten) – auf ${Hq[j - 1]} begrenzt (Lagen liegen nur auf Lagen darunter)`);
      h = Hq[j - 1];
    }
    Wq.push(w);
    Hq.push(h);
  }
  return { Wq, Hq };
}

function centeredCells(rows: [number, number], widthAt: (j: number) => number, W: number, into: Set<string>) {
  for (let j = rows[0]; j <= rows[1]; j++) {
    const w = widthAt(j);
    const c0 = (W - w) / 2;
    for (let i = c0; i < c0 + w; i++) into.add(cellKey(i, j));
  }
}

interface BodyResult { layers: BowPlan['layers']; builtTop: number[]; builtWidth: number[] }

/** Variante A: Plattenlagen; jede zweite Lage (und die oberste) mit Keilplattenkontur an der Spitze. */
function buildKeilplatten(stack: Stack, t: BowTarget, W: number, colors: BowColors, decisions: string[], deviations: string[]): BodyResult {
  const N = t.rows;
  const { Hq } = quantize(t, W, deviations);
  const S = (W - 2) / 2; // Segmente, je 2 Noppen schmaler
  let jt = t.width.findIndex((w) => w < W - 0.75);
  if (jt < 0) jt = N;
  const taperRows = N - jt;
  const Ls = taperRows / Math.max(S, 1) >= 3.5 ? 4 : 3;
  const jtq = Math.max(1, N - S * Ls);
  decisions.push(`Spitze aus ${S} Keilplattenpaar(en) ${Ls === 4 ? '4×2 (41769a/41770a)' : '3×2 (43722a/43723a)'}: je Paar 2 Noppen schmaler über ${Ls} Reihen`);
  if (jtq !== jt) deviations.push(`Beginn der Verjüngung: Vorgabe Reihe ${jt}, gebaut ab Reihe ${jtq} (Keilplatten haben feste Länge ${Ls})`);
  const segRows = (s: number): [number, number] => [jtq + s * Ls, jtq + (s + 1) * Ls - 1];
  const L = Hq[0];
  const layers: BowPlan['layers'] = [];
  const builtTop = new Array<number>(N).fill(0);
  const builtWidth = new Array<number>(N).fill(0);
  // Letzte Reihe der Lage l; in der Verjüngung auf Segmentgrenzen gerundet
  const layerEnd = (l: number) => {
    let E = -1;
    for (let j = 0; j < N; j++) if (Hq[j] >= l + 1) E = j;
    if (E >= jtq) {
      const s = Math.floor((E - jtq) / Ls);
      const r = (E - jtq) % Ls;
      E = r >= Ls / 2 - 0.5 ? segRows(s)[1] : s > 0 ? segRows(s - 1)[1] : jtq - 1;
    }
    return E;
  };
  for (let l = 0; l < L; l++) {
    const wedgeLevel = (L - 1 - l) % 2 === 0;
    let E = layerEnd(l);
    if (E < 0) continue;
    const name = `Lage ${l + 1}`;
    const cells = new Set<string>();
    const color = wedgeLevel ? colors.accent : colors.hull;
    centeredCells([0, Math.min(E, jtq - 1)], () => W, W, cells);
    let wedges = 0;
    for (let s = 0; s < S; s++) {
      const [r0, r1] = segRows(s);
      if (r1 > E) break;
      if (wedgeLevel) {
        const center = W - 2 * s - 4;
        if (center > 0) centeredCells([r0, r1], () => center, W, cells);
        const z = -(r0 * 20) - Ls * 10;
        const [left, right] = Ls === 4 ? ['41769a', '41770a'] : ['43722a', '43723a'];
        stack.add({ part: left, color, position: [(s + 1) * 20 - W * 10, -PLATE * l - PLATE, z], rotation: IDENTITY, layer: name }, l, l + 1);
        stack.add({ part: right, color, position: [(W - s - 1) * 20 - W * 10, -PLATE * l - PLATE, z], rotation: IDENTITY, layer: name }, l, l + 1);
        wedges += 2;
      } else centeredCells([r0, r1], () => W - 2 * s - 2, W, cells);
    }
    // Unterste Lage: Reihen vor dem Ende der zweiten Lage haben nichts darüber – längs gedrehte Platten von unter
    // der zweiten Lage bis in die Spitze, sonst lägen die Spitzenplatten nur an (nicht verbunden)
    let tipParts = 0;
    const Enext = l === 0 && L > 1 ? layerEnd(1) : -1;
    if (l === 0 && !wedgeLevel && Enext >= 0 && E > Enext) {
      const tip = tipPlates(stack, cells, Enext, E, W, color, name);
      tipParts = tip.n;
      if (tip.n && tip.lastRow < E) {
        deviations.push(`Spitze: Reihe ${tip.lastRow + 1}–${E} entfällt – dort hielte nur die unterste Lage, und eine Platte reicht nur bis Reihe ${tip.lastRow}`);
        E = tip.lastRow;
      }
    }
    const rects = tipParts + stack.packLayer(cells, PLATES, l, l, color, name);
    layers.push({ name, kind: wedgeLevel ? 'Platten mit Keilplattenkontur' : 'Platten (eingezogen)', parts: rects + wedges });
    for (let j = 0; j <= E; j++) {
      builtTop[j] = l + 1;
      const s = j >= jtq ? Math.floor((j - jtq) / Ls) : -1;
      const w = s < 0 ? W : wedgeLevel ? W - 2 * s - 2 * ((j - segRows(s)[0] + 0.5) / Ls) : W - 2 * s - 2;
      builtWidth[j] = Math.max(builtWidth[j], w);
    }
  }
  decisions.push(`${L} Plattenlagen; Keilplattenlagen wechseln mit eingezogenen Lagen, die die Noppen der vollen Keilplattenreihe überdecken; Belegung je Lage nach Verband (jedes Teil verbindet möglichst getrennte Gruppen)`);
  return { layers, builtTop, builtWidth };
}

/**
 * Platten 2 Reihen tief über die Reihen row und row + 1 legen, soweit beide in `cells` liegen (mittig, größte
 * zuerst); die belegten Zellen werden aus `cells` entfernt. Grundplatte (Unterkante 0).
 */
function bridgeRows(stack: Stack, cells: Set<string>, row: number, W: number, color: number, layer: string): number {
  const cols = (j: number) => [...cells].map((k) => k.split(',').map(Number)).filter(([, r]) => r === j).map(([i]) => i);
  const shared = cols(row).filter((i) => cols(row + 1).includes(i)).sort((a, b) => a - b);
  if (!shared.length || shared[shared.length - 1] - shared[0] + 1 !== shared.length) return 0;
  let n = 0;
  for (let i = shared[0]; i <= shared[shared.length - 1];) {
    const part = PLATES.filter((pp) => pp.sz === 2 && pp.sx <= shared[shared.length - 1] - i + 1).sort((x, y) => y.sx - x.sx)[0];
    if (!part) break;
    const pl: RectPlacement = { part: part.part, i0: i, j0: row, cols: part.sx, rows: 2, rotated: false };
    for (let a = i; a < i + part.sx; a++) for (const r of [row, row + 1]) cells.delete(cellKey(a, r));
    stack.add(rectInstance(pl, W, 0, color, layer), 0, HEIGHT[pl.part] / PLATE);
    n++;
    i += part.sx;
  }
  return n;
}

/**
 * Spitzenreihen vor dem letzten Schrägstein (Reihe from = dessen vorderste Reihe … to): Über ihnen liegt nichts,
 * also müssen längs gedrehte Platten von unter dem Schrägstein bis in die Spitze reichen. Gewählt wird die
 * längste verfügbare Plattenlänge ≤ Spitzenlänge; Reihen dahinter werden aus `cells` entfernt (entfallen).
 */
function tipPlates(stack: Stack, cells: Set<string>, from: number, to: number, W: number, color: number, layer: string): { n: number; lastRow: number } {
  const rowCols = (j: number) => new Set([...cells].map((k) => k.split(',').map(Number)).filter(([, r]) => r === j).map(([i]) => i));
  let shared = [...rowCols(from)];
  for (let j = from + 1; j <= to; j++) { const c = rowCols(j); shared = shared.filter((i) => c.has(i)); }
  shared.sort((a, b) => a - b);
  if (!shared.length) return { n: 0, lastRow: to };
  const span = to - from + 1;
  const lenFor = (sz: number) => Math.max(0, ...PLATES.filter((p) => p.sz === sz && p.sx >= 2 && p.sx <= span).map((p) => p.sx));
  const pairs = Math.floor(shared.length / 2);
  const len = Math.min(pairs ? lenFor(2) : Infinity, shared.length % 2 ? lenFor(1) : Infinity);
  if (!(len >= 2)) return { n: 0, lastRow: to };
  let n = 0;
  for (let k = 0; k < shared.length;) {
    const sz = shared.length - k >= 2 ? 2 : 1;
    const part = PLATES.find((p) => p.sz === sz && p.sx === len)!;
    const pl: RectPlacement = { part: part.part, i0: shared[k], j0: from, cols: sz, rows: len, rotated: true };
    for (let a = pl.i0; a < pl.i0 + sz; a++) for (let r = from; r < from + len; r++) cells.delete(cellKey(a, r));
    stack.add(rectInstance(pl, W, 0, color, layer), 0, HEIGHT[pl.part] / PLATE);
    n++;
    k += sz;
  }
  const lastRow = from + len - 1;
  for (const k of [...cells]) if (Number(k.split(',')[1]) > lastRow) cells.delete(k);
  return { n, lastRow };
}

/** Variante B: Grundplatte und Steinlagen; jede Steinlage endet vorn mit 33°-Schrägsteinen (3×2 bzw. 3×1). */
function buildSchraegsteine(stack: Stack, t: BowTarget, W: number, colors: BowColors, decisions: string[], deviations: string[]): BodyResult {
  const N = t.rows;
  const { Wq, Hq } = quantize(t, W, deviations);
  const layers: BowPlan['layers'] = [];
  const builtTop = new Array<number>(N).fill(0);
  const builtWidth = new Array<number>(N).fill(0);
  const E0 = N - 1;
  // Ende der ersten Steinlage (wie in der Schleife unten: Vorgabe mindestens Unterkante + 2 Platten)
  let E1 = -1;
  for (let j = 0; j < N; j++) if (Hq[j] >= 3) E1 = j;
  // Grundplatte nur, wo die erste Steinlage sie überdeckt (Steine bzw. Schrägsteine) – sonst blieben Plattenstücke
  // ohne Halt; vor der Spitze höchstens so breit wie die Schrägsteine
  const base = new Set<string>();
  const sw1 = E1 >= 2 ? Math.min(Wq[E1 - 2], Wq[E1 - 1], Wq[E1]) : W;
  const baseWidth = (j: number) => (E1 < 2 || j <= E1 - 3 ? Wq[j] : j <= E1 ? sw1 : Math.min(sw1, Wq[j]));
  centeredCells([0, E0], baseWidth, W, base);
  const fullBase = new Set(base);
  // Brücken in der Grundplatte: Schrägsteinbereich der ersten Lage ↔ Steinbereich und ↔ Spitzenreihen. Darüber
  // liegt dort eine Fuge der ersten Lage, die sonst durch beide Lagen ginge (Spitze nur angelehnt, nicht verbunden).
  let bridges = 0;
  let lastRow = E0;
  if (E1 >= 3) bridges += bridgeRows(stack, base, E1 - 3, W, colors.hull, 'Lage 1');
  if (E1 >= 2 && E1 < E0) {
    const tip = tipPlates(stack, base, E1, E0, W, colors.hull, 'Lage 1');
    bridges += tip.n;
    lastRow = tip.lastRow;
    if (lastRow < E0) deviations.push(`Spitze: Reihe ${lastRow + 1}–${E0} entfällt – vor dem letzten Schrägstein hält dort nur die Grundplatte, und eine Platte reicht nur bis Reihe ${lastRow}`);
  }
  // Steinlage k (Unterkante bottom) bis Reihe E: vorn Schrägsteine, dahinter Steine nach Verband
  const course = (stk: Stack, k: number, bottom: number, E: number) => {
    const name = `Lage ${k + 2}`;
    const sw = Math.min(Wq[E - 2], Wq[E - 1], Wq[E]);
    const c0 = (W - sw) / 2;
    const zRear = -(E - 2 + 0.5) * 20;
    let slopes = 0;
    for (let i = c0; i + 1 < c0 + sw; i += 2) { stk.add({ part: '3298', color: colors.accent, position: [(i + 1) * 20 - W * 10, -PLATE * bottom - BRICK, zRear], rotation: IDENTITY, layer: name }, bottom, bottom + 3); slopes++; }
    if (sw % 2 === 1) { stk.add({ part: '4286', color: colors.accent, position: [(c0 + sw - 0.5) * 20 - W * 10, -PLATE * bottom - BRICK, zRear], rotation: IDENTITY, layer: name }, bottom, bottom + 3); slopes++; }
    const cells = new Set<string>();
    if (E - 3 >= 0) centeredCells([0, E - 3], (j) => Wq[j], W, cells);
    return { name, parts: slopes + stk.packLayer(cells, BRICKS, k + 1, bottom, colors.hull, name) };
  };
  // Grundplatte mit Vorschau: gewählt wird die Belegung, auf der die erste Steinlage die wenigsten getrennten Gruppen
  // lässt. Dazu bevorzugt jede Platte, die viele Teile einer probeweise gelegten ersten Steinlage überdeckt – sie
  // überbrückt deren Fugen (Probe auf Einzelplatten 1×1, die jede Belegung tragen).
  let lookahead: ((trial: Stack) => number) | undefined;
  let baseScore: CandidateScore | undefined;
  if (E1 >= 2) {
    lookahead = (trial: Stack) => { course(trial, 0, 1, E1); return trial.components(); };
    try {
      const probe = new Stack(W);
      for (const k of fullBase) { const [i, j] = k.split(',').map(Number); probe.add(rectInstance({ part: '3024', i0: i, j0: j, cols: 1, rows: 1, rotated: false }, W, 0, colors.hull, 'Probe'), 0, 1); }
      course(probe, 0, 1, E1);
      const above = probe.topCells(4);
      baseScore = (cs) => new Set(cs.map((c) => above.get(c)).filter((x) => x !== undefined)).size;
    } catch {
      baseScore = undefined;
    }
  }
  layers.push({ name: 'Lage 1', kind: 'Grundplatten', parts: bridges + stack.packLayer(base, PLATES, 0, 0, colors.hull, 'Lage 1', lookahead, baseScore) });
  for (let j = 0; j < N; j++) { builtTop[j] = j <= lastRow ? 1 : 0; builtWidth[j] = j <= lastRow ? baseWidth(j) : 0; }
  const C = Math.max(1, Math.round((Hq[0] - 1) / 3));
  decisions.push(`Grundplatte und ${C} Steinlage(n); jede Steinlage endet vorn mit 33°-Schrägsteinen, die nächste beginnt auf deren Noppenreihe (Neigung fest: 1 Steinhöhe je 2 Reihen); Belegung je Lage nach Verband`);
  let prevE = E0;
  for (let k = 0; k < C; k++) {
    const bottom = 1 + 3 * k;
    let E = -1;
    for (let j = 0; j < N; j++) if (Hq[j] >= bottom + 2) E = j;
    const limit = k === 0 ? E0 : prevE - 2;
    if (E > limit) { if (k > 0) deviations.push(`Steinlage ${k + 1}: Vorgabe reicht bis Reihe ${E}, Schrägsteine erlauben höchstens Reihe ${limit}`); E = limit; }
    if (E < 2) { deviations.push(`Steinlage ${k + 1} entfällt (zu kurz für einen Schrägstein)`); break; }
    const c = course(stack, k, bottom, E);
    layers.push({ name: c.name, kind: 'Steine, vorn 33°-Schrägsteine', parts: c.parts });
    for (let j = 0; j <= E; j++) builtTop[j] = j >= E - 2 ? bottom + 3 * (j === E - 2 ? 1 : j === E - 1 ? 0.6 : 0.2) : bottom + 3;
    prevE = E;
  }
  return { layers, builtTop, builtWidth };
}

/** Kanzel: Steinlagen mit 45°-Schrägsteinen (2×2) als Frontscheibe; jede Lage beginnt eine Reihe weiter hinten. */
function buildCanopy(stack: Stack, t: BowTarget, W: number, builtTop: number[], colors: BowColors, decisions: string[], deviations: string[], baseLevelOf: (j: number) => number): BowPlan['layers'] {
  const layers: BowPlan['layers'] = [];
  if (!t.canopy) return layers;
  let c = t.canopy;
  // Hinterkante der Kanzel auf die erste Reihe mit ebener Rumpfoberkante (Noppen) legen
  let from = c.fromRow;
  while (from <= c.toRow && baseLevelOf(from) < 0) from++;
  if (from > c.toRow) { deviations.push(`Kanzel entfällt: Rumpfoberkante in Reihe ${c.fromRow}–${c.toRow} ist nirgends eben (nur Schrägflächen)`); return layers; }
  if (from > c.fromRow) { deviations.push(`Kanzel hinten gekürzt: Vorgabe ab Reihe ${c.fromRow}, ebene Rumpfoberkante erst ab Reihe ${from}`); c = { ...c, fromRow: from }; }
  const base = baseLevelOf(c.fromRow);
  let to = c.fromRow;
  while (to + 1 <= c.toRow && baseLevelOf(to + 1) === base) to++;
  if (to < c.toRow) deviations.push(`Kanzel vorn gekürzt: Vorgabe bis Reihe ${c.toRow}, Rumpfoberkante ist nur bis Reihe ${to} eben`);
  if (to - c.fromRow < 1) { deviations.push('Kanzel entfällt (ebene Auflage kürzer als 2 Reihen)'); return layers; }
  const cw = evenClamp(c.width, 2, W - 2);
  const courses = Math.max(1, Math.round(c.height / 3));
  decisions.push(`Kanzel: ${courses} Steinlage(n), ${cw} Noppen breit, Frontscheibe aus 45°-Schrägsteinen 2×2 (3039) in getöntem Transparent (Farbe ${colors.canopy}, Teil-Farb-Beleg fehlt)`);
  const c0 = (W - cw) / 2;
  for (let k = 0; k < courses; k++) {
    const F = to - k;
    if (F - 1 < c.fromRow) { deviations.push(`Kanzellage ${k + 1} entfällt (zu kurz)`); break; }
    const level = base + 3 * k;
    const name = `Kanzel ${k + 1}`;
    let slopes = 0;
    for (let i = c0; i < c0 + cw; i += 2) { stack.add({ part: '3039', color: colors.canopy, position: [(i + 1) * 20 - W * 10, -PLATE * level - BRICK, -(F - 1 + 0.5) * 20], rotation: IDENTITY, layer: name }, level, level + 3); slopes++; }
    const cells = new Set<string>();
    if (F - 2 >= c.fromRow) for (let j = c.fromRow; j <= F - 2; j++) for (let i = c0; i < c0 + cw; i++) cells.add(cellKey(i, j));
    const bricks = stack.packLayer(cells, BRICKS, k + 1, level, colors.hull, name);
    layers.push({ name, kind: 'Steine, vorn 45°-Schrägsteine (Scheibe)', parts: bricks + slopes });
    for (let j = c.fromRow; j <= F; j++) builtTop[j] = Math.max(builtTop[j], level + 3);
  }
  return layers;
}

/**
 * Baut Bug und Kanzel aus einer Formvorgabe. Ergebnis ist ein gewöhnliches kanonisches Modell aus realen
 * Teilinstanzen (Validator, Baufolge, Anleitung und Stückliste unverändert anwendbar).
 */
export function buildBow(target: BowTarget, o: BowOptions): { model: CanonicalModel; plan: BowPlan } {
  const errs = checkBowTarget(target);
  if (errs.length) throw new TargetError(`Formvorgabe unvollständig: ${errs.join('; ')}`);
  if (!(o.widthStuds >= 4 && o.widthStuds <= 16 && o.widthStuds % 2 === 0)) throw new TargetError('Breite muss eine gerade Noppenzahl zwischen 4 und 16 sein');
  const colors = { ...DEFAULT_BOW_COLORS, ...o.colors };
  const { target: t, factor } = scaleTarget(target, o.widthStuds);
  const W = o.widthStuds;
  const decisions = [`Maßstab: größte Vorgabebreite ${Math.max(...target.width).toFixed(2)} → ${W} Noppen (Faktor ${factor.toFixed(3)}); Länge ${t.rows} Reihen, Höhen proportional`];
  const deviations: string[] = [];
  const stack = new Stack(W);
  const body = o.variant === 'keilplatten' ? buildKeilplatten(stack, t, W, colors, decisions, deviations) : buildSchraegsteine(stack, t, W, colors, decisions, deviations);
  // Kanzel auf der ebenen Oberkante des Rumpfs (Lagenhöhe der Rumpfoberkante je Reihe)
  const hullTop = [...body.builtTop];
  const baseLevelOf = (j: number) => (o.variant === 'keilplatten' ? hullTop[j] : Math.abs(hullTop[j] - Math.round(hullTop[j])) < 1e-9 ? hullTop[j] : -1);
  const canopyLayers = buildCanopy(stack, t, W, body.builtTop, colors, decisions, deviations, baseLevelOf);
  const placed = stack.placed;
  const layers = [...body.layers, ...canopyLayers];

  const rowsReport: RowReport[] = t.width.map((w, j) => ({ row: j, targetWidth: Number(w.toFixed(2)), builtWidth: Number(body.builtWidth[j].toFixed(2)), targetTop: Number((t.top[j] + (t.canopy && j >= t.canopy.fromRow && j <= t.canopy.toRow ? t.canopy.height : 0)).toFixed(2)), builtTop: Number(body.builtTop[j].toFixed(2)) }));
  for (const r of rowsReport) {
    if (Math.abs(r.builtWidth - r.targetWidth) > 1) deviations.push(`Reihe ${r.row}: Breite gebaut ${r.builtWidth.toFixed(1)}, Vorgabe ${r.targetWidth.toFixed(1)} Noppen`);
    if (Math.abs(r.builtTop - r.targetTop) > 2) deviations.push(`Reihe ${r.row}: Oberkante gebaut ${r.builtTop.toFixed(1)}, Vorgabe ${r.targetTop.toFixed(1)} Plattenhöhen`);
  }

  const instances: PartInstance[] = placed.map((p, k) => ({ instanceId: `${p.layer.replace(/\s+/g, '-').toLowerCase()}-${String(k + 1).padStart(3, '0')}`, part: p.part, color: p.color, position: p.position, rotation: p.rotation, assemblyId: p.layer.startsWith('Kanzel') ? 'kanzel' : 'rumpf' }));
  const assemblies: Assembly[] = [
    { assemblyId: 'bug', name: 'Bug und Kanzel', parentId: null, builtSeparately: false, separateModule: false, source: BOW_TECHNIQUE_VERSION },
    { assemblyId: 'rumpf', name: 'Bugrumpf', parentId: 'bug', builtSeparately: false, separateModule: false, source: BOW_TECHNIQUE_VERSION },
    { assemblyId: 'kanzel', name: 'Kanzel', parentId: 'bug', builtSeparately: false, separateModule: false, source: BOW_TECHNIQUE_VERSION },
  ];
  const steps: StepDef[] = [];
  const src = `${BOW_TECHNIQUE_VERSION}: erzeugte Baufolge (Lage für Lage von unten) – im Bewegungsmodell geprüft, keine Herstelleranleitung, nicht physisch erprobt`;
  for (const ly of layers) {
    const ids = instances.filter((_i, k) => placed[k].layer === ly.name).map((i) => i.instanceId);
    if (!ids.length) continue;
    const step: StepDef = { stepId: `bug#${steps.length + 1}`, assemblyId: ly.name.startsWith('Kanzel') ? 'kanzel' : 'rumpf', add: ids, attach: [], source: src, notes: [`${ly.name}: ${ly.kind}`] };
    if (steps.length === 0 && ids.length > 1) step.support = { kind: 'hand', note: 'Die Teile der untersten Lage liegen lose nebeneinander, bis die nächste Lage sie verbindet – flach hinlegen und beim Aufsetzen festhalten', source: BOW_TECHNIQUE_VERSION };
    steps.push(step);
  }
  const usage = defaultUsage();
  usage.intendedUse = 'display';
  usage.intendedUsers = { minAgeYears: null, source: 'nicht angegeben (Konstruktionsnachweis)' };
  const design: DesignProvenance = {
    schema: 'baustein-sim/design-provenance@1',
    sources: target.origin.kind === 'template-measurement'
      ? [{ sourceId: 'vorlage', kind: 'concept-image', label: target.origin.description, mediaType: 'image/png', sha256: target.origin.imageSha256, rights: 'Vorlage des Nutzers (lokal, nicht im Modell gespeichert)' }]
      : [{ sourceId: 'testform', kind: 'parameters', label: target.origin.description, rights: 'eigene synthetische Testdaten' }],
    interpretation: { method: `Formvorgabe ${target.label}`, version: target.schema, notes: target.sources.map((s) => `${s.field}: ${s.source} (${s.method})`).join(' · ') },
    assumptions: [...decisions.map((d, k) => ({ id: `E${k + 1}`, statement: d, basis: 'Bautechnik-Vorlage' })), ...target.notes.map((n, k) => ({ id: `V${k + 1}`, statement: n, basis: 'Ableitung der Formvorgabe' }))],
    deviations: deviations.map((d, k) => ({ id: `A${k + 1}`, description: d, reason: 'Rasterung bzw. feste Teilgeometrie' })),
    visualComparison: { method: 'noch nicht abgeglichen', version: '0', status: 'unchecked' },
  };
  const id = `bug-${o.variant}-${W}-${cyrb53(stableStringify(target)).slice(0, 8)}`;
  const model: CanonicalModel = {
    schema: MODEL_SCHEMA, modelId: id, version: 1,
    name: `Bug & Kanzel – ${BOW_VARIANT_LABEL[o.variant]}, ${W} Noppen breit`,
    origin: { kind: 'generated', label: `Konstruktionsnachweis aus der Formvorgabe „${target.label}“ mit ${BOW_TECHNIQUE_VERSION} – eigener Entwurf, kein offizielles LEGO-Modell` },
    units: 'LDU', coordinateSystem: 'ldraw-right-handed-negative-y-up', rootAssemblyId: 'bug',
    instances, assemblies, steps, stepsSource: 'generated', usage, changeLog: [],
    generator: { name: 'bow-technique', version: BOW_TECHNIQUE_VERSION, params: { variant: o.variant, widthStuds: W, target: target.label, targetHash: cyrb53(stableStringify(target)) } },
    design,
  };
  return { model, plan: { variant: o.variant, widthStuds: W, rows: t.rows, scale: factor, layers, rowsReport, decisions, deviations } };
}
