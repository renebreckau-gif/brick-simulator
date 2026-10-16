// Gemeinsame Anleitungsdatenbasis für Bildschirm, Druckansicht und PDF: Texte, Kennzahlen und
// Bilder werden ausschließlich aus dem Anleitungsplan (und dessen Modellstand) abgeleitet.
import type { InstructionPlan, PartLine, PlanStep } from '../../core/instructions/plan';
import { groupThumb, overviewImage, partThumb, stepImages, type InstructionRenderer, type StepImages } from './render';

const SCOPE = 'Digital im unterstützten Umfang geprüft (Teilegeometrie, Verbindungen, Kollisionen, gerade Steckwege der Baufolge). Nicht physisch erprobt; keine Aussage über mechanische Belastbarkeit. Keine Preise, Elementnummern oder Kaufverfügbarkeit.';

/** Hinweis zu Herkunft und Prüfumfang – abhängig von der Modellherkunft, nie pauschal. */
export function notice(plan: InstructionPlan): string {
  const head = {
    generated: 'Eigener Entwurf – kein offizielles LEGO-Modell und keine Referenz.',
    reference: `Referenzmodell (${plan.modelOrigin}). Diese Anleitung ist eine eigene Ableitung aus der Modelldatei, keine Herstelleranleitung.`,
    fixture: 'Synthetischer Testfall – kein reales Set, kein Katalognachweis.',
    user: 'Benutzermodell – keine Referenz und kein offizielles LEGO-Modell.',
  }[plan.originKind];
  return `${head} ${SCOPE}`;
}

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
  out.push(['Herkunft', plan.modelOrigin]);
  if (plan.generator) out.push(['Generator', `${plan.generator.version}`]);
  if (plan.design) out.push(['Entwurfsgrundlage', plan.design.sources.map((s) => `${s.label} (${s.kind}${s.sha256 ? `, SHA-256 ${s.sha256.slice(0, 12)}…` : ''})`).join('; ') || 'keine Quelle angegeben']);
  out.push(['Katalog', plan.catalogState === 'loaded' ? 'Katalogauszug geladen' : 'ohne Katalogauszug – Teil-Farb-Belege ungeprüft; LDraw-Teilenummern und -Farben']);
  return out;
}

/** Konstruktive Annahmen und Abweichungen vom Konzept (nur wenn am Modell hinterlegt). */
export function designNotes(plan: InstructionPlan): { assumptions: string[]; deviations: string[]; comparison: string | null } | null {
  if (!plan.design) return null;
  return {
    assumptions: plan.design.assumptions.map((a) => `${a.statement} (Grundlage: ${a.basis})`),
    deviations: plan.design.deviations.map((d) => `${d.description} – Grund: ${d.reason}`),
    comparison: plan.design.visualComparison ? `${plan.design.visualComparison.method} ${plan.design.visualComparison.version}: ${plan.design.visualComparison.status === 'compared' ? plan.design.visualComparison.summary ?? 'abgeglichen' : 'ungeprüft'}` : null,
  };
}

export function sections(plan: InstructionPlan): string[] {
  return plan.assemblies
    .filter((a) => a.steps.length)
    .sort((a, b) => a.steps[0] - b.steps[0])
    .map((a) => `${a.builtSeparately ? 'Vormontage' : 'Hauptmodell'} „${a.name.replace(/^Vormontage:\s*/, '')}“: ${a.steps.length === 1 ? 'Schritt' : 'Schritte'} ${stepRanges(a.steps)}`);
}

/** [1,2,3,5,7,8] → „1–3, 5, 7–8“ */
export function stepRanges(nums: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(i === j ? String(nums[i]) : `${nums[i]}–${nums[j]}`);
    i = j;
  }
  return out.join(', ');
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
