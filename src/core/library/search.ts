// Teilesuche über die gesamte Bibliothek (05C.1). Filter auf Eigenschaften sind dreiwertig:
// nur „ja“ erfüllt einen Filter; Teile mit „unbekannt“/„widerspruch“ werden gezählt und getrennt ausgewiesen –
// sie sind keine Nicht-Treffer im Sinne von „hat die Eigenschaft nicht“.
import { dimensions, families, geoProp, presumedUses, type Family, type GeoProp } from './classify';
import type { PartLibraryIndex, SupportLevel, Tri } from './library';

export interface SearchQuery {
  text?: string;
  /** Mindestens eine dieser Katalogfamilien (leer = alle). */
  families?: Family[];
  /** Geforderte Eigenschaften (alle müssen „ja“ sein). */
  props?: GeoProp[];
  /** Höchstmaße in Noppen (Breite und Tiefe, unabhängig von der Drehung). */
  maxStuds?: number;
  /** Drucke/Aufkleberteile, Minifiguren, Technic und Aufkleber standardmäßig ausgeblendet. */
  includeExcluded?: boolean;
  limit?: number;
}

export interface SearchHit {
  id: string;
  title: string;
  families: Family[];
  support: SupportLevel;
  props: Partial<Record<GeoProp, Tri>>;
  uses: string[];
  /** Bewertung: Textrelevanz + Prüfbarkeit + Verbreitung (falls Farbbelege geladen). */
  score: number;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  /** Teile, die nur wegen „unbekannt“/„widerspruch“ bei einer geforderten Eigenschaft herausfielen. */
  undecided: { id: string; prop: GeoProp; value: Tri }[];
  scanned: number;
}

const EXCLUDED_FAMILIES: Family[] = ['technic', 'minifig', 'sticker'];
const SUPPORT_RANK: Record<SupportLevel, number> = { 'pruefbar': 3, 'anschluesse-importiert': 2, 'nur-geometrie': 1, 'ohne-geometrie': 0, 'nicht-einzeln': 0 };

export function searchParts(lib: PartLibraryIndex, q: SearchQuery): SearchResult {
  const tokens = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];
  const undecided: SearchResult['undecided'] = [];
  let scanned = 0;
  for (const id of lib.ids()) {
    const e = lib.parts[id];
    if (!q.includeExcluded && !(e.ty === 'part' || e.ty === 'shortcut')) continue;
    scanned++;
    const fam = families(e);
    if (!q.includeExcluded && fam.some((f) => EXCLUDED_FAMILIES.includes(f))) continue;
    if (q.families?.length && !fam.some((f) => q.families!.includes(f))) continue;
    let textScore = 0;
    if (tokens.length) {
      const hay = `${id} ${e.t} ${(e.k ?? []).join(' ')} ${e.c ?? ''}`.toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) continue;
      textScore = tokens.reduce((s, t) => s + (id === t ? 5 : id.startsWith(t) ? 2 : 1), 0);
    }
    if (q.maxStuds != null) {
      const d = dimensions(e);
      if (!d || Math.max(d.widthStuds, d.depthStuds) > q.maxStuds) continue;
    }
    const props: Partial<Record<GeoProp, Tri>> = {};
    let ok = true;
    for (const p of q.props ?? []) {
      const v = geoProp(lib, id, p);
      props[p] = v;
      if (v !== 'ja') {
        ok = false;
        if (v === 'unbekannt' || v === 'widerspruch') undecided.push({ id, prop: p, value: v });
        break;
      }
    }
    if (!ok) continue;
    const support = lib.support(id);
    const recent = lib.colors?.refset[id] ?? 0;
    const score = textScore * 10 + SUPPORT_RANK[support] * 2 + Math.log10(1 + recent);
    hits.push({ id, title: e.t, families: fam, support, props, uses: presumedUses(lib, id), score });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en', { numeric: true }));
  return { hits: hits.slice(0, q.limit ?? 200), total: hits.length, undecided, scanned };
}

/** Die vier Suchaufgaben aus Auftrag 05C.1 als feste, nachvollziehbare Anfragen. */
export const SEARCH_TASKS: { id: string; label: string; query: SearchQuery; note: string }[] = [
  {
    id: 'glatte-geneigte-ecke',
    label: 'glatte, geneigte Ecke',
    query: { props: ['geneigt', 'eckneigung', 'glatte_oberseite'] },
    note: 'Geometrie: Neigung in zwei Richtungen; Anschlussdaten: keine Noppe nach oben.',
  },
  {
    id: 'runde-wand',
    label: 'runde Wand',
    query: { props: ['runde_wand'] },
    note: 'Geometrie: senkrechte gekrümmte Fläche; Anschlüsse egal.',
  },
  {
    id: 'fensteroeffnung',
    label: 'Fensteröffnung',
    query: { families: ['window'] },
    note: 'Katalogfamilie (LDraw-Kategorie/Titel); Glas zusätzlich über Farbbeleg „transparent“, sofern geladen.',
  },
  {
    id: 'seitliche-platte',
    label: 'seitlich angesetzte Platte',
    query: { props: ['noppen_seitlich'], families: ['bracket', 'brick', 'plate', 'side_studs'] },
    note: 'Anschlussdaten: Noppen zur Seite – daran kann eine Platte seitlich angesetzt werden.',
  },
];
