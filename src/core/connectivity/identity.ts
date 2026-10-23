// Belegte Identitätsauflösung für Teil-Metadaten (Auftrag 05C.1.1) – gemeinsam für Prüfkern und Teilebibliothek.
//
// Regel: Eine LDraw-Datei K mit Titel „~Moved to X“ (oder Alias), die AUSSCHLIESSLICH aus genau einem Verweis auf X.dat
// mit Einheitsmatrix am Ursprung besteht, ist geometrisch identisch mit X („reine Umbenennung“). Dann gelten die
// geprüften Metadaten von K auch für X. Jede andere Beziehung (Formvariante, Alternative, gedrehter Verweis, Druck)
// begründet KEINE Identität. Die Regel wird aus den LDraw-Dateien selbst abgeleitet, nicht aus einer Handliste;
// dieselbe Regel setzt scripts/library/build.py als Feld `pure` in data/library/parts.json.
import { IDENTITY as IDENTITY_MAT, type Mat3 } from '../math';
import type { LdFile } from '../ldraw/parse';
import { definedPartIds, partMeta, type PartMeta } from './partMeta';

/** Ziel X, wenn `file` eine reine Umbenennung ist; sonst null. */
export function pureRenameTarget(file: LdFile | null): string | null {
  if (!file?.title) return null;
  if (!/^~Moved to\s+\S+/i.test(file.title) && !/Alias/i.test(file.ldrawOrg ?? '')) return null;
  const drawn = file.lines.filter((l) => l.type !== 'step');
  if (drawn.length !== 1) return null;
  const ref = drawn[0];
  if (ref.type !== 1) return null;
  const identity = ref.position.every((v) => v === 0) && (ref.rotation as Mat3).every((v, i) => v === IDENTITY_MAT[i]);
  if (!identity) return null;
  const target = ref.file.trim().toLowerCase().replace(/\\/g, '/').replace(/\.dat$/, '');
  const titled = file.title.match(/^~Moved to\s+(\S+)/i)?.[1]?.toLowerCase().replace(/\.dat$/, '');
  return titled && titled !== target ? null : target;
}

export interface ResolvedMeta {
  meta: PartMeta;
  /** Nummer, unter der die geprüften Metadaten geführt werden (≠ angefragte Nummer bei Umbenennung). */
  metaId: string;
  basis: 'eigene Metadaten' | 'reine Umbenennung';
}

/**
 * Metadaten für eine LDraw-Nummer: eigene Einträge oder – über eine belegte reine Umbenennung – die eines
 * Prüfkern-Teils. `renameTargetOf(K)` liefert für eine Prüfkern-Nummer K das Ziel der reinen Umbenennung oder null.
 */
export function resolvePartMeta(ldrawId: string, renameTargetOf: (metaId: string) => string | null): ResolvedMeta | null {
  const id = ldrawId.toLowerCase().replace(/\.dat$/, '');
  const own = partMeta(id);
  if (own) return { meta: own, metaId: id, basis: 'eigene Metadaten' };
  for (const k of definedPartIds()) {
    if (renameTargetOf(k) !== id) continue;
    const m = partMeta(k)!;
    return {
      metaId: k,
      basis: 'reine Umbenennung',
      meta: { ...m, ldrawId: id, provenance: { ...m.provenance, note: `${m.provenance.note} Identität: LDraw ${k}.dat ist eine reine Umbenennung nach ${id}.dat (ein Verweis, Einheitsmatrix).` } },
    };
  }
  return null;
}
