// Teilebibliothek: drei bewusst getrennte Beschreibungsebenen je Teil.
//  1. Katalogfamilie – aus LDraw-Kategorie und Titel (Namensgebung der Bibliothek, keine Messung).
//  2. Geometrische Eigenschaften – gemessen: Flächenkennwerte und Hüllquader aus der LDraw-Geometrie,
//     Anschlussrichtungen aus den importierten Anschlussdaten (dreiwertig je Quelle).
//  3. Vermutete Verwendungen – abgeleitet aus 1+2, ausdrücklich als Vermutung gekennzeichnet.
import type { LibraryEntry } from './types';
import type { PartLibraryIndex, Tri } from './library';

export type Family =
  | 'brick' | 'plate' | 'tile' | 'slope' | 'slope_corner' | 'slope_curved' | 'slope_inverted' | 'wedge'
  | 'arch' | 'round' | 'window' | 'panel' | 'bracket' | 'side_studs' | 'corner' | 'hinge_clip' | 'bar'
  | 'technic' | 'minifig' | 'sticker' | 'other';

export const FAMILY_LABEL: Record<Family, string> = {
  brick: 'Stein', plate: 'Platte', tile: 'Fliese (glatt)', slope: 'Schrägstein', slope_corner: 'Eck-Schrägstein',
  slope_curved: 'gewölbte Schräge', slope_inverted: 'inverse Schräge', wedge: 'Keil', arch: 'Bogen',
  round: 'rund / Zylinder / Kegel', window: 'Fenster / Glas / Kanzel', panel: 'Paneel / Wandteil', bracket: 'Winkel (Bracket)',
  side_studs: 'Noppen seitlich (laut Titel)', corner: 'Eckteil', hinge_clip: 'Scharnier / Clip', bar: 'Stange',
  technic: 'Technic', minifig: 'Minifigur', sticker: 'Aufkleber', other: 'sonstige',
};

/** Familien für die allgemeine Suche (Technic-Mechanik, Minifiguren und Aufkleber sind nicht Gegenstand von 05C.1). */
export const SEARCH_FAMILIES: Family[] = ['brick', 'plate', 'tile', 'slope', 'slope_corner', 'slope_curved', 'slope_inverted', 'wedge', 'arch', 'round', 'window', 'panel', 'bracket', 'side_studs', 'corner', 'hinge_clip', 'bar'];

export function families(e: LibraryEntry): Family[] {
  const cat = (e.c ?? '').toLowerCase();
  const t = e.t.replace(/\s+/g, ' ');
  const out = new Set<Family>();
  const has = (re: RegExp) => re.test(t);
  if (cat === 'sticker' || /^sticker/i.test(t)) out.add('sticker');
  if (cat.startsWith('minifig')) out.add('minifig');
  if (cat.startsWith('technic')) out.add('technic');
  if (cat === 'brick') out.add('brick');
  if (cat === 'plate') out.add('plate');
  if (cat === 'tile') out.add('tile');
  if (cat === 'slope' || has(/^Slope/i)) {
    out.add(has(/Inverted/i) ? 'slope_inverted' : 'slope');
    if (has(/Corner|Convex|Concave/i)) out.add('slope_corner');
    if (has(/Curved/i)) out.add('slope_curved');
  }
  if (cat === 'wedge' || has(/\bWedge\b/i)) out.add('wedge');
  if (cat === 'arch' || has(/\bArch\b|Macaroni/i)) out.add('arch');
  if (cat === 'cylinder' || cat === 'cone' || cat === 'dish' || cat === 'dome' || has(/\bRound\b|Cylinder|\bCone\b|\bDish\b|\bDome\b|Quarter Circle|Macaroni/i)) out.add('round');
  if (['window', 'glass', 'windscreen', 'cockpit', 'door'].includes(cat) || has(/Window|Windscreen|Glass|Canopy|Cockpit/i)) out.add('window');
  if (cat === 'panel' || has(/^Panel/i)) out.add('panel');
  if (cat === 'bracket' || has(/^Bracket/i)) out.add('bracket');
  if (has(/with (\d+ )?Studs? on (\d+ )?Sides?|Studs? on Side|Headlight|Erling|SNOT/i)) out.add('side_studs');
  if (has(/\bCorner\b/i)) out.add('corner');
  if (cat === 'hinge' || has(/Hinge|\bClip\b/i)) out.add('hinge_clip');
  if (cat === 'bar' || has(/^Bar\b/i)) out.add('bar');
  if (out.size === 0) out.add('other');
  return [...out];
}

export interface Dimensions {
  /** Körpermaße in Noppenraster (20 LDU) bzw. Plattenhöhen (8 LDU), ohne Noppen. */
  widthStuds: number;
  depthStuds: number;
  heightPlates: number;
  ldu: [number, number, number];
  approx: boolean;
}

