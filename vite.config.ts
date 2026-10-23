import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv, type Connect, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { listPublicDataFiles, PRIVATE_DEV_FILES } from './scripts/data-files.mjs';
import { designAnalysisApi } from './server/design-analysis/vitePlugin';

const DATA_DIR = resolve(__dirname, 'data');
const TYPES: Record<string, string> = { '.json': 'application/json; charset=utf-8', '.dat': 'text/plain; charset=utf-8', '.ldr': 'text/plain; charset=utf-8', '.mpd': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const typeOf = (p: string) => TYPES[p.slice(p.lastIndexOf('.'))] ?? 'application/octet-stream';

/**
 * Liefert ausschließlich die explizit freigegebenen Dateien aus data/ unter /data/ aus.
 * - Entwicklung: Positivliste + private lokale Dateien (nur auf dieser Maschine, z. B. Katalogauszug).
 * - Build: nur die Positivliste wird nach dist/data/ geschrieben (danach scripts/check-public-build.mjs).
 * Unbekannte /data/-Pfade ergeben 404 statt SPA-Fallback, damit „fehlt“ eindeutig erkennbar ist.
 */
function dataFiles(): Plugin {
  const serve = (allowed: (rel: string) => string | null): Connect.NextHandleFunction => (req, res, next) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (!url.startsWith('/data/')) return next();
    const file = allowed(url.slice('/data/'.length));
    if (!file || !existsSync(file)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('nicht vorhanden oder nicht freigegeben');
      return;
    }
    res.setHeader('Content-Type', typeOf(file));
    res.setHeader('Cache-Control', 'no-store');
    res.end(readFileSync(file));
  };
  return {
    name: 'baustein-data-files',
    configureServer(server) {
      const allowed = new Set([...listPublicDataFiles(DATA_DIR), ...PRIVATE_DEV_FILES]);
      server.middlewares.use(serve((rel) => (allowed.has(rel) ? join(DATA_DIR, rel) : null)));
    },
    configurePreviewServer(server) {
      const dist = resolve(__dirname, 'dist');
      const allowed = new Set(listPublicDataFiles(DATA_DIR));
      server.middlewares.use(serve((rel) => (allowed.has(rel) ? join(dist, 'data', rel) : null)));
    },
    generateBundle() {
      for (const rel of listPublicDataFiles(DATA_DIR)) this.emitFile({ type: 'asset', fileName: `data/${rel}`, source: readFileSync(join(DATA_DIR, rel)) });
    },
  };
}

/**
 * Teilebibliothek (05C.1): LDraw-Geometrie bei Bedarf aus dem lokalen Quellpaket (data-cache/, per npm run library:fetch).
 * Nur Entwicklungsserver; nur .dat-Dateien unter parts/ und p/. Ohne Quellpaket antwortet die Route mit 404 –
 * die Oberfläche zeigt dann „Geometrie nicht lokal verfügbar“.
 */
function libraryGeometry(): Plugin {
  const root = (() => {
    const marker = resolve(__dirname, 'data-cache', 'ldraw', '.fetched.json');
    if (!existsSync(marker)) return null;
    const top = JSON.parse(readFileSync(marker, 'utf8')).root as string;
    const base = resolve(__dirname, 'data-cache', 'ldraw', top);
    return existsSync(join(base, 'parts')) ? base : join(base, 'ldraw');
  })();
  return {
    name: 'baustein-library-geometry',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!url.startsWith('/library-geometry/')) return next();
        const rel = url.slice('/library-geometry/'.length).toLowerCase();
        // "any/<ref>" sucht wie LDraw-Programme erst unter parts/, dann unter p/ (eine Anfrage je Datei)
        const candidates = rel.startsWith('any/') ? ['parts/', 'p/'].map((d) => d + rel.slice(4)) : [rel];
        const file = root ? candidates.filter((c) => /^(parts|p)\/[a-z0-9_\-./]+\.dat$/.test(c) && !c.includes('..')).map((c) => join(root, c)).find((f) => existsSync(f)) ?? null : null;
        if (!file || !existsSync(file)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(root ? 'nicht vorhanden' : 'Quellpaket fehlt (npm run library:fetch)');
          return;
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'max-age=3600');
        res.setHeader('X-LDraw-Dir', file.startsWith(join(root!, 'p')) && !file.startsWith(join(root!, 'parts')) ? 'p' : 'parts');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // loadEnv mit Präfix '' liest auch Nicht-VITE-Variablen (z. B. ANTHROPIC_API_KEY aus .env.local) –
  // nur für den Server-Endpunkt; an den Browser gehen weiterhin ausschließlich VITE_-Variablen.
  plugins: [react(), dataFiles(), libraryGeometry(), designAnalysisApi(() => loadEnv(mode, __dirname, ''))],
  // Kein publicDir: data/ wird NICHT pauschal kopiert (enthält lokal ggf. private Dateien).
  publicDir: false,
  // Quellpakete der Teilebibliothek (~37 000 Dateien) und Rohdaten nicht beobachten – sonst wird der Server träge
  server: { watch: { ignored: ['**/data-cache/**', '**/data-raw/**'] } },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
}));
