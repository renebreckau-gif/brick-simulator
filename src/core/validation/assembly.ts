// Schrittweise Montageprüfung für gerade Steckbewegungen entlang der Noppenachse.
//
// Je Schritt werden Einzelteile bzw. separat gebaute Baugruppen („Einheiten“) zum bisherigen
// Bauzustand hinzugefügt. Für jede Einheit:
//  1. Erforderliche Bewegungsrichtung aus den Verbindungen zum Bestand ableiten
//     (Aufnahme auf Bestandsnoppe → Bewegung gegen die Noppenachse; eigene Noppe in
//     Bestandsaufnahme → Bewegung entlang der Noppenachse). Widerspruch = Klemmposition.
//  2. Deklarierte Einschubrichtung (falls vorhanden) gegen die Verbindungen prüfen.
//  3. Weg prüfen: Volumen der Einheit von „unendlich weit“ bis zur Endposition entlang der
//     Richtung fegen; Überschneidung mit Bestandsvolumen = Weg blockiert
//     (ausgenommen Noppen, die am Ende regulär in die Einheit greifen und umgekehrt).
// Nicht untersuchte Bewegungen (seitliches Einschieben, Drehen, Biegen) bleiben ungeprüft.
import { RULES_VERSION } from '../connectivity/rules';
import { boxesPenetrate, dot, type Box, type Vec3 } from '../math';
import type { CanonicalModel, StepDef } from '../model/types';
import { TOLERANCE } from '../units';
import { components } from './checkGraphCollision';
import { affected, finding, type Finding } from './findings';
import { analyzeStability } from './stability';
import { penetrationDepth, solidFromBox, sweepSolid, type Solid } from './solids';
import { pairKey, studKey, type Connection, type World } from './world';

// 1.1.0: Steckwege mit gefegten Prismenkörpern (exakt für Schrägen und Keile, Auftrag 05B.1)
export const ASSEMBLY_RULES_VERSION = 'assembly-rules@1.1.0';
const AXES: Vec3[] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

export interface UnitResult {
  unitId: string;
  kind: 'part' | 'module';
  instanceIds: string[];
  direction: Vec3 | null;
  directionSource: 'declared' | 'derived' | 'free' | 'none';
  status: 'ok' | 'blocked' | 'conflict' | 'mismatch' | 'unchecked';
  blockers: string[];
  connectionsToState: number;
  /** Bestandsteile, zu denen nur eine ungeprüfte Überschneidung/Technik besteht. */
  uncheckedWith: string[];
}

export interface StepResult {
  stepId: string;
  assemblyId: string;
  index: number;
  units: UnitResult[];
  /** Zustand des Baukontexts nach dem Schritt. */
  componentsAfter: number;
  standsAfter: boolean | null;
  supportDeclared: boolean;
}

export interface AssemblyAnalysis {
  steps: StepResult[];
  findings: Finding[];
}

const fmtDir = (d: Vec3 | null) => (d ? (d[1] > 0.5 ? 'von oben (nach unten)' : d[1] < -0.5 ? 'von unten (nach oben)' : `seitlich [${d.join(', ')}]`) : '–');

function sweep(box: Box, d: Vec3): Box {
  // Bewegung in Richtung d: die Einheit kam aus −d·∞
  const min: Vec3 = [...box.min];
  const max: Vec3 = [...box.max];
  for (let i = 0; i < 3; i++) {
    if (d[i] > 0.5) min[i] = -Infinity;
    if (d[i] < -0.5) max[i] = Infinity;
  }
  return { min, max };
}

/** Länge des gedachten Montagewegs für exakte Körper (LDU; „aus großer Entfernung“). */
const SWEEP_LENGTH = 100000;

function sameDir(a: Vec3, b: Vec3) {
  return dot(a, b) > 0.999;
}

