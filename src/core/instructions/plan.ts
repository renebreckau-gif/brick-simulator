// Anleitungsplan: abgeleitetes, versioniertes Artefakt aus einem kanonischen Modell.
//
// Der Plan verändert die kanonische Baufolge nicht. Er teilt große Schritte in kleinere
// Anleitungsschritte (Reihenfolge der kanonischen Schritte bleibt erhalten, jeder Teilschritt
// gehört genau zu einem kanonischen Schritt), legt Kameraperspektiven und Bildausschnitte fest und
// bezieht sich über Modell-ID, Version und Inhalts-Hash auf genau einen Modellstand.
// Die verfeinerte Schrittfolge wird mit dem unveränderten Montageprüfer erneut geprüft; nur wenn
// sie ohne Montageblocker durchläuft, wird sie verwendet.
import { computeBom } from '../bom/bom';
import type { Catalog } from '../catalog/catalog';
import type { PartLibrary } from '../ldraw/library';
import { transformBox, unionBox, type Box, type Vec3 } from '../math';
import { modelDimensions, type ModelDimensions } from '../model/dimensions';
import { cyrb53, modelRef, stableStringify } from '../model/hash';
import type { CanonicalModel, ModelRef, StepDef } from '../model/types';
import type { UnitResult } from '../validation/assembly';
import { validate } from '../validation/validate';

export const INSTRUCTION_PLAN_VERSION = 'instr-plan@1.0.0';
export const INSTRUCTION_PLAN_SCHEMA = 'baustein-sim/instruction-plan@1';
/** Höchstzahl neuer Einzelteile je Anleitungsschritt (größere kanonische Schritte werden geteilt). */
export const MAX_NEW_PARTS = 6;

export type CameraId = 'iso-vorn' | 'iso-hinten' | 'oben';
/** Blickrichtung als Richtung vom Ziel zur Kamera in LDraw-Koordinaten (−Y oben). */
export const CAMERAS: Record<CameraId, { label: string; toCamera: Vec3 }> = {
  'iso-vorn': { label: 'schräg von vorn', toCamera: norm([-1, -0.95, -0.8]) },
  'iso-hinten': { label: 'schräg von hinten', toCamera: norm([1, -0.95, -0.8]) },
  oben: { label: 'Draufsicht', toCamera: [0, -1, 0] },
};

export interface PartLine {
  part: string;
  color: number;
  quantity: number;
  partName: string;
  colorName: string;
  instanceIds: string[];
}

export interface InsertionInfo {
  /** von-oben = gerader Steckweg nach unten, im Bewegungsmodell geprüft; ablegen = keine Steckverbindung zum Bestand. */
  kind: 'von-oben' | 'von-unten' | 'seitlich' | 'ablegen' | 'ungeprueft';
  checked: boolean;
  text: string;
  /** Einheiten (Teil- oder Baugruppen-IDs), für die ein geprüfter Steckweg gezeichnet werden darf. */
  arrowUnits: string[];
}

export interface PlanStep {
  number: number;
  key: string;
  /** Kanonischer Schritt, aus dem dieser Anleitungsschritt stammt. */
  sourceStepId: string;
  part: { index: number; of: number };
  context: string;
  contextName: string;
  isModule: boolean;
  title: string;
  action: string;
  add: string[];
  attach: string[];
  newParts: PartLine[];
  attachedModules: { assemblyId: string; name: string; instanceCount: number; builtInSteps: number[] }[];
  /** Im Bild gezeigte Instanzen (Bauzustand des Kontexts nach dem Schritt). */
  shown: string[];
  /** Im Bild hervorgehobene Instanzen (neu bzw. angesetzte Baugruppe). */
  highlight: string[];
  camera: CameraId;
  cameraNote: string | null;
  detailCamera: CameraId | null;
  frame: string;
  insertion: InsertionInfo;
  support: string[];
  openChecks: string[];
}

