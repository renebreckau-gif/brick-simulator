// LDraw-/MPD-Parser (Spezifikation: https://www.ldraw.org/article/218.html, Rev. 1.0.2).
// Unterstützt Zeilentypen 0–5, `0 STEP`, `0 FILE`/`0 NOFILE` (MPD) und Kopfzeilen.
import type { Mat3, Vec3 } from '../math';

export interface SubfileRef {
  type: 1;
  color: number;
  position: Vec3;
  rotation: Mat3;
  file: string;
  lineNo: number;
}
export interface Polygon {
  type: 2 | 3 | 4 | 5;
  color: number;
  points: Vec3[];
}
export interface StepMarker {
  type: 'step';
  lineNo: number;
}
export type LdLine = SubfileRef | Polygon | StepMarker;

export interface LdFile {
  name: string;
  title: string | null;
  author: string | null;
  license: string | null;
  ldrawOrg: string | null;
  lines: LdLine[];
}

const num = (s: string) => {
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Ungültige Zahl in LDraw-Datei: ${s}`);
  return n;
};

export function normalizeName(name: string): string {
  return name.trim().replace(/\\/g, '/').toLowerCase();
}

/** Parst eine einzelne LDraw-Datei (ohne MPD-Trennung). */
export function parseLdraw(text: string, name: string): LdFile {
  const file: LdFile = { name: normalizeName(name), title: null, author: null, license: null, ldrawOrg: null, lines: [] };
  const rows = text.split(/\r?\n/);
  rows.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const t = line.split(/\s+/);
    switch (t[0]) {
      case '0': {
        const rest = line.slice(1).trim();
        if (/^STEP\b/.test(rest)) file.lines.push({ type: 'step', lineNo: idx + 1 });
        else if (rest.startsWith('Author:')) file.author = rest.slice(7).trim();
        else if (rest.startsWith('!LICENSE')) file.license = rest.slice(8).trim();
        else if (rest.startsWith('!LDRAW_ORG')) file.ldrawOrg = rest.slice(10).trim();
        else if (file.title === null && rest && !rest.startsWith('Name:') && !rest.startsWith('FILE') && !rest.startsWith('//') && !rest.startsWith('!') && !rest.startsWith('BFC'))
          file.title = rest;
        return;
      }
      case '1': {
        if (t.length < 15) throw new Error(`${name}:${idx + 1}: Typ-1-Zeile unvollständig`);
        file.lines.push({
          type: 1,
          color: num(t[1]),
          position: [num(t[2]), num(t[3]), num(t[4])],
          rotation: t.slice(5, 14).map(num) as Mat3,
          file: t.slice(14).join(' '),
          lineNo: idx + 1,
        });
        return;
      }
      case '2':
      case '3':
      case '4':
      case '5': {
        const type = Number(t[0]) as 2 | 3 | 4 | 5;
        const n = type === 2 ? 2 : type === 3 ? 3 : 4;
        const pts: Vec3[] = [];
        for (let i = 0; i < n; i++) pts.push([num(t[2 + i * 3]), num(t[3 + i * 3]), num(t[4 + i * 3])]);
        file.lines.push({ type, color: num(t[1]), points: pts });
        return;
      }
      default:
        return;
    }
  });
  return file;
}

/** Teilt eine MPD-Datei in ihre Unterdateien. Eine einfache LDR-Datei ergibt genau eine Datei. */
export function parseMpd(text: string, fallbackName: string): LdFile[] {
  const rows = text.split(/\r?\n/);
  const chunks: { name: string; text: string[] }[] = [];
  let cur: { name: string; text: string[] } | null = null;
  for (const raw of rows) {
    const m = /^\s*0\s+FILE\s+(.+?)\s*$/.exec(raw);
    if (m) {
      cur = { name: m[1], text: [] };
      chunks.push(cur);
      continue;
    }
    if (/^\s*0\s+NOFILE\s*$/.test(raw)) {
      cur = null;
      continue;
    }
    if (!cur) {
      if (chunks.length === 0) {
        cur = { name: fallbackName, text: [] };
        chunks.push(cur);
      } else continue;
    }
    cur.text.push(raw);
  }
  return chunks.map((c) => parseLdraw(c.text.join('\n'), c.name));
}
