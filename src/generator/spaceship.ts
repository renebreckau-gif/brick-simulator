// Deterministischer, parametrischer Raumschiff-Generator (kein Sprachmodell, kein Bild-zu-Modell).
//
// Prinzip: Belegungsraster aus Noppenfeldern (20 LDU) und Schichten (8 LDU = 1 Plattenhöhe).
// Jedes Teil wird ausschließlich von oben auf freie Noppen gesetzt; der Generator prüft beim Setzen
// selbst, dass keine Schicht doppelt belegt ist und mindestens eine Noppe darunter trägt. Lagen sind
// gegeneinander versetzt (keine Fuge direkt über einer Fuge). Die eigentliche Prüfung erfolgt danach
// unabhängig durch den Validator – der Generator ersetzt ihn nicht.
//
// Module: Rumpf (Bodenplatten, zwei durchgehende Lagen, zwei Lagen als Cockpit-Turm und Antriebsblock),
// Cockpit (vorn), Heckantrieb (hinten),
// Ausleger (separat vormontierte Baugruppe in der Rumpftaille: Querträger, Verlängerungen, Gondeln) und Details.
// Nur reale Teile aus dem unterstützten Umfang; keine Sondertechniken (kein 6541/2458/59900/30374).
import { partMeta } from '../core/connectivity/partMeta';
import { IDENTITY, rotY90, type Mat3 } from '../core/math';
import { defaultUsage, MODEL_SCHEMA, type Assembly, type CanonicalModel, type PartInstance, type StepDef } from '../core/model/types';
import { PLATE_HEIGHT } from '../core/units';

export const GENERATOR_VERSION = 'spaceship-gen@1.0.0';

export type PaletteId = 'arrakis' | 'stahl' | 'nacht';
export interface Palette {
  id: PaletteId;
  label: string;
  hull: number;
  hullAlt: number;
  canopy: number;
  engine: number;
  detail: number;
}
/** Farben (LDraw-Codes). Teil-Farb-Belege werden nicht hier behauptet, sondern vom Katalog geprüft. */
export const PALETTES: Record<PaletteId, Palette> = {
  arrakis: { id: 'arrakis', label: 'Arrakis (Tan, Dark Tan, Schwarz, Reddish Brown)', hull: 19, hullAlt: 28, canopy: 0, engine: 72, detail: 70 },
  stahl: { id: 'stahl', label: 'Stahl (Light/Dark Bluish Gray, Schwarz, Tan)', hull: 71, hullAlt: 72, canopy: 0, engine: 0, detail: 19 },
  nacht: { id: 'nacht', label: 'Nacht (Dark Bluish Gray, Schwarz, Light Bluish Gray, Dark Tan)', hull: 72, hullAlt: 0, canopy: 71, engine: 0, detail: 28 },
};

export const HULL_LENGTHS = [10, 12, 16, 20] as const;
export const SPANS = [10, 12, 14, 16] as const;
const HULL_WIDTH = 4;
/** Obergrenze der Aufteilungsversuche für den Rumpfverband (begrenzte automatische Korrektur). */
export const HULL_ATTEMPTS = 24;

export interface ShipParams {
  /** Rumpflänge in Noppen. */
  hullLength: number;
  /** Spannweite (Ausleger) in Noppen. */
  span: number;
  /** Gewünschter Teilezahlbereich (inklusive). */
  partMin: number;
  partMax: number;
  palette: PaletteId;
  /** Variantenkennung: steuert Steinaufteilung und Details deterministisch. */
  seed: number;
}

export const VARIANTS: Record<'kompakt' | 'langgestreckt' | 'breit', { label: string; params: ShipParams }> = {
  kompakt: { label: 'Kompakt', params: { hullLength: 10, span: 12, partMin: 100, partMax: 180, palette: 'arrakis', seed: 1 } },
  langgestreckt: { label: 'Langgestreckt', params: { hullLength: 16, span: 12, partMin: 100, partMax: 180, palette: 'arrakis', seed: 2 } },
  breit: { label: 'Breit', params: { hullLength: 12, span: 16, partMin: 100, partMax: 180, palette: 'arrakis', seed: 3 } },
};

export class GeneratorError extends Error {
  constructor(message: string, readonly hints: string[] = []) {
    super(message);
    this.name = 'GeneratorError';
  }
}

