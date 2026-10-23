// Unabhängiger, nachvollziehbarer Validator: führt alle Prüfschichten aus und erzeugt
// einen Bericht, der auf genau eine Modellversion und die verwendeten Daten-/Regelstände verweist.
import type { Catalog } from '../catalog/catalog';
import { PART_META_VERSION } from '../connectivity/partMeta';
import { RULES_VERSION } from '../connectivity/rules';
import { modelRef } from '../model/hash';
import type { CanonicalModel } from '../model/types';
import { analyzeAssembly, type AssemblyAnalysis } from './assembly';
import { checkCatalog, checkGeometry, checkUnsupportedConnectors } from './checkCatalogGeometry';
import { checkCollisions, checkGraph, components } from './checkGraphCollision';
import { checkSpecialConnections } from './checkSpecial';
import { affected, finding, LAYER_SCOPE, renumber, VALIDATOR_VERSION, type Finding, type Layer, type LayerSummary, type ValidationReport } from './findings';
import { analyzeStability, marginMm, type StabilityResult } from './stability';
import { bridges, continuousSeams, stoerWagner, subgraphWeights } from './structure';
import { buildWorld, type World } from './world';
import { checkFunction } from './checkFunction';

const HEURISTIC_VERSION = 'heuristics@1.0.0';

export interface ValidationResult {
  report: ValidationReport;
  world: World;
  assembly: AssemblyAnalysis;
  stability: StabilityResult | null;
}

