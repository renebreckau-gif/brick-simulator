// Gezielt fehlerhafte Varianten positiver Referenzen. Jede Variante benennt das veränderte
// Teil, damit Tests prüfen können, ob der Validator den Fehler dort lokalisiert.
import type { Mat3 } from '../core/math';
import type { CanonicalModel } from '../core/model/types';

export interface Mutation {
  mutationId: string;
  title: string;
  /** Erwarteter Befundcode (Erwartung, nicht aus dem Validator abgeleitet). */
  expectCode: string;
  apply: (m: CanonicalModel) => { model: CanonicalModel; target: string };
}

function clone(m: CanonicalModel, suffix: string, label: string): CanonicalModel {
  const c = structuredClone(m);
  c.modelId = `${m.modelId}~${suffix}`;
  c.name = `${m.name} – ${label}`;
  c.origin = { ...m.origin, kind: 'fixture', label: `Abgeleitete Fehlervariante von ${m.modelId} – keine Referenz` };
  return c;
}

/** Letztes Teil der Baufolge (liegt oben auf dem Modell). */
function lastAdded(m: CanonicalModel): string {
  for (let i = m.steps.length - 1; i >= 0; i--) if (m.steps[i].add.length) return m.steps[i].add[m.steps[i].add.length - 1];
  return m.instances[m.instances.length - 1].instanceId;
}

export const MUTATIONS: Mutation[] = [
  {
    mutationId: 'shift-half-stud',
    title: 'Oberstes Teil um eine halbe Noppe (10 LDU) verschoben',
    expectCode: 'COL_PENETRATION',
    apply: (m) => {
      const c = clone(m, 'shift', 'Teil verschoben');
      const t = lastAdded(c);
      const i = c.instances.find((x) => x.instanceId === t)!;
      i.position = [i.position[0] + 10, i.position[1], i.position[2]];
      return { model: c, target: t };
    },
  },
  {
    mutationId: 'lift-floating',
    title: 'Oberstes Teil um 16 LDU angehoben (schwebt)',
    expectCode: 'GRAPH_LOOSE',
    apply: (m) => {
      const c = clone(m, 'lift', 'Teil schwebt');
      const t = lastAdded(c);
      const i = c.instances.find((x) => x.instanceId === t)!;
      i.position = [i.position[0], i.position[1] - 16, i.position[2]];
      return { model: c, target: t };
    },
  },
  {
    mutationId: 'scaled',
    title: 'Ein Teil um 10 % skaliert',
    expectCode: 'GEO_DEFORMED',
    apply: (m) => {
      const c = clone(m, 'scaled', 'Teil skaliert');
      const t = c.instances[0].instanceId;
      c.instances[0].rotation = c.instances[0].rotation.map((v) => v * 1.1) as Mat3;
      return { model: c, target: t };
    },
  },
  {
    mutationId: 'unmapped-color',
    title: 'Ein Teil in einer Farbe ohne Katalogzuordnung',
    expectCode: 'CAT_COLOR_UNMAPPED',
    apply: (m) => {
      const c = clone(m, 'color', 'Farbe ohne Zuordnung');
      const t = c.instances[0].instanceId;
      c.instances[0].color = 0x2123456;
      return { model: c, target: t };
    },
  },
  {
    mutationId: 'last-part-first',
    title: 'Oberstes Teil in den ersten Schritt vorgezogen (falsche Baufolge)',
    expectCode: 'ASM_CONFLICTING_DIRECTIONS|ASM_PATH_BLOCKED',
    apply: (m) => {
      const c = clone(m, 'order', 'falsche Reihenfolge');
      const t = lastAdded(c);
      for (const s of c.steps) s.add = s.add.filter((x) => x !== t);
      const target = c.steps.find((s) => s.assemblyId === c.instances.find((x) => x.instanceId === t)!.assemblyId)!;
      target.add.unshift(t);
      c.steps = c.steps.filter((s) => s.add.length || s.attach.length);
      return { model: c, target: t };
    },
  },
];
