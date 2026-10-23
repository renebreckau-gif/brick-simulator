// Variante C (Auftrag 05B.2): hohler Bug mit zugänglichem Cockpit und abnehmbarer Kanzel.
//
// Bautechnik, kein festes Modell. Aus Formvorgabe (Breite, Ober- und Unterkante, Kanzellage) und
// Funktionsanforderungen (Cockpitöffnung, Hohl- oder Massivbau) entsteht:
//   Boden      eine Plattenlage über die volle Breite (jede Platte reicht bis unter beide Wände)
//   Wände      1 Noppe stark, Steinlagen im Verband; dazwischen der Innenraum (Cockpit + Raum dahinter)
//   Ringanker  eine Plattenlage auf Randhöhe um die Öffnung; hinter dem Cockpit als Deck über dem Raum
//   Nase       massiv; Unterkante angehoben über inverse 33°-Schrägsteine, Oberkante mit 33°-Schrägsteinen
//   Heck       Steinlagen bis zur hinteren Oberkante; Anschlussfläche für den späteren Rumpf
//   Kanzel     separat gebaute Baugruppe: Windschutzscheibe 2437 vorn, Seitenscheiben aus Glas-Steinen,
//              Rahmenplatten, Dach; steckt nur von oben auf dem Ringanker und wird gerade nach oben abgenommen
// Prüfung durch den unabhängigen Validator (inkl. Freiraum und Entnahme über model.functional).
import { IDENTITY } from '../math';
import { partMeta } from '../connectivity/partMeta';
import { defaultUsage, MODEL_SCHEMA, type Assembly, type CanonicalModel, type DesignProvenance, type FunctionalSpec, type PartInstance, type StepDef } from '../model/types';
import { cyrb53, stableStringify } from '../model/hash';
import { BRICK, centeredCells, evenClamp, PLATE, rectInstance, scaleTarget, Stack, type RowReport } from './bowTechnique';
import { BRICKS, cellKey, PLATES, type CandidateScore, type RectPart } from './packing';
import { checkBowTarget, TargetError, type BowTarget } from './shapeTarget';

export const COCKPIT_TECHNIQUE_VERSION = 'cockpit-technique@1.0.0';

export interface CockpitRequirements {
  /** Länge der Cockpitöffnung in Reihen; null = aus der Kanzellage der Formvorgabe. */
  openingRows: number | null;
  /** true = Hohlbau mit Innenraum; false = massiver Vergleichsbau mit gleicher Außenform. */
  hollow: boolean;
}
export const DEFAULT_COCKPIT: CockpitRequirements = { openingRows: null, hollow: true };

export interface CockpitColors { hull: number; accent: number; glass: number }
/** Rumpf Dark Bluish Gray, Akzent Tan, Glas Trans-Brown (LDraw 72, 19, 40). */
export const DEFAULT_COCKPIT_COLORS: CockpitColors = { hull: 72, accent: 19, glass: 40 };

export interface CockpitPlan {
  variant: 'cockpit';
  widthStuds: number;
  rows: number;
  scale: number;
  layers: { name: string; kind: string; parts: number }[];
  rowsReport: (RowReport & { targetBottom: number; builtBottom: number })[];
  decisions: string[];
  deviations: string[];
  /** Nutzbarer Innenraum (null bei Massivbau). */
  cockpit: { rows: [number, number]; cols: [number, number]; widthStuds: number; lengthStuds: number; wellPlates: number; headroomPlates: number; mm: { width: number; length: number; height: number } } | null;
  canopyParts: number;
}

const FLOOR: RectPart[] = [{ part: '3034', sx: 8, sz: 2 }, ...PLATES];
const RAILS: RectPart[] = [{ part: '3066', sx: 4, sz: 1 }, { part: '3065', sx: 2, sz: 1 }];
const STRIP_PLATES: RectPart[] = PLATES.filter((p) => p.sz === 1);

const centerX = (W: number, i0: number, cols: number) => (i0 + cols / 2) * 20 - W * 10;
const rowZ = (j: number) => -(j + 0.5) * 20;

