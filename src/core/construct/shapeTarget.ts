// Formvorgabe für eine Baugruppe (Auftrag 05B.1): messbare Zielgeometrie in Noppen und Plattenhöhen,
// unabhängig davon, aus welcher Vorlage sie stammt. Jede Angabe trägt ihre Quelle (welche Ansicht, welches
// Verfahren). Widersprüchliche Angaben verschiedener Ansichten werden NICHT gemittelt: Eine Ansicht wird als
// Quelle gewählt, die Abweichung der anderen wird festgehalten.

export const SHAPE_TARGET_SCHEMA = 'baustein-sim/shape-target@1';

export interface TargetSource {
  field: string;
  /** Ansicht bzw. Herkunft (z. B. „OBEN (Ausschnitt v-oben)“, „synthetische Testform“). */
  source: string;
  method: string;
}

/**
 * Formvorgabe „spitz zulaufender Bug mit Kanzel“.
 * Reihen j = 0 (hinten, Übergang zum Rumpf) … rows − 1 (Spitze); je Reihe Zielbreite (Noppen) und Oberkante
 * (Plattenhöhen über der flachen Unterseite). Reale Maße entstehen erst über den gewählten Maßstab.
 */
export interface BowTarget {
  schema: typeof SHAPE_TARGET_SCHEMA;
  kind: 'bow-with-canopy';
  label: string;
  /** Herkunft insgesamt: Vorlagenmessung oder synthetische Testform. */
  origin: { kind: 'template-measurement' | 'synthetic'; description: string; imageSha256?: string };
  /** Maßstab: Noppen je Längeneinheit der Vorlage (L = gezeichnete Rumpflänge); null bei synthetischer Form. */
  studsPerL: number | null;
  rows: number;
  width: number[];
  top: number[];
  /** Kanzel: Reihen (hinten → vorn), Breite (Noppen), Höhe über der Rumpfoberkante (Plattenhöhen). */
  canopy: { fromRow: number; toRow: number; width: number; height: number } | null;
  sources: TargetSource[];
  /** Widersprüche und bewusste Entscheidungen bei der Ableitung (z. B. „rechte Seite weicht um … ab“). */
  notes: string[];
}

export class TargetError extends Error {}

/** Prüft eine Formvorgabe auf Vollständigkeit und Konstruierbarkeit (Grenzen der Bautechnik). */
export function checkBowTarget(t: BowTarget): string[] {
  const e: string[] = [];
  if (!Number.isInteger(t.rows) || t.rows < 4 || t.rows > 60) e.push(`Länge ${t.rows} Reihen außerhalb 4…60`);
  if (t.width.length !== t.rows || t.top.length !== t.rows) e.push('Breiten- und Höhenprofil müssen je Reihe einen Wert haben');
  if (t.width.some((w) => !(w > 0) || w > 40)) e.push('Breiten müssen zwischen 0 und 40 Noppen liegen');
  if (t.top.some((h) => !(h > 0) || h > 120)) e.push('Höhen müssen zwischen 0 und 120 Plattenhöhen liegen');
  if (t.canopy) {
    const c = t.canopy;
    if (!(c.fromRow >= 0 && c.toRow < t.rows && c.toRow - c.fromRow >= 1)) e.push('Kanzel muss mindestens zwei Reihen innerhalb des Bugs umfassen');
    if (!(c.width >= 2) || !(c.height > 0)) e.push('Kanzel braucht Breite ≥ 2 Noppen und eine Höhe');
  }
  return e;
}

/**
 * Synthetische Testformen – ausdrücklich keine Vorlagenmessung. Sie dienen dazu zu zeigen, dass die
 * Konstruktion auf eine geänderte Formvorgabe reagiert.
 */
export function syntheticBowTarget(p: { rows: number; width: number; noseRows: number; rearTop: number; tipTop: number; canopy?: { fromRow: number; toRow: number; width: number; height: number } | null; label?: string }): BowTarget {
  const width: number[] = [];
  const top: number[] = [];
  const noseStart = p.rows - p.noseRows;
  for (let j = 0; j < p.rows; j++) {
    const f = j < noseStart ? 0 : (j - noseStart + 1) / p.noseRows; // 0 hinten … 1 an der Spitze
    width.push(p.width - (p.width - 2) * f);
    top.push(p.rearTop - (p.rearTop - p.tipTop) * f);
  }
  return {
    schema: SHAPE_TARGET_SCHEMA, kind: 'bow-with-canopy', label: p.label ?? 'Synthetische Testform',
    origin: { kind: 'synthetic', description: 'Synthetische Testform (linear zulaufend) – keine Vorlagenmessung' },
    studsPerL: null, rows: p.rows, width, top, canopy: p.canopy ?? null,
    sources: [{ field: 'alle', source: 'synthetische Testform', method: 'Parameter' }],
    notes: [],
  };
}
