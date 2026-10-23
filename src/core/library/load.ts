// Datenlader der Teilebibliothek (Auftrag 05C.1.1): unterscheidet fehlend, beschädigt und nicht erreichbar,
// prüft die geladenen Daten zur Laufzeit und nennt Datei und Grund. Optionale Dateien blockieren die übrige
// Bibliothek nie; eine beschädigte optionale Datei erscheint als „beschädigt“, nicht als „fehlt“.
import { z } from 'zod';
import { EvidenceFileSchema, type EvidenceFile } from '../procurement/evidence';
import type { BuildInfo, ConnectorsFile, PartsFile, RebrickableColorsFile } from './types';

export type LoadState = 'geladen' | 'fehlt' | 'beschädigt' | 'nicht erreichbar';

export interface FileStatus {
  file: string;
  label: string;
  required: boolean;
  state: LoadState;
  /** verständlicher Grund (bei allen Zuständen außer „geladen“) */
  reason?: string;
}

/** Minimaler Abruf: wirft bei Netzwerkfehlern, liefert sonst Status, Inhaltstyp und Text. */
export type LoadFetch = (path: string) => Promise<{ status: number; contentType: string; text: () => Promise<string> }>;

const ENTRY_TYPES = ['part', 'shortcut', 'print', 'alias', 'moved', 'hidden', 'other'] as const;

const PartsSchema = z.object({
  schema: z.literal('baustein-sim/library-parts@1'),
  builder: z.string(),
  licence: z.string(),
  source: z.object({ source: z.literal('ldraw'), sha256: z.string().regex(/^[0-9A-F]{64}$/), release: z.string().nullable() }),
  parts: z.record(z.string(), z.object({
    t: z.string(),
    ty: z.enum(ENTRY_TYPES),
    to: z.string().optional(),
    pr: z.string().optional(),
    c: z.string().optional(),
    k: z.array(z.string()).optional(),
    bb: z.array(z.number()).length(6).optional(),
    f: z.record(z.string(), z.union([z.number(), z.array(z.number())])).optional(),
  }).passthrough()),
});

/** Anschlusszeilen: [Typ-Index, x, y, z, ax, ay, az] – schnell ohne Schema je Zeile geprüft (≈ 200 000 Zeilen). */
const ConnectorsSchema = z.object({
  schema: z.literal('baustein-sim/library-connectors@1'),
  builder: z.string(),
  licence: z.string(),
  source: z.object({ source: z.enum(['ldcad-shadow', 'bricknet']), commit: z.string(), sha256: z.string() }).passthrough(),
  types: z.array(z.tuple([z.string(), z.string()])),
  parts: z.record(z.string(), z.array(z.array(z.number()))),
}).superRefine((d, ctx) => {
  for (const [id, rows] of Object.entries(d.parts)) {
    for (const r of rows) {
      if (r.length !== 7 || !Number.isInteger(r[0]) || r[0] < 0 || r[0] >= d.types.length || !r.every(Number.isFinite)) {
        ctx.addIssue({ code: 'custom', path: ['parts', id], message: `ungültige Anschlusszeile [${r.join(', ')}]` });
        return;
      }
    }
  }
});

const ColorsSchema = z.object({
  schema: z.literal('baustein-sim/library-rebrickable-private@2'),
  definition: z.object({ recentFrom: z.number().int(), excludedCategories: z.array(z.number()), identityReasons: z.array(z.string()), inventoryRule: z.string(), weight: z.string(), refset: z.string() }),
  counts: z.object({ sets: z.number(), setsRecent: z.number(), mapped: z.number(), ambiguous: z.number() }),
  colors: z.record(z.string(), z.tuple([z.string(), z.string(), z.boolean()])),
  parts: z.record(z.string(), z.object({
    rb: z.record(z.string(), z.array(z.enum(['gleiche Nummer', 'LDraw-Schlüsselwort', 'LDraw-Umbenennung']))),
    alternatives: z.array(z.string()),
    colors: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.boolean(), z.array(z.string())])),
  })),
  ambiguous: z.record(z.string(), z.array(z.string())),
  refset: z.record(z.string(), z.number().int().nonnegative()),
  refsetUnmapped: z.record(z.string(), z.number().int().nonnegative()),
});

const BuildInfoSchema = z.object({
  schema: z.literal('baustein-sim/library-build@1'),
  builder: z.string(),
  ldrawRelease: z.string().nullable(),
  sources: z.record(z.string(), z.object({ sha256: z.string() }).passthrough()),
  counts: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.object({ sha256: z.string(), bytes: z.number() })),
}).passthrough();