export interface ShipPlan {
  /** Gewählter Aufteilungsversuch des Rumpfverbands (0-basiert) von höchstens HULL_ATTEMPTS. */
  hullAttempt: number;
  /** Protokoll der gewählten Versatzstufen (begrenzte, nachvollziehbare Abweichungen von der strengen Regel). */
  relaxations: string[];
  target: number;
  mandatory: number;
  detailCapacity: number;
  achievable: [number, number];
}

export interface ShipResult {
  model: CanonicalModel;
  plan: ShipPlan;
}

// ---------------------------------------------------------------- deterministische Zufallsquelle
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- Belegungsraster
type Top = 'stud' | 'smooth';
interface Placement {
  id: string;
  part: string;
  color: number;
  cx: number;
  cz: number;
  fx: number;
  fz: number;
  /** untere Schicht (0 = Boden) und Höhe in Schichten */
  h: number;
  t: number;
  top: Top;
  assembly: 'main' | 'ausleger';
  step: string;
}

const PART_HEIGHT: Record<string, number> = {}; // in Schichten, aus Teil-Metadaten
function slabs(part: string): number {
  if (!(part in PART_HEIGHT)) {
    const m = partMeta(part);
    if (!m?.size) throw new GeneratorError(`Teil ${part} ohne Metadaten – nicht im unterstützten Umfang`);
    PART_HEIGHT[part] = m.size.height / PLATE_HEIGHT;
  }
  return PART_HEIGHT[part];
}

class Grid {
  private occ = new Map<string, string>();
  private tops = new Map<string, { h: number; top: Top }>();
  readonly placements: Placement[] = [];
  private counter = new Map<string, number>();

  topAt(cx: number, cz: number) {
    return this.tops.get(`${cx},${cz}`) ?? { h: -1, top: 'smooth' as Top };
  }

  /** Setzt ein Teil von oben. Bricht ab bei Überschneidung oder fehlender tragender Noppe. */
  place(p: Omit<Placement, 'id' | 't'> & { prefix: string }): Placement {
    const t = slabs(p.part);
    let supported = p.h === 0;
    for (let x = p.cx; x < p.cx + p.fx; x++)
      for (let z = p.cz; z < p.cz + p.fz; z++) {
        for (let s = p.h; s < p.h + t; s++) if (this.occ.has(`${x},${z},${s}`)) throw new GeneratorError(`Interner Generatorfehler: Feld ${x},${z} Schicht ${s} doppelt belegt (${p.part})`);
        const top = this.topAt(x, z);
        if (top.h > p.h) throw new GeneratorError(`Interner Generatorfehler: ${p.part} würde unter einem vorhandenen Teil liegen`);
        if (top.h === p.h && top.top === 'stud') supported = true;
      }
    if (!supported) throw new GeneratorError(`Interner Generatorfehler: ${p.part} bei ${p.cx},${p.cz} hätte keine tragende Noppe`);
    const n = (this.counter.get(p.prefix) ?? 0) + 1;
    this.counter.set(p.prefix, n);
    const pl: Placement = { ...p, t, id: `${p.prefix}-${String(n).padStart(2, '0')}` };
    delete (pl as { prefix?: string }).prefix;
    for (let x = p.cx; x < p.cx + p.fx; x++)
      for (let z = p.cz; z < p.cz + p.fz; z++) {
        for (let s = p.h; s < p.h + t; s++) this.occ.set(`${x},${z},${s}`, pl.id);
        this.tops.set(`${x},${z}`, { h: p.h + t, top: p.top });
      }
    this.placements.push(pl);
    return pl;
  }
}

// ---------------------------------------------------------------- Aufteilung einer Reihe (Mauerwerksverband)
/** Teilt eine Reihe der Länge len in Stücke; keine Fuge an verbotenen Stellen (Fugen der Lage darunter).
 *  edgeMin: Mindestlänge des ersten/letzten Stücks (offene Innenkanten der Türme: keine 1×1-Ecksteine). */
