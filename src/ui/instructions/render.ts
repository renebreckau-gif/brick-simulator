// Bilder der Bauanleitung: ausschließlich aus den Teilinstanzen des Modells mit unveränderter
// LDraw-Geometrie gerendert (keine Ersatzbilder). Eine Renderer-Instanz (ein WebGL-Kontext)
// bedient Bildschirmansicht, Druckansicht und PDF – dieselben Bilder aus demselben Plan.
//
// Kennzeichnung neuer Teile ohne Farbe als einziges Merkmal: neue Teile in voller Farbe mit
// kräftigen Kanten, Bestand aufgehellt mit schwachen Kanten; zusätzlich Markierungen im Bild
// (Pfeil nach unten nur bei im Bewegungsmodell geprüftem Steckweg, sonst Ringmarke ohne Richtung).
import * as THREE from 'three';
import type { Catalog } from '../../core/catalog/catalog';
import { CAMERAS, type CameraId, type InstructionPlan, type PlanStep } from '../../core/instructions/plan';
import type { PartLibrary } from '../../core/ldraw/library';
import type { Box, Vec3 } from '../../core/math';
import type { CanonicalModel } from '../../core/model/types';
import { partGeometry } from '../Viewer';

export interface ShotOptions {
  width: number;
  height: number;
  camera: CameraId;
  frame: Box;
  shown: string[];
  highlight: string[];
  /** Einheiten mit geprüftem Steckweg von oben: Pfeil zeichnen. */
  arrowFor: string[][];
  /** Ohne geprüften Steckweg: nur Positionsmarke. */
  markFor: string[][];
  /** false: Übersicht ohne Hervorhebung. */
  emphasize: boolean;
  /** Bildausschnitt eng an diese Instanzen anpassen (Ecken ihrer Boxen statt der Rahmenbox). */
  fitIds?: string[];
  /** Darstellungshilfe: angehobene Baugruppe (nur entlang eines geprüften Steckwegs von oben). */
  lift?: { ids: string[]; ldu: number };
}

/** LDraw (−Y oben) → Three (+Y oben): Drehung um X um 180°. */
const toThree = (v: Vec3) => new THREE.Vector3(v[0], -v[1], -v[2]);

export class InstructionRenderer {
  private gl: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private root = new THREE.Group();
  private objs = new Map<string, { group: THREE.Group; mat: THREE.MeshStandardMaterial | null; lines: THREE.LineBasicMaterial | null; box: THREE.Box3 }>();
  private cache = new Map<string, string>();

  constructor(model: CanonicalModel, library: PartLibrary, catalog: Catalog) {
    this.scene.background = new THREE.Color('#ffffff');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#9aa3ad', 1.7));
    const dir = new THREE.DirectionalLight('#ffffff', 1.3);
    dir.position.set(-300, 700, 500);
    this.scene.add(dir);
    this.root.rotation.x = Math.PI;
    this.scene.add(this.root);
    for (const inst of model.instances) {
      const g = partGeometry(library, catalog, inst.part, inst.color);
      const group = new THREE.Group();
      let mat: THREE.MeshStandardMaterial | null = null;
      let lines: THREE.LineBasicMaterial | null = null;
      if (g) {
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
        lines = new THREE.LineBasicMaterial({ color: '#111820', transparent: true, opacity: 1 });
        group.add(new THREE.Mesh(g.tris, mat), new THREE.LineSegments(g.edges, lines));
      }
      const r = inst.rotation;
      group.matrixAutoUpdate = false;
      group.matrix.set(r[0], r[1], r[2], inst.position[0], r[3], r[4], r[5], inst.position[1], r[6], r[7], r[8], inst.position[2], 0, 0, 0, 1);
      this.root.add(group);
      this.objs.set(inst.instanceId, { group, mat, lines, box: new THREE.Box3() });
    }
    this.root.updateMatrixWorld(true);
    for (const o of this.objs.values()) o.box.setFromObject(o.group);
  }

