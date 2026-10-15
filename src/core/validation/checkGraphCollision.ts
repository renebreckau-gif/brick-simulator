// Schichten „Verbindungsgraph“ und „Kollision“.
import { RULES_VERSION } from '../connectivity/rules';
import { boxesTouch, dot } from '../math';
import type { CanonicalModel } from '../model/types';
import { TOLERANCE } from '../units';
import { affected, finding, type Finding } from './findings';
import { allBoxes, pairKey, type World, type WorldInstance } from './world';

export class UnionFind {
  private parent = new Map<string, string>();
  add(x: string) {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x: string): string {
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (this.parent.get(c) !== r) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
}

/** Zusammenhangskomponenten über reguläre Verbindungen, optional auf eine Teilmenge beschränkt. */
export function components(world: World, subset?: Set<string>): string[][] {
  const uf = new UnionFind();
  const ids = subset ? [...subset] : [...world.instances.keys()];
  ids.forEach((i) => uf.add(i));
  for (const c of world.connections) {
    if (subset && (!subset.has(c.male.instanceId) || !subset.has(c.female.instanceId))) continue;
    uf.union(c.male.instanceId, c.female.instanceId);
  }
  const groups = new Map<string, string[]>();
  for (const i of ids) {
    const r = uf.find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(i);
  }
  return [...groups.values()].map((g) => g.sort()).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

function touching(a: WorldInstance, b: WorldInstance): boolean {
  return allBoxes(a).some((x) => allBoxes(b).some((y) => boxesTouch(x.box, y.box, TOLERANCE.contact)));
}

function isUnsupportedish(w: WorldInstance): boolean {
  return w.part.simulation !== 'supported' || !w.axisAligned || !w.rigid;
}

function descendantsOf(model: CanonicalModel, assemblyId: string): Set<string> {
  const out = new Set([assemblyId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of model.assemblies) if (a.parentId && out.has(a.parentId) && !out.has(a.assemblyId)) { out.add(a.assemblyId); grew = true; }
  }
  return out;
}

export function checkGraph(model: CanonicalModel, world: World): Finding[] {
  const out: Finding[] = [];
  const comps = components(world);
  if (comps.length <= 1) {
    out.push(finding({
      code: 'GRAPH_CONNECTED', layer: 'graph', dimension: 'assembly', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
      title: 'Modell zusammenhängend', message: 'Alle Teile sind über reguläre Steckverbindungen zu einer Komponente verbunden.',
      ruleVersion: RULES_VERSION, evidence: { components: comps.length },
      limitation: 'Ein zusammenhängender Graph ist kein Nachweis der Tragfähigkeit.',
    }));
    return out;
  }
  const separateModules = model.assemblies.filter((a) => a.separateModule);
  const main = comps[0];
  const mainSet = new Set(main);
  out.push(finding({
    code: 'GRAPH_MAIN_COMPONENT', layer: 'graph', dimension: 'assembly', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
    title: `Hauptkomponente: ${main.length} von ${world.instances.size} Teilen verbunden`, message: `Das Modell zerfällt in ${comps.length} Komponenten; die übrigen werden einzeln bewertet.`,
    affected: affected(main), ruleVersion: RULES_VERSION, evidence: { components: comps.map((c) => c.length) },
  }));
  for (const comp of comps.slice(1)) {
    const assemblies = new Set(comp.map((i) => world.instances.get(i)!.inst.assemblyId));
    const module = separateModules.find((m) => {
      const d = descendantsOf(model, m.assemblyId);
      return [...assemblies].every((a) => d.has(a));
    });
    if (module) {
      out.push(finding({
        code: 'GRAPH_SEPARATE_MODULE', layer: 'graph', dimension: 'assembly', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
        title: `Deklariertes separates Modul „${module.name}“`, message: 'Diese Komponente ist absichtlich nicht mit dem Hauptmodell verbunden.',
        affected: affected(comp, [], [module.assemblyId]), ruleVersion: RULES_VERSION,
      }));
      continue;
    }
    // Kontakte zu anderen Komponenten untersuchen
    const others = [...world.instances.values()].filter((w) => !comp.includes(w.inst.instanceId));
    const contacts: { a: WorldInstance; b: WorldInstance }[] = [];
    for (const id of comp) {
      const a = world.instances.get(id)!;
      for (const b of others) if (touching(a, b)) contacts.push({ a, b });
    }
    // Teile ohne Volumen/Regeln (außerhalb des Umfangs) können keinen Kontakt zeigen → ungeprüft statt lose
    const unknownGeometry = comp.filter((id) => !world.instances.get(id)!.meta || world.instances.get(id)!.bodyBoxes.length === 0);
    if (unknownGeometry.length) {
      out.push(finding({
        code: 'GRAPH_UNKNOWN_LINK', layer: 'graph', dimension: 'assembly', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
        title: 'Anbindung nicht prüfbar (Teil ohne Geometrie/Regeln)', message: `${unknownGeometry.length} Teil(e) liegen außerhalb des unterstützten Umfangs; ob sie verbunden sind, bleibt ungeprüft.`,
        affected: affected(comp), ruleVersion: RULES_VERSION, evidence: { component: comp, withoutGeometry: unknownGeometry },
      }));
      continue;
    }
    const viaUnsupported = contacts.filter((c) => isUnsupportedish(c.a) || isUnsupportedish(c.b));
    const sideways = contacts.filter((c) => Math.abs(dot(c.a.upAxis, c.b.upAxis)) < 0.999);
    const touchedIds = contacts.map((c) => c.b.inst.instanceId);
    if (viaUnsupported.length) {
      out.push(finding({
        code: 'GRAPH_UNKNOWN_LINK', layer: 'graph', dimension: 'assembly', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
        title: 'Anbindung über nicht unterstützte Technik', message: `${comp.length} Teil(e) berühren das übrige Modell nur über Teile/Merkmale ohne implementierte Regeln. Ob sie verbunden sind, bleibt ungeprüft.`,
        affected: affected([...comp, ...touchedIds]), ruleVersion: RULES_VERSION,
        evidence: { component: comp, contacts: viaUnsupported.map((c) => [c.a.inst.instanceId, c.b.inst.instanceId]) },
      }));
    } else if (sideways.length) {
      out.push(finding({
        code: 'GRAPH_SNOT_UNSUPPORTED', layer: 'graph', dimension: 'assembly', status: 'unsupported', severity: 'warning', evidenceLevel: 'unchecked',
        title: 'Seitliche Anordnung (SNOT) – nicht unterstützt', message: 'Teile mit unterschiedlicher Noppenrichtung berühren sich ohne passende Anschlüsse. Seitliches Bauen erfordert SNOT-Spezialteile, deren Regeln nicht implementiert sind.',
        affected: affected([...comp, ...touchedIds]), ruleVersion: RULES_VERSION,
        evidence: { component: comp, contacts: sideways.map((c) => [c.a.inst.instanceId, c.b.inst.instanceId]) },
        remedy: 'Mit regulären Steckverbindungen bauen oder auf SNOT-Unterstützung (spätere Phase) warten.',
      }));
    } else {
      out.push(finding({
        code: 'GRAPH_LOOSE', layer: 'graph', dimension: 'assembly', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
        title: contacts.length ? 'Lose Komponente (nur Berührung)' : 'Schwebende Komponente',
        message: contacts.length
          ? `${comp.length} Teil(e) berühren das Modell, sind aber über keine reguläre Steckverbindung verbunden.`
          : `${comp.length} Teil(e) haben keinen Kontakt zum übrigen Modell.`,
        affected: affected(comp), ruleVersion: RULES_VERSION,
        evidence: { component: comp, touches: touchedIds, mainComponentSize: mainSet.size },
        remedy: 'Teil auf Noppen/Aufnahmen ausrichten, verbindendes Teil ergänzen oder als separates Modul deklarieren.',
      }));
    }
  }
  return out;
}

export function checkCollisions(world: World): Finding[] {
  const out: Finding[] = [];
  const n = world.instances.size;
  const checkedPairs = (n * (n - 1)) / 2;
  for (const o of world.overlaps) {
    const kinds = [...new Set(o.kinds)];
    out.push(o.classification === 'unchecked'
      ? finding({
          code: 'COL_UNCHECKED', layer: 'collision', dimension: 'assembly', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
          title: o.reason?.startsWith('Unterseitenstift') ? 'Unterseitenstift in Hohlnoppe – ungeprüft' : 'Überschneidung mit grob modelliertem Teil',
          message: o.reason?.startsWith('Unterseitenstift')
            ? 'Eine Hohlnoppe greift koaxial unter den Unterseitenstift eines 1×N-Teils. Das ist eine reale Technik, deren Regel nicht implementiert ist – weder bestanden noch Durchdringung.'
            : 'Die Hüllvolumen überschneiden sich. Da mindestens ein Teil nur als grobe Hülle modelliert ist, kann eine reguläre Verbindung (z. B. Stange in Halter) nicht von einer Durchdringung unterschieden werden.',
          affected: affected([o.a, o.b]), ruleVersion: RULES_VERSION,
          evidence: { kinds, depthLDU: Number(o.depth.toFixed(2)), reason: o.reason },
          limitation: o.reason?.startsWith('Unterseitenstift') ? 'Regel R-UPIN-HOLLOWSTUD ist nur im Datenmodell erfasst.' : 'Hüllvolumen = LDraw-Begrenzungsbox.',
        })
      : finding({
          code: 'COL_PENETRATION', layer: 'collision', dimension: 'assembly', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
          title: 'Durchdringung', message: `Teile überschneiden sich um mindestens ${o.depth.toFixed(1)} LDU (Toleranz ${TOLERANCE.penetration} LDU): ${kinds.join(', ')}.`,
          affected: affected([o.a, o.b]), ruleVersion: RULES_VERSION,
          evidence: { kinds, depthLDU: Number(o.depth.toFixed(2)), tolerance: TOLERANCE.penetration, pair: pairKey(o.a, o.b) },
          limitation: 'Achsparallele Näherung: Noppen als Quader (konservativ), Hohlräume nur als Noppenaufnahmen modelliert.',
          remedy: 'Teil verschieben, bis es regulär auf Noppen sitzt oder nur berührt.',
        }));
  }
  if (!out.some((f) => f.code === 'COL_PENETRATION'))
    out.push(finding({
      code: 'COL_NONE', layer: 'collision', dimension: 'assembly', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
      title: 'Keine Durchdringung im unterstützten Umfang', message: `${checkedPairs} Teilepaare geprüft; Kontakt und reguläre Noppenverbindungen gelten nicht als Durchdringung.`,
      ruleVersion: RULES_VERSION, evidence: { pairs: checkedPairs, tolerance: TOLERANCE.penetration },
      limitation: 'Achsparallele Volumennäherung.',
    }));
  return out;
}
