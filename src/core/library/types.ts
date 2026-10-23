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

/** Private, nur lokal erzeugte Farbbelege (Rebrickable-Set-Inventare); nie im öffentlichen Build. */
export interface RebrickableColorsFile {
  schema: 'baustein-sim/library-rebrickable-private@1';
  definition: { recentFrom: number; excludedCategories: number[]; refset: string };
  /** Rebrickable-Farb-ID → [Name, RGB, transparent] */
  colors: Record<string, [string, string, boolean]>;
  /** LDraw-ID → Zuordnung und Farbbelege [Farbe, Sets, Sets ab recentFrom, erstes Jahr, letztes Jahr, Element-ID vorhanden] */
  parts: Record<string, { rb: string[]; map: string[]; colors: [number, number, number, number, number, boolean][] }>;
  /** Referenzmenge: LDraw-ID → Anzahl Sets ab recentFrom */
  refset: Record<string, number>;
  refsetUnmapped: string[];
}

export interface BuildInfo {
  schema: 'baustein-sim/library-build@1';
  builder: string;
  ldrawRelease: string | null;
  sources: Record<string, { url: string; sha256: string; bytes: number; commit?: string; licence: string }>;
  counts: Record<string, number | Record<string, number>>;
  outputs: Record<string, { sha256: string; bytes: number }>;
}
