import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `data/` wird unverändert ausgeliefert (LDraw-Dateien, Katalogauszug, Referenzen, Erwartungen).
export default defineConfig({
  plugins: [react()],
  publicDir: 'data',
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