  /** Weltbox einer Instanz in LDraw-Koordinaten. */
  instanceFrame(instanceId: string): Box | null {
    const o = this.objs.get(instanceId);
    if (!o || o.box.isEmpty()) return null;
    const ld = (v: THREE.Vector3): Vec3 => [v.x, -v.y, -v.z];
    const a = ld(o.box.min);
    const b = ld(o.box.max);
    return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
  }

  /** WebGL-Kontext erst bei Bedarf anlegen; nach dispose() wird er beim nächsten Bild neu erzeugt. */
  private renderer(): THREE.WebGLRenderer {
    if (!this.gl) {
      this.gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
      this.gl.setPixelRatio(1);
    }
    return this.gl;
  }

  dispose() {
    this.gl?.dispose();
    this.gl?.forceContextLoss();
    this.gl = null;
  }

  /** Rendert eine Ansicht und liefert sie als Data-URL (JPEG für kompakte PDFs). */
  shot(o: ShotOptions, key?: string): string {
    if (key && this.cache.has(key)) return this.cache.get(key)!;
    const shown = new Set(o.shown);
    const hi = new Set(o.highlight);
    for (const [id, obj] of this.objs) {
      obj.group.visible = shown.has(id);
      if (!obj.mat || !obj.lines) continue;
      const faded = o.emphasize && !hi.has(id);
      obj.mat.emissive.set(faded ? '#ffffff' : '#000000');
      obj.mat.emissiveIntensity = faded ? 0.42 : 0;
      obj.lines.opacity = faded ? 0.18 : o.emphasize ? 1 : 0.45;
    }
    const cam = this.camera(o.camera, o.frame, o.width / o.height, o.fitIds);
    const lifted = new Set(o.lift?.ids ?? []);
    const saved = new Map<string, THREE.Matrix4>();
    for (const id of lifted) {
      const obj = this.objs.get(id);
      if (!obj) continue;
      saved.set(id, obj.group.matrix.clone());
      obj.group.matrix.premultiply(new THREE.Matrix4().makeTranslation(0, -(o.lift!.ldu), 0)); // LDraw −Y = oben
    }
    const gl = this.renderer();
    gl.setSize(o.width, o.height, false);
    gl.render(this.scene, cam);
    for (const [id, m] of saved) this.objs.get(id)!.group.matrix.copy(m);

    const canvas = document.createElement('canvas');
    canvas.width = o.width;
    canvas.height = o.height;
    const g = canvas.getContext('2d')!;
    g.drawImage(gl.domElement, 0, 0);
    const project = (ids: string[]) => {
      const b = new THREE.Box3();
      for (const id of ids) {
        const obj = this.objs.get(id);
        if (obj) b.union(obj.box);
      }
      if (b.isEmpty()) return null;
      const up = ids.every((id) => lifted.has(id)) ? o.lift!.ldu : 0;
      const top = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + up, (b.min.z + b.max.z) / 2).project(cam);
      return { x: ((top.x + 1) / 2) * o.width, y: ((1 - top.y) / 2) * o.height };
    };
    const s = Math.max(o.width, o.height) / 1000;
    // Übereinanderliegende Einsetzstellen (z. B. Stein und Fliese darauf) teilen sich einen Pfeil
    const arrowPts: { x: number; y: number }[] = [];
    for (const ids of o.arrowFor) {
      const p = project(ids);
      if (!p) continue;
      const near = arrowPts.findIndex((q) => Math.abs(q.x - p.x) < 16 * s && Math.abs(q.y - p.y) < 70 * s);
      if (near < 0) arrowPts.push(p);
      else if (p.y < arrowPts[near].y) arrowPts[near] = p;
    }
    for (const p of arrowPts) {
      // Pfeil senkrecht nach unten auf die Einsetzstelle (nur geprüfte Steckwege)
      const len = 46 * s;
      const tip = { x: p.x, y: p.y - 6 * s };
      g.lineCap = 'round';
      for (const [w, c] of [[9 * s, '#ffffff'], [4.5 * s, '#1b1f24']] as const) {
        g.strokeStyle = c;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(tip.x, tip.y - len);
        g.lineTo(tip.x, tip.y - 12 * s);
        g.stroke();
      }
      g.fillStyle = '#1b1f24';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.5 * s;
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(tip.x - 9 * s, tip.y - 15 * s);
      g.lineTo(tip.x + 9 * s, tip.y - 15 * s);
      g.closePath();
      g.stroke();
      g.fill();
    }
    for (const ids of o.markFor) {
      const p = project(ids);
      if (!p) continue;
      for (const [w, c, dash] of [[7 * s, '#ffffff', false], [3.5 * s, '#1b1f24', true]] as const) {
        g.strokeStyle = c;
        g.lineWidth = w;
        g.setLineDash(dash ? [7 * s, 5 * s] : []);
        g.beginPath();
        g.arc(p.x, p.y, 18 * s, 0, Math.PI * 2);
        g.stroke();
      }
      g.setLineDash([]);
    }
    const url = canvas.toDataURL('image/jpeg', 0.92);
    if (key) this.cache.set(key, url);
    return url;
  }

  /**
   * Ganzes Modell orthografisch entlang vorgegebener Bildschirmachsen (LDraw-System: rechts, unten, zum
   * Betrachter), ohne Hervorhebung – für den Vergleich mit Ansichten einer Vorlage in deren Ausrichtung.
   */
  axisShot(axes: { right: Vec3; down: Vec3; toCamera: Vec3 }, width: number, height: number): string {
    const box = new THREE.Box3();
    for (const obj of this.objs.values()) {
      obj.group.visible = true;
      box.union(obj.box);
      if (!obj.mat || !obj.lines) continue;
      obj.mat.emissive.set('#000000');
      obj.mat.emissiveIntensity = 0;
      obj.lines.opacity = 0.45;
    }
    const center = box.getCenter(new THREE.Vector3());
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
    cam.up.copy(toThree(axes.down).multiplyScalar(-1));
    cam.position.copy(center).add(toThree(axes.toCamera).normalize().multiplyScalar(4000));
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    let w = (maxX - minX) * 1.1;
    let h = (maxY - minY) * 1.1;
    if (w / h < width / height) w = (h * width) / height;
    else h = (w * height) / width;
    cam.left = (minX + maxX) / 2 - w / 2;
    cam.right = (minX + maxX) / 2 + w / 2;
    cam.top = (minY + maxY) / 2 + h / 2;
    cam.bottom = (minY + maxY) / 2 - h / 2;
    cam.updateProjectionMatrix();
    const gl = this.renderer();
    gl.setSize(width, height, false);
    gl.render(this.scene, cam);
    return gl.domElement.toDataURL('image/png');
  }

  /** Orthografische Kamera, eingepasst auf den Bildausschnitt (alle Ecken der Rahmenbox sichtbar). */
  private camera(id: CameraId, frame: Box, aspect: number, fitIds?: string[]): THREE.OrthographicCamera {
    const fc: THREE.Vector3[] = [];
    for (const x of [frame.min[0], frame.max[0]]) for (const y of [frame.min[1], frame.max[1]]) for (const z of [frame.min[2], frame.max[2]]) fc.push(toThree([x, y, z]));
    const center = fc.reduce((a, c) => a.add(c), new THREE.Vector3()).multiplyScalar(1 / fc.length);
    const corners: THREE.Vector3[] = [];
    for (const id of fitIds ?? []) {
      const b = this.objs.get(id)?.box;
      if (!b || b.isEmpty()) continue;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
    if (!corners.length) corners.push(...fc);
    const dir = toThree(CAMERAS[id].toCamera).normalize();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
    if (id === 'oben') cam.up.set(-1, 0, 0);
    else cam.up.set(0, 1, 0);
    cam.position.copy(center).add(dir.multiplyScalar(4000));
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of corners) {
      const v = c.clone().applyMatrix4(inv);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    // Rand für Pfeile oberhalb der Teile
    const pad = 0.08;
    let w = (maxX - minX) * (1 + pad * 2);
    let h = (maxY - minY) * (1 + pad * 2) + (maxY - minY) * 0.12;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2 + (maxY - minY) * 0.06;
    cam.left = cx - w / 2;
    cam.right = cx + w / 2;
    cam.top = cy + h / 2;
    cam.bottom = cy - h / 2;
    cam.updateProjectionMatrix();
    return cam;
  }
}

