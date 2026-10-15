// Weltdarstellung eines Modells: Volumen und Anschlüsse aller Instanzen in Weltkoordinaten
// sowie die erkannten regulären Verbindungen (nur implementierte Regeln).
import type { Catalog, CatalogPart } from '../catalog/catalog';
import { studBox, type ConnectorDef, type PartMeta } from '../connectivity/partMeta';
import { isImplementedKind, ruleFor } from '../connectivity/rules';
import { apply, applyTransform, boxesPenetrate, det, dist, dot, isAxisAligned, orthonormalityError, transformBox, type Box, type Transform, type Vec3 } from '../math';
import type { CanonicalModel, PartInstance } from '../model/types';
import { TOLERANCE } from '../units';

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
  female: { instanceId: string; connectorId: string; kind: 'antistud' | 'tube' };
  ruleId: string;
  position: Vec3;
  /** Weltrichtung der Noppe (zeigt aus dem männlichen Teil heraus). */
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
    studs,
    connectors,
    upAxis: apply(inst.rotation, [0, -1, 0]),
    axisAligned: isAxisAligned(inst.rotation, TOLERANCE.axisAlignment),
    rigid,
    approximateVolume: meta?.approximateVolume ?? true,
  };
}

/** Erkennt reguläre Verbindungen: Noppe ↔ Aufnahme/Röhre, deckungsgleich, Achsen entgegengesetzt. */
export function detectConnections(instances: WorldInstance[]): Connection[] {
  const males: WorldConnector[] = [];
  const females: WorldConnector[] = [];
  for (const w of instances) {
    if (!w.rigid) continue; // verformte Teile: keine Verbindung werten (eigener Befund)
    for (const c of w.connectors) {
      if (!isImplementedKind(c.def.kind)) continue;
      if (c.def.kind === 'stud') males.push(c);
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
      const rule = ruleFor('stud', f.def.kind);
      if (!rule || rule.status !== 'implemented') continue;
      out.push({
        id: `${m.instanceId}::${m.def.id}->${f.instanceId}::${f.def.id}`,
        male: { instanceId: m.instanceId, connectorId: m.def.id },
        female: { instanceId: f.instanceId, connectorId: f.def.id, kind: f.def.kind as 'antistud' | 'tube' },
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
    studTarget.set(studKey(c.male.instanceId, c.male.connectorId), c.female.instanceId);
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
  /** penetration = echte Durchdringung im Regelumfang; unchecked = mögliche nicht unterstützte Verbindung/grobe Hülle. */
  classification: 'penetration' | 'unchecked';
  reason: string | null;
}

/** Hohlnoppe von x trifft koaxial einen Unterseitenstift von y (Regel R-UPIN-HOLLOWSTUD, nicht implementiert). */
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
      const rec = (k: string, x: Box, y: Box) => {
        kinds.push(k);
        const d = [Math.min(x.max[0], y.max[0]) - Math.max(x.min[0], y.min[0]), Math.min(x.max[1], y.max[1]) - Math.max(x.min[1], y.min[1]), Math.min(x.max[2], y.max[2]) - Math.max(x.min[2], y.min[2])];
        depth = Math.max(depth, Math.min(...d));
      };
      for (const ab of a.bodyBoxes) for (const bb of b.bodyBoxes) if (boxesPenetrate(ab, bb, TOLERANCE.penetration)) rec('Körper↔Körper', ab, bb);
      for (const [x, y] of [[a, b], [b, a]] as const)
        for (const s of x.studs)
          for (const yb of y.bodyBoxes) {
            if (!boxesPenetrate(s.box, yb, TOLERANCE.penetration)) continue;
            if (world.studTarget.get(studKey(x.inst.instanceId, s.connector.def.id)) === y.inst.instanceId) continue;
            if (hollowStudMeetsPin(x, s.connector.def.id, y)) viaHollow = true;
            rec(`Noppe ${x.inst.instanceId}:${s.connector.def.id}↔Körper`, s.box, yb);
          }
      for (const sa of a.studs) for (const sb of b.studs) if (boxesPenetrate(sa.box, sb.box, TOLERANCE.penetration)) rec('Noppe↔Noppe', sa.box, sb.box);
      if (!kinds.length) continue;
      const approximate = a.approximateVolume || b.approximateVolume || !a.axisAligned || !b.axisAligned;
      const onlyHollow = viaHollow && kinds.every((k) => k.startsWith('Noppe ') && !k.startsWith('Noppe↔'));
      out.push({
        a: a.inst.instanceId,
        b: b.inst.instanceId,
        kinds,
        depth,
        classification: approximate || onlyHollow ? 'unchecked' : 'penetration',
        reason: approximate ? 'grob modellierte Hülle' : onlyHollow ? 'Unterseitenstift in Hohlnoppe (Regel R-UPIN-HOLLOWSTUD nicht implementiert)' : null,
      });
    }
  return out;
}

/** Alle Volumen einer Instanz (Körper + Noppen) mit Kennzeichnung. */
export function allBoxes(w: WorldInstance): { box: Box; studId: string | null }[] {
  return [...w.bodyBoxes.map((box) => ({ box, studId: null })), ...w.studs.map((s) => ({ box: s.box, studId: s.connector.def.id }))];
}
