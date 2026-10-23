// Prüfschicht „Funktion“ (Auftrag 05B.2): deklarierte Funktionsanforderungen gegen das Endmodell.
//  - Freiraum: Kein Teilkörper und keine Noppe ragt in ein freizuhaltendes Volumen (Berühren ist erlaubt).
//  - Entnahme: Eine abnehmbare Baugruppe hängt nur über Steckverbindungen in Entnahmerichtung am Rest, hält als
//    Ganzes zusammen, und ihr gerader Weg ist frei (dieselbe Wegprüfung wie bei der Montage, umgekehrt gelesen).
//  - Anschluss: Für spätere Baugruppen vorgesehene Noppen sind frei.
// Ohne deklarierte Anforderungen entsteht kein Befund. Nicht untersucht: Drehen, Kippen, Klemmkraft beim Abnehmen.
import { dot, type Vec3 } from '../math';
import type { CanonicalModel } from '../model/types';
import { TOLERANCE } from '../units';
import { straightPathBlockers } from './assembly';
import { components } from './checkGraphCollision';
import { affected, finding, type Finding } from './findings';
import { penetrationDepth, solidFromBox } from './solids';
import { studKey, type World } from './world';

export const FUNCTION_RULES_VERSION = 'function-rules@1.0.0';

const base = { layer: 'function' as const, ruleVersion: FUNCTION_RULES_VERSION };

/** Instanzen einer Baugruppe samt Unterbaugruppen. */
function instancesOf(model: CanonicalModel, assemblyId: string): string[] {
  const ids = new Set([assemblyId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of model.assemblies) if (a.parentId && ids.has(a.parentId) && !ids.has(a.assemblyId)) { ids.add(a.assemblyId); grew = true; }
  }
  return model.instances.filter((i) => ids.has(i.assemblyId)).map((i) => i.instanceId);
}

