// Weltdarstellung eines Modells: Volumen und Anschlüsse aller Instanzen in Weltkoordinaten
// sowie die erkannten regulären Verbindungen (nur implementierte Regeln).
import type { Catalog, CatalogPart } from '../catalog/catalog';
import { studBox, type ConnectorDef, type PartMeta } from '../connectivity/partMeta';
import { isImplementedConnector, ruleFor, type ConnectionRule } from '../connectivity/rules';
import { checkUpinGeometry } from '../connectivity/upin';
import { apply, applyTransform, boxesPenetrate, det, dist, dot, isAxisAligned, orthonormalityError, transformBox, type Box, type Transform, type Vec3 } from '../math';
import type { CanonicalModel, PartInstance } from '../model/types';
import { STUD_HEIGHT, TOLERANCE } from '../units';
import { penetrationDepth, solidFromBox, solidFromPrism, solidsTouch, type Solid } from './solids';

export interface WorldConnector {
  instanceId: string;
  def: ConnectorDef;
  position: Vec3;
  axis: Vec3;
}

export interface WorldStud {
  connector: WorldConnector;
  box: Box;
}

export interface WorldInstance {
  inst: PartInstance;
  part: CatalogPart;
  meta: PartMeta | null;
  transform: Transform;
  bodyBoxes: Box[];
  /** Alle Teilkörper als konvexe Körper (Quader und exakte Prismen, 05B.1). */
  bodySolids: Solid[];
  studs: WorldStud[];
  connectors: WorldConnector[];
  /** Weltrichtung der Noppenachse (lokal −Y). */
  upAxis: Vec3;
  axisAligned: boolean;
  /** Rotation orthonormal (keine Skalierung/Scherung) und nicht gespiegelt. */
  rigid: boolean;
  approximateVolume: boolean;
}

export interface Connection {
  id: string;
  male: { instanceId: string; connectorId: string };
  female: { instanceId: string; connectorId: string; kind: 'antistud' | 'tube' | 'bar_holder' };
  ruleId: string;
  position: Vec3;
  /** Weltrichtung des männlichen Anschlusses (Noppe bzw. Unterseitenstift; zeigt aus dem männlichen Teil heraus). */
  studAxis: Vec3;
}

