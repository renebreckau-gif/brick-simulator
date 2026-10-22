// Umriss aus einem Bildausschnitt messen (Auftrag 05B.1) – reine Funktion auf RGBA-Pixeln, ohne Browser.
//
// Annahme: heller, gleichmäßiger Hintergrund (Papier) und dunkleres Objekt. Der Hintergrund wird aus dem Rand
// des Ausschnitts geschätzt; Objektpunkte weichen in der Farbe deutlich davon ab. Maßlinien und Beschriftungen
// sind dünn bzw. liegen abseits: Je Messlinie zählt nur der zusammenhängende Lauf, der die Mittellinie des
// Rumpfs (aus dessen Bildbereich) enthält. Das Ergebnis ist eine Messung der ZEICHNUNG, keine Objektmessung.

export interface Rgba { data: Uint8ClampedArray; width: number; height: number }
export interface PixelRect { x0: number; y0: number; x1: number; y1: number }

export function backgroundColor(img: Rgba, r: PixelRect): [number, number, number] {
  const samples: [number, number, number][] = [];
  const push = (x: number, y: number) => { const o = (y * img.width + x) * 4; samples.push([img.data[o], img.data[o + 1], img.data[o + 2]]); };
  for (let x = r.x0; x < r.x1; x += 2) { push(x, r.y0); push(x, r.y1 - 1); }
  for (let y = r.y0; y < r.y1; y += 2) { push(r.x0, y); push(r.x1 - 1, y); }
  const med = (k: number) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1];
  return [med(0), med(1), med(2)];
}

export function isObjectPixel(img: Rgba, x: number, y: number, bg: [number, number, number], threshold: number): boolean {
  const o = (y * img.width + x) * 4;
  const d = Math.hypot(img.data[o] - bg[0], img.data[o + 1] - bg[1], img.data[o + 2] - bg[2]);
  return d > threshold;
}

export interface Run { pos: number; lo: number; hi: number }

/**
 * Für jede Messlinie quer zur Längsachse den zusammenhängenden Objektlauf, der die Mittellinie enthält.
 * along = 'y': Längsachse senkrecht im Bild (Messlinien sind Bildzeilen, Lauf in x); along = 'x': umgekehrt.
 * Läufe kürzer als minRun Bildpunkte (Maß- und Mittellinien) gelten als kein Objekt. Mit open > 0 werden
 * vorab Linien bis 2 · open Bildpunkte Stärke entfernt (morphologisches Öffnen), mit span wird jeder Lauf
 * auf diesen Querbereich begrenzt.
 */
export function profileRuns(img: Rgba, r: PixelRect, along: 'x' | 'y', center: number, opts: { threshold?: number; minRun?: number; bg?: [number, number, number]; span?: [number, number]; maxGap?: number; open?: number } = {}): Run[] {
  const bg = opts.bg ?? backgroundColor(img, r);
  const th = opts.threshold ?? 60;
  const minRun = opts.minRun ?? 4;
  // Helle Teilflächen im Objekt (z. B. sandfarbene Steine auf Papier) unterbrechen den Lauf nicht, solange die
  // Lücke höchstens maxGap Bildpunkte breit ist und danach wieder Objekt folgt
  const maxGap = opts.maxGap ?? 0;
  const out: Run[] = [];
  const [p0, p1, q0, q1] = along === 'y' ? [r.y0, r.y1, r.x0, r.x1] : [r.x0, r.x1, r.y0, r.y1];
  const mask = objectMask(img, r, bg, th, opts.open ?? 0);
  const mw = r.x1 - r.x0;
  const obj = (p: number, q: number) => (along === 'y' ? mask[(p - r.y0) * mw + (q - r.x0)] : mask[(q - r.y0) * mw + (p - r.x0)]) === 1;
  const c = Math.round(center);
  // Suchbereich quer zur Längsachse: ± 3 Bildpunkte um die Mittellinie, mit span bis an dessen Grenzen
  // (z. B. Bildbereich des Rumpfs – in der Seitenansicht liegt die flache Spitze nicht auf halber Höhe)
  const reach = opts.span ? Math.max(c - opts.span[0], opts.span[1] - c) : 3;
  const inSpan = (q: number) => q >= q0 && q < q1 && (!opts.span || (q >= opts.span[0] && q <= opts.span[1]));
  for (let p = p0; p < p1; p++) {
    // Startpunkt: Objektpunkt nächst der Mittellinie, der zu einem ausreichend langen Lauf gehört
    for (let d = 0; d <= reach; d++) {
      let found: Run | null = null;
      for (const q of d === 0 ? [c] : [c + d, c - d]) {
        if (!inSpan(q) || !obj(p, q)) continue;
        const extend = (from: number, step: 1 | -1) => {
          let e = from;
          for (let k = from + step, gap = 0; k >= q0 && k < q1; k += step) {
            if (obj(p, k)) { e = k; gap = 0; } else if (++gap > maxGap) break;
          }
          return e;
        };
        const lo = Math.max(extend(q, -1), opts.span?.[0] ?? q0);
        const hi = Math.min(extend(q, 1), opts.span?.[1] ?? q1);
        if (hi - lo + 1 >= minRun) { found = { pos: p, lo, hi: hi + 1 }; break; }
      }
      if (found) { out.push(found); break; }
    }
  }
  return out;
}

/** Objektmaske des Ausschnitts (1 = Objekt); mit radius > 0 morphologisch geöffnet (Erosion, dann Dilatation). */
export function objectMask(img: Rgba, r: PixelRect, bg: [number, number, number], threshold: number, radius = 0): Uint8Array {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  let m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = isObjectPixel(img, r.x0 + x, r.y0 + y, bg, threshold) ? 1 : 0;
  if (radius <= 0) return m;
  // Quadratisches Strukturelement, getrennt in Zeilen und Spalten
  const pass = (src: Uint8Array, horizontal: boolean, erode: boolean) => {
    const dst = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = erode ? 1 : 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          const s = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[yy * w + xx];
          if (erode ? s === 0 : s === 1) { v = erode ? 0 : 1; break; }
        }
        dst[y * w + x] = v;
      }
    return dst;
  };
  m = pass(pass(m, true, true), false, true);
  return pass(pass(m, true, false), false, false);
}
