// Teilebibliothek: LDraw-Geometrie eines Teils bei Bedarf nachladen (alle Unterdateien und Primitive),
// danach mit der vorhandenen PartLibrary abflachen. Die Quelle ist austauschbar (Entwicklungsserver: /library-geometry/).
import { PartLibrary, type LdrawFileMap } from '../ldraw/library';
import { normalizeName, parseLdraw } from '../ldraw/parse';

/** Liefert eine LDraw-Referenz samt Fundort (parts oder p); null = nicht vorhanden. */
export type FetchText = (ref: string) => Promise<{ dir: 'parts' | 'p'; text: string } | null>;

export interface LoadedGeometry {
  library: PartLibrary;
  files: number;
  /** Referenzen, die weder unter parts/ noch unter p/ gefunden wurden. */
  missing: string[];
}

/** Lädt ein Teil und alle referenzierten Dateien (Breitensuche, je Ebene parallel). */
export async function loadPartGeometry(id: string, fetchText: FetchText, files: LdrawFileMap = new Map()): Promise<LoadedGeometry> {
  const missing: string[] = [];
  const seen = new Set<string>();
  let level = [normalizeName(`${id}.dat`)];
  while (level.length) {
    const next: string[] = [];
    await Promise.all(level.map(async (key) => {
      if (seen.has(key)) return;
      seen.add(key);
      let text: string | null = files.get(`parts/${key}`) ?? files.get(`p/${key}`) ?? null;
      if (text === null) {
        const got = await fetchText(key);
        if (got) {
          files.set(`${got.dir}/${key}`, got.text);
          text = got.text;
        }
      }
      if (text === null) { missing.push(key); return; }
      for (const line of parseLdraw(text, key).lines) if (line.type === 1) next.push(normalizeName(line.file));
    }));
    level = [...new Set(next)].filter((k) => !seen.has(k));
  }
  return { library: new PartLibrary(files), files: files.size, missing };
}

/** Abruf über den Entwicklungsserver; 404 = nicht vorhanden. */
export function devServerFetch(base = '/library-geometry/'): FetchText {
  return async (ref) => {
    const r = await fetch(`${base}any/${ref}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${ref}: HTTP ${r.status}`);
    const dir = r.headers.get('X-LDraw-Dir') === 'p' ? 'p' : 'parts';
    return { dir, text: await r.text() };
  };
}
