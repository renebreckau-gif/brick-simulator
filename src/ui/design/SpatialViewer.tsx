// Frei drehbare 3D-Ansicht des räumlichen Entwurfs. Geometrie aus bodyGeometry() – derselben Quelle wie die
// sechs orthografischen Ansichten. Objektachsen direkt übernommen: +x vorn, +y links, +z oben (z nach oben).
// Ressourcen (05B.0.1): Körper werden wiederverwendet bzw. freigegeben (spatialMeshes.ts); beim Abbau werden
// Steuerung, Listener, Hilfsobjekte, Renderer und WebGL-Kontext freigegeben.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { modelBounds } from '../../core/design/projection';
import type { SpatialDesign } from '../../core/design/spatial';
import { disposeAll, syncBodyMeshes, type BodyMesh } from './spatialMeshes';

interface Props {
  design: SpatialDesign;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  grid: THREE.GridHelper;
  registry: Map<string, BodyMesh>;
  framedFor: string | null;
}

export function SpatialViewer({ design, selected, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
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
    const hemi = new THREE.HemisphereLight('#ffffff', '#8a95a3', 1.7);
    const dir = new THREE.DirectionalLight('#ffffff', 1.3);
    dir.position.set(2, 3, 4);
    // Achsen: rot = +x (vorn), grün = +y (links), blau = +z (oben)
    const axes = new THREE.AxesHelper(0.8);
    const grid = new THREE.GridHelper(4, 16, '#aab4bf', '#c8d0d8');
    grid.rotation.x = Math.PI / 2; // in die x-y-Ebene legen
    const root = new THREE.Group();
    scene.add(hemi, dir, axes, grid, root);
    ctx.current = { renderer, scene, camera, controls, root, grid, registry: new Map(), framedFor: null };

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
    let frame = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      // Nur im Entwicklungsserver: Ressourcenzähler für die Browserprüfung (keine Wirkung im öffentlichen Build)
      if (import.meta.env.DEV && frame++ % 30 === 0) {
        el.dataset.geometries = String(renderer.info.memory.geometries);
        el.dataset.bodies = String(ctx.current?.registry.size ?? 0);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      disposeAll(ctx.current!.registry);
      axes.dispose();
      grid.dispose();
      hemi.dispose();
      dir.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      ctx.current = null;
    };
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    syncBodyMeshes(c.root, c.registry, design.bodies, selected);
    // Kamera nur beim Wechsel des Entwurfs einpassen (nicht bei jeder Korrektur)
    if (c.framedFor !== design.designId && design.bodies.length) {
      c.framedFor = design.designId;
      const bnd = modelBounds(design);
      const center = new THREE.Vector3((bnd.min[0] + bnd.max[0]) / 2, (bnd.min[1] + bnd.max[1]) / 2, (bnd.min[2] + bnd.max[2]) / 2);
      const size = Math.hypot(...bnd.size) || 1;
      c.camera.position.copy(center).add(new THREE.Vector3(1.1, 1.3, 0.8).multiplyScalar(size * 1.2));
      c.controls.target.copy(center);
      c.grid.position.z = bnd.min[2] - 0.001;
    }
    // Sofort zeichnen (auch wenn der Browser Animationsbilder drosselt) und Zähler aktualisieren
    c.renderer.render(c.scene, c.camera);
    if (import.meta.env.DEV) {
      host.current!.dataset.geometries = String(c.renderer.info.memory.geometries);
      host.current!.dataset.bodies = String(c.registry.size);
    }
  }, [design, selected]);

  return <div className="sp3d" ref={host} role="img" aria-label="Frei drehbare 3D-Ansicht des räumlichen Entwurfs (ziehen zum Drehen, scrollen zum Zoomen, klicken zum Auswählen)" />;
}