export interface World {
  instances: Map<string, WorldInstance>;
  connections: Connection[];
  /** Anzahl Noppenverbindungen je ungeordnetem Teilepaar ("a|b", a<b). */
  pairWeights: Map<string, number>;
  /** Für jede verbundene Noppe: Instanz-ID des aufnehmenden Teils. */
  studTarget: Map<string, string>;
  /** Klassifizierte Überschneidungen im Endzustand. */
  overlaps: Overlap[];
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function studKey(instanceId: string, connectorId: string): string {
  return `${instanceId}::${connectorId}`;
}

export function buildWorldInstance(inst: PartInstance, catalog: Catalog): WorldInstance {
  const part = catalog.part(inst.part);
  const meta = part.meta;
  const transform: Transform = { position: inst.position, rotation: inst.rotation };
  const rigid = orthonormalityError(inst.rotation) <= TOLERANCE.matrix && det(inst.rotation) > 0;
  const connectors: WorldConnector[] = (meta?.connectors ?? []).map((def) => ({
    instanceId: inst.instanceId,
    def,
    position: applyTransform(transform, def.position),
    axis: apply(inst.rotation, def.axis),
  }));
  const studs: WorldStud[] = (meta?.connectors ?? [])
    .map((def, i) => ({ def, wc: connectors[i] }))
    .filter((x) => x.def.kind === 'stud')
    .map(({ def, wc }) => ({ connector: wc, box: transformBox(transform, studBox(def)) }));
  return {
    inst,
    part,
    meta,
    transform,
    bodyBoxes: (meta?.bodyBoxes ?? []).map((b) => transformBox(transform, b)),
    bodySolids: [...(meta?.bodyBoxes ?? []).map((b) => solidFromBox(transformBox(transform, b))), ...(meta?.bodyPrisms ?? []).map((p) => solidFromPrism(p, transform))],
    studs,
    connectors,
    upAxis: apply(inst.rotation, [0, -1, 0]),
    axisAligned: isAxisAligned(inst.rotation, TOLERANCE.axisAlignment),
    rigid,
    approximateVolume: meta?.approximateVolume ?? true,
  };
}

const MALE_KINDS = new Set(['stud', 'underside_pin']);

/** Liegt die Paarung im belegten Geltungsbereich der Regel (falls die Regel einen hat)? */
function inScope(rule: ConnectionRule, maleId: string, femaleId: string): boolean {
  return !rule.scope || (rule.scope.male.includes(maleId) && rule.scope.female.includes(femaleId));
}

/**
 * Erkennt Verbindungen nach implementierten Regeln: Anschlusspunkte deckungsgleich, Achsen entgegengesetzt,
 * Paarung im Geltungsbereich und – bei Sonderregeln – geometrische Nennmaß-Voraussetzungen erfüllt.
 */
export function detectConnections(instances: WorldInstance[]): Connection[] {
  const males: WorldConnector[] = [];
  const females: WorldConnector[] = [];
  const partOf = new Map(instances.map((w) => [w.inst.instanceId, w.part.ldrawId]));
  for (const w of instances) {
    if (!w.rigid) continue; // verformte Teile: keine Verbindung werten (eigener Befund)
    for (const c of w.connectors) {
      if (!isImplementedConnector(c.def.kind, w.part.ldrawId)) continue;
      if (MALE_KINDS.has(c.def.kind)) males.push(c);
      else females.push(c);
    }
  }
  // Raster-Hash nach gerundeter Position
  const bucket = (p: Vec3) => `${Math.round(p[0])},${Math.round(p[1])},${Math.round(p[2])}`;
  const index = new Map<string, WorldConnector[]>();
  for (const f of females) {
    const k = bucket(f.position);
    (index.get(k) ?? index.set(k, []).get(k)!).push(f);
  }
  const out: Connection[] = [];
  for (const m of males) {
    const candidates: WorldConnector[] = [];
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      const k = `${Math.round(m.position[0]) + dx},${Math.round(m.position[1]) + dy},${Math.round(m.position[2]) + dz}`;
      candidates.push(...(index.get(k) ?? []));
    }
    for (const f of candidates) {
      if (f.instanceId === m.instanceId) continue;
      if (dist(f.position, m.position) > TOLERANCE.connectorPosition) continue;
      if (dot(f.axis, m.axis) > -0.999) continue;
      const rule = ruleFor(m.def.kind, f.def.kind);
      if (!rule || rule.status !== 'implemented') continue;
      if (!inScope(rule, partOf.get(m.instanceId)!, partOf.get(f.instanceId)!)) continue;
      if (rule.id === 'R-UPIN-HOLLOWSTUD' && !checkUpinGeometry(m.def.geometry, f.def.geometry).ok) continue;
      out.push({
        id: `${m.instanceId}::${m.def.id}->${f.instanceId}::${f.def.id}`,
        male: { instanceId: m.instanceId, connectorId: m.def.id },
        female: { instanceId: f.instanceId, connectorId: f.def.id, kind: f.def.kind as 'antistud' | 'tube' | 'bar_holder' },
        ruleId: rule.id,
        position: m.position,
        studAxis: m.axis,
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function buildWorld(model: CanonicalModel, catalog: Catalog): World {
  const list = model.instances.map((i) => buildWorldInstance(i, catalog));
  const instances = new Map(list.map((w) => [w.inst.instanceId, w]));
  const connections = detectConnections(list);
  const pairWeights = new Map<string, number>();
  const studTarget = new Map<string, string>();
  for (const c of connections) {
    const k = pairKey(c.male.instanceId, c.female.instanceId);
    pairWeights.set(k, (pairWeights.get(k) ?? 0) + 1);
    if (c.ruleId === 'R-UPIN-HOLLOWSTUD') {
      // Die Hohlnoppe des aufnehmenden Teils ragt in den Hohlraum des Stiftteils – nur diese eine Noppe ist freigestellt.
      const holder = instances.get(c.female.instanceId)!;
      const stud = holder.studs.find((s) => s.connector.def.hollow && dist(s.connector.position, c.position) <= TOLERANCE.connectorPosition);
      if (stud) studTarget.set(studKey(c.female.instanceId, stud.connector.def.id), c.male.instanceId);
    } else studTarget.set(studKey(c.male.instanceId, c.male.connectorId), c.female.instanceId);
  }
  const world: World = { instances, connections, pairWeights, studTarget, overlaps: [] };
  world.overlaps = computeOverlaps(world);
  return world;
}

export interface Overlap {
  a: string;
  b: string;
  kinds: string[];
  depth: number;
  /**
   * penetration = echte Durchdringung im Regelumfang; partial-insertion = Noppe koaxial zu einer Aufnahme,
   * aber nicht vollständig eingesteckt (falsche Einstecktiefe); unchecked = mögliche nicht unterstützte Verbindung/grobe Hülle.
   */
  classification: 'penetration' | 'partial-insertion' | 'unchecked';
  /** Bei partial-insertion: tatsächliche Einstecktiefe (LDU) statt der Noppenhöhe. */
  insertionDepth?: number;
  reason: string | null;
}

/**
 * Noppe s von x steht koaxial unter einer Aufnahme von y (entgegengesetzte Achse) und ist teilweise eingesteckt:
 * liefert die Einstecktiefe 0 < t < Noppenhöhe, sonst null. Aufnahmen: Noppenaufnahme, Röhre, oder – bei Hohlnoppen
 * im Geltungsbereich von R-UPIN-HOLLOWSTUD – der Unterseitenstift.
 */
function partialInsertionDepth(x: WorldInstance, s: WorldStud, y: WorldInstance): number | null {
  const a = s.connector.axis;
  for (const c of y.connectors) {
    const kindOk =
      c.def.kind === 'antistud' || c.def.kind === 'tube' ||
      (c.def.kind === 'underside_pin' && !!s.connector.def.hollow && isImplementedConnector('underside_pin', y.part.ldrawId) && isImplementedConnector('bar_holder', x.part.ldrawId));
    if (!kindOk || dot(c.axis, a) > -0.999) continue;
    const d: Vec3 = [c.position[0] - s.connector.position[0], c.position[1] - s.connector.position[1], c.position[2] - s.connector.position[2]];
    const along = dot(d, a);
    const lateral = Math.sqrt(Math.max(0, dot(d, d) - along * along));
    if (lateral > TOLERANCE.connectorPosition) continue;
    if (along > TOLERANCE.connectorPosition && along < STUD_HEIGHT - TOLERANCE.connectorPosition) return STUD_HEIGHT - along;
  }
  return null;
}

/** Hohlnoppe von x trifft koaxial einen Unterseitenstift von y, Paarung aber außerhalb einer implementierten Regel. */
function hollowStudMeetsPin(x: WorldInstance, studConnectorId: string, y: WorldInstance): boolean {
  const s = x.connectors.find((c) => c.def.id === studConnectorId);
  if (!s?.def.hollow) return false;
  return y.connectors.some((c) => c.def.kind === 'underside_pin' && dist(c.position, s.position) <= TOLERANCE.connectorPosition && dot(c.axis, s.axis) < -0.999);
}

/** Alle Überschneidungen zwischen Teilepaaren, klassifiziert. Reguläre Noppenverbindungen sind ausgenommen. */
export function computeOverlaps(world: World): Overlap[] {
  const list = [...world.instances.values()];
  const out: Overlap[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const kinds: string[] = [];
      let depth = 0;
      let viaHollow = false;
      let partialAll = true;
      let partialDepth: number | null = null;
      const rec = (k: string, x: Box, y: Box) => {
        kinds.push(k);
        const d = [Math.min(x.max[0], y.max[0]) - Math.max(x.min[0], y.min[0]), Math.min(x.max[1], y.max[1]) - Math.max(x.min[1], y.min[1]), Math.min(x.max[2], y.max[2]) - Math.max(x.min[2], y.min[2])];
        depth = Math.max(depth, Math.min(...d));
      };
      // Körper↔Körper: Quaderpaare wie bisher, sonst exakter Trennachsentest (Schrägen, Keilplatten)
      const recDepth = (k: string, d: number) => { kinds.push(k); depth = Math.max(depth, d); };
      for (const sa of a.bodySolids)
        for (const sb of b.bodySolids) {
          if (sa.isBox && sb.isBox) {
            if (boxesPenetrate(sa.aabb, sb.aabb, TOLERANCE.penetration)) { rec('Körper↔Körper', sa.aabb, sb.aabb); partialAll = false; }
            continue;
          }
          const d = penetrationDepth(sa, sb);
          if (d > TOLERANCE.penetration) { recDepth('Körper↔Körper', d); partialAll = false; }
        }
      for (const [x, y] of [[a, b], [b, a]] as const)
        for (const s of x.studs)
          for (const ys of y.bodySolids) {
            const yb = ys.aabb;
            if (ys.isBox ? !boxesPenetrate(s.box, yb, TOLERANCE.penetration) : penetrationDepth(solidFromBox(s.box), ys) <= TOLERANCE.penetration) continue;
            if (world.studTarget.get(studKey(x.inst.instanceId, s.connector.def.id)) === y.inst.instanceId) continue;
            const pd = partialInsertionDepth(x, s, y);
            if (pd === null) partialAll = false;
            else partialDepth = pd;
            if (pd === null && hollowStudMeetsPin(x, s.connector.def.id, y)) viaHollow = true;
            rec(`Noppe ${x.inst.instanceId}:${s.connector.def.id}↔Körper`, s.box, yb);
          }
      for (const sa of a.studs) for (const sb of b.studs) if (boxesPenetrate(sa.box, sb.box, TOLERANCE.penetration)) { rec('Noppe↔Noppe', sa.box, sb.box); partialAll = false; }
      if (!kinds.length) continue;
      const approximate = a.approximateVolume || b.approximateVolume || !a.axisAligned || !b.axisAligned;
      const onlyHollow = viaHollow && kinds.every((k) => k.startsWith('Noppe ') && !k.startsWith('Noppe↔'));
      const partial = !approximate && partialAll && partialDepth !== null;
      out.push({
        a: a.inst.instanceId,
        b: b.inst.instanceId,
        kinds,
        depth,
        classification: approximate || onlyHollow ? 'unchecked' : partial ? 'partial-insertion' : 'penetration',
        insertionDepth: partial ? Number(partialDepth!.toFixed(2)) : undefined,
        reason: approximate
          ? 'grob modellierte Hülle'
          : onlyHollow
            ? 'Unterseitenstift in Hohlnoppe außerhalb des belegten Geltungsbereichs von R-UPIN-HOLLOWSTUD (nur 3004 auf 6541)'
            : partial
              ? 'Noppe koaxial zur Aufnahme, aber nicht vollständig eingesteckt'
              : null,
      });
    }
  return out;
}

/** Alle Volumen einer Instanz (Körper + Noppen) mit Kennzeichnung (Körper als umhüllende Quader). */
export function allBoxes(w: WorldInstance): { box: Box; studId: string | null }[] {
  return [...w.bodySolids.map((s) => ({ box: s.aabb, studId: null })), ...w.studs.map((s) => ({ box: s.box, studId: s.connector.def.id }))];
}

/** Alle Volumen als konvexe Körper (exakt für Schrägen/Keilplatten). */
export function allSolids(w: WorldInstance): { solid: Solid; studId: string | null }[] {
  return [...w.bodySolids.map((solid) => ({ solid, studId: null })), ...w.studs.map((s) => ({ solid: solidFromBox(s.box), studId: s.connector.def.id }))];
}

/** Berühren sich zwei Instanzen (exakt für konvexe Körper)? */
export function instancesTouch(a: WorldInstance, b: WorldInstance, tol: number): boolean {
  return allSolids(a).some((x) => allSolids(b).some((y) => solidsTouch(x.solid, y.solid, tol)));
}
