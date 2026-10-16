// 3D-Ansicht. Rendert ausschließlich die Instanzen der aktuellen Modellversion
// mit unveränderter LDraw-Geometrie (Regel 7: keine Konzeptbilder als Modellansicht).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Catalog } from '../core/catalog/catalog';
import type { PartLibrary } from '../core/ldraw/library';
import { EDGE_COLOR, MAIN_COLOR } from '../core/ldraw/library';
import type { CanonicalModel } from '../core/model/types';

interface Props {
  model: CanonicalModel;
  library: PartLibrary;
  catalog: Catalog;
  visible: Set<string>;
  current: Set<string>;
  highlighted: Set<string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

interface Built {
  mesh: THREE.Object3D;
  material: THREE.MeshStandardMaterial | null;
}

const geoCache = new Map<string, { tris: THREE.BufferGeometry; edges: THREE.BufferGeometry } | null>();

export function partGeometry(library: PartLibrary, catalog: Catalog, part: string, color: number) {
  const key = `${part}|${color}`;
  if (geoCache.has(key)) return geoCache.get(key)!;
  if (!library.has(`${part}.dat`)) {
    geoCache.set(key, null);
    return null;
  }
  const flat = library.flatten(`${part}.dat`);
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const resolve = (code: number, edge: boolean) => {
    if (code === MAIN_COLOR) return catalog.displayColor(color).value;
    if (code === EDGE_COLOR) return catalog.displayColor(color).edge;
    if (code < 0) return catalog.displayColor(-code - 1).edge;
    return edge ? catalog.displayColor(code).edge : catalog.displayColor(code).value;
  };
  for (const t of flat.triangles) {
    c.set(resolve(t.color, false));
    for (const p of t.points) {
      pos.push(p[0], p[1], p[2]);
      col.push(c.r, c.g, c.b);
    }
  }
  const tris = new THREE.BufferGeometry();
  tris.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tris.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tris.computeVertexNormals();
  const ep: number[] = [];
  for (const e of flat.edges) for (const p of e.points) ep.push(p[0], p[1], p[2]);
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
  const out = { tris, edges };
  geoCache.set(key, out);
  return out;
}

export function Viewer(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    root: THREE.Group;
    built: Map<string, Built>;
    framedFor: string | null;
  } | null>(null);
  const onSelect = useRef(props.onSelect);
  onSelect.current = props.onSelect;

  // Szene einmalig aufbauen
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfe5eb');
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 50000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a95a3', 1.6));
    const dir = new THREE.DirectionalLight('#ffffff', 1.4);
    dir.position.set(300, 600, 400);
    scene.add(dir);
    const root = new THREE.Group();
    root.rotation.x = Math.PI; // LDraw: −Y oben → Three: +Y oben (echte Drehung, keine Spiegelung)
    scene.add(root);
    const grid = new THREE.GridHelper(2000, 100, '#aab4bf', '#c8d0d8');
    grid.name = 'grid';
    scene.add(grid);
    ctx.current = { renderer, scene, camera, controls, root, built: new Map(), framedFor: null };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hits = ray.intersectObjects(root.children, true).filter((h) => h.object.visible && h.object.userData.instanceId);
      onSelect.current(hits[0]?.object.userData.instanceId ?? null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // Modellinstanzen aufbauen (bei neuer Modellversion)
  useEffect(() => {
    const c = ctx.current!;
    c.root.clear();
    c.built.clear();
    for (const inst of props.model.instances) {
      const g = partGeometry(props.library, props.catalog, inst.part, inst.color);
      const obj = new THREE.Group();
      let material: THREE.MeshStandardMaterial | null = null;
      if (g) {
        material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
        const mesh = new THREE.Mesh(g.tris, material);
        mesh.userData.instanceId = inst.instanceId;
        obj.add(mesh, new THREE.LineSegments(g.edges, new THREE.LineBasicMaterial({ color: '#1d2733', transparent: true, opacity: 0.35 })));
      } else {
        // Keine Geometrie: deutlich als Platzhalter erkennbar (Drahtgitter)
        const box = new THREE.Mesh(new THREE.BoxGeometry(40, 24, 20), new THREE.MeshBasicMaterial({ color: '#7a8796', wireframe: true }));
        box.position.set(0, 12, 0);
        box.userData.instanceId = inst.instanceId;
        obj.add(box);
      }
      const m = new THREE.Matrix4();
      const r = inst.rotation;
      m.set(r[0], r[1], r[2], inst.position[0], r[3], r[4], r[5], inst.position[1], r[6], r[7], r[8], inst.position[2], 0, 0, 0, 1);
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(m);
      c.root.add(obj);
      c.built.set(inst.instanceId, { mesh: obj, material });
    }
    // Kamera nur beim Modellwechsel (nicht bei jeder Version) einpassen
    if (c.framedFor !== props.model.modelId) {
      c.framedFor = props.model.modelId;
      c.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(c.root);
      const size = box.getSize(new THREE.Vector3()).length() || 200;
      const center = box.getCenter(new THREE.Vector3());
      c.camera.position.copy(center).add(new THREE.Vector3(0.9, 0.7, 1.1).multiplyScalar(size * 0.95));
      c.controls.target.copy(center);
      const grid = c.scene.getObjectByName('grid')!;
      grid.position.y = box.min.y - 0.5;
    }
  }, [props.model, props.library, props.catalog]);

  // Sichtbarkeit/Hervorhebung
  useEffect(() => {
    const c = ctx.current!;
    for (const [id, b] of c.built) {
      b.mesh.visible = props.visible.has(id);
      if (!b.material) continue;
      const sel = props.selected === id;
      const hi = props.highlighted.has(id);
      const cur = props.current.has(id);
      b.material.emissive.set(sel ? '#1f5fbf' : hi ? '#b3261e' : cur ? '#c78a00' : '#000000');
      b.material.emissiveIntensity = sel ? 0.55 : hi ? 0.45 : cur ? 0.3 : 0;
      b.material.transparent = props.highlighted.size > 0 && !hi && !sel;
      b.material.opacity = b.material.transparent ? 0.35 : 1;
    }
  }, [props.visible, props.current, props.highlighted, props.selected, props.model]);

  return <div className="viewer" ref={host} aria-label="3D-Ansicht des Modells (ziehen zum Drehen, scrollen zum Zoomen)" />;
}