export interface StepImages {
  main: string;
  detail: string | null;
}

/** Arrow/Mark-Gruppen eines Plan-Schritts: je Einzelteil bzw. je angesetzter Baugruppe. */
function markers(step: PlanStep) {
  const moduleIds = step.highlight.filter((id) => !step.add.includes(id));
  const units: string[][] = [...step.add.map((id) => [id]), ...(moduleIds.length ? [moduleIds] : [])];
  if (step.insertion.checked && step.insertion.kind === 'von-oben') {
    const ok = new Set(step.insertion.arrowUnits);
    const arrowFor = units.filter((u) => (u.length === 1 ? ok.has(u[0]) : step.attach.some((a) => ok.has(a))));
    const markFor = units.filter((u) => !arrowFor.includes(u));
    return { arrowFor, markFor };
  }
  return { arrowFor: [] as string[][], markFor: units };
}

export function stepImages(r: InstructionRenderer, plan: InstructionPlan, step: PlanStep, size: { width: number; height: number }): StepImages {
  const frame = plan.frames[step.frame];
  const { arrowFor, markFor } = markers(step);
  // Ausschnitt fest je Bildrahmen des Plans (unabhängig vom Bauzustand, damit die Lage stabil bleibt)
  const fitIds = plan.frameIds[step.frame] ?? step.shown;
  const base = { width: size.width, height: size.height, frame, shown: step.shown, highlight: step.highlight, emphasize: true, fitIds };
  const k = `${plan.planHash}|${step.number}|${size.width}x${size.height}`;
  // Einbau einer Vormontage: Baugruppe entlang des geprüften Steckwegs angehoben zeigen
  const moduleIds = step.highlight.filter((id) => !step.add.includes(id));
  const lift = step.attach.length && step.insertion.checked && step.insertion.kind === 'von-oben' && moduleIds.length ? { ids: moduleIds, ldu: 56 } : undefined;
  const main = r.shot({ ...base, camera: step.camera, arrowFor, markFor, lift }, `${k}|main`);
  const detail = step.detailCamera ? r.shot({ ...base, width: Math.round(size.height * 1.2), camera: step.detailCamera, arrowFor: [], markFor: arrowFor.concat(markFor) }, `${k}|detail`) : null;
  return { main, detail };
}

