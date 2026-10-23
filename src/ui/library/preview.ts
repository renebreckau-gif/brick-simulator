// Vorschaubilder der Teilebibliothek: ein einziger, verzögert angelegter Renderer erzeugt statische Bilder
// (keine Vielzahl von WebGL-Kontexten). Hauptfarbe neutral grau – eine Vorschau belegt keine Teil-Farb-Kombination.
import * as THREE from 'three';
import type { PartLibrary } from '../../core/ldraw/library';
import { MAIN_COLOR } from '../../core/ldraw/library';

let renderer: THREE.WebGLRenderer | null = null;

function getRenderer(size: number): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
  }
  renderer.setSize(size, size, false);
  return renderer;
}

const NEUTRAL = new THREE.Color('#a4adb8');
const OTHER = new THREE.Color('#6f7d8c');

/** Rendert ein Teil aus Blickrichtung (azimut in Grad, 0 = von vorn/−z, positiv nach links). */
export function renderPartImage(library: PartLibrary, id: string, size = 128, azimuthDeg = 35): string | null {
  if (!library.has(`${id}.dat`)) return null;
  const flat = library.flatten(`${id}.dat`);
  if (!flat.triangles.length) return null;
  const pos: number[] = [];
  const col: number[] = [];
  for (const t of flat.triangles) {
    const c = t.color === MAIN_COLOR ? NEUTRAL : OTHER;
    for (const p of t.points) {
      pos.push(p[0], p[1], p[2]);
      col.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7, flatShading: true });
  const ep: number[] = [];
  for (const e of flat.edges) for (const p of e.points) ep.push(p[0], p[1], p[2]);
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
  const lm = new THREE.LineBasicMaterial({ color: '#2b3540' });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat), new THREE.LineSegments(eg, lm));
  group.rotation.x = Math.PI; // LDraw: y nach unten
  const scene = new THREE.Scene();
  scene.add(group, new THREE.AmbientLight('#ffffff', 1.4));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(-1, 2, -1.5);
  scene.add(sun);

  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 10;
  const cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, radius * 20);
  const az = (azimuthDeg * Math.PI) / 180;
  cam.position.set(center.x + Math.sin(az) * radius * 4, center.y + radius * 2.6, center.z - Math.cos(az) * radius * 4);
  cam.lookAt(center);

  const r = getRenderer(size);
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  geo.dispose();
  eg.dispose();
  mat.dispose();
  lm.dispose();
  return url;
}
