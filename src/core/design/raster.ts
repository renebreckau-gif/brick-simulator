// Verdeckung in den orthografischen Ansichten (Auftrag 05B.0.1): Tiefenpuffer je Bildpunkt statt einer
// Sortierung ganzer KÃ¶rper. Eine Sortierung nach KÃ¶rperabstand versagt bei schrÃ¤gen oder Ã¼berlappenden
// KÃ¶rpern (z. B. ein Quader vor der schrÃ¤gen FlÃ¤che eines grÃ¶ÃŸeren Keils). Hier entscheidet je Bildpunkt
// die tatsÃ¤chlich nÃ¤chste FlÃ¤che.
//
// Reines TypeScript ohne WebGL: dieselbe Rasterung zeichnet die Ansichten, beantwortet die Auswahl per
// Klick und ist ohne Browser testbar. MaÃŸstab, Mittelpunkt und Achsabbildung kommen unverÃ¤ndert aus
// sharedFrames()/VIEWS (projection.ts).
import { bodyGeometry, type V3, type ViewDef } from './projection';
import type { SpatialDesign } from './spatial';

export interface RasterFrame {
  view: ViewDef;
  /** Bildpunkte je LÃ¤ngeneinheit (fÃ¼r alle Ansichten gleich). */
  scale: number;
  /** Modellmittelpunkt dieser Ansicht in (u, v); liegt in der Bildmitte. */
  center: [number, number];
  width: number;
  height: number;
}

