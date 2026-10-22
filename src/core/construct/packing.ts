// Belegung einer Lage mit Rechteckteilen (Auftrag 05B.1).
// Zellen sind Noppenfelder (Spalte i quer, Reihe j längs). Gierig: an der ersten freien Zelle das größte Teil,
// das vollständig in freie Zellen passt. Die bevorzugte Ausrichtung wechselt je Lage, damit Fugen
// übereinanderliegender Lagen sich kreuzen (Verband) – ob das Ergebnis zusammenhängt, prüft der Validator.

export interface RectPart {
  part: string;
  /** Ausdehnung in Noppen entlang lokal x (quer) und z (längs) bei unrotiertem Einbau. */
  sx: number;
  sz: number;
}

export interface RectPlacement {
  part: string;
  /** Erste Spalte/Reihe und Ausdehnung im Raster (nach Drehung). */
  i0: number;
  j0: number;
  cols: number;
  rows: number;
  /** true = um 90° um die Hochachse gedreht (lokal x entlang der Reihen). */
  rotated: boolean;
}

/** Plattenauswahl (Raster 1 Plattenhöhe) und Steinauswahl (1 Steinhöhe), größte zuerst. */
export const PLATES: RectPart[] = [
  { part: '3795', sx: 6, sz: 2 }, { part: '3020', sx: 4, sz: 2 }, { part: '3021', sx: 3, sz: 2 }, { part: '3022', sx: 2, sz: 2 },
  { part: '3666', sx: 6, sz: 1 }, { part: '3710', sx: 4, sz: 1 }, { part: '3023', sx: 2, sz: 1 }, { part: '3024', sx: 1, sz: 1 },
];
export const BRICKS: RectPart[] = [
  { part: '2456', sx: 6, sz: 2 }, { part: '3001', sx: 4, sz: 2 }, { part: '3002', sx: 3, sz: 2 }, { part: '3003', sx: 2, sz: 2 },
  { part: '3009', sx: 6, sz: 1 }, { part: '3010', sx: 4, sz: 1 }, { part: '3004', sx: 2, sz: 1 }, { part: '3005', sx: 1, sz: 1 },
];

export const cellKey = (i: number, j: number) => `${i},${j}`;

/** Zellen einer Belegung. */
export function cellsOf(p: { i0: number; j0: number; cols: number; rows: number }): string[] {
  const out: string[] = [];
  for (let i = p.i0; i < p.i0 + p.cols; i++) for (let j = p.j0; j < p.j0 + p.rows; j++) out.push(cellKey(i, j));
  return out;
}

/**
 * Fugenversatz einer Lage: Die ersten rowOffset Reihen bzw. colOffset Spalten werden getrennt belegt. Damit
 * liegen die Fugen dieser Lage um so viele Felder versetzt zu einer Lage ohne Versatz.
 */
export interface Stagger { rowOffset: number; colOffset: number }

/** Versatz je Lagennummer: längs belegte Lagen um eine Spalte, quer belegte um eine Reihe versetzt. */
export function staggerFor(layerIndex: number): { preferAlong: boolean; stagger: Stagger } {
  const along = layerIndex % 2 === 0;
  return { preferAlong: along, stagger: along ? { rowOffset: 0, colOffset: 1 } : { rowOffset: 1, colOffset: 0 } };
}

/**
 * Belegt die Zellmenge vollständig. preferAlong = true bevorzugt Teile mit der langen Seite entlang der Reihen
 * (längs), sonst quer. Mit Versatz werden zuerst die Randstreifen (erste Reihen bzw. Spalten) belegt.
 * Rückgabe in Setzreihenfolge.
 */
/**
 * Bewertung eines Kandidaten (seine Zellen): höhere Zahl = besser, null = unzulässig. Ohne Bewertung entscheidet
 * nur die Größe. Mit Bewertung gewinnt der Kandidat mit der höchsten Zahl, bei Gleichstand der größere.
 */
export type CandidateScore = (cells: string[]) => number | null;

export function packCells(cells: Set<string>, palette: RectPart[], preferAlong: boolean, stagger: Stagger = { rowOffset: 0, colOffset: 0 }, score?: CandidateScore, onPlace?: (p: RectPlacement) => void): RectPlacement[] {
  if (stagger.rowOffset > 0 || stagger.colOffset > 0) {
    const coords = [...cells].map((k) => k.split(',').map(Number));
    const iMin = Math.min(...coords.map((c) => c[0]));
    const jMin = Math.min(...coords.map((c) => c[1]));
    const edge = new Set<string>();
    const rest = new Set<string>();
    for (const k of cells) {
      const [i, j] = k.split(',').map(Number);
      ((stagger.rowOffset > 0 && j < jMin + stagger.rowOffset) || (stagger.colOffset > 0 && i < iMin + stagger.colOffset) ? edge : rest).add(k);
    }
    // Randstreifen quer zu ihrer Richtung belegen: Reihenstreifen quer, Spaltenstreifen längs
    return [...(edge.size ? packCells(edge, palette, stagger.colOffset > 0, undefined, score, onPlace) : []), ...(rest.size ? packCells(rest, palette, preferAlong, undefined, score, onPlace) : [])];
  }
  const free = new Set(cells);
  const coords = [...cells].map((k) => k.split(',').map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: RectPlacement[] = [];
  const fits = (i0: number, j0: number, cols: number, rows: number) => {
    for (let i = i0; i < i0 + cols; i++) for (let j = j0; j < j0 + rows; j++) if (!free.has(cellKey(i, j))) return false;
    return true;
  };
  for (const [i, j] of coords) {
    if (!free.has(cellKey(i, j))) continue;
    // Kandidaten an dieser Ankerzelle: Teil × Ausrichtung, vollständig in freien Zellen
    const cands: { place: RectPlacement; area: number; order: number; s: number }[] = [];
    let order = 0;
    for (const p of [...palette].sort((a, b) => b.sx * b.sz - a.sx * a.sz)) {
      const options: { cols: number; rows: number; rotated: boolean }[] = [
        { cols: p.sx, rows: p.sz, rotated: false },
        { cols: p.sz, rows: p.sx, rotated: true },
      ];
      // längs bevorzugt: lange Seite entlang der Reihen (rows > cols) zuerst
      options.sort((a, b) => (preferAlong ? b.rows - b.cols - (a.rows - a.cols) : a.rows - a.cols - (b.rows - b.cols)));
      for (const o of options) {
        if (o.cols === o.rows && o.rotated) continue;
        if (!fits(i, j, o.cols, o.rows)) continue;
        const place = { part: p.part, i0: i, j0: j, cols: o.cols, rows: o.rows, rotated: o.rotated };
        const s = score ? score(cellsOf(place)) : 0;
        if (s === null) continue;
        cands.push({ place, area: o.cols * o.rows, order: order++, s });
      }
    }
    if (!cands.length) throw new Error(`Zelle ${i},${j} nicht belegbar`);
    cands.sort((a, b) => b.s - a.s || b.area - a.area || a.order - b.order);
    const best = cands[0].place;
    for (const k of cellsOf(best)) free.delete(k);
    out.push(best);
    onPlace?.(best);
  }
  return out;
}