interface Spec<T> {
  key: 'parts' | 'ldcad' | 'bricknet' | 'buildInfo' | 'colors' | 'evidence';
  file: string;
  label: string;
  required: boolean;
  schema: z.ZodType<T>;
}

const SPECS = [
  { key: 'parts', file: 'library/parts.json', label: 'Teile-Index (LDraw)', required: true, schema: PartsSchema },
  { key: 'ldcad', file: 'library/connectors-ldcad.json', label: 'Anschlüsse LDCad', required: false, schema: ConnectorsSchema },
  { key: 'bricknet', file: 'library/connectors-bricknet.json', label: 'Anschlüsse BrickNet', required: false, schema: ConnectorsSchema },
  { key: 'buildInfo', file: 'library/build-info.json', label: 'Bauprotokoll', required: false, schema: BuildInfoSchema },
  { key: 'colors', file: 'library/private/rebrickable-colors.json', label: 'Farbbelege (lokal, privat)', required: false, schema: ColorsSchema },
  { key: 'evidence', file: 'procurement/evidence-05b2.json', label: 'Beschaffungsbelege 05B.2 (lokal)', required: false, schema: EvidenceFileSchema },
] as Spec<unknown>[];

export interface LoadedLibraryData {
  parts: PartsFile | null;
  ldcad: ConnectorsFile | null;
  bricknet: ConnectorsFile | null;
  buildInfo: BuildInfo | null;
  colors: RebrickableColorsFile | null;
  evidence: EvidenceFile | null;
  files: FileStatus[];
}

function issueText(err: z.ZodError): string {
  const i = err.issues[0];
  const where = i.path.length ? i.path.slice(0, 4).join('.') : '(Wurzel)';
  return `Datenform ungültig bei ${where}: ${i.message}${err.issues.length > 1 ? ` (+${err.issues.length - 1} weitere)` : ''}`;
}

async function loadOne<T>(fetchFn: LoadFetch, spec: Spec<T>): Promise<{ status: FileStatus; data: T | null }> {
  const base = { file: spec.file, label: spec.label, required: spec.required };
  let res: Awaited<ReturnType<LoadFetch>>;
  try {
    res = await fetchFn(spec.file);
  } catch (e) {
    return { status: { ...base, state: 'nicht erreichbar', reason: `Abruf fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}` }, data: null };
  }
  if (res.status === 404) return { status: { ...base, state: 'fehlt', reason: 'Datei nicht vorhanden (HTTP 404)' }, data: null };
  if (res.status < 200 || res.status >= 300) return { status: { ...base, state: 'nicht erreichbar', reason: `Server antwortet mit HTTP ${res.status}` }, data: null };
  if (res.contentType.includes('text/html')) return { status: { ...base, state: 'fehlt', reason: 'Server lieferte eine HTML-Seite statt der Datei (nicht freigegeben?)' }, data: null };
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return { status: { ...base, state: 'nicht erreichbar', reason: `Übertragung abgebrochen: ${e instanceof Error ? e.message : String(e)}` }, data: null };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { status: { ...base, state: 'beschädigt', reason: `kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}` }, data: null };
  }
  const parsed = spec.schema.safeParse(json);
  if (!parsed.success) return { status: { ...base, state: 'beschädigt', reason: issueText(parsed.error) }, data: null };
  return { status: { ...base, state: 'geladen' }, data: parsed.data };
}

/** Lädt alle Bibliotheksdateien unabhängig voneinander. */
export async function loadLibraryData(fetchFn: LoadFetch): Promise<LoadedLibraryData> {
  const results = await Promise.all(SPECS.map((s) => loadOne(fetchFn, s)));
  const out: LoadedLibraryData = { parts: null, ldcad: null, bricknet: null, buildInfo: null, colors: null, evidence: null, files: results.map((r) => r.status) };
  SPECS.forEach((s, i) => { (out as unknown as Record<string, unknown>)[s.key] = results[i].data; });
  return out;
}

/** Abruf über fetch() relativ zur Datenwurzel (Browser). */
export function browserLoadFetch(base: string): LoadFetch {
  return async (path) => {
    const r = await fetch(base + path);
    return { status: r.status, contentType: r.headers.get('content-type') ?? '', text: () => r.text() };
  };
}