export interface InstructionPlan {
  schema: typeof INSTRUCTION_PLAN_SCHEMA;
  planVersion: string;
  planHash: string;
  modelRef: ModelRef;
  modelName: string;
  modelOrigin: string;
  originKind: CanonicalModel['origin']['kind'];
  generator: CanonicalModel['generator'] | null;
  /** Entwurfsherkunft des Modells (Bildquelle, Annahmen, Abweichungen), unverändert übernommen. */
  design: CanonicalModel['design'] | null;
  cameras: typeof CAMERAS;
  /** Bildausschnitte (Weltbox) und die Instanzen, auf die der Ausschnitt eingepasst wird. */
  frames: Record<string, Box>;
  frameIds: Record<string, string[]>;
  assemblies: { assemblyId: string; name: string; builtSeparately: boolean; steps: number[] }[];
  steps: PlanStep[];
  bom: PartLine[];
  totalParts: number;
  /** Außenmaße aus der LDraw-Geometrie der verbauten Teile. */
  dimensions: Pick<ModelDimensions, 'ldu' | 'mm' | 'studs'>;
  catalogState: 'loaded' | 'missing' | 'corrupt';
  sequenceCheck: { status: 'refined-ok' | 'canonical-only'; note: string; assemblyFindings: string[] };
}

export class InstructionPlanError extends Error {}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Deutsche Kurzbezeichnung aus dem LDraw-Titel („Brick 1 x 2“ → „Stein 1×2“). */
export function germanPartName(title: string | null, part: string, resolveTitle?: (part: string) => string | null): string {
  // LDraw-Umleitung („~Moved to 3023b“): Bezeichnung des Zielteils verwenden, Teilenummer bleibt
  const moved = title?.match(/^~Moved to (\S+)/);
  if (moved && resolveTitle) return germanPartName(resolveTitle(moved[1]), part);
  // Nur exakte Grundteile übersetzen (Fliesen mit Rille sind die Standardausführung); alle Sonderformen
  // (Jumper, mit Pin, bedruckt …) behalten ihren vollständigen LDraw-Titel, damit nichts verwechselt wird.
  const m = title?.match(/^(Brick|Plate|Tile)\s+(\d+)\s*x\s*(\d+)(\s+with Groove)?\s*$/);
  if (!m) return title ? title.replace(/\s+/g, ' ').trim() : part;
  return `${{ Brick: 'Stein', Plate: 'Platte', Tile: 'Fliese' }[m[1]]} ${m[2]}×${m[3]}`;
}

const plural = (name: string, n: number) => {
  if (n === 1) return name;
  return name.replace(/^Stein /, 'Steine ').replace(/^Platte /, 'Platten ').replace(/^Fliese /, 'Fliesen ');
};

/** Strahl–Box-Test (Slab-Methode); true, wenn der Strahl die Box bei t > eps trifft. */
function rayHits(o: Vec3, d: Vec3, b: Box, eps = 0.5): boolean {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] <= b.min[i] || o[i] >= b.max[i]) return false;
      continue;
    }
    let a = (b.min[i] - o[i]) / d[i];
    let c = (b.max[i] - o[i]) / d[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
  }
  return t1 > Math.max(t0, eps);
}

