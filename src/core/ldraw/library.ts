// Teilebibliothek: löst LDraw-Referenzen gegen lokal vorhandene Dateien auf und
// flacht Teile zu Dreiecken/Kanten ab. Rein, synchron, ohne Three.js.
import { apply, applyTransform, compose, det, IDENTITY, type Box, type Mat3, type Transform, type Vec3 } from '../math';
import { normalizeName, parseLdraw, type LdFile } from './parse';

export const MAIN_COLOR = 16;
export const EDGE_COLOR = 24;

export interface FlatTriangle {
  color: number; // aufgelöst; MAIN_COLOR bleibt 16, wenn auf Teilebene abgeflacht
  points: [Vec3, Vec3, Vec3];
}
export interface FlatEdge {
  color: number;
  points: [Vec3, Vec3];
}
export interface PrimitiveUse {
  file: string;
  transform: Transform;
}
export interface FlatPart {
  partFile: string;
  triangles: FlatTriangle[];
  edges: FlatEdge[];
  /** Alle Verwendungen von Primitiven aus p/ (z. B. stud.dat, stud4.dat) mit Transformation im Teilsystem. */
  primitives: PrimitiveUse[];
  bbox: Box;
  missing: string[];
}

/** Datei-Quelle: Pfad relativ zu data/ldraw → Text. */
export type LdrawFileMap = Map<string, string>;

export class PartLibrary {
  private parsed = new Map<string, LdFile | null>();
  private flatCache = new Map<string, FlatPart>();

  constructor(private files: LdrawFileMap) {}

  /** Sucht eine Referenz wie "s\\3001s01.dat" in parts/ und p/. */
  resolve(ref: string): { file: LdFile; path: string } | null {
    const key = normalizeName(ref);
    for (const path of [`parts/${key}`, `p/${key}`]) {
      if (this.parsed.has(path)) {
        const f = this.parsed.get(path);
        if (f) return { file: f, path };
        continue;
      }
      const text = this.files.get(path);
      if (text === undefined) {
        this.parsed.set(path, null);
        continue;
      }
      const f = parseLdraw(text, key);
      this.parsed.set(path, f);
      return { file: f, path };
    }
    return null;
  }

  has(ref: string): boolean {
    return this.resolve(ref) !== null;
  }

  header(ref: string): LdFile | null {
    return this.resolve(ref)?.file ?? null;
  }

  /** Flacht ein Teil ab. Farbe 16 bleibt als Platzhalter erhalten (wird pro Instanz ersetzt). */
  flatten(ref: string): FlatPart {
    const key = normalizeName(ref);
    const cached = this.flatCache.get(key);
    if (cached) return cached;
    const out: FlatPart = { partFile: key, triangles: [], edges: [], primitives: [], bbox: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, missing: [] };
    const visit = (name: string, t: Transform, color: number, depth: number) => {
      if (depth > 32) throw new Error(`Zu tiefe Verschachtelung in ${ref}`);
      const r = this.resolve(name);
      if (!r) {
        out.missing.push(name);
        return;
      }
      if (r.path.startsWith('p/')) out.primitives.push({ file: normalizeName(name), transform: t });
      const resolveColor = (c: number) => (c === MAIN_COLOR ? color : c === EDGE_COLOR ? (color === MAIN_COLOR ? EDGE_COLOR : -color - 1) : c);
      for (const line of r.file.lines) {
        if (line.type === 'step') continue;
        if (line.type === 1) {
          visit(line.file, compose(t, { position: line.position, rotation: line.rotation }), resolveColor(line.color), depth + 1);
        } else if (line.type === 3 || line.type === 4) {
          const p = line.points.map((v) => applyTransform(t, v));
          const c = resolveColor(line.color);
          out.triangles.push({ color: c, points: [p[0], p[1], p[2]] });
          if (line.type === 4) out.triangles.push({ color: c, points: [p[0], p[2], p[3]] });
          for (const v of p) for (let i = 0; i < 3; i++) {
            out.bbox.min[i] = Math.min(out.bbox.min[i], v[i]);
            out.bbox.max[i] = Math.max(out.bbox.max[i], v[i]);
          }
        } else if (line.type === 2) {
          const p = line.points.map((v) => applyTransform(t, v));
          out.edges.push({ color: resolveColor(line.color), points: [p[0], p[1]] });
        }
      }
    };
    visit(ref, { position: [0, 0, 0], rotation: IDENTITY }, MAIN_COLOR, 0);
    this.flatCache.set(key, out);
    return out;
  }
}

/** Hilfsfunktion: Position und lokale „Achse“ (−Y des Primitivs) einer Primitive-Verwendung. */
export function primitiveFrame(p: PrimitiveUse): { position: Vec3; axis: Vec3; mirrored: boolean } {
  return { position: p.transform.position, axis: apply(p.transform.rotation, [0, -1, 0]), mirrored: det(p.transform.rotation as Mat3) < 0 };
}