function partition(len: number, pieces: readonly number[], forbidden: Set<number>, rng: Rng, edgeMin: [number, number] = [1, 1]): number[] {
  // Kürzere Steine bevorzugt (mehr Verbandsfugen, kleinteiligere Oberfläche); Reihenfolge seed-abhängig
  // Schlüssel vorab ziehen: ein Zufallsvergleich in sort() hinge von der Sortierimplementierung der Engine ab
  const order = (): number[] =>
    shuffled(pieces, rng)
      .map((p, i) => ({ p, i, key: p + (rng() - 0.5) * 3 }))
      .sort((x, y) => x.key - y.key || x.i - y.i)
      .map((x) => x.p);
  const memo = new Set<number>();
  const go = (pos: number): number[] | null => {
    if (pos === len) return [];
    if (memo.has(pos)) return null;
    for (const p of order()) {
      const next = pos + p;
      if (next > len || (next < len && forbidden.has(next))) continue;
      if ((pos === 0 && p < edgeMin[0]) || (next === len && p < edgeMin[1])) continue;
      const rest = go(next);
      if (rest) return [p, ...rest];
    }
    memo.add(pos);
    return null;
  };
  const r = go(0);
  if (!r) throw new GeneratorError(`Interner Generatorfehler: keine versetzte Aufteilung für Länge ${len}`);
  return r;
}
const cuts = (parts: number[]) => {
  const out = new Set<number>();
  let s = 0;
  for (const p of parts.slice(0, -1)) out.add((s += p));
  return out;
};

const BRICK_2W: Record<number, string> = { 2: '3003', 3: '3002', 4: '3001', 6: '2456' };
const BRICK_1W: Record<number, string> = { 1: '3005', 2: '3004', 4: '3010', 6: '3009' };
const BASE_PLATES: Record<number, number[]> = { 10: [10], 12: [6, 6], 16: [10, 6], 20: [10, 10] };
const PLATE_4W: Record<number, string> = { 6: '3032', 10: '3030' };

function validateParams(p: ShipParams) {
  const errs: string[] = [];
  if (!(HULL_LENGTHS as readonly number[]).includes(p.hullLength)) errs.push(`Rumpflänge ${p.hullLength} nicht baubar: Die Bodenplatten (4×6, 4×10) ergeben nur ${HULL_LENGTHS.join(', ')} Noppen.`);
  if (!(SPANS as readonly number[]).includes(p.span)) errs.push(`Spannweite ${p.span} nicht baubar: Querträger 4×10 plus Verlängerungen 2×6 ergeben nur ${SPANS.join(', ')} Noppen.`);
  if (!PALETTES[p.palette]) errs.push(`Unbekannte Farbpalette „${p.palette}“.`);
  if (!Number.isInteger(p.seed) || p.seed < 0) errs.push('Variantenkennung muss eine nicht negative ganze Zahl sein.');
  if (!(Number.isInteger(p.partMin) && Number.isInteger(p.partMax)) || p.partMin < 1 || p.partMax < p.partMin) errs.push('Teilezahlbereich ungültig (ganze Zahlen, Minimum ≤ Maximum).');
  if (errs.length) throw new GeneratorError(errs.join(' '), ['Erlaubte Rumpflängen: ' + HULL_LENGTHS.join(', '), 'Erlaubte Spannweiten: ' + SPANS.join(', ')]);
}

