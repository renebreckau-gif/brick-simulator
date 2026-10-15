// PDF-Export der Bauanleitung mit jsPDF (lokal im Browser, keine Serverdienste).
// Inhalt und Bilder stammen aus derselben Anleitungsdatenbasis wie die Bildschirmansicht
// (document.ts). Schrittkarten werden nie über Seiten geteilt; Bilder werden vollständig eingepasst.
import { jsPDF } from 'jspdf';
import type { InstructionPlan, PartLine } from '../../core/instructions/plan';
import { designNotes, facts, fullDocument, LEGEND, lineKey, notice, OVERVIEW_IMAGE, sections, STEP_IMAGE, type DocStep } from './document';
import type { InstructionRenderer } from './render';

const PAGE = { w: 210, h: 297, m: 12 };
const CONTENT_W = PAGE.w - 2 * PAGE.m;
const BOTTOM = PAGE.h - 16; // Platz für Fußzeile
const INK: [number, number, number] = [24, 33, 44];
const MUTED: [number, number, number] = [91, 107, 127];

/** Die PDF-Standardschriften decken nur Latin-1 ab: übrige Zeichen in lesbare Entsprechungen umsetzen. */
export function pdfText(s: string): string {
  return s
    .replace(/[–—]/g, '-')
    .replace(/[„“”]/g, '"')
    .replace(/[‚‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/≈/g, 'ca.')
    .replace(/[^\x00-\xff]/g, '?');
}

export interface PdfResult {
  blob: Blob;
  pages: number;
  fileName: string;
}

export function instructionPdf(r: InstructionRenderer, plan: InstructionPlan): PdfResult {
  const docData = fullDocument(r, plan);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: pdfText(`Bauanleitung ${plan.modelName}`), subject: pdfText(`${plan.modelRef.modelId} v${plan.modelRef.version} ${plan.modelRef.contentHash} ${plan.planVersion}`), creator: 'Baustein-Simulator' });
  const text = (s: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: [number, number, number]; width?: number; align?: 'left' | 'right' } = {}) => {
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...(opts.color ?? INK));
    const lines: string[] = opts.width ? pdf.splitTextToSize(pdfText(s), opts.width) : [pdfText(s)];
    pdf.text(lines, x, y, { baseline: 'top', align: opts.align ?? 'left' });
    return lines.length * size * 0.3528 * 1.25;
  };
  const measure = (s: string, size: number, width: number) => {
    pdf.setFontSize(size);
    return (pdf.splitTextToSize(pdfText(s), width) as string[]).length * size * 0.3528 * 1.25;
  };

  // ---- Titelseite (lange Listen laufen auf eine Folgeseite über, nie in die Fußzeile)
  let y = PAGE.m;
  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      pdf.addPage();
      y = PAGE.m;
    }
  };
  y += text('Bauanleitung', PAGE.m, y, 22, { bold: true }) + 1;
  y += text(plan.modelName, PAGE.m, y, 14, { color: MUTED }) + 3;
  // Textumfang der Titelseite vorab messen; das Titelbild wird bei Bedarf verkleinert (Seitenverhältnis bleibt),
  // damit die Titelseite ohne fast leere Folgeseite auskommt.
  const dnPre = designNotes(plan);
  const designLines = dnPre ? [...dnPre.assumptions, ...dnPre.deviations, ...(dnPre.comparison ? [dnPre.comparison] : [])].map((l) => `- Abweichung: ${l}`) : [];
  const textH =
    facts(plan).reduce((a, [, v]) => a + measure(v, 10, CONTENT_W - 44) + 0.8, 0) + 2 +
    measure(notice(plan), 10, CONTENT_W - 8) + 10 +
    8 + LEGEND.length * 5 + 2 +
    (designLines.length ? 9 + designLines.reduce((a, l) => a + measure(l, 9.5, CONTENT_W) + 0.5, 0) : 0) +
    9 + sections(plan).reduce((a, l) => a + measure(`- ${l}`, 9.5, CONTENT_W) + 0.5, 0) + 4;
  const ovFull = (CONTENT_W * OVERVIEW_IMAGE.height) / OVERVIEW_IMAGE.width;
  const ovH = Math.max(60, Math.min(ovFull, BOTTOM - y - 4 - textH));
  const ovW = (ovH * OVERVIEW_IMAGE.width) / OVERVIEW_IMAGE.height;
  const ovX = PAGE.m + (CONTENT_W - ovW) / 2;
  pdf.addImage(docData.overview, 'JPEG', ovX, y, ovW, ovH);
  pdf.setDrawColor(205, 213, 222);
  pdf.rect(ovX, y, ovW, ovH);
  y += ovH + 4;
  for (const [k, v] of facts(plan)) {
    text(k, PAGE.m, y, 10, { bold: true });
    y += text(v, PAGE.m + 44, y, 10, { width: CONTENT_W - 44 }) + 0.8;
  }
  y += 2;
  const NOTICE = notice(plan);
  const noteH = measure(NOTICE, 10, CONTENT_W - 8) + 6;
  pdf.setFillColor(255, 247, 230);
  pdf.setDrawColor(154, 91, 0);
  pdf.rect(PAGE.m, y, CONTENT_W, noteH, 'FD');
  text(NOTICE, PAGE.m + 4, y + 3, 10, { width: CONTENT_W - 8 });
  y += noteH + 4;
  y += text('Markierungen in den Bildern', PAGE.m, y, 11, { bold: true }) + 1;
  for (const [k, v] of LEGEND) {
    ensure(6);
    text(k, PAGE.m, y, 9.5, { bold: true });
    y += text(v, PAGE.m + 56, y, 9.5, { width: CONTENT_W - 56 }) + 0.5;
  }
  const dn = designNotes(plan);
  if (dn) {
    y += 2;
    y += text('Entwurfsannahmen und Abweichungen', PAGE.m, y, 11, { bold: true }) + 1;
    for (const line of [...dn.assumptions.map((a) => `Annahme: ${a}`), ...dn.deviations.map((d) => `Abweichung: ${d}`), ...(dn.comparison ? [`Visueller Abgleich: ${dn.comparison}`] : [])]) {
      ensure(measure(`- ${line}`, 9.5, CONTENT_W));
      y += text(`- ${line}`, PAGE.m, y, 9.5, { width: CONTENT_W }) + 0.5;
    }
  }
  y += 2;
  ensure(12);
  y += text('Aufbau', PAGE.m, y, 11, { bold: true }) + 1;
  for (const s of sections(plan)) {
    ensure(measure(`- ${s}`, 9.5, CONTENT_W));
    y += text(`- ${s}`, PAGE.m, y, 9.5, { width: CONTENT_W }) + 0.5;
  }

  // ---- Teilezellen (Schritt und Stückliste)
  const CELL_W = CONTENT_W / 4;
  const CELL_H = 21;
  const drawCell = (l: PartLine, thumb: string | undefined, x: number, cy: number) => {
    if (thumb) pdf.addImage(thumb, 'JPEG', x, cy + 1, 17, 17);
    pdf.setDrawColor(205, 213, 222);
    pdf.rect(x, cy + 1, 17, 17);
    text(`${l.quantity}×`, x + 19, cy + 1.2, 11, { bold: true });
    // Name höchstens zwei Zeilen, Teilenummer/Farbe höchstens zwei Zeilen darunter – nichts überlappt
    const clip = (s: string, size: number, maxLines: number) => {
      pdf.setFontSize(size);
      const lines = pdf.splitTextToSize(pdfText(s), CELL_W - 20) as string[];
      return lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].replace(/.{0,3}$/, '')}...`] : lines;
    };
    const nameLines = clip(l.partName, 8.5, 2);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...INK);
    pdf.text(nameLines, x + 19, cy + 6.3, { baseline: 'top' });
    const metaY = cy + 6.3 + nameLines.length * 8.5 * 0.3528 * 1.15;
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED);
    pdf.text(clip(`${l.part} · ${l.colorName}`, 8, nameLines.length > 1 ? 1 : 2), x + 19, metaY, { baseline: 'top' });
  };
  const gridH = (n: number) => Math.ceil(n / 4) * CELL_H;

  // ---- Schrittkarten
  const N = plan.steps.length;
  const cardLayout = (d: DocStep) => {
    const s = d.step;
    const hasDetail = !!d.images.detail;
    const mainW = hasDetail ? 128 : 150;
    const mainH = (mainW * STEP_IMAGE.height) / STEP_IMAGE.width;
    const notes = [
      ...(s.cameraNote ? [`Ansicht: ${s.cameraNote}`] : []),
      `Einsetzen: ${s.insertion.text}`,
      ...s.support.map((x) => `Hinweis: ${x}`),
      ...s.openChecks.map((x) => `Offen: ${x}`),
    ];
    const moduleCells = s.attachedModules.length;
    const h = 10 + 2 + measure(s.action, 10.5, CONTENT_W) + 2 + mainH + 3 + notes.reduce((a, n) => a + measure(n, 9, CONTENT_W) + 0.6, 0) + 2 + moduleCells * CELL_H + gridH(s.newParts.length) + 2;
    return { hasDetail, mainW, mainH, notes, h };
  };
  const drawCard = (d: DocStep, y0: number) => {
    const s = d.step;
    const L = cardLayout(d);
    let cy = y0;
    pdf.setFillColor(s.isModule ? 232 : 236, s.isModule ? 240 : 239, s.isModule ? 250 : 242);
    pdf.rect(PAGE.m, cy, CONTENT_W, 10, 'F');
    text(`Schritt ${s.number} / ${N}`, PAGE.m + 3, cy + 2.3, 13, { bold: true });
    text(s.title, PAGE.m + 44, cy + 2.8, 10.5, { bold: true, width: 90 });
    text(s.isModule ? `Vormontage: ${s.contextName}` : 'Hauptmodell', PAGE.w - PAGE.m - 3, cy + 3, 9.5, { color: MUTED, align: 'right' });
    cy += 12;
    cy += text(s.action, PAGE.m, cy, 10.5, { width: CONTENT_W }) + 2;
    const mx = L.hasDetail ? PAGE.m : PAGE.m + (CONTENT_W - L.mainW) / 2;
    pdf.addImage(d.images.main, 'JPEG', mx, cy, L.mainW, L.mainH);
    pdf.setDrawColor(205, 213, 222);
    pdf.rect(mx, cy, L.mainW, L.mainH);
    if (d.images.detail) {
      const dx = PAGE.m + L.mainW + 4;
      const dw = CONTENT_W - L.mainW - 4;
      text('Detail: Draufsicht', dx, cy, 8.5, { bold: true, color: MUTED });
      const dh = dw / 1.2;
      pdf.addImage(d.images.detail, 'JPEG', dx, cy + 4.5, dw, dh);
      pdf.rect(dx, cy + 4.5, dw, dh);
    }
    cy += L.mainH + 3;
    for (const n of L.notes) cy += text(n, PAGE.m, cy, 9, { width: CONTENT_W, color: n.startsWith('Offen') ? [154, 91, 0] : INK }) + 0.6;
    cy += 2;
    // Vormontagen als eigene, volle Zeile (nicht als Einzelteile gezählt)
    for (const m of s.attachedModules) {
      const thumb = d.moduleThumbs.get(m.assemblyId);
      if (thumb) pdf.addImage(thumb, 'JPEG', PAGE.m, cy + 1, 17, 17);
      pdf.setDrawColor(24, 33, 44);
      pdf.setLineWidth(0.5);
      pdf.rect(PAGE.m, cy + 1, 17, 17);
      pdf.setLineWidth(0.2);
      text(`1× Vormontage „${m.name}“`, PAGE.m + 19, cy + 2, 11, { bold: true });
      text(`aus Schritt ${m.builtInSteps[0]}–${m.builtInSteps.at(-1)}, ${m.instanceCount} Teile – dort bereits gezählt, nicht erneut entnehmen`, PAGE.m + 19, cy + 8, 9, { color: MUTED, width: CONTENT_W - 20 });
      cy += CELL_H;
    }
    let i = 0;
    for (const l of s.newParts) {
      drawCell(l, d.thumbs.get(lineKey(l)), PAGE.m + (i % 4) * CELL_W, cy + Math.floor(i / 4) * CELL_H);
      i++;
    }
    return L.h;
  };

  pdf.addPage();
  y = PAGE.m;
  let prevCtx: string | null = null;
  for (const d of docData.steps) {
    const h = cardLayout(d).h;
    // Neue Seite, wenn die Karte nicht mehr passt oder der Baukontext wechselt (Vormontage ↔ Hauptmodell)
    const ctxChange = prevCtx !== null && prevCtx !== d.step.context;
    prevCtx = d.step.context;
    if (y > PAGE.m && (ctxChange || y + h > BOTTOM)) {
      pdf.addPage();
      y = PAGE.m;
    }
    y += drawCard(d, y) + 5;
    if (y < BOTTOM - 1) {
      pdf.setDrawColor(205, 213, 222);
      pdf.line(PAGE.m, y - 2.5, PAGE.w - PAGE.m, y - 2.5);
    }
  }

  // ---- Vollständige Stückliste
  pdf.addPage();
  y = PAGE.m;
  y += text(`Vollständige Stückliste: ${plan.totalParts} Teile in ${plan.bom.length} Positionen`, PAGE.m, y, 14, { bold: true }) + 1;
  y += text(plan.catalogState === 'loaded' ? 'Teilenummern nach LDraw; Namen und Farben aus dem lokalen Katalogauszug. Keine Elementnummern, Preise oder Verfügbarkeit.' : 'Ohne Katalogauszug: LDraw-Teilenummern und LDraw-Farbnamen; Katalogzuordnung und Teil-Farb-Belege ungeprüft. Keine Elementnummern, Preise oder Verfügbarkeit.', PAGE.m, y, 9, { width: CONTENT_W, color: MUTED }) + 3;
  plan.bom.forEach((l, i) => {
    const col = i % 4;
    if (col === 0 && i > 0) y += CELL_H;
    if (col === 0 && y + CELL_H > BOTTOM) {
      pdf.addPage();
      y = PAGE.m;
    }
    drawCell(l, docData.bomThumbs.get(lineKey(l)), PAGE.m + col * CELL_W, y);
  });

  // ---- Fußzeilen
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    text(`${plan.modelRef.modelId} · Version ${plan.modelRef.version} · Modellhash ${plan.modelRef.contentHash} · ${plan.planVersion}`, PAGE.m, PAGE.h - 10, 8, { color: MUTED });
    text(`Seite ${p} von ${pages}`, PAGE.w - PAGE.m, PAGE.h - 10, 8, { color: MUTED, align: 'right' });
  }
  return { blob: pdf.output('blob'), pages, fileName: `${plan.modelRef.modelId}-v${plan.modelRef.version}-${plan.modelRef.contentHash}.anleitung.pdf` };
}
