// Gibt den Abdeckungsbericht aus (nur mit LIBRARY_REPORT=1; sonst übersprungen). Grundlage für docs/TEILEBIBLIOTHEK.md.
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { coverage, crosscheckWithPartMeta, ldrawSystemRefSet, rebrickableRefSet } from '../src/core/library/coverage';
import { SEARCH_TASKS, searchParts } from '../src/core/library/search';
import { definedPartIds } from '../src/core/connectivity/partMeta';
import { loadLibrary } from './library-helpers';

describe.runIf(process.env.LIBRARY_REPORT)('Bibliotheksbericht', () => {
  it('schreibt den Bericht', () => {
    const { pub, priv } = loadLibrary();
    const lib = priv ?? pub;
    const out: Record<string, unknown> = {};
    out.coverage = [coverage(lib, ldrawSystemRefSet(lib)), ...(rebrickableRefSet(lib) ? [coverage(lib, rebrickableRefSet(lib)!)] : [])];
    out.validatorParts = definedPartIds().length;
    out.crosscheck = crosscheckWithPartMeta(lib);
    out.tasks = SEARCH_TASKS.map((t) => {
      const r = searchParts(lib, { ...t.query, limit: 25 });
      return { task: t.id, total: r.total, undecided: r.undecided.length, top: r.hits.map((h) => `${h.id} ${h.title} [${h.support}]`) };
    });
    writeFileSync(process.env.LIBRARY_REPORT!, JSON.stringify(out, null, 1));
  });
});