export function dimensions(e: LibraryEntry): Dimensions | null {
  if (!e.bb) return null;
  const [x0, y0, z0, x1, y1, z1] = e.bb;
  const r = (v: number, step: number) => Math.round((v / step) * 4) / 4;
  return { widthStuds: r(x1 - x0, 20), depthStuds: r(z1 - z0, 20), heightPlates: r(y1 - y0, 8), ldu: [x1 - x0, y1 - y0, z1 - z0], approx: e.bbx === 0 };
}

export type GeoProp = 'geneigt' | 'eckneigung' | 'gekruemmt' | 'runde_wand' | 'schraege_kante' | 'glatte_oberseite' | 'noppen_seitlich' | 'aufnahme_seitlich' | 'transparent_belegt';

export const GEO_PROP_LABEL: Record<GeoProp, { label: string; basis: string }> = {
  geneigt: { label: 'geneigte Fläche', basis: 'Geometrie: ≥ 8 % der Körperoberfläche eben geneigt' },
  eckneigung: { label: 'Neigung in zwei Richtungen', basis: 'Geometrie: große geneigte Flächen mit ≥ 90° Richtungsunterschied' },
  gekruemmt: { label: 'gekrümmte Fläche', basis: 'Geometrie: ≥ 15 % der Oberfläche in Richtungsfächern' },
  runde_wand: { label: 'runde senkrechte Wand', basis: 'Geometrie: ≥ 15 % der Oberfläche senkrecht gekrümmt' },
  schraege_kante: { label: 'schräge senkrechte Kante', basis: 'Geometrie: ≥ 5 % senkrechte, nicht achsparallele ebene Fläche' },
  glatte_oberseite: { label: 'keine Noppen nach oben', basis: 'Anschlussdaten (je Quelle)' },
  noppen_seitlich: { label: 'Noppen zur Seite', basis: 'Anschlussdaten (je Quelle)' },
  aufnahme_seitlich: { label: 'Noppenaufnahme zur Seite', basis: 'Anschlussdaten (je Quelle)' },
  transparent_belegt: { label: 'in transparenter Farbe belegt', basis: 'Farbbelege (Set-Inventare, nur lokal)' },
};

const yes = (b: boolean): Tri => (b ? 'ja' : 'nein');

export function geoProp(lib: PartLibraryIndex, id: string, p: GeoProp): Tri {
  const e = lib.entry(id);
  if (!e) return 'unbekannt';
  const f = e.f;
  switch (p) {
    case 'geneigt': return f ? yes((f.i ?? 0) >= 0.08) : 'unbekannt';
    case 'eckneigung': {
      if (!f) return 'unbekannt';
      const sd = f.sd ?? [];
      return yes(sd.some((a) => sd.some((b) => { const d = Math.abs(a - b) % 8; return Math.min(d, 8 - d) >= 2; })));
    }
    case 'gekruemmt': return f ? yes((f.cv ?? 0) >= 0.15) : 'unbekannt';
    case 'runde_wand': return f ? yes((f.cvv ?? 0) >= 0.15) : 'unbekannt';
    case 'schraege_kante': return f ? yes((f.ov ?? 0) >= 0.05) : 'unbekannt';
    case 'glatte_oberseite': return lib.connectorFact(id, (s) => s.studsUp === 0).value;
    case 'noppen_seitlich': return lib.connectorFact(id, (s) => s.studsSide > 0).value;
    case 'aufnahme_seitlich': return lib.connectorFact(id, (s) => s.recvSide > 0).value;
    case 'transparent_belegt': return lib.transparentEvidenced(id);
  }
}

/** Vermutete Verwendungen – nur Hinweise für die Suche, keine Prüfaussage. */
export function presumedUses(lib: PartLibraryIndex, id: string): string[] {
  const e = lib.entry(id);
  if (!e) return [];
  const fam = new Set(families(e));
  const out: string[] = [];
  if (fam.has('tile') || geoProp(lib, id, 'glatte_oberseite') === 'ja') out.push('glatter Abschluss / Oberfläche');
  if (fam.has('slope') || fam.has('slope_curved')) out.push('Dach, Bug, Abschrägung');
  if (fam.has('slope_corner') || geoProp(lib, id, 'eckneigung') === 'ja') out.push('Dach- oder Bugecke');
  if (fam.has('slope_inverted')) out.push('Unterseite, Überhang');
  if (fam.has('wedge') || geoProp(lib, id, 'schraege_kante') === 'ja') out.push('Flügel, Spitze, schräge Kontur');
  if (fam.has('arch')) out.push('Durchgang, Bogenfenster, Rundung');
  if (fam.has('round') || geoProp(lib, id, 'runde_wand') === 'ja') out.push('runde Wand, Turm, Säule');
  if (fam.has('window')) out.push('Fensteröffnung, Verglasung');
  if (fam.has('panel')) out.push('dünne Wand, Verkleidung');
  if (fam.has('bracket') || fam.has('side_studs') || geoProp(lib, id, 'noppen_seitlich') === 'ja') out.push('seitlicher Anbau (SNOT)');
  if (fam.has('corner')) out.push('Ecke');
  return out;
}
