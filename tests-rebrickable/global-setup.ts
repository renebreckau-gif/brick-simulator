// Vorbedingung der Rebrickable-Integrationstests: echter, gültiger Auszug muss lokal vorhanden sein.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseExtract, TEST_FIXTURE_PROVIDER } from '../src/core/catalog/catalog';

const PATH = join(__dirname, '..', 'data', 'catalog', 'rebrickable-extract.json');

export default function setup() {
  if (!existsSync(PATH))
    throw new Error(
      'Rebrickable-Integrationstests NICHT ausgeführt: data/catalog/rebrickable-extract.json fehlt. ' +
        'Diese Tests brauchen den privaten Katalogauszug (Erzeugung siehe README, Abschnitt „Fehlende lokale Daten“). ' +
        'Die reguläre Suite (npm test) ist davon unabhängig.',
    );
  const extract = parseExtract(readFileSync(PATH, 'utf8'), 'data/catalog/rebrickable-extract.json'); // wirft bei Beschädigung mit Grund
  if (extract.source.provider === TEST_FIXTURE_PROVIDER) throw new Error('Rebrickable-Integrationstests NICHT ausgeführt: data/catalog/rebrickable-extract.json ist eine Testfixture, kein echter Auszug.');
  console.log(`Rebrickable-Integrationstests mit Auszug vom ${extract.source.fetchedAt} (${extract.source.provider}).`);
}
