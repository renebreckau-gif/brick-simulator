import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv, type Connect, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { listPublicDataFiles, PRIVATE_DEV_FILES } from './scripts/data-files.mjs';
import { designAnalysisApi } from './server/design-analysis/vitePlugin';

const DATA_DIR = resolve(__dirname, 'data');
const TYPES: Record<string, string> = { '.json': 'application/json; charset=utf-8', '.dat': 'text/plain; charset=utf-8', '.ldr': 'text/plain; charset=utf-8', '.mpd': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
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

export default defineConfig(({ mode }) => ({
  // loadEnv mit Präfix '' liest auch Nicht-VITE-Variablen (z. B. ANTHROPIC_API_KEY aus .env.local) –
  // nur für den Server-Endpunkt; an den Browser gehen weiterhin ausschließlich VITE_-Variablen.
  plugins: [react(), dataFiles(), designAnalysisApi(() => loadEnv(mode, __dirname, ''))],
  // Kein publicDir: data/ wird NICHT pauschal kopiert (enthält lokal ggf. private Dateien).
  publicDir: false,
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
}));