export interface Raster {
  width: number;
  height: number;
  /** Index des sichtbaren KÃ¶rpers in design.bodies je Bildpunkt (âˆ’1 = Hintergrund). */
  body: Int32Array;
  /** Laufende Nummer der sichtbaren FlÃ¤che (fÃ¼r Kanten), âˆ’1 = Hintergrund. */
  face: Int32Array;
  /** Ausrichtung der sichtbaren FlÃ¤che zur Kamera 0â€¦1 (Schattierung). */
  shade: Float32Array;
  /** Abstand zur Kamera in Objekteinheiten (grÃ¶ÃŸer = nÃ¤her); âˆ’Infinity = Hintergrund. */
  depth: Float32Array;
  bodyIds: string[];
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Bildpunktkoordinaten (x nach rechts, y nach unten) eines Objektpunkts in dieser Ansicht. */
export function toPixel(p: V3, f: RasterFrame): [number, number, number] {
  const u = dot(p, f.view.right);
  const v = dot(p, f.view.up);
  return [f.width / 2 + (u - f.center[0]) * f.scale, f.height / 2 - (v - f.center[1]) * f.scale, dot(p, f.view.toCamera)];
}

/**
 * FlÃ¤chennormale nach Newell Ã¼ber alle Ecken. Robust, wenn Ecken zusammenfallen (spitzer Keil: zwei
 * Ecken jeder SeitenflÃ¤che liegen aufeinander â€“ das Kreuzprodukt der ersten drei Ecken wÃ¤re dann null).
 */
export function faceNormal(vs: V3[], face: number[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let k = 0; k < face.length; k++) {
    const a = vs[face[k]];
    const b = vs[face[(k + 1) % face.length]];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/** Rastert alle KÃ¶rper mit Tiefenpuffer; abgetastet wird jeweils die Bildpunktmitte. */
export function rasterize(d: Pick<SpatialDesign, 'bodies'>, f: RasterFrame): Raster {
  const W = Math.max(1, Math.round(f.width));
  const H = Math.max(1, Math.round(f.height));
  const n = W * H;
  const r: Raster = { width: W, height: H, body: new Int32Array(n).fill(-1), face: new Int32Array(n).fill(-1), shade: new Float32Array(n), depth: new Float32Array(n).fill(-Infinity), bodyIds: d.bodies.map((b) => b.id) };
  let faceNo = 0;
  d.bodies.forEach((b, bi) => {
    const g = bodyGeometry(b);
    const px = g.vertices.map((v) => toPixel(v, f));
    for (const fc of g.faces) {
      const id = faceNo++;
      const nrm = faceNormal(g.vertices, fc);
      const len = Math.hypot(...nrm);
      if (len < 1e-12) continue; // entartete FlÃ¤che ohne Inhalt (z. B. VorderflÃ¤che eines spitzen Keils)
      const facing = dot(nrm, f.view.toCamera) / len;
      if (facing <= 1e-9) continue; // RÃ¼ckseite bzw. genau seitlich: nicht sichtbar (alle KÃ¶rper sind konvex und geschlossen)
      for (let k = 1; k + 1 < fc.length; k++) tri(r, px[fc[0]], px[fc[k]], px[fc[k + 1]], bi, id, facing);
    }
  });
  return r;
}

function tri(r: Raster, p0: number[], p1: number[], p2: number[], bi: number, faceId: number, shade: number) {
  const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
  if (Math.abs(area) < 1e-12) return;
  const x0 = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
  const x1 = Math.min(r.width - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
  const y0 = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
  const y1 = Math.min(r.height - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
  const eps = 1e-9;
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const sx = x + 0.5;
      const w0 = ((p1[0] - sx) * (p2[1] - sy) - (p1[1] - sy) * (p2[0] - sx)) / area;
      const w1 = ((p2[0] - sx) * (p0[1] - sy) - (p2[1] - sy) * (p0[0] - sx)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -eps || w1 < -eps || w2 < -eps) continue;
      // Orthografisch: Tiefe ist im Bild linear, die baryzentrische Interpolation ist exakt
      const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
      const i = y * r.width + x;
      if (z > r.depth[i] + 1e-9) {
        r.depth[i] = z;
        r.body[i] = bi;
        r.face[i] = faceId;
        r.shade[i] = shade;
      }
    }
  }
}

/** Sichtbarer KÃ¶rper an einer Bildpunktposition (fÃ¼r Auswahl per Klick und Tests); null = Hintergrund. */
export function bodyAt(r: Raster, x: number, y: number): string | null {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= r.width || yi >= r.height) return null;
  const b = r.body[yi * r.width + xi];
  return b < 0 ? null : r.bodyIds[b];
}

/** Anteil sichtbarer Bildpunkte je KÃ¶rper (z. B. um zu prÃ¼fen, dass ein KÃ¶rper nicht vollstÃ¤ndig verdeckt ist). */
export function visiblePixels(r: Raster): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < r.body.length; i++) if (r.body[i] >= 0) m.set(r.bodyIds[r.body[i]], (m.get(r.bodyIds[r.body[i]]) ?? 0) + 1);
  return m;
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Farbbild aus dem Raster: KÃ¶rperfarbe nach FlÃ¤chenausrichtung schattiert, Kanten an FlÃ¤chen- und
 * KÃ¶rpergrenzen, ausgewÃ¤hlter KÃ¶rper mit blauem Umriss. Ergebnis als RGBA (fÃ¼r ImageData).
 */
export function shadeRaster(r: Raster, colors: string[], selectedIndex: number, background: [number, number, number] = [246, 248, 250]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  const rgb = colors.map(hex);
  const W = r.width;
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 4;
      const b = r.body[i];
      let c: [number, number, number] = background;
      if (b >= 0) {
        const k = 0.55 + 0.45 * r.shade[i];
        c = [rgb[b][0] * k, rgb[b][1] * k, rgb[b][2] * k];
      }
      // Kanten: Nachbar rechts/unten gehÃ¶rt zu anderer FlÃ¤che bzw. anderem KÃ¶rper
      const fr = x + 1 < W ? r.face[i + 1] : -1;
      const fd = y + 1 < r.height ? r.face[i + W] : -1;
      const br = x + 1 < W ? r.body[i + 1] : -1;
      const bd = y + 1 < r.height ? r.body[i + W] : -1;
      const bl = x > 0 ? r.body[i - 1] : -1;
      const bu = y > 0 ? r.body[i - W] : -1;
      const isSel = b === selectedIndex;
      const selEdge = selectedIndex >= 0 && [br, bd, bl, bu].some((nb) => (nb === selectedIndex) !== isSel);
      if (selEdge) c = [31, 95, 191];
      else if (b !== br || b !== bd) c = [29, 39, 51];
      else if (r.face[i] !== fr || r.face[i] !== fd) c = [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7];
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = 255;
    }
  return out;
}
