// Auftrag 05B.0.1: 3D-Ressourcen werden wiederverwendet bzw. freigegeben (Geometrien, Kanten, Materialien).
// Three.js-Objekte ohne WebGL; gezählt werden die tatsächlichen dispose-Ereignisse.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SpatialBody } from '../src/core/design/spatial';
import { disposeAll, syncBodyMeshes, type BodyMesh } from '../src/ui/design/spatialMeshes';

const basis = { position: 'user', size: 'user', rotation: 'user', shape: 'user', color: 'user' } as const;
const B = (id: string, p: Partial<SpatialBody> = {}): SpatialBody => ({
  id, name: id, groupId: null, isMain: false, shape: 'box', center: { x: 0, y: 0, z: 0 }, size: { length: 1, width: 0.5, height: 0.3 },
  rotation: { yaw: 0, pitch: 0, roll: 0 }, taper: 1, color: '#888888', basis, assumptions: [], uncertainty: 'mittel', mirrorOf: null, ...p,
});

/** Zählt dispose-Ereignisse aller Ressourcen eines Körpers. */
function watch(m: BodyMesh, counter: { n: number }) {
  for (const r of [m.mesh.geometry, m.mesh.material, m.edges.geometry, m.edges.material] as THREE.EventDispatcher<{ dispose: object }>[]) r.addEventListener('dispose', () => counter.n++);
}

describe('3D-Körper: Wiederverwendung und Freigabe', () => {
  it('Farb- und Auswahländerung baut nichts neu auf', () => {
    const root = new THREE.Group();
    const reg = new Map<string, BodyMesh>();
    syncBodyMeshes(root, reg, [B('a'), B('b')], null);
    const geo = reg.get('a')!.mesh.geometry;
    const disposed = { n: 0 };
    watch(reg.get('a')!, disposed);
    const s = syncBodyMeshes(root, reg, [B('a', { color: '#ff0000' }), B('b')], 'a');
    expect(s).toEqual({ created: 0, reused: 2, disposed: 0 });
    expect(reg.get('a')!.mesh.geometry).toBe(geo);
    expect(reg.get('a')!.mesh.material.color.getHexString()).toBe('ff0000');
    expect(reg.get('a')!.mesh.material.emissiveIntensity).toBeGreaterThan(0);
    expect(disposed.n).toBe(0);
  });
  it('Formänderung ersetzt den Körper und gibt alle vier Ressourcen frei (Fläche, Kanten, beide Materialien)', () => {
    const root = new THREE.Group();
    const reg = new Map<string, BodyMesh>();
    syncBodyMeshes(root, reg, [B('a')], null);
    const disposed = { n: 0 };
    watch(reg.get('a')!, disposed);
    const s = syncBodyMeshes(root, reg, [B('a', { size: { length: 1, width: 0.8, height: 0.3 } })], null);
    expect(s).toEqual({ created: 1, reused: 0, disposed: 1 });
    expect(disposed.n).toBe(4);
    expect(root.children).toHaveLength(2); // genau Fläche + Kanten des neuen Körpers
  });
  it('entfernter Körper wird freigegeben und aus der Szene genommen', () => {
    const root = new THREE.Group();
    const reg = new Map<string, BodyMesh>();
    syncBodyMeshes(root, reg, [B('a'), B('b')], null);
    const disposed = { n: 0 };
    watch(reg.get('b')!, disposed);
    syncBodyMeshes(root, reg, [B('a')], null);
    expect(disposed.n).toBe(4);
    expect(reg.has('b')).toBe(false);
    expect(root.children.filter((o) => o.userData.bodyId === 'b')).toHaveLength(0);
  });
  it('wiederholte Änderungen: Anzahl lebender Ressourcen bleibt konstant', () => {
    const root = new THREE.Group();
    const reg = new Map<string, BodyMesh>();
    const disposed = { n: 0 };
    let created = 0;
    const seen = new Set<BodyMesh>();
    for (let i = 0; i < 50; i++) {
      // a wird jedes Mal verschoben (Neuaufbau), b nur umgefärbt (Wiederverwendung)
      syncBodyMeshes(root, reg, [B('a', { center: { x: i * 0.01, y: 0, z: 0 } }), B('b', { color: i % 2 ? '#111111' : '#222222' })], i % 2 ? 'a' : null);
      for (const m of reg.values()) if (!seen.has(m)) { seen.add(m); watch(m, disposed); created += 4; }
    }
    expect(created - disposed.n).toBe(8); // lebend: 2 Körper × 4 Ressourcen
    expect(created).toBe(4 * 51); // a 50-mal gebaut, b einmal
    disposeAll(reg);
    expect(created - disposed.n).toBe(0);
    expect(root.children).toHaveLength(0);
  });
});
