// Anschlussarten und Kompatibilitätsregeln (versioniert).
// Nur Regeln mit status 'implemented' werden vom Validator als Verbindung gewertet;
// alle anderen Anschlussarten erzeugen sichtbar „nicht unterstützt“.

export const RULES_VERSION = 'connect-rules@1.1.0';

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
  /**
   * Belegter Geltungsbereich (LDraw-Teilenummern). Fehlt er, gilt die Regel für alle Teile mit der Anschlussart.
   * Teile außerhalb bleiben trotz gleicher Anschlussart „ungeprüft“.
   */
  scope?: { male: string[]; female: string[]; evidence: string };
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
    status: 'implemented',
    scope: {
      male: ['3004'],
      female: ['6541'],
      evidence:
        'Paarung im Set 21002-1 (LEGO-Anleitung 4580898, Schritt 24; OMR-Datei, Gruppe Building#20) belegt; Maße aus LDraw (stud3.dat, stud2.dat, box5-Hohlraum). Andere Teile mit gleicher Anschlussart sind nicht freigegeben.',
    },
    description: 'Unterseitenstift eines 1×2-Steins (3004) greift koaxial in die Hohlnoppe eines Technic-Steins 1×1 (6541); die Noppenwand sitzt im Hohlraum zwischen Stift und Seitenwänden',
    condition:
      'Stiftachse und Noppenachse koaxial (≤ 0,25 LDU), entgegengesetzt; Teilboden liegt auf der Noppenbasis (Einstecktiefe = Noppenhöhe 4 LDU); Stiftradius ≤ Lochradius, Noppen-Außenradius ≤ halbe lichte Hohlraumweite, Lochtiefe ≥ Einstecktiefe (Nennmaße aus LDraw)',
    motion: 'straight-along-axis',
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

/** Regeln mit belegtem, teilespezifischem Geltungsbereich. */
export function scopedRuleFor(kind: ConnectorKind, ldrawId: string): ConnectionRule | undefined {
  return CONNECTION_RULES.find(
    (r) => r.status === 'implemented' && r.scope && ((r.male === kind && r.scope.male.includes(ldrawId)) || (r.female === kind && r.scope.female.includes(ldrawId))),
  );
}

/** Ist dieser Anschluss dieses Teils durch eine implementierte Regel abgedeckt? */
export function isImplementedConnector(kind: ConnectorKind, ldrawId: string): boolean {
  return isImplementedKind(kind) || !!scopedRuleFor(kind, ldrawId);
}

/** Gegenstücke laut Regeltabelle (für die Erkennung „mögliche, aber ungeprüfte Verbindung“). */
export function counterpartKinds(k: ConnectorKind): ConnectorKind[] {
  return CONNECTION_RULES.flatMap((r) => (r.male === k ? [r.female] : r.female === k ? [r.male] : []));
}