export function checkFunction(model: CanonicalModel, world: World): Finding[] {
  const spec = model.functional;
  if (!spec) return [];
  const out: Finding[] = [];

  for (const k of spec.keepouts) {
    const box = solidFromBox({ min: k.min, max: k.max });
    const intruders: { id: string; depth: number; what: 'Körper' | 'Noppe' }[] = [];
    const approx: string[] = [];
    for (const [id, w] of world.instances) {
      if (w.approximateVolume) approx.push(id);
      let worst: { depth: number; what: 'Körper' | 'Noppe' } | null = null;
      for (const s of w.bodySolids) { const d = penetrationDepth(s, box); if (d > TOLERANCE.penetration && (!worst || d > worst.depth)) worst = { depth: d, what: 'Körper' }; }
      for (const st of w.studs) { const d = penetrationDepth(solidFromBox(st.box), box); if (d > TOLERANCE.penetration && (!worst || d > worst.depth)) worst = { depth: d, what: 'Noppe' }; }
      if (worst) intruders.push({ id, ...worst });
    }
    const size = [0, 1, 2].map((i) => k.max[i] - k.min[i]);
    out.push(finding({
      ...base, dimension: 'usage',
      code: intruders.length ? 'FUNC_KEEPOUT_VIOLATED' : approx.length ? 'FUNC_KEEPOUT_UNCHECKED' : 'FUNC_KEEPOUT_CLEAR',
      status: intruders.length ? 'failed' : approx.length ? 'unchecked' : 'passed',
      severity: intruders.length ? 'blocker' : approx.length ? 'warning' : 'info',
      evidenceLevel: intruders.length || !approx.length ? 'confirmed' : 'unchecked',
      title: intruders.length ? `${k.label}: ${intruders.length} Teil(e) ragen hinein` : `${k.label} frei`,
      message: intruders.length
        ? intruders.map((x) => `${x.id} (${x.what}, ${x.depth.toFixed(1)} LDU)`).join(', ')
        : `Freiraum ${size[0]} × ${size[2]} LDU Grundfläche, ${size[1]} LDU hoch (≈ ${(size[0] * 0.4).toFixed(0)} × ${(size[2] * 0.4).toFixed(0)} × ${(size[1] * 0.4).toFixed(0)} mm): kein Teilkörper und keine Noppe ragt hinein.${approx.length ? ` Grob modellierte Teile (${approx.length}) nicht genau prüfbar.` : ''}`,
      affected: affected(intruders.map((x) => x.id)),
      evidence: { keepout: k, intruders },
      limitation: 'Geprüft mit den Kollisionskörpern der Teilemetadaten (Quader, Prismen, Hüllen) und Noppenquadern; Berühren gilt als frei.',
      remedy: intruders.length ? 'Teile aus dem Freiraum nehmen oder den Freiraum anpassen.' : undefined,
    }));
  }

  for (const r of spec.removable) {
    const ids = instancesOf(model, r.assemblyId);
    const unit = new Set(ids);
    const rest = new Set([...world.instances.keys()].filter((id) => !unit.has(id)));
    const conns = world.connections.filter((c) => (unit.has(c.male.instanceId) && rest.has(c.female.instanceId)) || (unit.has(c.female.instanceId) && rest.has(c.male.instanceId)));
    // Entnahmerichtung je Verbindung: eigene Noppe steckt im Rest → gegen die Noppenachse; Noppe des Rests in der Einheit → entlang
    const locking = conns.filter((c) => { const d: Vec3 = unit.has(c.male.instanceId) ? [-c.studAxis[0], -c.studAxis[1], -c.studAxis[2]] : c.studAxis; return dot(d, r.direction) < 0.999; });
    const split = components(world, unit).length;
    const insertDir: Vec3 = [-r.direction[0], -r.direction[1], -r.direction[2]];
    const blockers = straightPathBlockers(world, unit, rest, insertDir);
    const ok = !locking.length && !blockers.length && split === 1 && ids.length > 0;
    out.push(finding({
      ...base, dimension: 'assembly',
      code: ok ? 'FUNC_REMOVAL_OK' : 'FUNC_REMOVAL_BLOCKED',
      status: ok ? 'passed' : 'failed', severity: ok ? 'info' : 'blocker', evidenceLevel: 'confirmed',
      title: ok ? `${r.label}: gerade abnehmbar` : `${r.label}: nicht gerade abnehmbar`,
      message: ok
        ? `${ids.length} Teile lösen sich als ein Stück; ${conns.length} Steckverbindung(en) zum Rest öffnen sich in Entnahmerichtung, der Weg ist frei.`
        : [
          !ids.length ? 'Baugruppe enthält keine Teile.' : '',
          split > 1 ? `Baugruppe zerfällt beim Abnehmen in ${split} Teile.` : '',
          locking.length ? `${locking.length} Verbindung(en) sperren die Richtung.` : '',
          blockers.length ? `Weg blockiert durch ${blockers.join(', ')}.` : '',
        ].filter(Boolean).join(' '),
      affected: affected([...ids, ...blockers], [], [r.assemblyId]),
      evidence: { direction: r.direction, connections: conns.length, locking: locking.map((c) => c.id), blockers, parts: ids.length },
      limitation: 'Nur gerade Bewegung; Klemmkraft und Griffmöglichkeit nicht bewertet. Ein Schnittbild allein belegt keinen Zugang.',
    }));
    if (ok && !conns.length)
      out.push(finding({
        ...base, dimension: 'robustness', code: 'FUNC_REMOVABLE_LOOSE', status: 'failed', severity: 'warning', evidenceLevel: 'confirmed',
        title: `${r.label}: liegt nur auf`, message: 'Keine Steckverbindung zum Rest – die Baugruppe ist nicht befestigt.', affected: affected(ids, [], [r.assemblyId]),
      }));
  }

  for (const itf of spec.interfaces) {
    const missing = itf.studs.filter((s) => !world.instances.get(s.instanceId)?.connectors.some((c) => c.def.id === s.connectorId && c.def.kind === 'stud'));
    const covered = itf.studs.filter((s) => world.studTarget.has(studKey(s.instanceId, s.connectorId)));
    const ok = !missing.length && !covered.length && itf.studs.length > 0;
    out.push(finding({
      ...base, dimension: 'assembly',
      code: ok ? 'FUNC_INTERFACE_FREE' : 'FUNC_INTERFACE_COVERED',
      status: ok ? 'passed' : 'failed', severity: ok ? 'info' : 'warning', evidenceLevel: 'confirmed',
      title: ok ? `${itf.label}: ${itf.studs.length} Noppen frei` : `${itf.label}: nicht frei`,
      message: ok ? 'Alle vorgesehenen Anschlussnoppen sind unbelegt.' : `${missing.length} fehlen, ${covered.length} sind belegt.`,
      affected: affected([...new Set(itf.studs.map((s) => s.instanceId))]),
      evidence: { interface: itf.id, missing, covered },
      limitation: 'Prüft nur, dass die Noppen frei sind – nicht, wie die spätere Baugruppe daran hält.',
    }));
  }
  return out;
}
