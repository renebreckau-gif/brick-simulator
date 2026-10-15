// Anschlussarten und Kompatibilitätsregeln (versioniert).
// Nur Regeln mit status 'implemented' werden vom Validator als Verbindung gewertet;
// alle anderen Anschlussarten erzeugen sichtbar „nicht unterstützt“.

export const RULES_VERSION = 'connect-rules@1.0.0';

export type ConnectorKind =
  | 'stud'
  | 'antistud'
  | 'tube'
  | 'technic_pin'
  | 'technic_pin_hole'
  | 'technic_axle'
  | 'technic_axle_hole'
  | 'bar'
  | 'bar_holder'
  | 'clip'
  | 'hinge'
  | 'side_stud'
  | 'underside_pin'
  | 'flex';

export interface ConnectionRule {
  id: string;
  male: ConnectorKind;
  female: ConnectorKind;
  status: 'implemented' | 'not_implemented';
  description: string;
  /** Geometrische Bedingung in Worten (für Bericht/Doku). */
  condition: string;
  /** Erlaubte Montagebewegung relativ zur Anschlussachse. */
  motion: 'straight-along-axis' | 'unknown';
}

export const CONNECTION_RULES: ConnectionRule[] = [
  {
    id: 'R-STUD-ANTISTUD',
    male: 'stud',
    female: 'antistud',
    status: 'implemented',
    description: 'Noppe in Unterseiten-Aufnahme (reguläres Raster)',
    condition: 'Anschlusspunkte deckungsgleich (≤ Toleranz), Achsen entgegengesetzt',
    motion: 'straight-along-axis',
  },
  {
    id: 'R-STUD-TUBE',
    male: 'stud',
    female: 'tube',
    status: 'implemented',
    description: 'Noppe in Röhre (Halbnoppenversatz unter 2-breiten Teilen)',
    condition: 'Anschlusspunkte deckungsgleich (≤ Toleranz), Achsen entgegengesetzt',
    motion: 'straight-along-axis',
  },
  {
    id: 'R-UPIN-HOLLOWSTUD',
    male: 'underside_pin',
    female: 'bar_holder',
    status: 'not_implemented',
    description: 'Unterseitenstift eines 1×N-Teils in Hohlnoppe (z. B. 1×2-Stein mittig auf Hohlnoppe)',
    condition: '–',
    motion: 'unknown',
  },
  { id: 'R-PIN-HOLE', male: 'technic_pin', female: 'technic_pin_hole', status: 'not_implemented', description: 'Technic-Pin in Pinloch', condition: '–', motion: 'unknown' },
  { id: 'R-AXLE-HOLE', male: 'technic_axle', female: 'technic_axle_hole', status: 'not_implemented', description: 'Technic-Achse in Achsloch', condition: '–', motion: 'unknown' },
  { id: 'R-BAR-HOLDER', male: 'bar', female: 'bar_holder', status: 'not_implemented', description: 'Stange in Halter/Clip/Hohlnoppe', condition: '–', motion: 'unknown' },
  { id: 'R-CLIP', male: 'bar', female: 'clip', status: 'not_implemented', description: 'Clip-Verbindung', condition: '–', motion: 'unknown' },
  { id: 'R-HINGE', male: 'hinge', female: 'hinge', status: 'not_implemented', description: 'Scharnier (beweglich)', condition: '–', motion: 'unknown' },
  { id: 'R-SNOT', male: 'side_stud', female: 'antistud', status: 'not_implemented', description: 'Seitliche Noppen (SNOT-Spezialteile)', condition: '–', motion: 'unknown' },
  { id: 'R-FLEX', male: 'flex', female: 'flex', status: 'not_implemented', description: 'Flexible Teile', condition: '–', motion: 'unknown' },
];

export function ruleFor(male: ConnectorKind, female: ConnectorKind): ConnectionRule | undefined {
  return CONNECTION_RULES.find((r) => r.male === male && r.female === female);
}

export const IMPLEMENTED_MALE: ConnectorKind[] = ['stud'];
export const IMPLEMENTED_FEMALE: ConnectorKind[] = ['antistud', 'tube'];

export function isImplementedKind(k: ConnectorKind): boolean {
  return IMPLEMENTED_MALE.includes(k) || IMPLEMENTED_FEMALE.includes(k);
}

/** Gegenstücke laut Regeltabelle (für die Erkennung „mögliche, aber ungeprüfte Verbindung“). */
export function counterpartKinds(k: ConnectorKind): ConnectorKind[] {
  return CONNECTION_RULES.flatMap((r) => (r.male === k ? [r.female] : r.female === k ? [r.male] : []));
}
