// Optionale Integrationstests gegen den privaten Rebrickable-Auszug (npm run test:rebrickable).
// Nicht Teil der regulären Suite. Fehlen die Daten, bricht der Lauf mit ausdrücklicher Meldung ab
// (globalSetup) – er wird nicht stillschweigend übersprungen oder als bestanden gewertet.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests-rebrickable/**/*.test.ts'],
    globalSetup: ['tests-rebrickable/global-setup.ts'],
    testTimeout: 30000,
  },
});
