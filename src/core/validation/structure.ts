// Strukturelle Risikoindikatoren (heuristisch, ohne behauptete Festigkeit):
//  - schwächster Schnitt: minimale Zahl von Noppenverbindungen, deren Lösen das Modell teilt (Stoer–Wagner)
//  - Ein-Noppen-Anbauten: Brücken im Teilegraph mit Gewicht 1
//  - durchgehende Fugen: senkrechte Stoßfugen, die sich über mehrere Lagen fortsetzen
import { overlapDepths } from '../math';
import { TOLERANCE } from '../units';
import { pairKey, type World, type WorldInstance } from './world';

export interface MinCut {
  weight: number;
  sideA: string[];
  sideB: string[];
}

/** Globaler minimaler Schnitt (Stoer–Wagner) eines gewichteten, ungerichteten Graphen. */
export function stoerWagner(nodes: string[], weights: Map<string, number>): MinCut | null {
  if (nodes.length < 2) return null;
  const n = nodes.length;
  const w: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const idx = new Map(nodes.map((x, i) => [x, i]));
  for (const [k, v] of weights) {
    const [a, b] = k.split('|');
    const i = idx.get(a);
    const j = idx.get(b);
    if (i === undefined || j === undefined) continue;
    w[i][j] += v;
    w[j][i] += v;
  }
  const groups: number[][] = nodes.map((_, i) => [i]);
  let active = nodes.map((_, i) => i);
  let best: MinCut | null = null;
  while (active.length > 1) {
    const used = new Set<number>();
    const weightTo = new Map(active.map((v) => [v, 0]));
    let prev = -1;
    let last = -1;
    for (let k = 0; k < active.length; k++) {
      let sel = -1;
      for (const v of active) if (!used.has(v) && (sel === -1 || weightTo.get(v)! > weightTo.get(sel)!)) sel = v;
      used.add(sel);
      prev = last;
      last = sel;
      for (const v of active) if (!used.has(v)) weightTo.set(v, weightTo.get(v)! + w[sel][v]);
    }
    const cutWeight = weightTo.get(last)!;
    if (!best || cutWeight < best.weight) {
      const sideA = groups[last].map((i) => nodes[i]).sort();
      const setA = new Set(sideA);
      best = { weight: cutWeight, sideA, sideB: nodes.filter((x) => !setA.has(x)).sort() };
    }
    groups[prev].push(...groups[last]);
    for (const v of active) {
      w[prev][v] += w[last][v];
      w[v][prev] = w[prev][v];
    }
    active = active.filter((v) => v !== last);
  }
  return best;
}

/** Brücken (Tarjan) im Teilegraph; liefert je Brücke die kleinere abgetrennte Seite. */
export function bridges(nodes: string[], weights: Map<string, number>): { a: string; b: string; weight: number; smallSide: string[] }[] {
  const adj = new Map<string, string[]>(nodes.map((x) => [x, []]));
  const nodeSet = new Set(nodes);
  for (const k of weights.keys()) {
    const [a, b] = k.split('|');
    if (!nodeSet.has(a) || !nodeSet.has(b)) continue;
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  let time = 0;
  const found: [string, string][] = [];
  const dfs = (u: string, parent: string | null) => {
    disc.set(u, time);
    low.set(u, time);
    time++;
    for (const v of adj.get(u)!) {
      if (v === parent) continue;
      if (!disc.has(v)) {
        dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (low.get(v)! > disc.get(u)!) found.push([u, v]);
      } else low.set(u, Math.min(low.get(u)!, disc.get(v)!));
    }
  };
  for (const x of nodes) if (!disc.has(x)) dfs(x, null);
  return found.map(([a, b]) => {
    // Seite von b ohne die Kante a–b
    const side = new Set([b]);
    const stack = [b];
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of adj.get(u)!) if (!side.has(v) && !(u === b && v === a)) { side.add(v); stack.push(v); }
    }
    const sideB = [...side];
    const other = nodes.filter((x) => !side.has(x));
    return { a, b, weight: weights.get(pairKey(a, b)) ?? 0, smallSide: (sideB.length <= other.length ? sideB : other).sort() };
  });
}

export interface Seam {
  axis: 'x' | 'z';
  coordinate: number;
  layers: number;
  instanceIds: string[];
}

/** Senkrechte Stoßfugen zwischen Nachbarteilen derselben Lage und deren Fortsetzung über Lagen. */
export function continuousSeams(instances: WorldInstance[]): Seam[] {
  interface Joint { axis: 'x' | 'z'; c: number; span: [number, number]; y: [number, number]; ids: [string, string] }
  const joints: Joint[] = [];
  const bodies = instances.filter((w) => w.bodyBoxes.length === 1 && w.axisAligned && w.rigid && Math.abs(w.upAxis[1] + 1) < 1e-6);
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i].bodyBoxes[0];
      const b = bodies[j].bodyBoxes[0];
      if (Math.abs(a.min[1] - b.min[1]) > TOLERANCE.contact || Math.abs(a.max[1] - b.max[1]) > TOLERANCE.contact) continue;
      const d = overlapDepths(a, b);
      for (const [axis, ai, oi] of [['x', 0, 2], ['z', 2, 0]] as const) {
        if (Math.abs(d[ai]) <= TOLERANCE.contact && d[oi] > TOLERANCE.contact) {
          const c = a.max[ai] <= b.min[ai] + TOLERANCE.contact ? a.max[ai] : a.min[ai];
          joints.push({ axis, c, span: [Math.max(a.min[oi], b.min[oi]), Math.min(a.max[oi], b.max[oi])], y: [a.min[1], a.max[1]], ids: [bodies[i].inst.instanceId, bodies[j].inst.instanceId] });
        }
      }
    }
  // Ketten: Fuge in direkt darüberliegender Lage an gleicher Stelle mit überlappender Spanne
  const seams: Seam[] = [];
  const used = new Set<Joint>();
  for (const start of [...joints].sort((p, q) => q.y[0] - p.y[0])) {
    if (used.has(start)) continue;
    const chain = [start];
    used.add(start);
    let cur = start;
    for (;;) {
      const next = joints.find((k) => !used.has(k) && k.axis === cur.axis && Math.abs(k.c - cur.c) <= TOLERANCE.contact && Math.abs(k.y[1] - cur.y[0]) <= TOLERANCE.contact && Math.min(k.span[1], cur.span[1]) - Math.max(k.span[0], cur.span[0]) > TOLERANCE.contact);
      if (!next) break;
      chain.push(next);
      used.add(next);
      cur = next;
    }
    if (chain.length >= 2) seams.push({ axis: start.axis, coordinate: start.c, layers: chain.length, instanceIds: [...new Set(chain.flatMap((k) => k.ids))].sort() });
  }
  return seams.sort((p, q) => q.layers - p.layers);
}

export function subgraphWeights(world: World, ids: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of world.pairWeights) {
    const [a, b] = k.split('|');
    if (ids.has(a) && ids.has(b)) out.set(k, v);
  }
  return out;
}