export function buildInstructionPlan(model: CanonicalModel, catalog: Catalog, library: PartLibrary): InstructionPlan {
  if (!model.steps.length) throw new InstructionPlanError('Das Modell hat keine Baufolge – eine Anleitung lässt sich nicht ableiten.');
  const base = validate(model, catalog, 'plan');
  const blockers = base.report.findings.filter((f) => f.severity === 'blocker' && f.status === 'failed');
  if (blockers.length)
    throw new InstructionPlanError(`Das Modell hat ${blockers.length} Blocker (${[...new Set(blockers.map((f) => f.code))].join(', ')}). Eine Anleitung wird nur für Modelle ohne Blocker erzeugt.`);

  const inst = new Map(model.instances.map((i) => [i.instanceId, i]));
  const asm = new Map(model.assemblies.map((a) => [a.assemblyId, a]));
  const boxOf = new Map<string, Box>();
  for (const i of model.instances)
    if (library.has(`${i.part}.dat`)) boxOf.set(i.instanceId, transformBox({ position: i.position, rotation: i.rotation }, library.flatten(`${i.part}.dat`).bbox));
  const bom = computeBom(model, catalog);
  const lineOf = new Map(bom.lines.map((l) => [`${l.ldrawPart}|${l.ldrawColor}`, l]));
  const partLines = (ids: string[]): PartLine[] => {
    const g = new Map<string, PartLine>();
    for (const id of ids) {
      const i = inst.get(id)!;
      const k = `${i.part}|${i.color}`;
      const l = lineOf.get(k);
      const pl = g.get(k) ?? g.set(k, { part: i.part, color: i.color, quantity: 0, partName: germanPartName(catalog.part(i.part).ldrawTitle, i.part, (t) => catalog.part(t).ldrawTitle), colorName: (l?.colorName ?? catalog.color(i.color)?.ldrawName ?? `Farbcode ${i.color}`).replace(/_/g, ' '), instanceIds: [] }).get(k)!;
      pl.quantity++;
      pl.instanceIds.push(id);
    }
    return [...g.values()].sort((a, b) => b.quantity - a.quantity || a.part.localeCompare(b.part) || a.color - b.color);
  };

  // Baukontext wie im Montageprüfer: nächste separat gebaute Baugruppe oder Wurzel
  const contextOf = (assemblyId: string): string => {
    let a = asm.get(assemblyId);
    while (a && a.parentId && !a.builtSeparately) a = asm.get(a.parentId);
    return a?.assemblyId ?? model.rootAssemblyId;
  };
  /** Alle Instanzen einer Baugruppe einschließlich verschachtelter Unterbaugruppen. */
  const within = (assemblyId: string, aid: string): boolean => {
    for (let a = asm.get(assemblyId); a; a = a.parentId ? asm.get(a.parentId) : undefined) if (a.assemblyId === aid) return true;
    return assemblyId === aid;
  };
  const moduleInstances = (aid: string) => model.instances.filter((i) => within(i.assemblyId, aid)).map((i) => i.instanceId);

  // 1) Verfeinerung: große Schritte nach Höhe (unten zuerst), dann entlang der längeren
  //    waagerechten Achse des Kontexts teilen (modellunabhängig: Reihenfolge entlang −X → +X bzw. −Z → +Z)
  const axisOf = (ctx: string): 0 | 2 => {
    const ids = ctx === model.rootAssemblyId ? model.instances.filter((i) => contextOf(i.assemblyId) === ctx).map((i) => i.instanceId) : moduleInstances(ctx);
    const b = unionBox(ids.map((id) => boxOf.get(id)).filter((x): x is Box => !!x));
    return b.max[0] - b.min[0] >= b.max[2] - b.min[2] ? 0 : 2;
  };
  const refine = (s: StepDef): StepDef[] => {
    if (s.add.length <= MAX_NEW_PARTS || s.attach.length) return [s];
    const ax = axisOf(contextOf(s.assemblyId));
    const other = ax === 0 ? 2 : 0;
    const ids = [...s.add].sort((a, b) => {
      const A = inst.get(a)!.position;
      const B = inst.get(b)!.position;
      return B[1] - A[1] || A[ax] - B[ax] || A[other] - B[other];
    });
    const n = Math.ceil(ids.length / MAX_NEW_PARTS);
    const size = Math.ceil(ids.length / n);
    const out: StepDef[] = [];
    for (let k = 0; k < n; k++) {
      const add = ids.slice(k * size, (k + 1) * size);
      if (add.length) out.push({ ...s, stepId: `${s.stepId}/${k + 1}`, add });
    }
    return out;
  };
  const refinedSteps = model.steps.flatMap(refine);
  const parentOf = new Map<string, { src: StepDef; index: number; of: number }>();
  for (const s of model.steps) {
    const parts = refine(s);
    parts.forEach((p, i) => parentOf.set(p.stepId, { src: s, index: i + 1, of: parts.length }));
  }
  const derived: CanonicalModel = { ...model, steps: refinedSteps };
  const dv = validate(derived, catalog, 'plan');
  const asmBlockers = dv.report.findings.filter((f) => f.layer === 'assembly' && f.severity === 'blocker' && f.status === 'failed');
  const useRefined = asmBlockers.length === 0;
  const planSteps = useRefined ? refinedSteps : model.steps;
  const analysis = useRefined ? dv.assembly : base.assembly;
  if (!useRefined) for (const s of model.steps) parentOf.set(s.stepId, { src: s, index: 1, of: 1 });
  const asmFindings = (useRefined ? dv : base).report.findings.filter((f) => f.layer === 'assembly' && f.status !== 'passed');

  // 2) Bildausschnitte je Kontext
  // Hauptmodell: bis zum ersten Ansetzen einer Vormontage nur die eigenen Teile des Hauptmodells (größere Darstellung),
  // danach das ganze Modell. Der Wechsel wird im Schritt angekündigt.
  const frameIds: Record<string, string[]> = {};
  for (const a of model.assemblies) if (a.builtSeparately) frameIds[`modul:${a.assemblyId}`] = moduleInstances(a.assemblyId);
  frameIds.kern = model.instances.filter((i) => contextOf(i.assemblyId) === model.rootAssemblyId).map((i) => i.instanceId);
  frameIds.hauptmodell = model.instances.map((i) => i.instanceId);
  const frames: Record<string, Box> = {};
  for (const [k, ids] of Object.entries(frameIds)) frames[k] = unionBox(ids.map((id) => boxOf.get(id)).filter((b): b is Box => !!b));

  // 3) Schritte mit Bauzustand, Kamera, Einsetzrichtung und Hinweisen
  const state = new Map<string, string[]>();
  const builtIn = new Map<string, number[]>();
  const steps: PlanStep[] = [];
  let prevCamera: CameraId | null = null;
  let prevContext: string | null = null;
  let prevFrame: string | null = null;
  const attachedSoFar = new Set<string>();
  const fmtDir = (d: Vec3 | null) => (!d ? null : d[1] > 0.5 ? 'von-oben' : d[1] < -0.5 ? 'von-unten' : 'seitlich');

  const moduleOfStep = (s: StepDef) => s.attach.flatMap(moduleInstances);
  /** Anzahl neuer Teile (bzw. der angesetzten Baugruppe), deren Oberseite aus der Kamera verdeckt ist. */
  const hiddenCount = (cam: CameraId, s: StepDef, shown: string[]) => {
    const d = CAMERAS[cam].toCamera;
    const attachedIds = moduleOfStep(s);
    // Teile desselben Schritts verdecken sich nicht gegenseitig im Sinne der Anleitung (z. B. Stein mit Fliese darauf)
    const sameStep = new Set(s.add);
    const occluders = shown.filter((id) => boxOf.has(id) && !sameStep.has(id));
    let hidden = 0;
    for (const id of s.add.length ? s.add : attachedIds) {
      const b = boxOf.get(id);
      if (!b) continue;
      const top = b.min[1] - 0.1;
      const pts: Vec3[] = [[(b.min[0] + b.max[0]) / 2, top, (b.min[2] + b.max[2]) / 2], [b.min[0] + 3, top, b.min[2] + 3], [b.max[0] - 3, top, b.max[2] - 3], [b.min[0] + 3, top, b.max[2] - 3], [b.max[0] - 3, top, b.min[2] + 3]];
      const own = new Set(s.attach.length ? attachedIds : [id]);
      if (!pts.some((p) => !occluders.some((o) => !own.has(o) && rayHits(p, d, boxOf.get(o)!)))) hidden++;
    }
    return hidden;
  };
  // Perspektive je Kontext: die mit den wenigsten verdeckten neuen Teilen über alle Schritte (bei Gleichstand „schräg von vorn“)
  const contextCamera = new Map<string, CameraId>();
  {
    const tally = new Map<string, Record<CameraId, number>>();
    const st = new Map<string, string[]>();
    for (const s of planSteps) {
      const ctx = contextOf(s.assemblyId);
      const shown = [...(st.get(ctx) ?? []), ...s.add, ...moduleOfStep(s)];
      st.set(ctx, shown);
      const t = tally.get(ctx) ?? tally.set(ctx, { 'iso-vorn': 0, 'iso-hinten': 0, oben: 0 }).get(ctx)!;
      for (const c of ['iso-vorn', 'iso-hinten'] as CameraId[]) t[c] += hiddenCount(c, s, shown);
    }
    for (const [ctx, t] of tally) contextCamera.set(ctx, t['iso-hinten'] < t['iso-vorn'] ? 'iso-hinten' : 'iso-vorn');
  }

  planSteps.forEach((s, idx) => {
    const ctx = contextOf(s.assemblyId);
    const isModule = ctx !== model.rootAssemblyId;
    const before = state.get(ctx) ?? [];
    const attachedIds = s.attach.flatMap(moduleInstances);
    const shown = [...before, ...s.add, ...attachedIds];
    state.set(ctx, shown);
    const highlight = [...s.add, ...attachedIds];
    const number = idx + 1;
    (builtIn.get(ctx) ?? builtIn.set(ctx, []).get(ctx)!).push(number);
    const parent = parentOf.get(s.stepId)!;
    // Titel aus der Quelle des Schritts; ohne Angabe die Baugruppe (keine internen Schritt-IDs als Titel)
    const label = parent.src.notes?.[0] ?? (s.attach.length ? `${asm.get(s.attach[0])?.name ?? s.attach[0]} ansetzen` : asm.get(s.assemblyId)?.name ?? 'Bauschritt');

    // Einsetzrichtung aus der Montageprüfung der verwendeten Schrittfolge
    const units: UnitResult[] = analysis.steps[idx]?.units ?? [];
    const statuses = new Set(units.map((u) => (u.status === 'ok' ? (u.directionSource === 'free' ? 'ablegen' : fmtDir(u.direction)) : 'ungeprueft')));
    let insertion: InsertionInfo;
    if (statuses.size === 1 && statuses.has('von-oben'))
      insertion = { kind: 'von-oben', checked: true, text: 'Senkrecht von oben aufstecken – gerader Steckweg im Bewegungsmodell geprüft.', arrowUnits: units.map((u) => u.unitId) };
    else if ([...statuses].every((x) => x === 'ablegen' || x === 'von-oben'))
      insertion = {
        kind: statuses.has('von-oben') ? 'von-oben' : 'ablegen',
        checked: true,
        text: statuses.has('von-oben') ? 'Teils ablegen, teils senkrecht von oben aufstecken – Steckwege im Bewegungsmodell geprüft.' : 'Flach hinlegen (noch keine Steckverbindung zum Bestand).',
        arrowUnits: units.filter((u) => u.status === 'ok' && u.directionSource !== 'free' && fmtDir(u.direction) === 'von-oben').map((u) => u.unitId),
      };
    else if (statuses.has('ungeprueft') || statuses.size === 0)
      insertion = { kind: 'ungeprueft', checked: false, text: 'Einsetzrichtung ungeprüft (nicht im unterstützten Bewegungsmodell).', arrowUnits: [] };
    else {
      const k = [...statuses][0] as 'von-unten' | 'seitlich';
      insertion = { kind: k, checked: true, text: k === 'von-unten' ? 'Von unten anstecken – Bauzustand dafür anheben (Steckweg geprüft).' : 'Seitlich einschieben (Steckweg geprüft).', arrowUnits: [] };
    }

    // Hinweise: Handunterstützung, lose Teilgruppen, offene Prüfungen
    const support: string[] = [];
    if (parent.src.support) support.push(`${parent.src.support.kind === 'hand' ? 'Handunterstützung' : 'Hilfsstütze'}: ${parent.src.support.note}`);
    const sr = analysis.steps[idx];
    if (sr && !isModule && sr.componentsAfter > 1 && idx < planSteps.length - 1)
      support.push(`Nach diesem Schritt liegen noch ${sr.componentsAfter} getrennte Teilgruppen lose nebeneinander – festhalten, bis ein späterer Schritt sie verbindet.`);
    const openChecks = [
      ...units.filter((u) => u.status === 'unchecked').map((u) => `Montage von ${u.unitId} ungeprüft (nicht unterstützte Technik).`),
      ...asmFindings.filter((f) => f.affected.stepIds.includes(s.stepId) && f.severity !== 'info').map((f) => f.title),
    ];

    // Kamera: eine feste Perspektive je Baukontext; verdeckte neue Teile → Draufsicht als Detailansicht
    const contextChanged = prevContext !== null && prevContext !== ctx;
    const camera = contextCamera.get(ctx)!;
    const detailCamera: CameraId | null = hiddenCount(camera, s, shown) > 0 ? 'oben' : null;
    let cameraNote: string | null = null;
    if (contextChanged || (prevContext === null && isModule)) cameraNote = isModule ? `Neue Baugruppe: ${asm.get(ctx)?.name ?? ctx} wird separat gebaut (Ansicht ${CAMERAS[camera].label}).` : `Weiter am Hauptmodell (Ansicht ${CAMERAS[camera].label}).`;
    else if (prevCamera && prevCamera !== camera) cameraNote = `Ansicht gewechselt: jetzt ${CAMERAS[camera].label} (Modell gedreht).`;
    for (const a of s.attach) attachedSoFar.add(a);
    const frame = isModule ? `modul:${ctx}` : attachedSoFar.size ? 'hauptmodell' : 'kern';
    if (!contextChanged && prevFrame && prevFrame !== frame) cameraNote = `Bildausschnitt erweitert: ab jetzt das ganze Modell (gleiche Blickrichtung, ${CAMERAS[camera].label}).`;
    prevFrame = frame;
    prevCamera = camera;
    prevContext = ctx;

    const newParts = partLines(s.add);
    const attachedModules = s.attach.map((aid) => ({ assemblyId: aid, name: asm.get(aid)?.name ?? aid, instanceCount: moduleInstances(aid).length, builtInSteps: [...(builtIn.get(aid) ?? [])] }));
    const count = s.add.length;
    const title = parent.of > 1 ? `${label} (${parent.index}/${parent.of})` : label;
    let action: string;
    if (s.attach.length)
      action = attachedModules.map((m) => `Vormontierte Baugruppe „${m.name}“ (aus Schritt ${m.builtInSteps[0]}–${m.builtInSteps.at(-1)}) als Ganzes ${insertion.kind === 'von-oben' ? 'senkrecht von oben aufsetzen' : 'ansetzen'} und gleichmäßig andrücken.`).join(' ');
    else {
      const desc = newParts.map((p) => `${p.quantity} ${plural(p.partName, p.quantity)} ${p.colorName}`).join(', ');
      const where = parent.of <= 1 ? '' : ` (Abschnitt ${parent.index} von ${parent.of})`;
      const verb = insertion.kind === 'ablegen' ? 'Bereitlegen' : insertion.kind === 'von-oben' ? 'Aufsetzen' : 'Einsetzen';
      action = `${verb}: ${desc}${where}. Positionen wie im Bild markiert.`;
      if (count === 0) action = 'Kein neues Teil.';
    }
    steps.push({
      number, key: s.stepId, sourceStepId: parent.src.stepId, part: { index: parent.index, of: parent.of }, context: ctx, contextName: asm.get(ctx)?.name ?? ctx, isModule,
      title, action, add: [...s.add], attach: [...s.attach], newParts, attachedModules, shown, highlight, camera, cameraNote, detailCamera,
      frame, insertion, support, openChecks,
    });
  });

  const assemblies = model.assemblies.map((a) => ({ assemblyId: a.assemblyId, name: a.name, builtSeparately: a.builtSeparately, steps: steps.filter((s) => s.context === a.assemblyId).map((s) => s.number) }));
  const plan: Omit<InstructionPlan, 'planHash'> = {
    schema: INSTRUCTION_PLAN_SCHEMA,
    planVersion: INSTRUCTION_PLAN_VERSION,
    modelRef: modelRef(model),
    modelName: model.name,
    modelOrigin: model.origin.label,
    originKind: model.origin.kind,
    generator: model.generator ?? null,
    design: model.design ?? null,
    cameras: CAMERAS,
    frames,
    frameIds,
    assemblies,
    steps,
    bom: partLines(model.instances.map((i) => i.instanceId)),
    totalParts: model.instances.length,
    dimensions: (({ ldu, mm, studs }) => ({ ldu, mm, studs }))(modelDimensions(model, library)),
    catalogState: catalog.source.state,
    sequenceCheck: useRefined
      ? { status: 'refined-ok', note: `Verfeinerte Schrittfolge (${refinedSteps.length} statt ${model.steps.length} Schritte, je höchstens ${MAX_NEW_PARTS} neue Teile) mit dem Montageprüfer geprüft: keine Montageblocker.`, assemblyFindings: asmFindings.map((f) => f.code) }
      : { status: 'canonical-only', note: `Verfeinerung hätte Montageblocker erzeugt (${[...new Set(asmBlockers.map((f) => f.code))].join(', ')}); die kanonischen Schritte werden unverändert verwendet.`, assemblyFindings: asmFindings.map((f) => f.code) },
  };
  return { ...plan, planHash: cyrb53(stableStringify(plan)) };
}