export function analyzeAssembly(model: CanonicalModel, world: World): AssemblyAnalysis {
  const findings: Finding[] = [];
  const results: StepResult[] = [];

  if (model.steps.length === 0) {
    findings.push(finding({
      code: 'ASM_NO_STEPS', layer: 'assembly', dimension: 'assembly', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
      title: 'Keine belegte Baufolge', message: 'Für dieses Modell liegt keine Baufolge vor. Montagewege und Reihenfolge sind ungeprüft; nur der Endzustand wird bewertet.',
      ruleVersion: ASSEMBLY_RULES_VERSION,
      limitation: 'Ein automatischer Baufolgenplaner ist nicht Teil dieser Phase.',
    }));
    return { steps: results, findings };
  }

  // --- Konsistenz der Schrittliste
  const asmById = new Map(model.assemblies.map((a) => [a.assemblyId, a]));
  const added = new Map<string, number>();
  for (const s of model.steps) for (const id of s.add) added.set(id, (added.get(id) ?? 0) + 1);
  const missing = model.instances.filter((i) => !added.has(i.instanceId)).map((i) => i.instanceId);
  const dup = [...added].filter(([, n]) => n > 1).map(([id]) => id);
  const ghost = [...added.keys()].filter((id) => !world.instances.has(id));
  if (missing.length || dup.length || ghost.length)
    findings.push(finding({
      code: 'ASM_STEPS_INCONSISTENT', layer: 'assembly', dimension: 'assembly', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
      title: 'Baufolge passt nicht zum Modell', message: `Nicht in Schritten: ${missing.length}, mehrfach: ${dup.length}, unbekannt: ${ghost.length}.`,
      affected: affected([...missing, ...dup]), ruleVersion: ASSEMBLY_RULES_VERSION,
      evidence: { missing, duplicate: dup, unknown: ghost },
      remedy: 'Baufolge aus derselben Modellversion neu erzeugen.',
    }));

  // Baukontext: nächste Baugruppe, die separat gebaut wird (oder Wurzel)
  const contextOf = (assemblyId: string): string => {
    let a = asmById.get(assemblyId);
    while (a && a.parentId && !a.builtSeparately) a = asmById.get(a.parentId);
    return a?.assemblyId ?? model.rootAssemblyId;
  };
  const state = new Map<string, Set<string>>();
  const stateOf = (ctx: string) => state.get(ctx) ?? state.set(ctx, new Set()).get(ctx)!;

  const connectionsBetween = (unit: Set<string>, existing: Set<string>): Connection[] =>
    world.connections.filter((c) => (unit.has(c.male.instanceId) && existing.has(c.female.instanceId)) || (unit.has(c.female.instanceId) && existing.has(c.male.instanceId)));

  const boxesOf = (ids: Iterable<string>) => {
    const out: { id: string; box: Box; solid: Solid; studId: string | null }[] = [];
    for (const id of ids) {
      const w = world.instances.get(id);
      if (!w) continue;
      for (const s of w.bodySolids) out.push({ id, box: s.aabb, solid: s, studId: null });
      for (const s of w.studs) out.push({ id, box: s.box, solid: solidFromBox(s.box), studId: s.connector.def.id });
    }
    return out;
  };

  // Paare, deren Überschneidung auf eine nicht unterstützte Technik/grobe Hülle zurückgeht
  const uncheckedPairs = new Set(world.overlaps.filter((o) => o.classification === 'unchecked').map((o) => pairKey(o.a, o.b)));
  const uncheckedBetween = (unit: Set<string>, existing: Set<string>) =>
    world.overlaps.filter((o) => o.classification === 'unchecked' && ((unit.has(o.a) && existing.has(o.b)) || (unit.has(o.b) && existing.has(o.a))));

  const pathBlockers = (unit: Set<string>, existing: Set<string>, d: Vec3): string[] => {
    const blockers = new Set<string>();
    const ub = boxesOf(unit);
    const eb = boxesOf(existing);
    for (const u of ub) {
      const swept = sweep(u.box, d);
      // exakter Montageweg nur, wenn ein Schräg-/Keilkörper beteiligt ist (sonst gilt der Quadertest exakt)
      let sweptSolid: Solid | null = null;
      for (const e of eb) {
        if (uncheckedPairs.has(pairKey(u.id, e.id))) continue; // eigener Befund „ungeprüft“
        if (!boxesPenetrate(swept, e.box, TOLERANCE.penetration)) continue;
        if (!(u.solid.isBox && e.solid.isBox)) {
          sweptSolid ??= sweepSolid(u.solid, d, SWEEP_LENGTH);
          if (penetrationDepth(sweptSolid, e.solid) <= TOLERANCE.penetration) continue;
        }
        // Erlaubt: Noppe des Bestands, die regulär in die Einheit greift (und umgekehrt)
        if (e.studId && unit.has(world.studTarget.get(studKey(e.id, e.studId)) ?? '')) continue;
        if (u.studId && existing.has(world.studTarget.get(studKey(u.id, u.studId)) ?? '')) continue;
        blockers.add(e.id);
      }
    }
    return [...blockers].sort();
  };

  const instancesOfAssembly = (assemblyId: string): string[] => {
    const ids = new Set([assemblyId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const a of model.assemblies) if (a.parentId && ids.has(a.parentId) && !ids.has(a.assemblyId)) { ids.add(a.assemblyId); grew = true; }
    }
    return model.instances.filter((i) => ids.has(i.assemblyId)).map((i) => i.instanceId);
  };

  const placeUnitRaw = (step: StepDef, unitId: string, kind: 'part' | 'module', ids: string[], existing: Set<string>): UnitResult => {
    const unit = new Set(ids);
    const conns = connectionsBetween(unit, existing);
    const required: Vec3[] = [];
    for (const c of conns) {
      const d: Vec3 = unit.has(c.male.instanceId) ? c.studAxis : [-c.studAxis[0], -c.studAxis[1], -c.studAxis[2]];
      if (!required.some((r) => sameDir(r, d))) required.push(d);
    }
    const declared = step.insertion?.[unitId] ?? null;
    const res: UnitResult = { unitId, kind, instanceIds: ids, direction: null, directionSource: 'none', status: 'ok', blockers: [], connectionsToState: conns.length, uncheckedWith: [] };
    res.uncheckedWith = [...new Set(uncheckedBetween(unit, existing).map((o) => (unit.has(o.a) ? o.b : o.a)))].sort();

    if (required.length > 1) {
      res.status = 'conflict';
      res.blockers = [...new Set(conns.map((c) => (unit.has(c.male.instanceId) ? c.female.instanceId : c.male.instanceId)))].sort();
      return res;
    }
    if (declared) {
      res.direction = declared;
      res.directionSource = 'declared';
      if (required.length === 1 && !sameDir(required[0], declared)) {
        res.status = 'mismatch';
        return res;
      }
    } else if (required.length === 1) {
      res.direction = required[0];
      res.directionSource = 'derived';
    }
    if (res.direction) {
      res.blockers = pathBlockers(unit, existing, res.direction);
      if (res.blockers.length) res.status = 'blocked';
      return res;
    }
    // Keine Verbindung zum Bestand: irgendein freier gerader Weg genügt (Ablegen/Halten)
    res.directionSource = 'free';
    for (const d of AXES) {
      const b = pathBlockers(unit, existing, d);
      if (!b.length) {
        res.direction = d;
        return res;
      }
      if (!res.blockers.length) res.blockers = b;
    }
    res.status = 'blocked';
    return res;
  };

  const placeUnit = (step: StepDef, unitId: string, kind: 'part' | 'module', ids: string[], existing: Set<string>): UnitResult => {
    const r = placeUnitRaw(step, unitId, kind, ids, existing);
    const noVolume = ids.some((id) => !world.instances.get(id)?.bodySolids.length);
    if (r.status === 'ok' && (r.uncheckedWith.length || noVolume)) r.status = 'unchecked';
    return r;
  };
  const placeable = (r: UnitResult) => r.status === 'ok' || r.status === 'unchecked';

  model.steps.forEach((step, index) => {
    const ctx = contextOf(step.assemblyId);
    const existing = stateOf(ctx);
    const pending: { unitId: string; kind: 'part' | 'module'; ids: string[] }[] = [
      ...step.add.filter((id) => world.instances.has(id)).map((id) => ({ unitId: id, kind: 'part' as const, ids: [id] })),
      ...step.attach.map((aid) => {
        const ids = instancesOfAssembly(aid);
        const built = stateOf(contextOf(aid));
        const incomplete = ids.filter((i) => !built.has(i));
        if (incomplete.length)
          findings.push(finding({
            code: 'ASM_MODULE_INCOMPLETE', layer: 'assembly', dimension: 'assembly', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
            title: 'Baugruppe vor Fertigstellung angesetzt', message: `${incomplete.length} Teil(e) der Baugruppe ${aid} sind zu diesem Zeitpunkt noch nicht gebaut.`,
            affected: affected(incomplete, [step.stepId], [aid]), ruleVersion: ASSEMBLY_RULES_VERSION,
          }));
        return { unitId: aid, kind: 'module' as const, ids };
      }),
    ];
    const units: UnitResult[] = [];
    // Reihenfolge innerhalb eines Schritts ist nicht belegt: zuerst Einheiten mit Verbindung
    // zum Bestand und freiem Weg platzieren, dann lose Ablagen.
    while (pending.length) {
      let pickIdx = -1;
      let pickRes: UnitResult | null = null;
      for (const pass of ['anchored', 'any'] as const) {
        for (let i = 0; i < pending.length; i++) {
          const p = pending[i];
          const r = placeUnit(step, p.unitId, p.kind, p.ids, existing);
          if (placeable(r) && (pass === 'any' || r.connectionsToState > 0)) { pickIdx = i; pickRes = r; break; }
        }
        if (pickRes) break;
      }
      if (!pickRes) {
        // Keine Einheit platzierbar: alle verbleibenden mit ihrem Fehler melden
        for (const p of pending) {
          const r = placeUnit(step, p.unitId, p.kind, p.ids, existing);
          units.push(r);
          p.ids.forEach((id) => existing.add(id));
        }
        break;
      }
      units.push(pickRes);
      pending[pickIdx].ids.forEach((id) => existing.add(id));
      pending.splice(pickIdx, 1);
    }

    // Zwischenzustand
    const comps = components(world, existing);
    const isRoot = ctx === model.rootAssemblyId;
    const stab = isRoot ? analyzeStability([...existing].map((id) => world.instances.get(id)!).filter(Boolean)) : null;
    const supportDeclared = !!step.support;
    results.push({ stepId: step.stepId, assemblyId: step.assemblyId, index, units, componentsAfter: comps.length, standsAfter: stab ? stab.stands && comps.length === 1 : null, supportDeclared });

    for (const u of units) {
      const base = { layer: 'assembly' as const, dimension: 'assembly' as const, ruleVersion: `${ASSEMBLY_RULES_VERSION}+${RULES_VERSION}` };
      if (u.status === 'conflict')
        findings.push(finding({
          ...base, code: 'ASM_CONFLICTING_DIRECTIONS', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
          title: 'Endposition passt, Einschub unmöglich (Klemmposition)',
          message: `${u.kind === 'module' ? 'Baugruppe' : 'Teil'} ${u.unitId} müsste gleichzeitig von oben und von unten auf bereits verbaute Teile gesteckt werden.`,
          affected: affected([...u.instanceIds, ...u.blockers], [step.stepId], u.kind === 'module' ? [u.unitId] : []),
          evidence: { counterparts: u.blockers },
          limitation: 'Nur gerade Steckbewegungen untersucht.',
          remedy: 'Reihenfolge ändern (Teil vor dem darüberliegenden einsetzen) oder als vormontierte Baugruppe ansetzen.',
        }));
      else if (u.status === 'mismatch')
        findings.push(finding({
          ...base, code: 'ASM_DIRECTION_MISMATCH', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
          title: 'Deklarierte Einschubrichtung widerspricht Steckverbindung',
          message: `Deklariert: ${fmtDir(u.direction)}; die Verbindungen erfordern eine andere Richtung.`,
          affected: affected(u.instanceIds, [step.stepId]),
        }));
      else if (u.status === 'blocked')
        findings.push(finding({
          ...base, code: 'ASM_PATH_BLOCKED', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
          title: 'Einschubweg blockiert',
          message: `${u.kind === 'module' ? 'Baugruppe' : 'Teil'} ${u.unitId}: Weg ${fmtDir(u.direction)} bis zur Endposition ist durch ${u.blockers.length} bereits verbaute(s) Teil(e) versperrt.`,
          affected: affected([...u.instanceIds, ...u.blockers], [step.stepId]),
          evidence: { direction: u.direction, directionSource: u.directionSource, blockers: u.blockers },
          limitation: 'Seitliches Einschieben, Kippen oder Biegen nicht untersucht.',
          remedy: 'Teil früher einsetzen oder blockierende Teile später montieren.',
        }));
      else if (u.status === 'unchecked')
        findings.push(finding({
          ...base, code: 'ASM_UNIT_UNCHECKED', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
          title: 'Montage über nicht unterstützte Technik – ungeprüft',
          message: `${u.unitId} greift in ${u.uncheckedWith.length} Teil(e) über eine Technik ohne implementierte Regel (z. B. Hohlnoppe, Stange, Technic). Weg und Verbindung sind dafür nicht prüfbar.`,
          affected: affected([...u.instanceIds, ...u.uncheckedWith], [step.stepId]),
          evidence: { counterparts: u.uncheckedWith, direction: u.direction },
        }));
      else if (u.direction && u.direction[1] < -0.5 && u.connectionsToState > 0 && !supportDeclared)
        findings.push(finding({
          ...base, code: 'ASM_FROM_BELOW', status: 'passed', severity: 'info', evidenceLevel: 'heuristic',
          title: 'Ansetzen von unten', message: `${u.unitId} wird von unten angesteckt – der Bauzustand muss dafür angehoben oder gedreht werden (heuristische Einschätzung).`,
          affected: affected(u.instanceIds, [step.stepId]),
        }));
    }
    if (isRoot && comps.length > 1 && index < model.steps.length - 1)
      findings.push(finding({
        layer: 'assembly', dimension: 'assembly', ruleVersion: ASSEMBLY_RULES_VERSION,
        code: 'ASM_INTERMEDIATE_SPLIT', status: 'passed', severity: 'info', evidenceLevel: 'heuristic',
        title: `Zwischenzustand nach Schritt ${index + 1}: ${comps.length} getrennte Teilgruppen`,
        message: supportDeclared ? `Deklarierte Unterstützung: ${step.support!.note}` : 'Die Gruppen liegen lose nebeneinander, bis ein späterer Schritt sie verbindet. Kein Montageblocker.',
        affected: affected([], [step.stepId]),
      }));
    if (stab && !stab.stands && comps.length === 1)
      findings.push(finding({
        layer: 'assembly', dimension: 'robustness', ruleVersion: ASSEMBLY_RULES_VERSION,
        code: supportDeclared ? 'ASM_SUPPORT_DECLARED' : 'ASM_INTERMEDIATE_UNSTABLE',
        status: supportDeclared ? 'passed' : 'unchecked', severity: supportDeclared ? 'info' : 'warning', evidenceLevel: 'heuristic',
        title: supportDeclared ? `Schritt ${index + 1}: dokumentierte ${step.support!.kind === 'hand' ? 'Handunterstützung' : 'Hilfsstütze'}` : `Zwischenzustand nach Schritt ${index + 1} steht voraussichtlich nicht selbstständig`,
        message: supportDeclared
          ? `${step.support!.note} (Quelle: ${step.support!.source}). Der Zwischenzustand wäre ohne Unterstützung voraussichtlich nicht standfähig.`
          : 'Schwerpunkt liegt außerhalb der Aufstandsfläche (heuristische Einschätzung). Kein Montageblocker; ggf. Handunterstützung deklarieren.',
        affected: affected([], [step.stepId]),
        evidence: { marginLDU: stab.marginLDU, centerOfMass: stab.centerOfMass },
      }));
  });

  // Gesamtergebnis
  const failed = findings.some((f) => f.layer === 'assembly' && f.status === 'failed');
  const uncheckedUnits = results.flatMap((r) => r.units).filter((u) => u.status === 'unchecked').length;
  if (!failed)
    findings.push(finding({
      code: 'ASM_SEQUENCE_OK', layer: 'assembly', dimension: 'assembly', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
      title: uncheckedUnits ? `Baufolge im unterstützten Umfang ausführbar (${uncheckedUnits} Einheit(en) ungeprüft)` : 'Baufolge im unterstützten Umfang ausführbar',
      message: `${model.steps.length} Schritte: jede geprüfte Einheit hat einen freien geraden Steckweg ${model.steps.some((s) => s.insertion) ? '(teils deklarierte, sonst abgeleitete Richtung)' : '(Richtung aus den Verbindungen abgeleitet)'}.`,
      ruleVersion: ASSEMBLY_RULES_VERSION,
      evidence: { steps: model.steps.length, source: model.stepsSource },
      limitation: 'Gerade Steckbewegungen; Fingerzugang, Steckkraft und Toleranzen nicht modelliert.',
    }));
  return { steps: results, findings };
}