export function buildCockpitBow(target: BowTarget, o: { widthStuds: number; colors?: Partial<CockpitColors>; req?: Partial<CockpitRequirements> }): { model: CanonicalModel; plan: CockpitPlan } {
  const errs = checkBowTarget(target);
  if (errs.length) throw new TargetError(`Formvorgabe unvollständig: ${errs.join('; ')}`);
  const W = o.widthStuds;
  if (!(W >= 6 && W <= 16 && W % 2 === 0)) throw new TargetError('Variante C braucht eine gerade Breite von 6 bis 16 Noppen (Kanzelscheibe 4 Noppen plus Seitenscheiben)');
  if (!target.canopy) throw new TargetError('Variante C braucht eine Kanzellage in der Formvorgabe');
  const req = { ...DEFAULT_COCKPIT, ...o.req };
  const colors = { ...DEFAULT_COCKPIT_COLORS, ...o.colors };
  const { target: t, factor } = scaleTarget(target, W);
  const N = t.rows;
  const decisions: string[] = [`Maßstab: größte Vorgabebreite ${Math.max(...target.width).toFixed(2)} → ${W} Noppen (Faktor ${factor.toFixed(3)}); Länge ${N} Reihen`];
  const deviations: string[] = [];
  const c = t.canopy!;

  // ---- Raster
  const Wq: number[] = [];
  for (let j = 0; j < N; j++) Wq.push(Math.min(evenClamp(t.width[j], 2, W), j > 0 ? Wq[j - 1] : W));
  const Hb = t.bottom ?? new Array<number>(N).fill(0);
  const f = Math.min(c.toRow, N - 2); // Befestigungsreihe der Scheibe (vorderste Kanzelreihe)
  if (f < c.toRow) deviations.push(`Kanzel vorn gekürzt: Vorgabe bis Reihe ${c.toRow}, vor der Scheibe bleibt mindestens eine Nasenreihe`);
  const c0 = (W - 4) / 2;
  for (let j = 0; j <= f; j++) if (Wq[j] < 6) { deviations.push(`Reihe ${j}: Breite ${t.width[j].toFixed(1)} Noppen → 6 (Kanzel mit Seitenscheiben braucht 6)`); Wq[j] = 6; }
  const canopyRows = t.top.slice(c.fromRow, c.toRow + 1).sort((a, b) => a - b);
  const Hc = canopyRows[canopyRows.length >> 1];
  // Randhöhe R = Boden + K Steinlagen + Ringanker; das Kanzeldach liegt 5 Platten darüber. K so, dass Rumpfkante
  // unter der Kanzel und höchster Kanzelpunkt zusammen am wenigsten abweichen.
  const canopyTop = c.profile?.length ? Math.max(...c.profile) : Hc + c.height;
  const K = [Math.floor((Hc - 2) / 3), Math.ceil((Hc - 2) / 3)].map((k) => Math.max(2, k)).sort((a, b) => Math.abs(2 + 3 * a - Hc) + Math.abs(7 + 3 * a - canopyTop) - (Math.abs(2 + 3 * b - Hc) + Math.abs(7 + 3 * b - canopyTop)))[0];
  const R = 1 + 3 * K + 1;
  decisions.push(`Randhöhe ${R} Platten (Boden, ${K} Steinlagen, Ringanker), Kanzeldach ${R + 5}: Vorgabe Rumpfkante unter der Kanzel ${Hc.toFixed(1)}, höchster Kanzelpunkt ${canopyTop.toFixed(1)} Platten`);

  // ---- Bugkontur aus Keilsegmenten (je 4 Reihen 2 Noppen schmaler): Keilplatten in Boden und Ringanker,
  // Keilsteine 41767/41768 in den Steinlagen. Segment s belegt links die Spalten s, s + 1 (rechts gespiegelt).
  // Ein Segment darf neben dem Cockpit liegen, wenn seine innere Spalte höchstens die Spalte der Seitenscheibe ist.
  let jt0 = t.width.findIndex((w, j) => j > 0 && w < W - 0.75);
  if (jt0 < 0) jt0 = N;
  let S = Math.max(0, Math.min((W - 2) / 2, Math.floor((N - jt0 + 2) / 4)));
  let jt = N - 4 * S;
  const segOk = () => { for (let k = 0; k < S; k++) if (jt + 4 * k <= f && k > c0 - 2) return false; return true; };
  while (S > 0 && !segOk()) { jt++; S = Math.min(S, Math.floor((N - jt) / 4)); }
  if (S === 0) jt = N;
  const seg = (j: number) => (j >= jt && j < jt + 4 * S ? Math.floor((j - jt) / 4) : -1);  if (S) decisions.push(`Bugkontur: ${S} Keilsegment(e) ab Reihe ${jt} (je 4 Reihen 2 Noppen schmaler) – Keilplatten 41769a/41770a bzw. Keilsteine 41767/41768 in jeder zweiten Lage, dazwischen eingezogene Lagen über der vollen Keilspalte (Verbund)`);
  /** Rechteckbereich der Reihe (Spalten ohne Keilteile) und Umrissbreite. */
  const edge = (j: number): [number, number] => { const sg = seg(j); return sg >= 0 ? [sg + 2, W - sg - 3] : j >= jt + 4 * S ? [S + 1, W - S - 2] : [(W - Wq[j]) / 2, (W + Wq[j]) / 2 - 1]; };
  const outline = (j: number) => { const sg = seg(j); return sg >= 0 ? W - 2 * sg - 2 * ((j - jt - 4 * sg + 0.5) / 4) : edge(j)[1] - edge(j)[0] + 1; };
  const innerWall = (j: number): [number, number] => { const sg = seg(j); return sg >= 0 ? [sg + 1, W - sg - 2] : edge(j); };

  // ---- Cockpitöffnung und Innenraum
  const L = req.openingRows ?? f - c.fromRow;
  const o1 = f - 1;
  const o0 = Math.max(0, o1 - Math.max(2, L) + 1);
  if (req.openingRows !== null && o1 - o0 + 1 !== req.openingRows) deviations.push(`Cockpitöffnung ${o1 - o0 + 1} statt ${req.openingRows} Reihen (begrenzt durch die Bauteillänge)`);
  const inOpening = (i: number, j: number) => j >= o0 && j <= o1 && i >= c0 && i < c0 + 4;
  // Innenraum so breit wie die Öffnung (Wände außen mindestens 1 Noppe, bei breiteren Bugen entsprechend
  // stärker): So liegt jede Platte des Ringankers auf einer Wand, nichts kragt über den Hohlraum aus.
  const inCavity = (i: number, j: number) => req.hollow && j <= o1 && i >= c0 && i < c0 + 4 && i > innerWall(j)[0] && i < innerWall(j)[1];
  if (req.hollow) decisions.push(`Innenraum: Reihen 0–${o1} 4 Noppen breit zwischen den Wänden; Cockpitöffnung ${o1 - o0 + 1} × 4 Noppen (Reihen ${o0}–${o1}), dahinter ein geschlossener Raum unter dem Deck für spätere Funktionen`);
  else decisions.push('Massivbau zum Vergleich: gleiche Außenform, Innenraum mit Steinen gefüllt');

  // ---- Unterkante: Boden reicht mindestens bis unter die Scheibenbefestigung (Innenraum hat Vorrang)
  let Ef = f;
  for (let j = f + 1; j < N; j++) if (Hb[j] < 1.5) Ef = j; else break;
  for (let j = 0; j <= f; j++) if (Hb[j] >= 1.5) deviations.push(`Reihe ${j}: Unterkante Vorgabe ${Hb[j].toFixed(1)} Platten, gebaut 0 – ebener Cockpitboden hat Vorrang`);
  const raised = Ef <= N - 3;
  const bottomLevel = (j: number) => (j <= Ef ? 0 : raised ? (j <= Ef + 2 ? 1 : 4) : 0);
  if (raised) decisions.push(`Angehobene Bugnase: inverse 33°-Schrägsteine 3747b auf der vordersten Bodenreihe ${Ef}; Unterkante steigt bis Reihe ${Ef + 2} um 1 Steinhöhe, davor freitragend`);

  // ---- Oberkante der Nase: Steinlagen je Reihe, vorn 33°-Schrägsteine
  const nose = (j: number) => j > f;
  const courseRaw = (j: number, k: number) => {
    const bot = 1 + 3 * k;
    if (k < 0 || bottomLevel(j) > bot) return false;
    if (!nose(j)) return k < K;
    return k < K && t.top[j] >= bot + 1.5;
  };
  // Schrägsteine oben an der Nase (vorderste 3 Reihen) in der höchsten Lage, die dort noch getragen wird;
  // darüber entfallen diese Reihen
  let kSlope = -1;
  if (N - 1 - f >= 3) for (let k = K - 1; k >= 1 && kSlope < 0; k--) if (courseRaw(N - 3, k) && [N - 3, N - 2, N - 1].every((j) => courseRaw(j, k - 1))) kSlope = k;
  const courseIn = (j: number, k: number) => courseRaw(j, k) && !(kSlope >= 0 && j >= N - 3 && k > kSlope);
  const stack = new Stack(W);
  stack.fromTipStrategies = true;
  const layers: CockpitPlan['layers'] = [];

  // Sonderteile je Lage (mittig, so breit wie die Reihe innerhalb der Keilsegmente)
  const midWidth = (j: number) => { const [a, b] = innerWall(j); return b - a + 1; };
  const invSlope = raised ? { rows: [Ef, Ef + 2] as [number, number], width: Math.max(2, 2 * Math.floor(Math.min(midWidth(Ef + 1), midWidth(Ef)) / 2)) } : null;
  const noseTop = kSlope >= 0 ? { rows: [N - 3, N - 1] as [number, number], width: Math.max(2, 2 * Math.floor(midWidth(N - 2) / 2)), k: kSlope } : null;
  const inBlock = (b: { rows: [number, number]; width: number } | null, i: number, j: number) => !!b && j >= b.rows[0] && j <= b.rows[1] && i >= (W - b.width) / 2 && i < (W + b.width) / 2;
  const special = (k: number, i: number, j: number) => (k === 0 && inBlock(invSlope, i, j)) || (!!noseTop && k === noseTop.k && inBlock(noseTop, i, j));
  /**
   * Keilteile einer Lage: Segmente, deren 4 Reihen ganz in der Lage liegen und frei von Sonderteilen sind – nur in
   * jeder zweiten Lage (Lagenindex gerade: Boden 0, Steinlagen 1…K, Ringanker K + 1). Die Lagen dazwischen sind
   * eingezogen und überdecken die volle Keilspalte; sonst stünden die Keilteile als eigene Säule ohne Verbund.
   */
  const wedgesFor = (layerIndex: number, rowIn: (j: number) => boolean, blocked: (i: number, j: number) => boolean) => {
    const out: number[] = [];
    if (layerIndex % 2 !== 0) return out;
    for (let sg = 0; sg < S; sg++) {
      const rows = [0, 1, 2, 3].map((r) => jt + 4 * sg + r);
      if (rows.every((j) => rowIn(j) && ![sg, sg + 1, W - sg - 2, W - sg - 1].some((i) => blocked(i, j)))) out.push(sg);
    }
    return out;
  };
  /** Zellen einer Lage: Rechteckbereich; Segmente ohne Keilteil nur mit ihrer inneren Spalte (gestuft). */
  const layerCells = (rowIn: (j: number) => boolean, wedged: number[], keep: (i: number, j: number) => boolean) => {
    const cells = new Set<string>();
    for (let j = 0; j < N; j++) {
      if (!rowIn(j)) continue;
      const [lo, hi] = edge(j);
      for (let i = lo; i <= hi; i++) if (keep(i, j)) cells.add(cellKey(i, j));
      const sg = seg(j);
      if (sg >= 0 && !wedged.includes(sg)) for (const i of [sg + 1, W - sg - 2]) if (keep(i, j)) cells.add(cellKey(i, j));
    }
    return cells;
  };
  const addWedges = (stk: Stack, wedged: number[], plates: boolean, level: number, color: number, name: string) => {
    const h = plates ? 1 : 3;
    for (const sg of wedged) {
      const z = -(jt + 4 * sg) * 20 - 40;
      const [l, r] = plates ? ['41769a', '41770a'] : ['41767', '41768'];
      stk.add({ part: l, color, position: [(sg + 1) * 20 - W * 10, -PLATE * level - PLATE * h, z], rotation: IDENTITY, layer: name }, level, level + h);
      stk.add({ part: r, color, position: [(W - sg - 1) * 20 - W * 10, -PLATE * level - PLATE * h, z], rotation: IDENTITY, layer: name }, level, level + h);
    }
    return wedged.length * 2;
  };
  const addSpecial = (stk: Stack, k: number, name: string) => {
    let n = 0;
    if (k === 0 && invSlope) {
      const ci = (W - invSlope.width) / 2;
      for (let i = ci; i + 1 < ci + invSlope.width; i += 2) { stk.add({ part: '3747b', color: colors.accent, position: [centerX(W, i, 2), -PLATE * 1 - BRICK, rowZ(invSlope.rows[0])], rotation: IDENTITY, layer: name }, 1, 4); n++; }
    }
    if (noseTop && k === noseTop.k) {
      const ci = (W - noseTop.width) / 2;
      const bot = 1 + 3 * k;
      for (let i = ci; i + 1 < ci + noseTop.width; i += 2) { stk.add({ part: '3298', color: colors.accent, position: [centerX(W, i, 2), -PLATE * bot - BRICK, rowZ(noseTop.rows[0])], rotation: IDENTITY, layer: name }, bot, bot + 3); n++; }
    }
    return n;
  };
  const course = (stk: Stack, k: number) => {
    const name = `Lage ${k + 2}`;
    const rowIn = (j: number) => courseIn(j, k);
    const wedged = wedgesFor(k + 1, rowIn, (i, j) => special(k, i, j));
    const sp = addSpecial(stk, k, name) + addWedges(stk, wedged, false, 1 + 3 * k, colors.hull, name);
    return { name, parts: sp + stk.packLayer(layerCells(rowIn, wedged, (i, j) => !inCavity(i, j) && !special(k, i, j)), BRICKS, k + 1, 1 + 3 * k, colors.hull, name) };
  };

  // Lage 1: Boden (Vorschau auf die erste Steinlage: jede Bodenplatte soll in der Wand gehalten sein)
  const floorIn = (j: number) => j <= Ef;
  // Unter dem Innenraum keine Keilplatten: dort muss jede Bodenplatte bis unter beide Wände reichen
  const floorWedges = wedgesFor(0, (j) => floorIn(j) && !(req.hollow && j <= o1), () => false);
  const lookahead = (trial: Stack) => { course(trial, 0); return trial.components(); };
  const floorParts = addWedges(stack, floorWedges, true, 0, colors.hull, 'Lage 1');
  const floorCells = layerCells(floorIn, floorWedges, () => true);
  // Zusätzliche Strategie: Bodenplatten, die Fugen einer probeweise gelegten ersten Steinlage überbrücken (Probe
  // auf Einzelplatten 1×1, die jede Belegung tragen) – wie bei Variante B
  let floorScore: CandidateScore | undefined;
  try {
    const probe = new Stack(W);
    probe.fromTipStrategies = true;
    addWedges(probe, floorWedges, true, 0, colors.hull, 'Probe');
    for (const k of floorCells) { const [i, j] = k.split(',').map(Number); probe.add(rectInstance({ part: '3024', i0: i, j0: j, cols: 1, rows: 1, rotated: false }, W, 0, colors.hull, 'Probe'), 0, 1); }
    course(probe, 0);
    const above = probe.topCells(4);
    floorScore = (cs) => new Set(cs.map((cc) => above.get(cc)).filter((x) => x !== undefined)).size;
  } catch {
    floorScore = undefined;
  }
  layers.push({ name: 'Lage 1', kind: 'Boden', parts: floorParts + stack.packLayer(floorCells, FLOOR, 0, 0, colors.hull, 'Lage 1', lookahead, floorScore) });
  for (let k = 0; k < K; k++) { const r = course(stack, k); layers.push({ name: r.name, kind: k === 0 && invSlope ? 'Wände, Nase mit inversen Schrägsteinen' : noseTop && k === noseTop.k ? 'Wände, Nase mit Schrägsteinen' : 'Wände und Nase', parts: r.parts }); }
  if (invSlope) decisions.push(`Nase unten: ${invSlope.width / 2} inverse Schrägsteine 3747b (Reihen ${invSlope.rows[0]}–${invSlope.rows[1]})`);
  if (noseTop) decisions.push(`Nase oben: ${noseTop.width / 2} Schrägsteine 3298 (Reihen ${noseTop.rows[0]}–${noseTop.rows[1]})`);

  // Ringanker (Unterkante R − 1): alle Reihen bis zur Scheibenbefestigung außer der Öffnung
  const ringIn = (j: number) => j <= f;
  const ringWedges = wedgesFor(K + 1, ringIn, () => false);
  const ringParts = addWedges(stack, ringWedges, true, R - 1, colors.hull, `Lage ${K + 2}`);
  layers.push({ name: `Lage ${K + 2}`, kind: 'Ringanker und Deck', parts: ringParts + stack.packLayer(layerCells(ringIn, ringWedges, (i, j) => !inOpening(i, j)), FLOOR, K + 1, R - 1, colors.hull, `Lage ${K + 2}`) });

  // Heck über dem Deck bis zur hinteren Oberkante
  const nb = o0 > 0 ? Math.max(0, Math.round((t.top[0] - R) / 3)) : 0;
  for (let k = 0; k < nb; k++) {
    const cells = new Set<string>();
    centeredCells([0, o0 - 1], (j) => Wq[j], W, cells);
    const name = `Lage ${K + 3 + k}`;
    layers.push({ name, kind: 'Heck', parts: stack.packLayer(cells, BRICKS, K + 2 + k, R + 3 * k, colors.hull, name) });
  }
  const rearTop = R + 3 * nb;
  const hullCount = stack.placed.length;

  // ---- Kanzel (separat gebaute Baugruppe)
  const railFrom = (f - o0 + 1) % 2 === 0 ? o0 : o0 + 1;
  if (railFrom !== o0) deviations.push(`Seitenscheiben ab Reihe ${railFrom} (gerade Länge aus 1×4/1×2-Steinen); Reihe ${o0} seitlich offen`);
  const railCells = new Set<string>();
  for (let j = railFrom; j <= f; j++) { railCells.add(cellKey(c0 - 1, j)); railCells.add(cellKey(c0 + 4, j)); }
  const canopyLayers: CockpitPlan['layers'] = [];
  canopyLayers.push({ name: 'Kanzel 1', kind: 'Seitenscheiben (Glas-Steine)', parts: stack.packLayer(new Set(railCells), RAILS, 1, R, colors.glass, 'Kanzel 1') });
  canopyLayers.push({ name: 'Kanzel 2', kind: 'Rahmen', parts: stack.packLayer(new Set(railCells), STRIP_PLATES, 0, R + 3, colors.hull, 'Kanzel 2') });
  stack.add({ part: '2437', color: colors.glass, position: [centerX(W, c0, 4), -PLATE * R - 32, rowZ(f) + 20], rotation: IDENTITY, layer: 'Kanzel 3' }, R, R + 4);
  canopyLayers.push({ name: 'Kanzel 3', kind: 'Windschutzscheibe 2437', parts: 1 });
  let roof = 0;
  for (let j = railFrom; j <= f - 2;) {
    const two = j + 1 <= f - 2;
    const part = two ? '3795' : '3666';
    stack.add(rectInstance({ part, i0: c0 - 1, j0: j, cols: 6, rows: two ? 2 : 1, rotated: false }, W, R + 4, colors.hull, 'Kanzel 4'), R + 4, R + 5);
    roof++;
    j += two ? 2 : 1;
  }
  for (const i0 of [c0 - 1, c0 + 3]) stack.add(rectInstance({ part: '3023', i0, j0: f - 1, cols: 2, rows: 1, rotated: false }, W, R + 4, colors.glass, 'Kanzel 4'), R + 4, R + 5);
  canopyLayers.push({ name: 'Kanzel 4', kind: 'Dach und Verbindungsplatten zur Scheibe', parts: roof + 2 });
  decisions.push(`Kanzel: Windschutzscheibe 2437 (Reihen ${f - 2}–${f}), Seitenscheiben aus Glas-Steinen 3066/3065 (Reihen ${railFrom}–${f}), Rahmenplatten, Dach über Reihen ${railFrom}–${f - 2}; als Baugruppe von oben auf den Ringanker gesteckt`);

  // ---- Bericht je Reihe
  const builtTop = (j: number) => {
    if (j < o0) return rearTop;
    if (j <= f) return j >= railFrom || j === f - 1 ? R + 5 : R;
    let top = 1;
    for (let k = 0; k < K; k++) if (courseIn(j, k)) top = 1 + 3 * (k + 1);
    if (noseTop && j >= noseTop.rows[0]) top = 1 + 3 * noseTop.k + 3 * (j === noseTop.rows[0] ? 1 : j === noseTop.rows[0] + 1 ? 0.6 : 0.2);
    return top;
  };
  const builtBottom = (j: number) => (j <= Ef ? 0 : !raised ? 0 : j === Ef + 1 ? 1.5 : j === Ef + 2 ? 3 : 4);
  const targetTop = (j: number) => (c.profile && j >= c.fromRow && j <= c.toRow ? c.profile[j - c.fromRow] : t.top[j] + (j >= c.fromRow && j <= c.toRow ? c.height : 0));
  const rowsReport = t.width.map((w, j) => ({ row: j, targetWidth: +w.toFixed(2), builtWidth: +outline(j).toFixed(2), targetTop: +targetTop(j).toFixed(2), builtTop: +builtTop(j).toFixed(2), targetBottom: +Hb[j].toFixed(2), builtBottom: builtBottom(j) }));
  for (const r of rowsReport) {
    if (Math.abs(r.builtWidth - r.targetWidth) > 1) deviations.push(`Reihe ${r.row}: Breite gebaut ${r.builtWidth.toFixed(1)}, Vorgabe ${r.targetWidth.toFixed(1)} Noppen`);
    if (Math.abs(r.builtTop - r.targetTop) > 2) deviations.push(`Reihe ${r.row}: Oberkante gebaut ${r.builtTop.toFixed(1)}, Vorgabe ${r.targetTop.toFixed(1)} Plattenhöhen`);
    if (Math.abs(r.builtBottom - r.targetBottom) > 2) deviations.push(`Reihe ${r.row}: Unterkante gebaut ${r.builtBottom.toFixed(1)}, Vorgabe ${r.targetBottom.toFixed(1)} Plattenhöhen`);
  }

  // ---- Modell
  const placed = stack.placed;
  const isCanopy = (k: number) => k >= hullCount;
  const instances: PartInstance[] = placed.map((p, k) => ({ instanceId: `${p.layer.replace(/\s+/g, '-').toLowerCase()}-${String(k + 1).padStart(3, '0')}`, part: p.part, color: p.color, position: p.position, rotation: p.rotation, assemblyId: isCanopy(k) ? 'kanzel' : 'rumpf' }));
  const assemblies: Assembly[] = [
    { assemblyId: 'bug', name: 'Bug mit Cockpit', parentId: null, builtSeparately: false, separateModule: false, source: COCKPIT_TECHNIQUE_VERSION },
    { assemblyId: 'rumpf', name: 'Bugrumpf (Boden, Wände, Ringanker, Nase, Heck)', parentId: 'bug', builtSeparately: false, separateModule: false, source: COCKPIT_TECHNIQUE_VERSION },
    { assemblyId: 'kanzel', name: 'Kanzel (abnehmbar)', parentId: 'bug', builtSeparately: true, separateModule: false, source: COCKPIT_TECHNIQUE_VERSION },
  ];
  const src = `${COCKPIT_TECHNIQUE_VERSION}: erzeugte Baufolge – im Bewegungsmodell geprüft, keine Herstelleranleitung, nicht physisch erprobt`;
  const steps: StepDef[] = [];
  for (const ly of [...layers, ...canopyLayers]) {
    const ids = instances.filter((_i, k) => placed[k].layer === ly.name).map((i) => i.instanceId);
    if (!ids.length) continue;
    const step: StepDef = { stepId: `bug#${steps.length + 1}`, assemblyId: ly.name.startsWith('Kanzel') ? 'kanzel' : 'rumpf', add: ids, attach: [], source: src, notes: [`${ly.name}: ${ly.kind}`] };
    if ((ly.name === 'Lage 1' || ly.name === 'Kanzel 1') && ids.length > 1) step.support = { kind: 'hand', note: 'Die Teile dieser Lage liegen lose, bis die nächste Lage sie verbindet – flach hinlegen und beim Aufsetzen festhalten', source: COCKPIT_TECHNIQUE_VERSION };
    if (ly.name === 'Kanzel 3') step.support = { kind: 'hand', note: 'Scheibe in den Rahmen stellen und halten, bis Dach und Verbindungsplatten sie fassen', source: COCKPIT_TECHNIQUE_VERSION };
    steps.push(step);
  }
  steps.push({ stepId: `bug#${steps.length + 1}`, assemblyId: 'bug', add: [], attach: ['kanzel'], source: src, notes: ['Kanzel von oben auf den Ringanker setzen (zum Öffnen gerade nach oben abziehen)'] });

  // ---- Funktionsmodell: Freiräume, Entnahme, Anschluss
  const x0 = centerX(W, c0, 4) - 40;
  const zFront = -(o1 + 1) * 20;
  const zRear = -o0 * 20;
  const functional: FunctionalSpec = { schema: 'baustein-sim/functional@1', keepouts: [], removable: [{ assemblyId: 'kanzel', label: 'Kanzel', direction: [0, -1, 0] }], interfaces: [], notes: [] };
  let cockpit: CockpitPlan['cockpit'] = null;
  if (req.hollow) {
    const floorTop = -PLATE * 1 - 4; // über den Bodennoppen
    functional.keepouts.push(
      { id: 'cockpit-schacht', label: 'Cockpit (Schacht bis Randhöhe)', min: [x0, -PLATE * R, zFront], max: [x0 + 80, floorTop, zRear], source: 'Funktionsanforderung: Innenraum unter der Öffnung' },
      { id: 'cockpit-dach', label: 'Cockpit (Kopfraum unter dem Dach)', min: [x0, -PLATE * (R + 4), -(f - 2) * 20], max: [x0 + 80, -PLATE * R, zRear], source: 'Funktionsanforderung: Kopfraum bis Dachunterseite' },
      { id: 'cockpit-scheibe', label: 'Cockpit (Kopfraum unter der Scheibe)', min: [x0 + 10, -PLATE * (R + 3), zFront], max: [x0 + 70, -PLATE * R, -(f - 2) * 20], source: 'Funktionsanforderung: Kopfraum unter dem Glasdach von 2437 (3 Platten; Schräge, Seitenwangen und Rundungen ausgespart)' },
    );
    const well = R - 1.5;
    cockpit = { rows: [o0, o1], cols: [c0, c0 + 3], widthStuds: 4, lengthStuds: o1 - o0 + 1, wellPlates: well, headroomPlates: 4, mm: { width: 32, length: (o1 - o0 + 1) * 8, height: +((well + 4) * 3.2).toFixed(1) } };
    functional.notes.push(`Nutzbarer Innenraum: Grundfläche 4 × ${o1 - o0 + 1} Noppen über den Bodennoppen, Schacht ${well} Platten bis Randhöhe, darüber 4 Platten Kopfraum unter dem Dach (unter der Scheibe 3 Platten, 3 Noppen breit) – Vorschlag, kein Minifigurenmaßstab vorausgesetzt`);
    functional.notes.push('Raum hinter dem Cockpit (unter dem Deck) bleibt frei für spätere Funktionen (z. B. Antriebe, Laderaum); nicht ausgestaltet');
  }
  // Anschluss zum Rumpf: freie Noppen des Hecks oben
  const heckTop = new Set(placed.map((p, k) => (p.layer === `Lage ${K + 2 + nb}` && nb > 0 ? k : -1)).filter((k) => k >= 0));
  const itf = [...heckTop].flatMap((k) => (partMeta(placed[k].part)?.connectors ?? []).filter((cn) => cn.kind === 'stud').map((cn) => ({ instanceId: instances[k].instanceId, connectorId: cn.id })));
  if (itf.length) functional.interfaces.push({ id: 'rumpfanschluss', label: 'Anschluss zum späteren Rumpf (Heck oben)', studs: itf });
  functional.notes.push('Rumpfanschluss: hintere Stirnseite offen (Innenraum setzt sich in den Rumpf fort), Heckoberseite mit freien Noppen; Verbindung des späteren Rumpfs nicht konstruiert');

  const usage = defaultUsage();
  usage.intendedUse = 'display';
  usage.intendedUsers = { minAgeYears: null, source: 'nicht angegeben (Konstruktionsnachweis)' };
  const design: DesignProvenance = {
    schema: 'baustein-sim/design-provenance@1',
    sources: target.origin.kind === 'template-measurement'
      ? [{ sourceId: 'vorlage', kind: 'concept-image', label: target.origin.description, mediaType: 'image/png', sha256: target.origin.imageSha256, rights: 'Vorlage des Nutzers (lokal, nicht im Modell gespeichert)' }]
      : [{ sourceId: 'testform', kind: 'parameters', label: target.origin.description, rights: 'eigene synthetische Testdaten' }],
    interpretation: { method: `Formvorgabe ${target.label}`, version: target.schema, notes: target.sources.map((s) => `${s.field}: ${s.source} (${s.method})`).join(' · ') },
    assumptions: [...decisions.map((d, k) => ({ id: `E${k + 1}`, statement: d, basis: 'Bautechnik-Vorlage' })), ...functional.notes.map((d, k) => ({ id: `F${k + 1}`, statement: d, basis: 'Funktionsanforderung (Vorschlag)' })), ...target.notes.map((n, k) => ({ id: `V${k + 1}`, statement: n, basis: 'Ableitung der Formvorgabe' }))],
    deviations: deviations.map((d, k) => ({ id: `A${k + 1}`, description: d, reason: 'Rasterung, feste Teilgeometrie oder Vorrang der Funktion' })),
    visualComparison: { method: 'noch nicht abgeglichen', version: '0', status: 'unchecked' },
  };
  const hash = cyrb53(stableStringify({ target, req, W, colors }));
  const model: CanonicalModel = {
    schema: MODEL_SCHEMA, modelId: `bug-cockpit${req.hollow ? '' : '-massiv'}-${W}-${hash.slice(0, 8)}`, version: 1,
    name: `Bug & Cockpit – Variante C${req.hollow ? '' : ' (massiv, Vergleich)'}, ${W} Noppen breit`,
    origin: { kind: 'generated', label: `Konstruktionsnachweis aus der Formvorgabe „${target.label}“ mit ${COCKPIT_TECHNIQUE_VERSION} – eigener Entwurf, kein offizielles LEGO-Modell` },
    units: 'LDU', coordinateSystem: 'ldraw-right-handed-negative-y-up', rootAssemblyId: 'bug',
    instances, assemblies, steps, stepsSource: 'generated', usage, changeLog: [],
    generator: { name: 'cockpit-technique', version: COCKPIT_TECHNIQUE_VERSION, params: { widthStuds: W, target: target.label, targetHash: cyrb53(stableStringify(target)), requirements: req as unknown as Record<string, unknown> } },
    design, functional,
  };
  return {
    model,
    plan: { variant: 'cockpit', widthStuds: W, rows: N, scale: factor, layers: [...layers, ...canopyLayers], rowsReport, decisions, deviations, cockpit, canopyParts: placed.length - hullCount },
  };
}
