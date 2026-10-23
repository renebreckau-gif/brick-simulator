// Private Integrationsprüfungen der Teilebibliothek (05C.1.1): echte, lokal erzeugte Farbbelege
// (data/library/private/rebrickable-colors.json aus npm run library:import mit data-raw/rebrickable/).
// Nur über npm run test:rebrickable. Mit LIBRARY_REPORT=<Datei> wird zusätzlich der Abdeckungsbericht geschrieben.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { geoProp } from '../src/core/library/classify';
import { coverage, crosscheckWithPartMeta, ldrawSystemRefSet, rebrickableRefSet } from '../src/core/library/coverage';
import { PartLibraryIndex } from '../src/core/library/library';
import { loadLibraryData, type LoadFetch } from '../src/core/library/load';
import { SEARCH_TASKS, searchParts } from '../src/core/library/search';
import { definedPartIds } from '../src/core/connectivity/partMeta';
import { bundle } from '../tests/helpers';

const DATA = join(__dirname, '..', 'data');
const fsFetch: LoadFetch = async (p) => {
  const f = join(DATA, p);
  if (!existsSync(f)) return { status: 404, contentType: 'text/plain', text: async () => '' };
  return { status: 200, contentType: 'application/json', text: async () => readFileSync(f, 'utf8') };
};

const d = await loadLibraryData(fsFetch);
const b = await bundle('none');
const colorsStatus = d.files.find((f) => f.file.endsWith('rebrickable-colors.json'))!;
if (colorsStatus.state !== 'geladen')
  throw new Error(`Private Farbbelege NICHT nutzbar (${colorsStatus.state}: ${colorsStatus.reason}). Erzeugen mit npm run library:import (braucht data-raw/rebrickable/).`);
const lib = new PartLibraryIndex(d.parts!, { ldcad: d.ldcad, bricknet: d.bricknet }, { colors: d.colors, evidence: d.evidence, validator: (id) => b.catalog.part(id).simulation });

describe('Echte Farbbelege', () => {
  it('3001 in Rot belegt (gleiche Nummer), Glas 60601 transparent belegt', () => {
    const c = lib.colorEvidence('3001');
    expect(c.state).toBe('belegt');
    if (c.state === 'belegt') {
      expect(c.rebrickable['3001']).toContain('gleiche Nummer');
      expect(c.colors.some((x) => x.name === 'Red' && x.sets > 0)).toBe(true);
    }
    expect(geoProp(lib, '60601', 'transparent_belegt')).toBe('ja');
  });
  it('kein Farbbeleg beruht auf einer Alternative: jede Herkunft hat einen Identitätsgrund', () => {
    for (const p of Object.values(d.colors!.parts)) {
      for (const c of p.colors) for (const rb of c[6]) expect(p.rb[rb]?.length, rb).toBeGreaterThan(0);
      for (const a of p.alternatives) expect(Object.keys(p.rb)).not.toContain(a);
    }
  });
  it('Gewichte sind eindeutige Sets: kein Teil in mehr Sets als es aktuelle Sets gibt', () => {
    const max = d.colors!.counts.setsRecent;
    for (const w of [...Object.values(d.colors!.refset), ...Object.values(d.colors!.refsetUnmapped)]) expect(w).toBeLessThanOrEqual(max);
  });
  it('Rebrickable-Referenzmenge: Anschlussdaten für über 90 % des zugeordneten Bestands', () => {
    const row = coverage(lib, rebrickableRefSet(lib)!);
    expect(row.anyConnectors.n / row.anyConnectors.mapped).toBeGreaterThan(0.9);
    expect(row.refset.unmapped).toBeGreaterThan(0); // Katalog-Lücke wird ausgewiesen, nicht verschwiegen
    expect(row.anyConnectors.weightedTotal!).toBeLessThan(row.anyConnectors.weightedMapped!);
  });
  it.runIf(process.env.LIBRARY_REPORT)('schreibt den Abdeckungsbericht', () => {
    const out = {
      coverage: [coverage(lib, ldrawSystemRefSet(lib)), coverage(lib, rebrickableRefSet(lib)!)],
      colorsCounts: d.colors!.counts,
      validatorParts: definedPartIds().length,
      crosscheck: crosscheckWithPartMeta(lib),
      tasks: SEARCH_TASKS.map((t) => {
        const r = searchParts(lib, { ...t.query, limit: 25 });
        return { task: t.id, total: r.total, undecided: r.undecided.length, top: r.hits.map((h) => `${h.id} ${h.title} [${h.support}]`) };
      }),
    };
    writeFileSync(process.env.LIBRARY_REPORT!, JSON.stringify(out, null, 1));
  });
});
