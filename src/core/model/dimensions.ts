// Außenmaße eines Modells aus der tatsächlichen Teilegeometrie (LDraw-Begrenzungsboxen je Instanz,
// mit der Instanz-Transformation in Weltkoordinaten überführt). Keine Schätzung aus Parametern.
import type { PartLibrary } from '../ldraw/library';
import { transformBox, unionBox, type Box } from '../math';
import { APPROX_MM_PER_LDU, LDU_PER_STUD } from '../units';
import type { CanonicalModel } from './types';

export interface ModelDimensions {
  /** Länge (x), Breite (z), Höhe (y) in LDU. */
  ldu: { length: number; width: number; height: number };
  mm: { length: number; width: number; height: number };
  /** in Noppenraster (20 LDU) für Länge/Breite; Höhe in LDU. */
  studs: { length: number; width: number };
  box: Box;
  /** Instanzen ohne Geometrie (nicht in den Maßen enthalten). */
  missingGeometry: string[];
}

export function modelDimensions(model: CanonicalModel, library: PartLibrary): ModelDimensions {
  const boxes: Box[] = [];
  const missing: string[] = [];
  for (const i of model.instances) {
    if (!library.has(`${i.part}.dat`)) {
      missing.push(i.instanceId);
      continue;
    }
    boxes.push(transformBox({ position: i.position, rotation: i.rotation }, library.flatten(`${i.part}.dat`).bbox));
  }
  const box = boxes.length ? unionBox(boxes) : { min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] };
  const r = (v: number) => Math.round(v * 100) / 100;
  const ldu = { length: r(box.max[0] - box.min[0]), width: r(box.max[2] - box.min[2]), height: r(box.max[1] - box.min[1]) };
  const mm = { length: r(ldu.length * APPROX_MM_PER_LDU), width: r(ldu.width * APPROX_MM_PER_LDU), height: r(ldu.height * APPROX_MM_PER_LDU) };
  return { ldu, mm, studs: { length: r(ldu.length / LDU_PER_STUD), width: r(ldu.width / LDU_PER_STUD) }, box, missingGeometry: missing };
}
