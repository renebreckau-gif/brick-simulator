// Regression (Korrekturauftrag 03A): Der Inventarabgleich der Stückliste gehört zum dargestellten Modell.
// Ein zuvor gewähltes Referenzmodell darf im Raumschiff-Labor nicht als Vergleichsgrundlage erscheinen.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeBom } from '../src/core/bom/bom';
import { initialProcurementState } from '../src/core/procurement/types';
import { generateSpaceship, VARIANTS } from '../src/generator/spaceship';
import { comparisonReferenceId, GENERATED_COMPARISON_NOTE } from '../src/ui/comparison';
import { labItems } from '../src/ui/items';
import { BomPanel } from '../src/ui/panels';
import { bundle, type CatalogMode } from './helpers';

const REFS = ['ref-40013-1', 'ref-21002-1', 'ref-1869-1'];

for (const mode of ['none', 'fixture'] as CatalogMode[])
  describe(`Vergleichsgrundlage der Stückliste (Katalog: ${mode})`, () => {
    it('Raumschiff nach Auswahl einer Referenz: kein Referenzabgleich, nur Hinweis', async () => {
      const b = await bundle(mode);
      const items = labItems(b);
      const ship = generateSpaceship(VARIANTS.kompakt.params).model;
      const bom = computeBom(ship, b.catalog);
      for (const id of [...REFS, 'ref-21002-1~anleitung']) {
        const item = items.find((i) => i.id === id)!;
        // die zuletzt gewählte Auswahl bleibt im Zustand stehen – im Raumschiff-Modus wie auch bei fremdem Modell
        expect(comparisonReferenceId(ship, item, 'schiff'), id).toBeUndefined();
        expect(comparisonReferenceId(ship, item, 'pruef'), id).toBeUndefined();
        const html = renderToStaticMarkup(createElement(BomPanel, { bom, bundle: b, referenceId: comparisonReferenceId(ship, item, 'schiff'), comparisonNote: GENERATED_COMPARISON_NOTE, procurement: initialProcurementState(bom), onHighlight: () => {} }));
        const set = b.references.find((r) => r.referenceId === item.referenceId)!.setNumber;
        expect(html, id).not.toContain(set);
        expect(html).not.toContain('Inventar von');
        expect(html).toContain('Kein Inventarabgleich: eigener Entwurf');
      }
    });

    it('Prüflabor: Referenzen behalten ihren eigenen Abgleich', async () => {
      const b = await bundle(mode);
      const items = labItems(b);
      for (const id of [...REFS, 'ref-21002-1~anleitung']) {
        const item = items.find((i) => i.id === id)!;
        const model = item.make();
        expect(comparisonReferenceId(model, item, 'pruef'), id).toBe(item.referenceId);
        const bom = computeBom(model, b.catalog);
        const html = renderToStaticMarkup(createElement(BomPanel, { bom, bundle: b, referenceId: comparisonReferenceId(model, item, 'pruef'), procurement: initialProcurementState(bom), onHighlight: () => {} }));
        expect(html, id).toContain('Unabhängiger Abgleich');
        expect(html).not.toContain('Kein Inventarabgleich');
      }
      // Grenzfälle und Fehlervarianten haben weiterhin keinen Referenzabgleich
      for (const item of items.filter((i) => i.group !== 'Referenzen')) expect(comparisonReferenceId(item.make(), item, 'pruef'), item.id).toBeUndefined();
    });

    it('Modell gehört nicht zur gewählten Referenz: kein Abgleich', async () => {
      const b = await bundle(mode);
      const items = labItems(b);
      const ghost = items.find((i) => i.id === 'ref-40013-1')!.make();
      expect(comparisonReferenceId(ghost, items.find((i) => i.id === 'ref-21002-1'), 'pruef')).toBeUndefined();
    });
  });
