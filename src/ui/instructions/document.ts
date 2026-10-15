// Gemeinsame Anleitungsdatenbasis für Bildschirm, Druckansicht und PDF: Texte, Kennzahlen und
// Bilder werden ausschließlich aus dem Anleitungsplan (und dessen Modellstand) abgeleitet.
import type { InstructionPlan, PartLine, PlanStep } from '../../core/instructions/plan';
import { groupThumb, overviewImage, partThumb, stepImages, type InstructionRenderer, type StepImages } from './render';

export const NOTICE =
  'Eigener Entwurf – kein offizielles LEGO-Modell und keine Referenz. Digital im unterstützten Umfang geprüft (Teilegeometrie, Verbindungen, Kollisionen, gerade Steckwege der Baufolge). Nicht physisch erprobt; keine Aussage über mechanische Belastbarkeit. Keine Preise, Elementnummern oder Kaufverfügbarkeit.';

export const LEGEND: [string, string][] = [
  ['Volle Farbe, dunkle Kanten', 'in diesem Schritt neu'],
  ['Aufgehellt, schwache Kanten', 'bereits verbaut'],
  ['Pfeil nach unten', 'senkrecht von oben aufstecken (Steckweg im Bewegungsmodell geprüft)'],
  ['Gestrichelter Ring', 'Position ohne geprüfte Einsetzrichtung (z. B. Ablegen)'],
];

export const STEP_IMAGE = { width: 1400, height: 660 };
export const OVERVIEW_IMAGE = { width: 1400, height: 820 };

export function facts(plan: InstructionPlan): [string, string][] {
  const d = plan.dimensions;
  const out: [string, string][] = [
    ['Teile (tatsächlich)', String(plan.totalParts)],
    ['Außenmaße', `${d.studs.length} × ${d.studs.width} Noppen, Höhe ${d.ldu.height} LDU (ca. ${d.mm.length} × ${d.mm.width} × ${d.mm.height} mm)`],
    ['Modell-ID', plan.modelRef.modelId],
    ['Modellversion', String(plan.modelRef.version)],
    ['Modellhash', plan.modelRef.contentHash],
    ['Anleitungsplan', `${plan.planVersion} (Plan-Hash ${plan.planHash})`],
    ['Anleitungsschritte', String(plan.steps.length)],
  ];
  if (plan.generator) out.push(['Generator', `${plan.generator.version}`]);
  out.push(['Katalog', plan.catalogState === 'loaded' ? 'Katalogauszug geladen' : 'ohne Katalogauszug – Teil-Farb-Belege ungeprüft; LDraw-Teilenummern und -Farben']);
  return out;
}

export function sections(plan: InstructionPlan): string[] {
  return plan.assemblies
    .filter((a) => a.steps.length)
    .sort((a, b) => a.steps[0] - b.steps[0])
    .map((a) => `${a.builtSeparately ? 'Vormontage' : 'Hauptmodell'} „${a.name}“: Schritt ${a.steps[0]}–${a.steps.at(-1)}`);
}

export interface DocStep {
  step: PlanStep;
  images: StepImages;
  thumbs: Map<string, string>;
  /** Bilder der angesetzten Vormontagen je assemblyId. */
  moduleThumbs: Map<string, string>;
}

export const lineKey = (l: PartLine) => `${l.part}|${l.color}`;

export function thumbsFor(r: InstructionRenderer, plan: InstructionPlan, lines: PartLine[]): Map<string, string> {
  return new Map(lines.map((l) => [lineKey(l), partThumb(r, plan, l.instanceIds[0])]));
}

export function docStep(r: InstructionRenderer, plan: InstructionPlan, step: PlanStep): DocStep {
  return {
    step,
    images: stepImages(r, plan, step, STEP_IMAGE),
    thumbs: thumbsFor(r, plan, step.newParts),
    moduleThumbs: new Map(step.attachedModules.map((m) => [m.assemblyId, groupThumb(r, plan, `modul:${m.assemblyId}`)])),
  };
}

export function fullDocument(r: InstructionRenderer, plan: InstructionPlan) {
  return {
    overview: overviewImage(r, plan, OVERVIEW_IMAGE),
    steps: plan.steps.map((s) => docStep(r, plan, s)),
    bomThumbs: thumbsFor(r, plan, plan.bom),
  };
}
