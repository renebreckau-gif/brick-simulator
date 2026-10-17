// Frei drehbare 3D-Ansicht des räumlichen Entwurfs. Geometrie aus bodyGeometry() – derselben Quelle wie die
// sechs orthografischen Ansichten. Objektachsen direkt übernommen: +x vorn, +y links, +z oben (z nach oben).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bodyGeometry, modelBounds } from '../../core/design/projection';
import type { SpatialDesign } from '../../core/design/spatial';

interface Props {
  design: SpatialDesign;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

function meshGeometry(b: SpatialDesign['bodies'][number]): THREE.BufferGeometry {
  const g = bodyGeometry(b);
  const pos: number[] = [];
  for (const f of g.faces) for (let i = 1; i + 1 < f.length; i++) for (const k of [f[0], f[i], f[i + 1]]) pos.push(...g.vertices[k]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

export function SpatialViewer({ design, selected, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; root: THREE.Group; framedFor: string | null } | null>(null);
  const onSel = useRef(onSelect);
  onSel.current = onSelect;

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      el.textContent = '3D-Ansicht nicht verfügbar (WebGL fehlt). Die sechs Ansichten unten zeigen dieselbe Geometrie.';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfe5eb');
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
    camera.up.set(0, 0, 1); // Objektsystem: z nach oben (vor dem Anlegen der Steuerung setzen)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a95a3', 1.7));
    const dir = new THREE.DirectionalLight('#ffffff', 1.3);
    dir.position.set(2, 3, 4);
    scene.add(dir);
    // Achsen: rot = +x (vorn), grün = +y (links), blau = +z (oben)
    scene.add(new THREE.AxesHelper(0.8));
    const grid = new THREE.GridHelper(4, 16, '#aab4bf', '#c8d0d8');
    grid.rotation.x = Math.PI / 2; // in die x-y-Ebene legen
    grid.name = 'grid';
    scene.add(grid);
    const root = new THREE.Group();
    scene.add(root);
    ctx.current = { scene, camera, controls, root, framedFor: null };
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1);
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
      const hit = ray.intersectObjects(root.children, true).find((h) => h.object.userData.bodyId);
      onSel.current(hit?.object.userData.bodyId ?? null);
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
      ctx.current = null;
    };
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.root.clear();
    for (const b of design.bodies) {
      const geo = meshGeometry(b);
      const sel = b.id === selected;
      const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7, metalness: 0, flatShading: true, emissive: sel ? '#1f5fbf' : '#000000', emissiveIntensity: sel ? 0.45 : 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.bodyId = b.id;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: sel ? '#1f5fbf' : '#1d2733', transparent: !sel, opacity: sel ? 1 : 0.45 }));
      c.root.add(mesh, edges);
    }
    // Kamera nur beim Wechsel des Entwurfs einpassen (nicht bei jeder Korrektur)
    if (c.framedFor !== design.designId && design.bodies.length) {
      c.framedFor = design.designId;
      const bnd = modelBounds(design);
      const center = new THREE.Vector3((bnd.min[0] + bnd.max[0]) / 2, (bnd.min[1] + bnd.max[1]) / 2, (bnd.min[2] + bnd.max[2]) / 2);
      const size = Math.hypot(...bnd.size) || 1;
      c.camera.position.copy(center).add(new THREE.Vector3(1.1, 1.3, 0.8).multiplyScalar(size * 1.2));
      c.controls.target.copy(center);
      c.scene.getObjectByName('grid')!.position.z = bnd.min[2] - 0.001;
    }
  }, [design, selected]);

  return <div className="sp3d" ref={host} role="img" aria-label="Frei drehbare 3D-Ansicht des räumlichen Entwurfs (ziehen zum Drehen, scrollen zum Zoomen, klicken zum Auswählen)" />;
}
