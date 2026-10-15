// Befunde zur Sonderverbindung R-UPIN-HOLLOWSTUD (Unterseitenstift in Hohlnoppe).
// Getrennt ausgewiesen:
//  1. geometrisch kompatibel (Nennmaße, Lage, Orientierung, Einstecktiefe)   → bestätigt im Regelumfang
//  2. im unterstützten Bewegungsmodell montierbar (gerade Steckbewegung)     → aus der Montageprüfung
//  3. mechanisch belastbar (Klemm-/Haltekraft)                                → ungeprüft (keine Kalibrierung)
import { CONNECTION_RULES, RULES_VERSION } from '../connectivity/rules';
import { checkUpinGeometry, UPIN_DIMENSION_TOLERANCE } from '../connectivity/upin';
import { dist, dot } from '../math';
import type { CanonicalModel } from '../model/types';
import { STUD_HEIGHT, TOLERANCE } from '../units';
import type { AssemblyAnalysis } from './assembly';
import { affected, finding, type Finding } from './findings';
import type { World } from './world';

const RULE = CONNECTION_RULES.find((r) => r.id === 'R-UPIN-HOLLOWSTUD')!;

export function checkSpecialConnections(model: CanonicalModel, world: World, assembly: AssemblyAnalysis): Finding[] {
  const out: Finding[] = [];
  for (const c of world.connections.filter((x) => x.ruleId === RULE.id)) {
    const mi = world.instances.get(c.male.instanceId)!;
    const fi = world.instances.get(c.female.instanceId)!;
    const pin = mi.connectors.find((x) => x.def.id === c.male.connectorId)!;
    const holder = fi.connectors.find((x) => x.def.id === c.female.connectorId)!;
    const geo = checkUpinGeometry(pin.def.geometry, holder.def.geometry);
    const lateral = dist(pin.position, holder.position);
    const axisDot = dot(pin.axis, holder.axis);

    // Montage: Schritt und Einheit, in der die Verbindung entsteht (das später gesetzte Teil)
    let mountedIn: { stepId: string; unitId: string; status: string; direction: number[] | null; source: string } | null = null;
    for (const s of assembly.steps)
      for (const u of s.units)
        if (u.instanceIds.includes(c.male.instanceId) || u.instanceIds.includes(c.female.instanceId))
          mountedIn = { stepId: s.stepId, unitId: u.unitId, status: u.status, direction: u.direction, source: u.directionSource };
    const ids = [c.male.instanceId, c.female.instanceId];
    const montage = !model.steps.length
      ? 'nicht geprüft (keine Baufolge)'
      : mountedIn
        ? `Schritt ${mountedIn.stepId}: ${mountedIn.status === 'ok' ? 'gerader Steckweg frei' : `Status „${mountedIn.status}“`} (Richtung ${mountedIn.source === 'declared' ? 'deklariert' : 'abgeleitet'})`
        : 'nicht ermittelt';

    out.push(finding({
      code: 'CON_UPIN_HOLLOWSTUD', layer: 'connection', dimension: 'assembly', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
      title: `Unterseitenstift in Hohlnoppe: ${mi.inst.part} auf ${fi.inst.part}`,
      message:
        `Erkannt nach ${RULE.id}: Stift von ${c.male.instanceId} koaxial in der Hohlnoppe von ${c.female.instanceId}. ` +
        `Geometrisch geprüft: ${geo.checks.map((g) => `${g.name} (${g.value} ${g.relation} ${g.limit})`).join('; ')}; ` +
        `Achsabstand ${lateral.toFixed(2)} LDU (≤ ${TOLERANCE.connectorPosition}), Achsen entgegengesetzt, Einstecktiefe ${STUD_HEIGHT} LDU. ` +
        `Montage: ${montage}. Mechanische Belastbarkeit ungeprüft.`,
      affected: affected(ids, mountedIn ? [mountedIn.stepId] : []),
      ruleVersion: RULES_VERSION,
      evidence: {
        rule: RULE.id,
        scope: RULE.scope,
        geometryChecks: geo.checks,
        dimensionTolerance: UPIN_DIMENSION_TOLERANCE,
        lateralOffsetLDU: Number(lateral.toFixed(3)),
        axisDot: Number(axisDot.toFixed(3)),
        insertionDepthLDU: STUD_HEIGHT,
        pinSource: pin.def.geometry?.source,
        holderSource: holder.def.geometry?.source,
        assembly: mountedIn,
        separation: {
          geometricallyCompatible: 'bestätigt (LDraw-Nennmaße)',
          mountableInMotionModel: mountedIn ? (mountedIn.status === 'ok' ? 'ja (gerade Steckbewegung)' : mountedIn.status) : 'nicht geprüft',
          mechanicallyLoadable: 'ungeprüft',
        },
      },
      limitation: 'Nennmaße aus LDraw ohne Spiel und Fertigungstoleranz; Klemm- und Haltekraft nicht modelliert; kein physischer Probebau.',
    }));
    out.push(finding({
      code: 'CON_UPIN_MECHANICS_UNCHECKED', layer: 'connection', dimension: 'robustness', status: 'unchecked', severity: 'info', evidenceLevel: 'unchecked',
      title: `Haltekraft ${mi.inst.part} auf ${fi.inst.part} ungeprüft`,
      message: 'Für die Verbindung Unterseitenstift in Hohlnoppe liegen keine kalibrierten Klemm- oder Haltekräfte vor. Sie zählt im Strukturindikator als eine Verbindung, ohne Aussage über Belastbarkeit.',
      affected: affected(ids),
      ruleVersion: RULES_VERSION,
      limitation: 'Physische Prüfung nach docs/PHYSISCHE-PRUEFPROTOKOLLE.md ausstehend.',
    }));
  }
  return out;
}
