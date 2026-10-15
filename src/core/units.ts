// Einheiten und numerische Toleranzen.
//
// Koordinatensystem: LDraw – rechtshändig, −Y zeigt nach oben, Einheit LDU.
// Die Schwerkraft wirkt in +Y (Weltkoordinaten). 1 LDU ≈ 0,4 mm (laut LDraw-Spezifikation nur Näherung).

export const LDU_PER_STUD = 20;
export const BRICK_HEIGHT = 24;
export const PLATE_HEIGHT = 8;
export const STUD_HEIGHT = 4;
export const STUD_DIAMETER = 12;
export const APPROX_MM_PER_LDU = 0.4;

export const COORDINATE_SYSTEM = 'ldraw-right-handed-negative-y-up' as const;
export const GRAVITY_DIRECTION: [number, number, number] = [0, 1, 0];

/**
 * Dokumentierte Toleranzen (Version in RULES_VERSION).
 * - connectorPosition: max. Abstand zweier Anschlusspunkte, die als deckungsgleich gelten.
 *   LDraw-Modelle sind meist ganzzahlig; 0,25 LDU (≈0,1 mm) fängt Rundungsrauschen,
 *   bleibt aber weit unter dem kleinsten echten Versatz (halbe Noppe = 10 LDU).
 * - penetration: Überlappung, ab der zwei Volumen als Durchdringung gelten.
 *   Flächenkontakt (Überlappung 0) ist ausdrücklich keine Kollision.
 * - contact: Abstand, bis zu dem zwei Volumen als „berührend“ gelten (für Nachbarschaft/Fugen).
 * - matrix: Abweichung einer Rotationsmatrix von Orthonormalität (Skalierung/Verformung).
 */
export const TOLERANCE = {
  connectorPosition: 0.25,
  penetration: 0.5,
  contact: 0.25,
  matrix: 1e-3,
  axisAlignment: 1e-3,
} as const;
