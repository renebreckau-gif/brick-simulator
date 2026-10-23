// Teilebibliothek (Auftrag 05C.1): Datenformen der versionierten Bibliotheksdateien unter data/library/.
// Erzeugt von scripts/library/build.py; je Quelle und Lizenz eine eigene Datei.
import type { Vec3 } from '../math';

/** LDraw-Eintragsart: Teil, Kurzform (Baugruppe), Druck/Aufkleber, Alias, Umbenennung, versteckt. */
export type LdrawEntryType = 'part' | 'shortcut' | 'print' | 'alias' | 'moved' | 'hidden' | 'other';

/** Flächenanteile der Körperoberfläche (ohne Anschluss-Primitive), aus der LDraw-Geometrie berechnet. */
export interface ShapeFeatures {
  /** waagrecht */
  h?: number;
  /** senkrecht, achsparallel */
  va?: number;
  /** senkrecht, schräg zur Achse, eben (z. B. Keilplatten-Kante) */
  ov?: number;
  /** geneigt, eben */
  i?: number;
  /** gekrümmt (Richtungsfächer); cvv davon senkrecht */
  cv?: number;
  cvv?: number;
  /** Azimute großer geneigter Flächen in 45°-Stufen (0 = +z) */
  sd?: number[];
}

export interface LibraryEntry {
  t: string;
  ty: LdrawEntryType;
  to?: string;
  pr?: string;
  c?: string;
  k?: string[];
  lic?: string;
  u?: string;
  /** Körper-Hüllquader [minx, miny, minz, maxx, maxy, maxz] in LDU, ohne Anschluss-Primitive. */
  bb?: number[];
  /** 0 = Hüllquader genähert: schief gedrehte Unterdateien, aus Extrempunkten in 26 Richtungen (höchstens leicht zu klein). */
  bbx?: 0;
  f?: ShapeFeatures;
  /** Fehlende Unterdateien – Geometrie unvollständig. */
  gm?: string[];
  /** Laut BrickNet geometriegleich mit (reine Umbenennung). */
  same?: string;
  /** 1 = reine Umbenennung: Datei verweist nur auf `to`, Einheitsmatrix am Ursprung (Geometrie identisch). */
  pure?: 1;
}

export interface PartsFile {
  schema: 'baustein-sim/library-parts@1';
  builder: string;
  licence: string;
  source: { source: 'ldraw'; sha256: string; release: string | null };
  parts: Record<string, LibraryEntry>;
}

export type ConnectorClass =
  | 'stud' | 'antistud' | 'bar' | 'barhole' | 'pin' | 'pinhole' | 'axle' | 'axlehole'
  | 'clip' | 'finger' | 'generic' | 'hinge' | 'ball' | 'fixed' | 'other';

export interface ConnectorsFile {
  schema: 'baustein-sim/library-connectors@1';
  builder: string;
  licence: string;
  source: { source: 'ldcad-shadow' | 'bricknet'; commit: string; sha256: string };
  /** [Klasse, Rohform der Quelle] je Typ-Index. */
  types: [ConnectorClass, string][];
  /** Zeile: [Typ-Index, x, y, z, Achse x, Achse y, Achse z] – Achse = Steckrichtung (Noppe oben: 0,−1,0). */
  parts: Record<string, number[][]>;
}

export type ConnectorSource = 'ldcad' | 'bricknet';

export interface LibraryConnector {
  cls: ConnectorClass;
  /** Rohform der Quelle (z. B. "cyl:M:R 6 4", "stud:open"). */
  raw: string;
  pos: Vec3;
  axis: Vec3;
}

/** Zuordnungsgründe, die eine Identität Rebrickable ↔ LDraw belegen (Alternativen gehören nicht dazu). */
export type IdentityReason = 'gleiche Nummer' | 'LDraw-Schlüsselwort' | 'LDraw-Umbenennung';

/**
 * Private, nur lokal erzeugte Farbbelege (Rebrickable-Set-Inventare); nie im öffentlichen Build.
 * Regeln: scripts/library/rebrickable.py (05C.1.1).
 */
export interface RebrickableColorsFile {
  schema: 'baustein-sim/library-rebrickable-private@2';
  definition: { recentFrom: number; excludedCategories: number[]; identityReasons: IdentityReason[]; inventoryRule: string; weight: string; refset: string };
  counts: { sets: number; setsRecent: number; mapped: number; ambiguous: number };
  /** Rebrickable-Farb-ID → [Name, RGB, transparent] */
  colors: Record<string, [string, string, boolean]>;
  /**
   * LDraw-ID → belegte Identität und Farbbelege.
   * rb: Rebrickable-Teil → Zuordnungsgründe; alternatives: nur Hinweis, keine Farbbelege.
   * colors: [Farbe, eindeutige Sets, davon ab recentFrom, erstes Jahr, letztes Jahr, Element-ID vorhanden, Herkunft (Rebrickable-Teile)]
   */
  parts: Record<string, { rb: Record<string, IdentityReason[]>; alternatives: string[]; colors: [number, number, number, number, number, boolean, string[]][] }>;
  /** Rebrickable-Teile, deren Belege auf mehrere LDraw-Teile zeigen – ohne Farbbelege. */
  ambiguous: Record<string, string[]>;
  /** Referenzmenge: LDraw-ID → eindeutige Sets ab recentFrom (Gewicht) */
  refset: Record<string, number>;
  /** Grundteile der Referenzmenge ohne eindeutige LDraw-Zuordnung → Gewicht */
  refsetUnmapped: Record<string, number>;
}

export interface BuildInfo {
  schema: 'baustein-sim/library-build@1';
  builder: string;
  ldrawRelease: string | null;
  sources: Record<string, { url: string; sha256: string; bytes: number; commit?: string; licence: string }>;
  counts: Record<string, number | Record<string, number>>;
  outputs: Record<string, { sha256: string; bytes: number }>;
}
