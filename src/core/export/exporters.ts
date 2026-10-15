// Exporte: kanonisches Modell (JSON), Prüfbericht (JSON), Stückliste (CSV), LDraw (MPD).
import type { Bom } from '../bom/bom';
import { modelRef } from '../model/hash';
import type { CanonicalModel } from '../model/types';
import type { ValidationReport } from '../validation/findings';

export function exportModelJson(model: CanonicalModel): string {
  return JSON.stringify({ ...model, exportedRef: modelRef(model) }, null, 2);
}

export function exportReportJson(report: ValidationReport): string {
  return JSON.stringify(report, null, 2);
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportBomCsv(bom: Bom): string {
  const head = ['status', 'ldraw_part', 'ldraw_color', 'rebrickable_part', 'rebrickable_color', 'part_name', 'color_name', 'quantity', 'combination_evidence', 'simulation', 'note'];
  const rows: unknown[][] = [
    ...bom.lines.map((l) => ['aufgeloest', l.ldrawPart, l.ldrawColor, l.rebrickablePart, l.rebrickableColor, l.partName, l.colorName, l.quantity, l.combination === 'evidenced' ? 'belegt' : 'nicht belegt', l.simulation, '']),
    ...bom.unresolved.map((u) => ['nicht aufloesbar', u.ldrawPart, u.ldrawColor, '', '', '', '', u.quantity, '', '', u.reasons.join(' / ')]),
  ];
  const meta = `# modell=${bom.modelRef.modelId};version=${bom.modelRef.version};hash=${bom.modelRef.contentHash};katalog=${bom.catalogVersion};beschaffung=nicht geprueft`;
  return [meta, head.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';
}

/** LDraw-Export mit STEP je Bauschritt (flach, Weltkoordinaten). */
export function exportLdraw(model: CanonicalModel): string {
  const ref = modelRef(model);
  const fmt = (n: number) => String(Number(n.toFixed(4)));
  const line = (id: string) => {
    const i = model.instances.find((x) => x.instanceId === id)!;
    return `1 ${i.color} ${i.position.map(fmt).join(' ')} ${i.rotation.map(fmt).join(' ')} ${i.part}.dat`;
  };
  const out = [`0 ${model.name}`, `0 Name: ${model.modelId}.ldr`, `0 // Export Baustein-Simulator: Modell ${ref.modelId} v${ref.version} (${ref.contentHash})`];
  if (model.steps.length) {
    for (const s of model.steps) {
      if (!s.add.length) continue;
      out.push(`0 // Schritt ${s.stepId}`, ...s.add.map(line), '0 STEP');
    }
  } else out.push(...model.instances.map((i) => line(i.instanceId)));
  return out.join('\n') + '\n';
}