/** Unabhängige Konsistenzprüfung eines Plans gegen ein Modell. Leere Liste = konsistent. */
export function checkInstructionPlan(plan: InstructionPlan, model: CanonicalModel): string[] {
  const issues: string[] = [];
  const ref = modelRef(model);
  if (plan.modelRef.modelId !== ref.modelId || plan.modelRef.version !== ref.version || plan.modelRef.contentHash !== ref.contentHash)
    issues.push(`Plan gehört zu ${plan.modelRef.modelId} v${plan.modelRef.version} (${plan.modelRef.contentHash}), Modell ist v${ref.version} (${ref.contentHash}).`);
  const known = new Set(model.instances.map((i) => i.instanceId));
  const counted = new Map<string, number>();
  for (const s of plan.steps) {
    for (const id of [...s.add, ...s.shown, ...s.highlight]) if (!known.has(id)) issues.push(`Schritt ${s.number}: unbekannte Instanz ${id}.`);
    for (const l of s.newParts) for (const id of l.instanceIds) counted.set(id, (counted.get(id) ?? 0) + 1);
    const lineIds = s.newParts.flatMap((l) => l.instanceIds).sort();
    if (stableStringify(lineIds) !== stableStringify([...s.add].sort())) issues.push(`Schritt ${s.number}: Teileübersicht entspricht nicht den neuen Teilen.`);
  }
  for (const id of known) if ((counted.get(id) ?? 0) !== 1) issues.push(`Instanz ${id} wird ${counted.get(id) ?? 0}× als neu benötigt gezählt.`);
  const sum = new Map<string, number>();
  for (const s of plan.steps) for (const l of s.newParts) sum.set(`${l.part}|${l.color}`, (sum.get(`${l.part}|${l.color}`) ?? 0) + l.quantity);
  const full = new Map<string, number>();
  for (const i of model.instances) full.set(`${i.part}|${i.color}`, (full.get(`${i.part}|${i.color}`) ?? 0) + 1);
  for (const [k, n] of full) if (sum.get(k) !== n) issues.push(`Menge ${k}: Schritte ${sum.get(k) ?? 0}, Modell ${n}.`);
  for (const k of sum.keys()) if (!full.has(k)) issues.push(`Menge ${k} nicht im Modell.`);
  return issues;
}
