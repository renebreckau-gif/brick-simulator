// Verwaltung der 3D-Objekte des räumlichen Entwurfs (Auftrag 05B.0.1): Wiederverwendung je Körper statt
// Neuaufbau bei jeder Änderung, und Freigabe von Geometrien und Materialien (inklusive Kanten), sobald ein
// Körper entfällt, sich seine Form ändert oder die Ansicht abgebaut wird. Ohne WebGL testbar.
import * as THREE from 'three';
import { bodyGeometry } from '../../core/design/projection';
import type { SpatialBody } from '../../core/design/spatial';

export interface BodyMesh {
  /** Schlüssel der Geometrie: Form, Maße, Verjüngung, Lage, Drehung. Ändert er sich, wird neu aufgebaut. */
  key: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
}

export const geometryKey = (b: SpatialBody) => JSON.stringify([b.shape, b.size, b.taper, b.center, b.rotation]);

export function meshGeometry(b: SpatialBody): THREE.BufferGeometry {
  const g = bodyGeometry(b);
  const pos: number[] = [];
  for (const f of g.faces) for (let i = 1; i + 1 < f.length; i++) for (const k of [f[0], f[i], f[i + 1]]) pos.push(...g.vertices[k]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function build(b: SpatialBody): BodyMesh {
  const geo = meshGeometry(b);
  const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7, metalness: 0, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.bodyId = b.id;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: '#1d2733', transparent: true, opacity: 0.45 }));
  return { key: geometryKey(b), mesh, edges };
}

export function disposeBodyMesh(m: BodyMesh): void {
  m.mesh.removeFromParent();
  m.edges.removeFromParent();
  m.mesh.geometry.dispose();
  m.mesh.material.dispose();
  m.edges.geometry.dispose();
  m.edges.material.dispose();
}

/** Darstellung (Farbe, Auswahl) ohne Neuaufbau aktualisieren. */
function style(m: BodyMesh, b: SpatialBody, selected: boolean) {
  m.mesh.material.color.set(b.color);
  m.mesh.material.emissive.set(selected ? '#1f5fbf' : '#000000');
  m.mesh.material.emissiveIntensity = selected ? 0.45 : 0;
  m.edges.material.color.set(selected ? '#1f5fbf' : '#1d2733');
  m.edges.material.opacity = selected ? 1 : 0.45;
  m.edges.material.transparent = !selected;
}

/**
 * Gleicht die Objekte unter root mit den Körpern ab: Unveränderte Körper behalten Geometrie und Material,
 * geänderte Formen werden ersetzt (alte Ressourcen freigegeben), entfallene Körper freigegeben.
 */
export function syncBodyMeshes(root: THREE.Object3D, registry: Map<string, BodyMesh>, bodies: SpatialBody[], selected: string | null): { created: number; reused: number; disposed: number } {
  const stats = { created: 0, reused: 0, disposed: 0 };
  const ids = new Set(bodies.map((b) => b.id));
  for (const [id, m] of registry) if (!ids.has(id)) { disposeBodyMesh(m); registry.delete(id); stats.disposed++; }
  for (const b of bodies) {
    let m = registry.get(b.id);
    if (m && m.key !== geometryKey(b)) { disposeBodyMesh(m); stats.disposed++; m = undefined; }
    if (!m) { m = build(b); registry.set(b.id, m); root.add(m.mesh, m.edges); stats.created++; }
    else stats.reused++;
    style(m, b, b.id === selected);
  }
  return stats;
}

export function disposeAll(registry: Map<string, BodyMesh>): void {
  for (const m of registry.values()) disposeBodyMesh(m);
  registry.clear();
}