function checkStabilityAndStructure(world: World): { findings: Finding[]; stability: StabilityResult | null } {
  const out: Finding[] = [];
  const comps = components(world);
  const main = comps[0] ?? [];
  const mainInst = main.map((id) => world.instances.get(id)!);
  const stab = analyzeStability(mainInst);
  if (!stab) {
    out.push(finding({ code: 'STAB_UNCHECKED', layer: 'stability', dimension: 'robustness', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked', title: 'Standprüfung nicht möglich', message: 'Keine auswertbaren Volumen.', ruleVersion: HEURISTIC_VERSION }));
  } else {
    const approx = mainInst.some((w) => w.approximateVolume);
    out.push(finding({
      code: stab.stands ? 'STAB_STANDS' : 'STAB_TIPS', layer: 'stability', dimension: 'robustness',
      status: stab.stands ? 'passed' : 'failed', severity: stab.stands ? 'info' : 'warning', evidenceLevel: 'heuristic',
      title: stab.stands ? 'Steht auf ebener Unterlage (heuristische Einschätzung)' : 'Kippt voraussichtlich (heuristische Einschätzung)',
      message: stab.stands
        ? `Schwerpunktlot ${stab.marginLDU} LDU (≈${marginMm(stab.marginLDU)} mm) innerhalb der Aufstandsfläche; rechnerischer Kippwinkel der Unterlage ≈ ${stab.tipAngleDeg}°.`
        : `Schwerpunktlot ${Math.abs(stab.marginLDU)} LDU außerhalb der Aufstandsfläche.`,
      affected: affected(stab.contactInstanceIds),
      ruleVersion: HEURISTIC_VERSION,
      evidence: { ...stab, gravity: '+Y (Welt)', massModel: 'Volumen der Körperhüllen', components: comps.length },
      limitation: `Keine kalibrierten Massen, starre Verbindungen angenommen, ebene horizontale Unterlage${comps.length > 1 ? '; nur größte Komponente betrachtet' : ''}${approx ? '; enthält grob modellierte Teile' : ''}. Kein Nachweis für Handhabung oder Spiel.`,
    }));
  }

  const ids = new Set(main);
  const weights = subgraphWeights(world, ids);
  const cut = stoerWagner(main, weights);
  if (cut) {
    const small = cut.sideA.length <= cut.sideB.length ? cut.sideA : cut.sideB;
    out.push(finding({
      code: 'STR_WEAKEST_CUT', layer: 'structure', dimension: 'robustness', status: 'passed', severity: 'info', evidenceLevel: 'heuristic',
      title: `Schwächster Schnitt: ${cut.weight} Noppenverbindung(en)`,
      message: `Das Lösen von ${cut.weight} Noppenverbindung(en) trennt ${small.length} Teil(e) ab. Kopplungsindikator, keine Festigkeitsangabe.`,
      affected: affected(small), ruleVersion: HEURISTIC_VERSION, evidence: { weight: cut.weight, separated: small },
      limitation: 'Zählt Noppen; Haltekräfte, Hebelarme und Materialstreuung sind nicht modelliert.',
    }));
  }
  // Ein-Noppen-Anbauten: nur die jeweils größte Kette melden (verschachtelte Teilketten unterdrücken)
  const reported: Set<string>[] = [];
  for (const b of bridges(main, weights).filter((x) => x.weight <= 1 && x.smallSide.length >= 2).sort((p, q) => q.smallSide.length - p.smallSide.length)) {
    if (reported.some((r) => b.smallSide.every((id) => r.has(id)))) continue;
    reported.push(new Set(b.smallSide));
    out.push(finding({
      code: 'STR_SINGLE_STUD_LINK', layer: 'structure', dimension: 'robustness', status: 'failed', severity: 'warning', evidenceLevel: 'heuristic',
      title: `Anbau aus ${b.smallSide.length} Teilen hängt an einer Noppe`,
      message: 'Eine Baugruppe ist nur über eine einzige Noppenverbindung angebunden – mögliche fragile Stelle (heuristische Einschätzung).',
      affected: affected([b.a, b.b, ...b.smallSide]), ruleVersion: HEURISTIC_VERSION, evidence: { link: [b.a, b.b], side: b.smallSide },
      remedy: 'Zusätzliche überlappende Verbindung vorsehen.',
    }));
  }
  const seams = continuousSeams(mainInst);
  const shortSeams = seams.filter((s) => s.layers < 3);
  if (shortSeams.length)
    out.push(finding({
      code: 'STR_SHORT_SEAMS', layer: 'structure', dimension: 'robustness', status: 'passed', severity: 'info', evidenceLevel: 'heuristic',
      title: `${shortSeams.length} Stoßfuge(n) über 2 Lagen`,
      message: 'Kurze fortgesetzte Fugen sind in vielen Bauten üblich; erst ab 3 Lagen als Hinweis gewertet.',
      affected: affected(shortSeams.flatMap((s) => s.instanceIds)), ruleVersion: HEURISTIC_VERSION, evidence: { seams: shortSeams },
    }));
  for (const s of seams.filter((x) => x.layers >= 3))
    out.push(finding({
      code: 'STR_CONTINUOUS_SEAM', layer: 'structure', dimension: 'robustness', status: 'failed', severity: 'warning', evidenceLevel: 'heuristic',
      title: `Durchgehende Fuge über ${s.layers} Lagen`,
      message: `Senkrechte Stoßfuge bei ${s.axis} = ${s.coordinate} LDU setzt sich über ${s.layers} Lagen fort (kein versetzter Verband). Struktureller Vergleichsindikator, keine gemessene Festigkeit.`,
      affected: affected(s.instanceIds), ruleVersion: HEURISTIC_VERSION, evidence: { ...s },
      remedy: 'Steine der folgenden Lage über die Fuge versetzen.',
    }));
  if (!seams.length && mainInst.length > 1)
    out.push(finding({
      code: 'STR_NO_CONTINUOUS_SEAM', layer: 'structure', dimension: 'robustness', status: 'passed', severity: 'info', evidenceLevel: 'heuristic',
      title: 'Keine über mehrere Lagen durchgehenden Fugen', message: 'Stoßfugen sind von Lage zu Lage versetzt oder nicht vorhanden.', ruleVersion: HEURISTIC_VERSION,
    }));
  return { findings: out, stability: stab };
}

function checkUsage(model: CanonicalModel): Finding[] {
  const out: Finding[] = [];
  const u = model.usage;
  const minAge = u.intendedUsers.minAgeYears;
  out.push(finding({
    code: 'USE_SMALL_PARTS', layer: 'usage', dimension: 'usage', status: 'passed', severity: 'info', evidenceLevel: 'confirmed',
    title: 'Enthält Kleinteile des LEGO-System-Formats',
    message: 'Alle unterstützten Teile gehören zum System-Format (nicht DUPLO). Kleinteile können verschluckt werden.',
    ruleVersion: 'usage-rules@1.0.0',
    evidence: { family: 'LEGO System', manufacturerInfo: 'https://www.lego.com/de-de/preschool/article/play-safe-with-lego-duplo (abgerufen 2026-10-14): DUPLO ab 18 Monaten; Hinweis auf verschluckbare Kleinteile' },
    limitation: 'Keine Messung nach Spielzeugnormen; der Simulator zertifiziert keine Konstruktion.',
  }));
  if (minAge !== null && minAge < 3)
    out.push(finding({
      code: 'USE_UNDER3_BLOCKED', layer: 'usage', dimension: 'usage', status: 'failed', severity: 'blocker', evidenceLevel: 'confirmed',
      title: 'Keine Freigabe für Kinder unter 3 Jahren',
      message: `Vorgesehene Nutzer ab ${minAge} Jahren: Ein Modell aus Standard-LEGO-Teilen mit Kleinteilen erhält keine positive Kleinkindfreigabe.`,
      ruleVersion: 'usage-rules@1.0.0', evidence: { declaredMinAge: minAge, source: u.intendedUsers.source },
      remedy: 'Nutzergruppe ändern; DUPLO ist eine spätere, separat zu behandelnde Teilefamilie – auch dort ohne Zertifizierung freier Entwürfe.',
    }));
  out.push(finding({
    code: 'USE_AGE_NOT_ASSESSED', layer: 'usage', dimension: 'usage', status: 'unchecked', severity: 'info', evidenceLevel: 'unchecked',
    title: 'Alterseignung nicht bewertet',
    message: u.ageSuitability.status === 'not-assessed'
      ? 'Für dieses Modell liegt keine belegte Altersangabe vor. Altersangaben von Referenzsets werden nicht auf veränderte Modelle übertragen und nie aus Stabilitätswerten abgeleitet.'
      : `Angabe: ${u.ageSuitability.value} (Quelle: ${u.ageSuitability.source}).`,
    ruleVersion: 'usage-rules@1.0.0', evidence: { ...u.ageSuitability },
    limitation: 'Kein Label „kindersicher“ ohne unabhängigen Nachweis.',
  }));
  out.push(finding({
    code: 'USE_PINCH_UNCHECKED', layer: 'usage', dimension: 'usage', status: 'unchecked', severity: 'info', evidenceLevel: 'unchecked',
    title: 'Klemmstellen nicht geprüft', message: 'Mechanismen (Scharniere, Gelenke) sind nicht im Umfang; Klemmstellen werden nicht bewertet.', ruleVersion: 'usage-rules@1.0.0',
  }));
  if (u.intendedUse === 'play-goal')
    out.push(finding({
      code: 'USE_PLAY_GOAL', layer: 'usage', dimension: 'usage', status: 'unchecked', severity: 'warning', evidenceLevel: 'unchecked',
      title: 'Spielmodell ist Entwicklungsziel, kein Urteil', message: 'Für Spielbelastung liegen keine kalibrierten Daten vor; physische Prüfung nach docs/PHYSISCHE-PRUEFPROTOKOLLE.md erforderlich.', ruleVersion: 'usage-rules@1.0.0',
    }));
  for (const h of u.handlingScenarios)
    out.push(finding({
      code: 'USE_HANDLING_SCENARIO', layer: 'usage', dimension: 'robustness', status: 'unchecked', severity: 'info', evidenceLevel: 'unchecked',
      title: `Handhabungsszenario ${h.id}: ungeprüft`, message: h.description, ruleVersion: 'usage-rules@1.0.0',
      limitation: 'Keine physischen Tests durchgeführt.',
    }));
  return out;
}

function summarize(findings: Finding[]): LayerSummary[] {
  const layers: Layer[] = ['catalog', 'geometry', 'connection', 'graph', 'collision', 'assembly', 'stability', 'structure', 'usage', 'function', 'procurement'];
  return layers.map((layer) => {
    const fs = findings.filter((f) => f.layer === layer);
    const counts = { passed: 0, failed: 0, unchecked: 0, unsupported: 0 };
    for (const f of fs) counts[f.status]++;
    const confirmedFail = fs.some((f) => f.status === 'failed' && f.evidenceLevel === 'confirmed');
    const status: LayerSummary['status'] = confirmedFail ? 'failed' : counts.failed ? 'flagged' : counts.unchecked || counts.unsupported ? (counts.passed ? 'partial' : 'unchecked') : counts.passed ? 'passed' : 'unchecked';
    return { layer, status, counts, scope: LAYER_SCOPE[layer] };
  });
}

export function validate(model: CanonicalModel, catalog: Catalog, now = new Date().toISOString()): ValidationResult {
  const world = buildWorld(model, catalog);
  const assembly = analyzeAssembly(model, world);
  const sas = checkStabilityAndStructure(world);
  const procurement = finding({
    code: 'PROC_NOT_CHECKED', layer: 'procurement', dimension: 'data', status: 'unchecked', severity: 'info', evidenceLevel: 'unchecked',
    title: 'Beschaffung nicht geprüft', message: 'Es sind keine Angebotsdaten angebunden. Katalogexistenz sagt nichts über aktuelle Kaufverfügbarkeit oder Preise.', ruleVersion: 'procurement@0',
  });
  const findings = renumber([
    ...checkCatalog(model, catalog),
    ...checkGeometry(world),
    ...checkUnsupportedConnectors(world),
    ...checkSpecialConnections(model, world, assembly),
    ...checkGraph(model, world),
    ...checkCollisions(world),
    ...assembly.findings,
    ...sas.findings,
    ...checkUsage(model),
    ...checkFunction(model, world),
    procurement,
  ]);
  const ref = modelRef(model);
  const blockers = findings.some((f) => f.severity === 'blocker' && f.status === 'failed');
  const open = findings.some((f) => f.status === 'unchecked' || f.status === 'unsupported');
  const report: ValidationReport = {
    schema: 'baustein-sim/report@1',
    reportId: `report-${ref.modelId}-v${ref.version}-${ref.contentHash}`,
    modelRef: ref,
    dataVersions: { catalog: catalog.version, partMeta: PART_META_VERSION, rules: RULES_VERSION, validator: `${VALIDATOR_VERSION}+${HEURISTIC_VERSION}` },
    createdAt: now,
    overall: blockers ? 'blockers-found' : open ? 'no-blockers-open-checks' : 'no-blockers-all-checked',
    layers: summarize(findings),
    findings,
  };
  return { report, world, assembly, stability: sas.stability };
}

export const OVERALL_LABEL: Record<ValidationReport['overall'], string> = {
  'blockers-found': 'Blocker gefunden (im geprüften Umfang)',
  'no-blockers-open-checks': 'Keine Blocker – offene/ungeprüfte Bereiche vorhanden',
  'no-blockers-all-checked': 'Keine Blocker – alle Schichten geprüft',
};