// ---------------------------------------------------------------- Generator
export function generateSpaceship(params: ShipParams): ShipResult {
  validateParams(params);
  const { hullLength: L, span: S } = params;
  const pal = PALETTES[params.palette];
  const rng = mulberry32(params.seed * 2654435761 + L * 97 + S * 13);
  const g = new Grid();
  const zMin = -HULL_WIDTH / 2; // Rumpf: Felder z −2..1

  // 1) Rumpf: Bodenplatten (4 breit), Länge aus 4×10 / 4×6
  let x = 0;
  const plateSeams = new Set<number>();
  for (const len of BASE_PLATES[L]) {
    g.place({ part: PLATE_4W[len], color: pal.hullAlt, cx: x, cz: zMin, fx: len, fz: 4, h: 0, top: 'stud', assembly: 'main', step: 'Rumpf: Bodenplatten', prefix: 'rumpf-boden' });
    x += len;
    if (x < L) plateSeams.add(x);
  }

  // 2) Rumpf: vier verzahnte Steinlagen (je 3 Schichten). Die Aufteilung wird in bis zu
  //    HULL_ATTEMPTS deterministisch abgeleiteten Versuchen berechnet; gewählt wird der Versuch
  //    mit den wenigsten Lockerungen der Versatzregel (begrenzt, im Plan protokolliert).
  type Row = { z: number; w: 1 | 2 };
  // Taille: Ausleger sitzen auf Lage 2 im Bereich x = m … m+3; Lage 3 und 4 bilden nur den vorderen
  // Cockpit-Turm (x < m) und den hinteren Antriebsblock (x ≥ m+4) – gestufte Silhouette.
  const m = Math.max(3, Math.floor(L / 2) - 2);
  const full: [number, number][] = [[0, L]];
  const towers: [number, number][] = [[0, m], [m + 4, L]];
  const courses: { rows: Row[]; color: number; label: string; sections: [number, number][] }[] = [
    { rows: [{ z: -2, w: 2 }, { z: 0, w: 2 }], color: pal.hull, label: 'Rumpf: Lage 1', sections: full },
    { rows: [{ z: -2, w: 1 }, { z: -1, w: 2 }, { z: 1, w: 1 }], color: pal.hullAlt, label: 'Rumpf: Lage 2', sections: full },
    { rows: [{ z: -2, w: 2 }, { z: 0, w: 2 }], color: pal.hull, label: 'Rumpf: Lage 3 (Türme)', sections: towers },
    { rows: [{ z: -2, w: 1 }, { z: -1, w: 2 }, { z: 1, w: 1 }], color: pal.hullAlt, label: 'Rumpf: Lage 4 (Türme)', sections: towers },
  ];
  type HullLayout = { rows: { course: number; row: Row; start: number; parts: number[] }[]; relaxations: string[]; score: number };
  const layoutHull = (hr: Rng): HullLayout => {
    let cutsBelow = new Map<number, Set<number>>();
    for (let z = -2; z < 2; z++) cutsBelow.set(z, new Set(plateSeams));
    const out: HullLayout = { rows: [], relaxations: [], score: 0 };
    courses.forEach((course, ci) => {
      const cutsHere = new Map<number, Set<number>>();
      for (const [a, b] of course.sections) for (const row of course.rows) {
        // Versatzregel in Stufen:
        //  1. keine Fuge über irgendeiner Fuge darunter und nicht neben der Nachbarreihe
        //  2. keine Fuge über irgendeiner Fuge darunter
        //  3. keine Fuge über einer Fuge, die in allen überdeckten Reihen liegt (echte durchgehende Fuge)
        // Fugen absolut (x); für die Aufteilung relativ zum Abschnittsbeginn a
        const rel = (c: Set<number>) => new Set([...c].filter((x) => x > a && x < b).map((x) => x - a));
        const below = Array.from({ length: row.w }, (_, k) => rel(cutsBelow.get(row.z + k)!));
        const union = new Set(below.flatMap((c) => [...c]));
        const inter = new Set([...below[0]].filter((c) => below.every((bb) => bb.has(c))));
        const neighbor = rel(cutsHere.get(row.z - 1) ?? new Set<number>());
        const pieces = row.w === 2 ? [2, 3, 4, 6] : [1, 2, 4, 6];
        const levels: [string, Set<number>, number][] = [
          ['streng', new Set([...union, ...neighbor]), 0],
          ['ohne Nachbarversatz', union, 1],
          ['nur durchgehende Fugen vermieden', inter, 10],
        ];
        let parts: number[] | null = null;
        for (const [name, forbidden, cost] of levels) {
          try {
            parts = partition(b - a, pieces, forbidden, hr, [a > 0 ? 2 : 1, b < L ? 2 : 1]);
            if (cost) {
              out.relaxations.push(`${course.label}, Reihe z=${row.z}: Versatz „${name}“`);
              out.score += cost;
            }
            break;
          } catch {
            /* nächste Stufe */
          }
        }
        if (!parts) throw new GeneratorError(`Interner Generatorfehler: ${course.label}, Reihe z=${row.z}: keine versetzte Aufteilung`);
        out.rows.push({ course: ci, row, start: a, parts });
        const c = new Set([...cuts(parts)].map((x) => x + a));
        for (let z = row.z; z < row.z + row.w; z++) {
          const prev = cutsHere.get(z) ?? new Set<number>();
          cutsHere.set(z, new Set([...prev, ...c, a, b].filter((x) => x > 0 && x < L)));
        }
      }
      cutsBelow = cutsHere;
    });
    return out;
  };
  let best: HullLayout | null = null;
  let hullAttempt = 0;
  for (let a = 0; a < HULL_ATTEMPTS; a++) {
    let lay: HullLayout;
    try {
      lay = layoutHull(mulberry32(params.seed * 7919 + a * 104729 + L));
    } catch {
      continue; // Versuch ohne gültige Aufteilung verworfen
    }
    if (!best || lay.score < best.score) {
      best = lay;
      hullAttempt = a;
    }
    if (best.score === 0) break;
  }
  if (!best) throw new GeneratorError(`Interner Generatorfehler: in ${HULL_ATTEMPTS} Versuchen keine versetzte Rumpfaufteilung`, ['Andere Variantenkennung (Seed) wählen']);
  const relaxations = best.relaxations;
  for (const { course, row, start, parts } of best.rows) {
    let px = start;
    for (const len of parts) {
      g.place({ part: (row.w === 2 ? BRICK_2W : BRICK_1W)[len], color: courses[course].color, cx: px, cz: row.z, fx: len, fz: row.w, h: 1 + course * 3, top: 'stud', assembly: 'main', step: courses[course].label, prefix: `rumpf-l${course + 1}` });
      px += len;
    }
  }
  const waistTop = 1 + 2 * 3; // Oberkante Lage 2 = 7 Schichten
  const h = 1 + courses.length * 3;
  const hullTop = h; // Oberkante der Türme = 13 Schichten (Bodenplatte + 4 Steinlagen)

  // 3) Cockpit vorn: Kanzel 2×3 (Fensterfarbe), seitliche Rahmen, Fliesen als Verglasung
  g.place({ part: '3002', color: pal.canopy, cx: 0, cz: -1, fx: 3, fz: 2, h: hullTop, top: 'stud', assembly: 'main', step: 'Cockpit: Kanzel', prefix: 'cockpit' });
  for (const z of [-2, 1]) {
    g.place({ part: '3023', color: pal.detail, cx: 0, cz: z, fx: 2, fz: 1, h: hullTop, top: 'stud', assembly: 'main', step: 'Cockpit: Kanzel', prefix: 'cockpit' });
    g.place({ part: '3024', color: pal.detail, cx: 2, cz: z, fx: 1, fz: 1, h: hullTop, top: 'stud', assembly: 'main', step: 'Cockpit: Kanzel', prefix: 'cockpit' });
  }
  for (let cx = 0; cx < 3; cx++) g.place({ part: '3069b', color: pal.canopy, cx, cz: -1, fx: 1, fz: 2, h: hullTop + 3, top: 'smooth', assembly: 'main', step: 'Cockpit: Verglasung', prefix: 'cockpit' });

  // 4) Heckantrieb: zwei Triebwerksblöcke 2×2 nebeneinander. Düsenplatten 1×2 je Block, darüber
  //    Fliesen; die mittlere 1×2-Fliese überbrückt beide Blöcke (keine durchgehende Fuge).
  for (const z of [-2, 0]) g.place({ part: '3003', color: pal.engine, cx: L - 2, cz: z, fx: 2, fz: 2, h: hullTop, top: 'stud', assembly: 'main', step: 'Heckantrieb: Triebwerke', prefix: 'antrieb' });
  for (let dx = 0; dx < 2; dx++) {
    for (const z of [-2, 0]) g.place({ part: '3023', color: pal.canopy, cx: L - 2 + dx, cz: z, fx: 1, fz: 2, h: hullTop + 3, top: 'stud', assembly: 'main', step: 'Heckantrieb: Düsen', prefix: 'antrieb' });
    g.place({ part: '3070b', color: pal.detail, cx: L - 2 + dx, cz: -2, fx: 1, fz: 1, h: hullTop + 4, top: 'smooth', assembly: 'main', step: 'Heckantrieb: Düsen', prefix: 'antrieb' });
    g.place({ part: '3069b', color: pal.detail, cx: L - 2 + dx, cz: -1, fx: 1, fz: 2, h: hullTop + 4, top: 'smooth', assembly: 'main', step: 'Heckantrieb: Düsen', prefix: 'antrieb' });
    g.place({ part: '3070b', color: pal.detail, cx: L - 2 + dx, cz: 1, fx: 1, fz: 1, h: hullTop + 4, top: 'smooth', assembly: 'main', step: 'Heckantrieb: Düsen', prefix: 'antrieb' });
  }

  // 5) Ausleger (separat vormontiert): Querträger 4×10 quer über dem Rumpf, Verlängerungen, Gondeln
  const e = (S - 10) / 2;
  g.place({ part: '3030', color: pal.hullAlt, cx: m, cz: -5, fx: 4, fz: 10, h: waistTop, top: 'stud', assembly: 'ausleger', step: 'Ausleger: Querträger', prefix: 'ausleger' });
  const tipLeft = -5 - e;
  const tipRight = 4 + e - 1; // linke Zelle der rechten 2er-Gondel
  let podBase = waistTop + 1;
  if (e > 0) {
    g.place({ part: '2456', color: pal.hull, cx: m + 1, cz: tipLeft, fx: 2, fz: 6, h: waistTop + 1, top: 'stud', assembly: 'ausleger', step: 'Ausleger: Verlängerungen', prefix: 'ausleger' });
    g.place({ part: '2456', color: pal.hull, cx: m + 1, cz: 4 + e - 5, fx: 2, fz: 6, h: waistTop + 1, top: 'stud', assembly: 'ausleger', step: 'Ausleger: Verlängerungen', prefix: 'ausleger' });
    podBase = waistTop + 4;
  }
  for (const cz of [tipLeft, tipRight]) {
    g.place({ part: '3003', color: pal.engine, cx: m + 1, cz, fx: 2, fz: 2, h: podBase, top: 'stud', assembly: 'ausleger', step: 'Ausleger: Gondeln', prefix: 'ausleger' });
    for (let dx = 0; dx < 2; dx++) g.place({ part: '3069b', color: pal.canopy, cx: m + 1 + dx, cz, fx: 1, fz: 2, h: podBase + 3, top: 'smooth', assembly: 'ausleger', step: 'Ausleger: Gondeln', prefix: 'ausleger' });
  }

  const mandatory = g.placements.length;

  // 6) Details als Plattenverband auf freien Noppenflächen (Rumpfoberseite, Querträger).
  //    Lage 1: 1×2-Platten quer (z), Lage 2: 1×2-Platten längs (x) und versetzt, Lage 3: Fliesen.
  //    Jedes Detailteil liegt vollständig auf der Lage darunter; Einzelstücke (1×1) nur in Plattenlagen.
  //    Die Teile werden lagenweise über alle Flächen geordnet; jedes Präfix dieser Liste ist baubar,
  //    so lässt sich die Teilezahl exakt einstellen.
  type Unit = { part: string; cx: number; cz: number; fx: number; fz: number; layer: number; base: number; asm: 'main' | 'ausleger'; color: number; top: Top };
  const regions: { cells: [number, number][]; asm: 'main' | 'ausleger'; base: number; name: string }[] = [];
  const freeCells = (xs: number[], zs: number[], base: number) => xs.flatMap((cx) => zs.map((cz) => [cx, cz] as [number, number])).filter(([cx, cz]) => g.topAt(cx, cz).h === base && g.topAt(cx, cz).top === 'stud');
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
  regions.push({ cells: freeCells(range(3, m), range(-2, 2), hullTop), asm: 'main', base: hullTop, name: 'Rumpfdeck vorn' });
  regions.push({ cells: freeCells(range(m + 4, L - 2), range(-2, 2), hullTop), asm: 'main', base: hullTop, name: 'Rumpfdeck hinten' });
  regions.push({ cells: freeCells(range(m, m + 4), range(-5 - e, 5 + e), waistTop + 1), asm: 'ausleger', base: waistTop + 1, name: 'Querträger' });
  const units: Unit[] = [];
  const startParity = Math.floor(rng() * 2);
  const singleCells = new Set<string>(); // Einzelstücke der Lage 1: darauf kein weiteres Einzelstück
  for (let layer = 1; layer <= 3; layer++) {
    for (const r of regions) {
      if (!r.cells.length) continue;
      const set = new Set(r.cells.map(([x, z]) => `${x},${z}`));
      const alongZ = layer % 2 === 1; // Lage 1 und 3 quer, Lage 2 längs (versetzt)
      const parity = (startParity + layer) % 2;
      const used = new Set<string>();
      const singlesBelow = layer === 2 ? singleCells : new Set<string>();
      const sorted = [...r.cells].sort((a, b) => (alongZ ? a[0] - b[0] || a[1] - b[1] : a[1] - b[1] || a[0] - b[0]));
      for (const [cx, cz] of sorted) {
        const k = `${cx},${cz}`;
        if (used.has(k)) continue;
        const coord = alongZ ? cz : cx;
        const nx = alongZ ? cx : cx + 1;
        const nz = alongZ ? cz + 1 : cz;
        const nk = `${nx},${nz}`;
        const tile = layer === 3;
        if (((coord - (alongZ ? -10 : 0)) % 2 + 2) % 2 === parity && set.has(nk) && !used.has(nk)) {
          used.add(k).add(nk);
          units.push({ part: tile ? '3069b' : '3023', cx, cz, fx: alongZ ? 1 : 2, fz: alongZ ? 2 : 1, layer, base: r.base + layer - 1, asm: r.asm, color: tile ? pal.hull : layer === 1 ? pal.hullAlt : pal.detail, top: tile ? 'smooth' : 'stud' });
        } else if (layer < 3 && !singlesBelow.has(k)) {
          // Einzelstücke nur in Plattenlagen; die Fliesenlage besteht nur aus 1×2-Fliesen, die jeweils
          // zwei Teile darunter überbrücken – so hängt kein mehrteiliger Anbau an einer einzelnen Noppe.
          used.add(k);
          if (layer === 1) singleCells.add(k);
          units.push({ part: tile ? '3070b' : '3024', cx, cz, fx: 1, fz: 1, layer, base: r.base + layer - 1, asm: r.asm, color: tile ? pal.hull : layer === 1 ? pal.hullAlt : pal.detail, top: tile ? 'smooth' : 'stud' });
        }
      }
    }
  }
  const capacity = units.length;
  const achievable: [number, number] = [mandatory, mandatory + capacity];
  if (params.partMin > achievable[1] || params.partMax < achievable[0]) {
    throw new GeneratorError(
      `Teilezahlbereich ${params.partMin}–${params.partMax} mit Rumpflänge ${L} und Spannweite ${S} nicht erfüllbar: möglich sind ${achievable[0]}–${achievable[1]} Teile.`,
      params.partMin > achievable[1] ? ['Rumpflänge oder Spannweite erhöhen (mehr freie Noppen für Details)', 'Teilezahlbereich senken'] : ['Teilezahlbereich anheben', 'Rumpflänge oder Spannweite verringern'],
    );
  }
  const target = Math.min(Math.max(Math.round((params.partMin + params.partMax) / 2), params.partMin, achievable[0]), Math.min(params.partMax, achievable[1]));
  for (const u of units.slice(0, target - mandatory))
    g.place({ part: u.part, color: u.color, cx: u.cx, cz: u.cz, fx: u.fx, fz: u.fz, h: u.base, top: u.top, assembly: u.asm, step: u.asm === 'ausleger' ? `Ausleger: Deckplatten Lage ${u.layer}` : `Details: Rumpfdeck Lage ${u.layer}`, prefix: u.asm === 'ausleger' ? 'ausleger-deck' : 'deck' });
  if (g.placements.length !== target) throw new GeneratorError(`Interner Generatorfehler: ${g.placements.length} statt ${target} Teile`);

  return { model: toModel(params, g.placements, L, S), plan: { hullAttempt, relaxations, target, mandatory, detailCapacity: capacity, achievable } };
}