export function overviewImage(r: InstructionRenderer, plan: InstructionPlan, size: { width: number; height: number }): string {
  const all = plan.steps.at(-1)?.shown ?? [];
  return r.shot({ ...size, camera: 'iso-vorn', frame: plan.frames.hauptmodell, shown: all, highlight: [], arrowFor: [], markFor: [], emphasize: false, fitIds: all }, `${plan.planHash}|overview|${size.width}x${size.height}`);
}

/** Einzelteilbild für Teileübersichten: genau ein Teil in seiner Farbe, gleiche Geometrie wie im Modell. */
export function partThumb(r: InstructionRenderer, plan: InstructionPlan, instanceId: string, px = 160): string {
  const frame = r.instanceFrame(instanceId);
  if (!frame) return '';
  return r.shot({ width: px, height: px, camera: 'iso-vorn', frame, shown: [instanceId], highlight: [instanceId], arrowFor: [], markFor: [], emphasize: true, fitIds: [instanceId] }, `${plan.planHash}|thumb|${instanceId}|${px}`);
}

/** Bild einer fertigen Vormontage (alle ihre Instanzen, isoliert) für die Einbau-Position. */
export function groupThumb(r: InstructionRenderer, plan: InstructionPlan, frameKey: string, px = 200): string {
  const ids = plan.frameIds[frameKey] ?? [];
  return r.shot({ width: px, height: px, camera: 'iso-vorn', frame: plan.frames[frameKey], shown: ids, highlight: ids, arrowFor: [], markFor: [], emphasize: true, fitIds: ids }, `${plan.planHash}|group|${frameKey}|${px}`);
}