// ---------------------------------------------------------------- Umwandlung ins kanonische Modell
function orient(part: string, fx: number, fz: number): Mat3 {
  const s = partMeta(part)!.size!;
  if (s.studsX === fx && s.studsZ === fz) return IDENTITY;
  if (s.studsX === fz && s.studsZ === fx) return rotY90(1);
  throw new GeneratorError(`Interner Generatorfehler: ${part} passt nicht auf ${fx}×${fz}`);
}

export function shipModelId(p: ShipParams): string {
  return `ship-L${p.hullLength}-S${p.span}-${p.palette}-n${p.partMin}-${p.partMax}-s${p.seed}`;
}

function toModel(params: ShipParams, placements: Placement[], L: number, S: number): CanonicalModel {
  const instances: PartInstance[] = placements.map((p) => ({
    instanceId: p.id,
    part: p.part,
    color: p.color,
    position: [(p.cx + p.fx / 2) * 20 - L * 10, -PLATE_HEIGHT * (p.h + p.t), (p.cz + p.fz / 2) * 20],
    rotation: orient(p.part, p.fx, p.fz),
    assemblyId: p.assembly,
  }));
  const assemblies: Assembly[] = [
    { assemblyId: 'main', name: 'Raumschiff', parentId: null, builtSeparately: false, separateModule: false, source: GENERATOR_VERSION },
    { assemblyId: 'ausleger', name: 'Ausleger (Vormontage)', parentId: 'main', builtSeparately: true, separateModule: false, source: `${GENERATOR_VERSION}: Querträger mit Verlängerungen und Gondeln, als Einheit von oben aufgesetzt` },
  ];
  // Baufolge aus dem Konstruktionsprozess: Gruppen (Baugruppe, Schrittname) in der Setzreihenfolge,
  // Hauptschritte nach Höhe sortiert (jedes Teil wird von oben gesetzt, nichts liegt schon darüber).
  const groupOrder: string[] = [];
  const groups = new Map<string, { asm: 'main' | 'ausleger'; label: string; ids: string[]; h: number }>();
  for (const p of placements) {
    const k = `${p.assembly}|${p.step}`;
    if (!groups.has(k)) {
      groups.set(k, { asm: p.assembly, label: p.step, ids: [], h: p.h });
      groupOrder.push(k);
    }
    const gr = groups.get(k)!;
    gr.ids.push(p.id);
    gr.h = Math.min(gr.h, p.h);
  }
  const src = (label: string) => `${GENERATOR_VERSION}: erzeugte Baufolge (${label}) – im Bewegungsmodell geprüft, keine Herstelleranleitung, nicht physisch erprobt`;
  const steps: StepDef[] = [];
  for (const k of groupOrder.filter((x) => groups.get(x)!.asm === 'ausleger')) {
    const gr = groups.get(k)!;
    steps.push({ stepId: `ausleger#${steps.length + 1}`, assemblyId: 'ausleger', add: gr.ids, attach: [], source: src(gr.label), notes: [gr.label] });
  }
  const mainGroups = groupOrder.filter((x) => groups.get(x)!.asm === 'main').map((k) => groups.get(k)!);
  const auslegerH = Math.min(...placements.filter((p) => p.assembly === 'ausleger').map((p) => p.h));
  const ordered = [...mainGroups.map((gr) => ({ ...gr, attach: false })), { asm: 'main' as const, label: 'Ausleger aufsetzen', ids: [], h: auslegerH + 0.5, attach: true }]
    .map((gr, i) => ({ ...gr, i }))
    .sort((a, b) => a.h - b.h || a.i - b.i);
  let n = 0;
  for (const gr of ordered) {
    n++;
    const step: StepDef = { stepId: `main#${n}`, assemblyId: 'main', add: gr.ids, attach: gr.attach ? ['ausleger'] : [], source: src(gr.label), notes: [gr.label] };
    if (gr.label === 'Rumpf: Bodenplatten' && gr.ids.length > 1)
      step.support = { kind: 'hand', note: 'Bodenplatten liegen lose nebeneinander, bis Lage 1 sie verbindet – flach auf den Tisch legen und beim Aufsetzen von Lage 1 festhalten', source: GENERATOR_VERSION };
    steps.push(step);
  }

  const id = shipModelId(params);
  const usage = defaultUsage();
  usage.intendedUse = 'display';
  usage.intendedUsers = { minAgeYears: null, source: 'nicht angegeben (Displaymodell)' };
  return {
    schema: MODEL_SCHEMA,
    modelId: id,
    version: 1,
    name: `Raumschiff ${L}×${S} (${PALETTES[params.palette].label.split(' ')[0]}, Seed ${params.seed})`,
    origin: { kind: 'generated', label: `Eigener Entwurf, erzeugt mit ${GENERATOR_VERSION} – kein offizielles LEGO-Modell, keine Referenz` },
    units: 'LDU',
    coordinateSystem: 'ldraw-right-handed-negative-y-up',
    rootAssemblyId: 'main',
    instances,
    assemblies,
    steps,
    stepsSource: 'generated',
    usage,
    changeLog: [],
    generator: { name: 'spaceship', version: GENERATOR_VERSION, params: { ...params } },
  };
}
