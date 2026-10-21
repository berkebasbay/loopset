import { stepKindLabels } from '../ui/messages/labels';
import { worldSceneMessages as m } from '../ui/messages/WorldScene';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Project, ModelNode, Point } from '../model/types';
import type { WorldFrame } from '../playback';
import { modelLinks, sceneExtent, sceneLayout } from './graph';
import { beginMoveGesture, type LayoutTranslation, type MoveGesture } from '../features/layoutCommands';
import type { SelectionIntent } from '../features/editorSelection';
import { connectionFraming, connectionShapes, flowTopology, ribbonPositions, sharedPositionLinks, type ConnectionShape, type FlowWalk } from './flowPresentation';
import { batchStaticMeshes } from './batchStaticMeshes';

interface Props {
  project: Project; frame: WorldFrame; selected: string | null; selectedIds?: string[]; reducedMotion: boolean;
  onSelect: (id: string | null, intent?: SelectionIntent) => void; onMove?: (ids: string[], delta: Point) => void;
  moving?: boolean; quality?: 'high' | 'low'; resetKey?: number;
  flow?: { walk: FlowWalk; cursor: number } | null;
}
type Label = { el: HTMLButtonElement; node: ModelNode; position: THREE.Vector3 };
type Part = { nodeId: string; mesh: THREE.Object3D; kind: 'press' | 'scanner' | 'arm'; rest: number };
type LabelRect = { x: number; y: number; width: number; height: number };
type RendererLifetime = { renderer: THREE.WebGLRenderer; releasePointers: () => void; dispose: () => void };
type Disposable = { dispose: () => void };
type GeometryAssets = { geometries: Map<string, THREE.BufferGeometry>; resources: Set<Disposable> };
type EdgeVisual = { index: number; from: string; to: string; highlight: { visible: boolean }; meshes: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] };

// Labels may cross scenic bodies when space is tight, but never another label's
// pointer region. The second pass trades decorative occlusion for a safe target.
export function placeLabel(anchor: LabelRect, viewport: { width: number; height: number }, occupied: LabelRect[], bodies: LabelRect[]): LabelRect | null {
  const { width, height } = anchor;
  const minX = 10, maxX = viewport.width - width - 10, minY = 47, maxY = viewport.height - height - (viewport.width < 500 ? 56 : 42);
  if (maxX < minX || maxY < minY) return null;
  const x = Math.max(minX, Math.min(maxX, anchor.x)), y = Math.max(minY, Math.min(maxY, anchor.y));
  const overlaps = (candidate: LabelRect, rectangles: LabelRect[]) => rectangles.some(rect => candidate.x < rect.x + rect.width + 8 && candidate.x + width + 8 > rect.x && candidate.y < rect.y + rect.height + 8 && candidate.y + height + 8 > rect.y);
  const candidates: LabelRect[] = [];
  for (let row = 0; row <= Math.ceil((maxY - minY) / (height + 8)); row++) {
    for (const direction of row ? [-1, 1] : [0]) {
      const cy = Math.max(minY, Math.min(maxY, y + row * (height + 8) * direction));
      for (const col of [0, -1, 1, -2, 2, -3, 3]) candidates.push({ x: Math.max(minX, Math.min(maxX, x + col * (width * .72 + 8))), y: cy, width, height });
    }
  }
  return candidates.find(candidate => !overlaps(candidate, occupied) && !overlaps(candidate, bodies))
    ?? candidates.find(candidate => !overlaps(candidate, occupied)) ?? null;
}
const kit = {
  factory: { accent: '#dc6338', secondary: '#507b68', floor: '#e5e0d1', base: '#b4b9a7', wall: '#829a83', edge: '#42634d' },
  festival: { accent: '#d89539', secondary: '#327b79', floor: '#d7ddc5', base: '#a7b38c', wall: '#709375', edge: '#3d684d' },
  service: { accent: '#b17659', secondary: '#6c7792', floor: '#e6ddd1', base: '#bcb4a4', wall: '#a8b4a1', edge: '#56684f' },
};
const palette = { cream: '#f4eee0', dark: '#294a40', metal: '#577166', box: '#be8d55', ink: '#304a3e' };

export function WorldScene(props: Props) {
  const mount = useRef<HTMLDivElement>(null); const latest = useRef(props); latest.current = props;
  const invalidate = useRef<() => void>(() => {});
  const cancelPreview = useRef<() => void>(() => {});
  const rendererLifetime = useRef<RendererLifetime | null>(null);
  const acquireRenderer = useRef<() => RendererLifetime | null>(() => null);
  const disposeActiveScene = useRef<() => void>(() => {});
  const updateConnectivity = useRef<((nodes: ModelNode[]) => void) | null>(null);
  const [error, setError] = useState(false);
  const [sceneAttempt, setSceneAttempt] = useState(0);
  const geometryKey = JSON.stringify({ world: props.project.world, layout: props.project.layout,
    nodes: props.project.model.nodes.map(node => ({ id: node.id, kind: node.kind })) });
  const connectivityKey = JSON.stringify(props.project.model.nodes.map(node => ({ id: node.id,
    next: 'next' in node ? node.next : undefined, branches: node.kind === 'route' ? node.branches : undefined })));
  const appliedConnectivityKey = useRef(connectivityKey);

  useEffect(() => {
    if (!mount.current) return;
    const host = mount.current;
    acquireRenderer.current = () => {
      if (rendererLifetime.current) return rendererLifetime.current;
      let renderer: THREE.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' }); }
      catch { host.dataset.status = 'error'; setError(true); return null; }
      const canvas = renderer.domElement, pointers = new Set<number>();
      // Capture may still be pending when a scene is replaced during pointerdown.
      const trackPointer = (event: PointerEvent) => { pointers.add(event.pointerId); };
      const forgetPointer = (event: PointerEvent) => { if (!canvas.hasPointerCapture(event.pointerId)) pointers.delete(event.pointerId); };
      const releasePointers = () => {
        for (const id of pointers) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
        pointers.clear();
      };
      let disposed = false;
      const lifetime: RendererLifetime = { renderer, releasePointers, dispose: () => {
        if (disposed) return;
        disposed = true; releasePointers();
        canvas.removeEventListener('pointerdown', trackPointer, true); canvas.removeEventListener('gotpointercapture', trackPointer);
        canvas.removeEventListener('lostpointercapture', forgetPointer);
        document.removeEventListener('pointerup', forgetPointer); document.removeEventListener('pointercancel', forgetPointer);
        renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
        if (rendererLifetime.current === lifetime) rendererLifetime.current = null;
      } };
      rendererLifetime.current = lifetime;
      try {
        canvas.addEventListener('pointerdown', trackPointer, true); canvas.addEventListener('gotpointercapture', trackPointer);
        canvas.addEventListener('lostpointercapture', forgetPointer);
        document.addEventListener('pointerup', forgetPointer); document.addEventListener('pointercancel', forgetPointer);
        canvas.setAttribute('role', 'img'); canvas.tabIndex = 0; canvas.dataset.testid = 'world-canvas';
        host.appendChild(canvas); return lifetime;
      } catch { lifetime.dispose(); host.dataset.status = 'error'; setError(true); return null; }
    };
    return () => {
      acquireRenderer.current = () => null;
      // React may clean up the mount effect before the scene effect, including
      // StrictMode replay. Scene teardown must finish before its renderer dies.
      disposeActiveScene.current(); rendererLifetime.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!mount.current) return;
    appliedConnectivityKey.current = connectivityKey;
    const host = mount.current, lifetime = acquireRenderer.current(); if (!lifetime) return;
    const { renderer } = lifetime;
    host.dataset.status = 'loading'; setError(false);
    let alive = true, handle = 0;
    let cancelInteraction = () => {};
    const cleanups: (() => void)[] = [], resources = new Set<Disposable>();
    function own<T extends Disposable>(resource: T, group?: Set<Disposable>): T { resources.add(resource); group?.add(resource); return resource; }
    function release(resource: Disposable) { resources.delete(resource); resource.dispose(); }
    const cleanup = () => {
      if (!alive) return;
      alive = false; invalidate.current = () => {}; cancelPreview.current = () => {}; updateConnectivity.current = null;
      cancelAnimationFrame(handle); cancelInteraction(); lifetime.releasePointers();
      for (const dispose of cleanups.reverse()) dispose();
      for (const resource of [...resources].reverse()) resource.dispose();
      resources.clear(); renderer.renderLists.dispose(); host.dataset.renderPending = 'false';
      if (disposeActiveScene.current === cleanup) disposeActiveScene.current = () => {};
    };
    const fail = () => { cleanup(); lifetime.dispose(); host.dataset.status = 'error'; setError(true); };
    disposeActiveScene.current = cleanup;
    try {
    const project = props.project, world = project.world, theme = kit[world];
    const layout = sceneLayout(project), extent = sceneExtent(layout);
    const nodes = project.model.nodes, services = nodes.filter(node => node.kind === 'service');
    const dense = nodes.length > 30;
    const pixelRatio = Math.min(window.devicePixelRatio, props.quality === 'low' ? 1 : 1.6);
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = props.quality !== 'low' && !dense;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.13;
    renderer.setClearColor('#f2f0e7', 0);
    renderer.domElement.setAttribute('aria-label', m.interactiveWorldLabel(project.name));
    host.dataset.world = world; host.dataset.nodeCount = String(nodes.length);
    const scene = new THREE.Scene();
    cleanups.push(() => scene.clear());
    const camera = new THREE.OrthographicCamera(-16, 16, 12, -12, .1, 2000);
    const cameraDirection = new THREE.Vector3(24, 29, 33).normalize();
    camera.position.copy(cameraDirection.clone().multiplyScalar(80)); camera.lookAt(extent.x, 0, extent.z);
    const controls = new OrbitControls(camera, renderer.domElement);
    cleanups.push(() => controls.dispose());
    controls.enableRotate = false; controls.enableDamping = false; controls.screenSpacePanning = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN; controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    scene.add(new THREE.AmbientLight('#fff8e7', .65));
    scene.add(new THREE.HemisphereLight('#fcfbf3', '#6a806a', 1.35));
    const light = new THREE.DirectionalLight('#fff2d8', 3.1);
    own(light.shadow);
    light.position.set(extent.x - 12, 26, extent.z + 8); light.target.position.set(extent.x, 0, extent.z);
    light.castShadow = true; light.shadow.mapSize.set(2048, 2048);
    const shadowSize = Math.max(extent.width, extent.depth) * .6;
    light.shadow.camera.left = -shadowSize; light.shadow.camera.right = shadowSize;
    light.shadow.camera.top = shadowSize; light.shadow.camera.bottom = -shadowSize;
    light.shadow.camera.far = 200; light.shadow.normalBias = .035; light.shadow.bias = -.0002;
    scene.add(light, light.target);
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    const geometries = new Map<string, THREE.BufferGeometry>();
    const sceneAssets: GeometryAssets = { geometries, resources };
    const capacityPlates: { id: string; index: number; content: string; update: (content: string) => void }[] = [];
    function mat(color: string) {
      if (!materials.has(color)) materials.set(color, own(new THREE.MeshStandardMaterial({ color, roughness: .78 })));
      return materials.get(color)!;
    }
    function rounded(w: number, h: number, d: number, radius = .04, assets = sceneAssets) {
      const key = `${w}-${h}-${d}-${radius}`;
      if (!assets.geometries.has(key)) assets.geometries.set(key, own(dense ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, w / 3, h / 3, d / 3)), assets.resources));
      return assets.geometries.get(key)!;
    }
    function box(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, color: string, radius = .04, assets = sceneAssets) {
      const mesh = new THREE.Mesh(rounded(w, h, d, radius, assets), mat(color)); mesh.position.set(x, y, z);
      mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
    }
    function cylinder(parent: THREE.Object3D, x: number, y: number, z: number, r: number, h: number, color: string, rz = 0, assets = sceneAssets) {
      const key = `c-${r}-${h}`;
      if (!assets.geometries.has(key)) assets.geometries.set(key, own(new THREE.CylinderGeometry(r, r, h, dense ? 6 : 12), assets.resources));
      const mesh = new THREE.Mesh(assets.geometries.get(key)!, mat(color)); mesh.position.set(x, y, z); mesh.rotation.z = rz;
      mesh.castShadow = true; parent.add(mesh); return mesh;
    }
    function text(parent: THREE.Object3D, content: string, x: number, y: number, z: number, size: number, color: string, rotationX = 0, assets = sceneAssets) {
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
      const c = canvas.getContext('2d')!; c.font = '700 64px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(content, 512, 64);
      const tex = own(new THREE.CanvasTexture(canvas), assets.resources); tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(own(new THREE.PlaneGeometry(size * 8, size), assets.resources), own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }), assets.resources));
      assets.geometries.set(`text-${tex.id}`, mesh.geometry); mesh.position.set(x, y, z); mesh.rotation.x = rotationX; parent.add(mesh);
      return { mesh, update: (content: string) => { c.clearRect(0, 0, 1024, 128); c.fillText(content, 512, 64); tex.needsUpdate = true; } };
    }
    function person(parent: THREE.Object3D, x: number, z: number, shirt = theme.secondary) {
      const g = new THREE.Group(); g.position.set(x, .1, z); parent.add(g);
      box(g, 0, .36, 0, .25, .4, .2, shirt, .07);
      cylinder(g, 0, .7, 0, .12, .21, '#d6ab80');
      cylinder(g, -.07, .12, 0, .047, .25, palette.dark); cylinder(g, .07, .12, 0, .047, .25, palette.dark);
      box(g, -.17, .36, .04, .09, .3, .1, shirt); box(g, .17, .36, .04, .09, .3, .1, shirt);
      return g;
    }
    function plant(x: number, z: number, big = false) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(big ? 1.35 : 1); scene.add(g);
      cylinder(g, 0, .22, 0, .25, .44, world === 'festival' ? '#aa7653' : '#c2ae8d');
      for (let i = 0; i < 5; i++) {
        const leaf = box(g, Math.cos(i * 2.3) * .2, .7 + (i % 2) * .2, Math.sin(i * 2.3) * .2, .15, .8, .3, i % 2 ? '#427957' : '#729261', .06);
        leaf.rotation.z = Math.cos(i * 2.3) * .6; leaf.rotation.x = Math.sin(i * 2.3) * .5;
      }
    }
    function bench(x: number, z: number, width = 2) {
      box(scene, x, .53, z, width, .16, .55, '#aa8058');
      for (const dx of [-width * .35, width * .35]) box(scene, x + dx, .27, z, .12, .5, .5, palette.dark);
      box(scene, x, .86, z - .22, width, .5, .09, '#b68e64');
    }
    // Original reusable material kit. Scenic equipment never represents simulated jobs.
    box(scene, extent.x, -.37, extent.z, extent.width + .5, .7, extent.depth + .5, theme.base, .2);
    box(scene, extent.x, -.025, extent.z, extent.width + .25, .11, extent.depth + .25, theme.floor, .1);
    const floor = document.createElement('canvas'); floor.width = 512; floor.height = 512;
    const fc = floor.getContext('2d')!; fc.fillStyle = theme.floor; fc.fillRect(0, 0, 512, 512);
    fc.strokeStyle = world === 'festival' ? '#c6d1ad' : '#cecbbd'; fc.lineWidth = 1;
    for (let a = 0; a <= 512; a += 64) { fc.beginPath(); fc.moveTo(a, 0); fc.lineTo(a, 512); fc.moveTo(0, a); fc.lineTo(512, a); fc.stroke(); }
    const floorTex = own(new THREE.CanvasTexture(floor)); floorTex.colorSpace = THREE.SRGBColorSpace;
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(extent.width / 20, extent.depth / 12);
    const floorMat = own(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1 }));
    const floorMesh = new THREE.Mesh(own(new THREE.PlaneGeometry(extent.width, extent.depth)), floorMat);
    floorMesh.rotation.x = -Math.PI / 2; floorMesh.position.set(extent.x, .045, extent.z); floorMesh.receiveShadow = true; scene.add(floorMesh); geometries.set('floor-plane', floorMesh.geometry);
    const backZ = extent.minZ + .18, leftX = extent.minX + .18;
    if (world !== 'festival') {
      box(scene, extent.x, .72, backZ, extent.width, 1.4, .18, theme.wall);
      box(scene, leftX, .72, extent.z, .18, 1.4, extent.depth, theme.wall);
      box(scene, extent.x, 1.45, backZ, extent.width + .1, .1, .26, theme.edge);
      box(scene, leftX, 1.45, extent.z, .26, .1, extent.depth, theme.edge);
      box(scene, leftX + 2, .78, backZ + .11, 1.2, 1.45, .09, theme.edge);
      box(scene, leftX + 2.38, .78, backZ + .18, .08, .08, .08, '#e3bd6b');
      box(scene, extent.x - 1.3, .94, backZ + .13, 4.7, .7, .07, palette.cream);
      text(scene, world === 'factory' ? m.qLittleFactory : m.qServiceStudio, extent.x - 1.3, .95, backZ + .19, .24, theme.edge);
    } else {
      box(scene, extent.x, .18, backZ, extent.width, .28, .7, '#7c965e');
      for (let x = extent.minX + .5; x < extent.maxX; x += 1.2) {
        cylinder(scene, x, .7, backZ + .2, .055, 1.4, palette.cream);
        box(scene, x + .3, 1.15, backZ + .2, .6, .38, .05, Math.round(x) % 2 ? theme.secondary : theme.accent);
      }
      bench(extent.minX + 3, backZ + 1.1, 2.4); bench(extent.minX + 6, backZ + 1.1, 2.4);
      for (const x of [extent.maxX - 2.7, extent.maxX - 1.7]) {
        cylinder(scene, x, .45, backZ + 1.1, .35, .9, theme.secondary);
        cylinder(scene, x, .91, backZ + 1.1, .38, .06, palette.cream);
      }
    }
    if (!dense) {
      plant(leftX + .8, backZ + 1, true); plant(extent.maxX - .85, backZ + 1, true);
      plant(leftX + .7, extent.maxZ - .6); plant(extent.maxX - .75, extent.maxZ - .7);
      if (world === 'factory') {
        const shelfX = extent.maxX - 3.1;
        for (const x of [shelfX - 1.35, shelfX + 1.35]) box(scene, x, .85, backZ + 1, .09, 1.7, .8, theme.edge);
        for (const y of [.4, .98, 1.56]) {
          box(scene, shelfX, y, backZ + 1, 2.9, .09, .9, theme.secondary);
          for (let i = 0; i < 4; i++) box(scene, shelfX - 1 + i * .66, y + .22, backZ + 1, .5, .35, .58, i % 2 ? '#c8a46c' : '#c3b69c');
        }
        text(scene, m.supplies, shelfX, 1.9, backZ + 1.1, .18, theme.edge);
        const toolX = leftX + 3.2, toolZ = extent.maxZ - 2.2;
        box(scene, toolX, .76, toolZ, 2.15, .2, 1, '#a67e50');
        for (const x of [-.86, .86]) for (const z of [-.34, .34]) box(scene, toolX + x, .38, toolZ + z, .11, .75, .11, theme.edge);
        box(scene, toolX, 1.1, toolZ - .4, 2, .52, .13, theme.secondary);
        for (let i = 0; i < 6; i++) box(scene, toolX - .75 + i * .3, 1.1, toolZ - .31, .045, .27, .035, '#d7b365');
        box(scene, toolX + .58, .99, toolZ, .45, .3, .33, palette.metal);
        cylinder(scene, toolX + .58, 1.24, toolZ, .055, .23, theme.accent);
        const cartX = toolX + 2, cartZ = toolZ + .2;
        box(scene, cartX, .55, cartZ, .75, .77, .65, theme.accent);
        for (const y of [.35, .62, .86]) { box(scene, cartX, y, cartZ + .34, .62, .19, .035, '#b34f2c'); box(scene, cartX, y + .02, cartZ + .37, .24, .035, .035, palette.cream); }
        for (const x of [-.25, .25]) cylinder(scene, cartX + x, .14, cartZ, .12, .07, palette.dark, Math.PI / 2);
        text(scene, m.maintenance, toolX, .078, toolZ + .95, .17, '#738267', -Math.PI / 2);

        box(scene, leftX + .5, .6, extent.z - 1.2, .7, 1.1, 1.3, theme.secondary);
        for (let i = 0; i < 3; i++) box(scene, leftX + .88, .33 + i * .32, extent.z - 1.2, .03, .2, 1.05, '#92a58b');
      } else if (world === 'service') {
        for (const dx of [-1.2, 0, 1.2]) {
          box(scene, extent.maxX - 3 + dx, .6, backZ + 1, .9, .3, .9, theme.secondary, .1);
          box(scene, extent.maxX - 3 + dx, .93, backZ + .6, .9, .6, .18, theme.secondary, .08);
        }
        text(scene, m.waitingLounge, extent.maxX - 3, 1.8, backZ + 1, .17, theme.edge);
        box(scene, leftX + .4, 1, extent.z - 1, .5, 1.8, 2.4, '#cbbaa1');
        for (let i = 0; i < 4; i++) box(scene, leftX + .69, .4 + i * .4, extent.z - 1, .04, .06, 2.2, '#6f7d68');
      }
      text(scene, m.queueLab, extent.x - 6.3, .075, extent.maxZ - 1.2, .36, '#a9ac98', -Math.PI / 2);
      text(scene, m.syntheticWorld, extent.x - 6.3, .076, extent.maxZ - .72, .12, '#8a9581', -Math.PI / 2);
    }
    const pickables: THREE.Object3D[] = [], rings = new Map<string, THREE.Mesh>(), parts: Part[] = [];
    const stageGroups = new Map<string, THREE.Group>();
    function nodeGroup(node: ModelNode) {
      const g = new THREE.Group(), p = layout[node.id]; g.position.set(p.x, .08, p.z); g.userData.nodeId = node.id; scene.add(g); stageGroups.set(node.id, g);
      const radius = node.kind === 'service' ? 1.5 : node.kind === 'queue' ? .85 : 1.05;
      const ringGeo = own(new THREE.RingGeometry(radius, radius + .065, 40)); geometries.set(`ring-${node.id}`, ringGeo);
      const ring = new THREE.Mesh(ringGeo, own(new THREE.MeshBasicMaterial({ color: theme.accent, side: THREE.DoubleSide, depthWrite: false })));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .015; g.add(ring); rings.set(node.id, ring); return g;
    }
    function register(g: THREE.Group, id: string) {
      // Dense artwork has many small opaque pieces. Keep batches inside their
      // node so ordinary picking, live drag transforms and history still apply.
      if (dense) batchStaticMeshes(g, new Set(parts.map(part => part.mesh)), own);
      g.traverse(obj => { if ((obj as THREE.Mesh).isMesh) { obj.userData.nodeId = id; pickables.push(obj); } });
    }
    const fadedMaterials = new Map<THREE.Material, THREE.Material>();
    const focusLinkMaterial = own(new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, depthTest: false, depthWrite: false }));
    const focusArrowMaterial = own(new THREE.MeshBasicMaterial({ color: palette.cream, transparent: true, depthTest: false, depthWrite: false }));
    function faded(material: THREE.Material) {
      if (!fadedMaterials.has(material)) { const copy = own(material.clone()); copy.transparent = true; copy.opacity = .16; copy.depthWrite = false; fadedMaterials.set(material, copy); }
      return fadedMaterials.get(material)!;
    }
    function overlayMesh(positions: number[], material: THREE.MeshBasicMaterial): THREE.Mesh {
      const geometry = own(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.renderOrder = 5; scene.add(mesh); return mesh;
    }
    const connectionMaterial = own(new THREE.MeshBasicMaterial({ color: palette.dark, side: THREE.DoubleSide, transparent: true, opacity: .8, depthTest: false, depthWrite: false }));
    const overviewMaterial = own(new THREE.MeshBasicMaterial({ color: theme.accent, side: THREE.DoubleSide, transparent: true, opacity: .65, depthTest: false, depthWrite: false }));
    const activeMaterial = own(new THREE.MeshBasicMaterial({ color: theme.accent, side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false }));
    const arrowMaterial = own(new THREE.MeshBasicMaterial({ color: palette.dark, side: THREE.DoubleSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false }));
    const overview = overlayMesh([], overviewMaterial), activeConnection = overlayMesh([], activeMaterial), activeArrow = overlayMesh([], arrowMaterial);
    const baseCoincident = overlayMesh([], connectionMaterial), focusedCoincident = overlayMesh([], connectionMaterial);
    overview.renderOrder = 6; activeConnection.renderOrder = 7; activeArrow.renderOrder = 8;
    overview.visible = false; activeConnection.visible = false; activeArrow.visible = false;
    baseCoincident.visible = false; focusedCoincident.visible = false;
    const updateOverlay = (mesh: THREE.Mesh, positions: number[]) => {
      const previous = mesh.geometry;
      mesh.geometry = own(new THREE.BufferGeometry()); mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      release(previous); mesh.visible = positions.length > 0;
    };
    const arrowPositions = (shape: ConnectionShape) => shape.arrow.flatMap(point => [point.x, point.y, point.z]);
    function buildConnections(connectionNodes: ModelNode[]) {
      const links = modelLinks(connectionNodes), topology = flowTopology(connectionNodes), shapes = connectionShapes(topology, layout);
      const sharedEdges = new Set(sharedPositionLinks(topology, layout).map(link => link.index)), coincidentEdges = new Set<number>();
      // This cache and resource group belong only to this connection generation.
      // Scenic materials are reused; length-dependent buffers and percentage
      // textures must never accumulate in the stationary world's geometry cache.
      const assets: GeometryAssets = { geometries: new Map(), resources: new Set() };
      const group = new THREE.Group(), edgeVisuals: EdgeVisual[] = [];
      // Links are the model's actual directed edges, never an invented service ordering.
      for (const [index, link] of links.entries()) {
        const a = layout[link.from], b = layout[link.to], distance = Math.hypot(b.x - a.x, b.z - a.z);
        const sourceNode = topology.nodes.get(link.from)!, targetNode = topology.nodes.get(link.to)!;
        const startTrim = sourceNode.kind === 'service' ? 1.15 : sourceNode.kind === 'queue' ? .7 : .65;
        const endTrim = targetNode.kind === 'service' ? 1.15 : targetNode.kind === 'queue' ? .7 : .65;
        const trimmedLength = distance - startTrim - endTrim, compact = trimmedLength <= .08;
        const shape = shapes.get(index)!;
        if (shape.coincident) {
          coincidentEdges.add(index);
          // Every zero-length declared edge gets a directed return symbol.
          // Shared-position UI counts distinct endpoints only, not real self-loops.
          edgeVisuals.push({ index, from: link.from, to: link.to, highlight: { visible: false }, meshes: [] });
          continue;
        }
        if (!dense && compact) continue;
        const length = compact ? distance : trimmedLength;
        const dx = (b.x - a.x) / distance, dz = (b.z - a.z) / distance;
        const g = new THREE.Group(), offset = compact ? length / 2 : startTrim + length / 2;
        g.position.set(a.x + dx * offset, 0, a.z + dz * offset); g.rotation.y = Math.atan2(dx, dz); group.add(g);
        if (!compact && world === 'factory') {
          box(g, 0, .25, 0, .67, .14, length, palette.dark, .04, assets);
          for (const x of [-.38, .38]) box(g, x, .34, 0, .05, .14, length, '#819284', .04, assets);
          if (!dense) for (let z = -length / 2 + .1; z < length / 2; z += .22) cylinder(g, 0, .34, z, .055, .65, '#9ca895', Math.PI / 2, assets);
        } else if (!compact) box(g, 0, .07, 0, .65, .025, length, world === 'festival' ? '#bbc8a7' : '#c6bcaa', .04, assets);
        // White chevrons communicate direction even in a monochrome view.
        const arrowZ = Math.min(length / 2 - .08, 0);
        if (!compact) for (const x of [-1, 1]) { const arrow = box(g, x * .09, world === 'factory' ? .411 : .092, arrowZ, .045, .015, .23, palette.cream, .005, assets); arrow.rotation.y = x * -.65; }
        if (link.probability !== undefined && !dense) text(g, `${Math.round(link.probability * 100)}%`, 0, .13, -.2, .15, palette.ink, -Math.PI / 2, assets);
        if (dense) {
          const meshes: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
          g.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) meshes.push({ mesh, material: mesh.material }); });
          const highlight = new THREE.Group(); g.add(highlight); highlight.visible = false;
          // Closely placed nodes have no floor segment after trimming. Their
          // selected connection is lifted above the equipment instead of lost.
          const surfaceY = compact ? 3.35 : world === 'factory' ? .44 : .12;
          const spine: THREE.Mesh = box(highlight, 0, surfaceY, 0, .2, .02, length, theme.accent, .005, assets); spine.material = focusLinkMaterial; spine.renderOrder = 2;
          for (const x of [-1, 1]) { const arrow: THREE.Mesh = box(highlight, x * .12, surfaceY + .02, arrowZ, .055, .02, .3, palette.cream, .005, assets); arrow.rotation.y = x * -.65; arrow.material = focusArrowMaterial; arrow.renderOrder = 3; }
          edgeVisuals.push({ index, from: link.from, to: link.to, highlight, meshes });
        }
      }
      return { group, assets, links, topology, shapes, sharedEdges, coincidentEdges, edgeVisuals };
    }
    function disposeConnections(previous: ReturnType<typeof buildConnections>) {
      previous.group.removeFromParent(); previous.group.clear();
      for (const resource of [...previous.assets.resources].reverse()) {
        // Percentage labels own their materials. Remove any faded derivative
        // with them, while retaining derivatives of shared scenic materials.
        if (resource instanceof THREE.Material) {
          const copy = fadedMaterials.get(resource);
          if (copy) { release(copy); fadedMaterials.delete(resource); }
        }
        release(resource);
      }
      previous.assets.resources.clear(); previous.assets.geometries.clear();
    }
    let connections = buildConnections(nodes);
    let { links, topology, shapes, sharedEdges, coincidentEdges, edgeVisuals } = connections;
    scene.add(connections.group);
    function describeConnections() {
      host.dataset.edges = JSON.stringify(links);
      host.dataset.sharedPositionEdges = JSON.stringify([...sharedEdges].map(index => ({ index, from: links[index].from, to: links[index].to })));
    }
    describeConnections();
    for (const [index, node] of services.entries()) {
      const g = nodeGroup(node); g.scale.setScalar(1.12);
      box(g, 0, .025, 0, 2.85, .07, 2.7, world === 'factory' ? '#c3c8ae' : '#c4c9b5', .1);
      for (const x of [-1.35, 1.35]) box(g, x, .07, 0, .035, .015, 2.45, theme.secondary, .005);
      if (world === 'factory') {
        if (index % 3 === 0) {
          box(g, 0, .7, 0, 1.85, 1.25, 1.5, palette.cream, .1);
          box(g, .94, .75, -.1, .15, 1.2, 1.3, theme.accent);
          for (let i = 0; i < 5; i++) box(g, 1.023, .6 + i * .13, -.1, .02, .045, .7, '#914b30', .006);
          box(g, -.1, 1.4, -.55, 1.7, 1.4, .28, theme.secondary);
          box(g, -.57, 1.56, -.14, .64, .52, .6, '#81a08b');
          box(g, -.43, .75, .79, .8, .77, .09, palette.dark);
          box(g, -.43, .73, .85, .6, .5, .03, '#172f2a');
          cylinder(g, -.43, .75, .91, .18, .09, '#81917c', Math.PI / 2);
          box(g, .5, .86, .82, .43, .64, .13, palette.dark);
          box(g, .5, 1.01, .9, .3, .17, .025, '#9bc9a0');
          for (let i = 0; i < 3; i++) cylinder(g, .4 + i * .12, .78, .92, .027, .03, i === 0 ? theme.accent : '#ddbd74', Math.PI / 2);
          cylinder(g, .7, 1.97, -.52, .065, .38, theme.accent);
          const press = box(g, -.44, 1.24, .08, .17, .42, .17, theme.accent); parts.push({ nodeId: node.id, mesh: press, kind: 'press', rest: press.position.y });
          for (let i = 0; i < 7; i++) { const stripe = box(g, -.88 + i * .28, .1, 1.1, .15, .025, .22, i % 2 ? '#394e3c' : '#d8b15f', .006); stripe.rotation.y = -.35; }
        } else if (index % 3 === 1) {
          box(g, 0, .7, 0, 1.95, .2, 1.55, palette.cream);
          for (const x of [-.78, .78]) for (const z of [-.6, .6]) box(g, x, .35, z, .12, .7, .12, palette.metal);
          for (const x of [-.88, .88]) box(g, x, 1.27, -.08, .16, 1.15, 1, theme.secondary);
          box(g, 0, 1.85, -.08, 1.95, .23, 1.05, theme.secondary);
          box(g, 0, 1.72, .47, 1.6, .06, .04, '#d5b95d');
          box(g, -.37, 1.25, -.5, .65, .5, .13, palette.dark);
          box(g, -.37, 1.26, -.42, .49, .3, .025, '#9bc9a0');
          const scan = box(g, .3, 1.36, .1, .06, .55, .04, '#e8c36f'); parts.push({ nodeId: node.id, mesh: scan, kind: 'scanner', rest: scan.position.x });
          person(g, 1.1, .5);
        } else {
          box(g, 0, .68, 0, 2.05, .24, 1.65, palette.cream);
          for (const x of [-.85, .85]) for (const z of [-.65, .65]) box(g, x, .35, z, .13, .7, .13, palette.metal);
          for (const x of [-.88, .88]) box(g, x, 1.29, -.22, .2, 1.35, 1.07, theme.accent);
          box(g, 0, 2.02, -.22, 2.1, .27, 1.12, theme.accent, .07);
          box(g, 0, 2.04, .36, .8, .13, .035, '#f2ce9f');
          const press = box(g, 0, 1.68, -.22, .25, .42, .2, '#8e7254'); parts.push({ nodeId: node.id, mesh: press, kind: 'press', rest: press.position.y });
          box(g, .72, 1.1, -.25, .26, .5, .5, palette.dark); box(g, .74, 1.23, .02, .19, .15, .025, '#aac6a1');
          for (const x of [-.74, -.37, 0, .37, .74]) cylinder(g, x, .86, .44, .055, .8, '#6c8272', Math.PI / 2);
          person(g, .42, 1.09);
        }
      } else if (world === 'festival') {
        if (index % 3 < 2) {
          for (const x of [-1, 1]) cylinder(g, x, 1.13, -.45, .055, 2.15, palette.cream);
          box(g, 0, 2.2, -.45, 2.55, .2, 1.85, index % 3 ? theme.accent : theme.secondary, .08);
          for (let i = 0; i < 7; i++) box(g, -.99 + i * .33, 2.07, .46, .17, .2, .05, palette.cream);
          box(g, 0, .82, 0, 2.03, .2, .92, palette.cream);
          for (const x of [-.82, .82]) box(g, x, .41, 0, .12, .82, .66, theme.secondary);
          box(g, .45, 1.12, 0, .32, .38, .25, palette.dark); box(g, .45, 1.15, .14, .22, .16, .03, '#aed6af');
          person(g, 0, -.7);
          text(g, index % 3 ? m.tickets : m.wristbands, 0, 2.25, .51, .18, palette.cream);
        } else {
          for (const x of [-.85, .85]) box(g, x, 1.15, -.15, .24, 2.25, .65, theme.secondary);
          box(g, 0, 2.24, -.15, 1.95, .28, .65, theme.secondary);
          text(g, m.security, 0, 2.25, .19, .17, palette.cream);
          box(g, 1.15, .9, .7, .3, .65, .38, palette.dark); person(g, 1.2, -.7);
          box(g, 0, .08, 0, 1.5, .06, 1.8, '#a5b89a');
        }
        for (const x of [-1.12, 1.12]) { cylinder(g, x, .43, 1.1, .055, .85, palette.dark); cylinder(g, x, .055, 1.1, .19, .08, palette.dark); }
      } else {
        box(g, 0, .76, 0, 2.2, .2, 1.1, '#cfb68f');
        for (const x of [-.92, .92]) box(g, x, .38, 0, .14, .76, .9, palette.cream);
        box(g, 0, 1.17, -.2, .7, .46, .1, palette.dark); box(g, 0, 1.17, -.14, .57, .34, .02, '#aabebc');
        cylinder(g, 0, .98, -.2, .035, .3, palette.dark);
        box(g, .6, .89, .15, .3, .035, .38, palette.cream);
        box(g, -.65, .88, .22, .3, .05, .21, theme.secondary);
        person(g, .45, -.8, theme.secondary);
        box(g, 0, 1.1, -.95, 2.6, 1.6, .13, index % 3 ? '#b4bda9' : '#cbbda6');
        box(g, 0, 1.92, -.95, 2.65, .08, .18, theme.edge);
        text(g, [m.welcome, m.specialists, m.resolution][index % 3], 0, 1.59, -.87, .15, theme.edge);
        for (const x of [-.6, .6]) { box(g, x, .43, .95, .55, .16, .55, theme.secondary); box(g, x, .7, 1.18, .55, .47, .12, theme.secondary); }
      }
      // Server count is represented by a numbered capacity plate, never fake busy workers.
      const content = `${String(index + 1).padStart(2, '0')} / ${Number.isFinite(node.servers) ? node.servers : '—'}×`;
      const plate = text(g, content, .05, .09, 1.17, .25, theme.edge, -Math.PI / 2);
      capacityPlates.push({ id: node.id, index, content, update: plate.update });
      register(g, node.id);
    }
    for (const node of nodes.filter(node => node.kind !== 'service')) {
      const g = nodeGroup(node);
      if (node.kind === 'queue') {
        box(g, 0, .04, .75, 1.25, .08, 2.6, world === 'factory' ? '#b4bd9e' : '#c2c9ad');
        for (const x of [-.65, .65]) box(g, x, .1, .75, .035, .035, 2.7, '#8e9e7c', .005);
        if (world === 'factory') {
          for (const x of [-.57, .57]) box(g, x, .31, -.5, .06, .55, .08, theme.secondary);
          box(g, 0, .56, -.5, 1.18, .07, .08, theme.secondary);
          text(g, m.buffer, 0, .39, -.44, .11, theme.edge);
        } else {
          for (const z of [-.4, .6, 1.3]) for (const x of [-.6, .6]) {
            cylinder(g, x, .35, z, .04, .7, palette.dark); cylinder(g, x, .04, z, .14, .07, palette.dark);
          }
          for (const x of [-.6, .6]) box(g, x, .64, .45, .025, .045, 1.7, world === 'festival' ? theme.secondary : '#8f9d8a', .005);
        }
      } else if (node.kind === 'source' || node.kind === 'sink') {
        box(g, 0, .05, 0, 1.55, .12, 1.5, '#a6b794');
        const incoming = node.kind === 'source';
        if (world === 'factory') {
          box(g, 0, .55, -.2, 1.2, .95, .7, incoming ? theme.secondary : '#bc9568');
          box(g, 0, 1.08, -.2, 1.3, .12, .8, palette.cream);
          box(g, 0, .57, .18, .85, .5, .025, incoming ? '#9cb195' : '#ead6ad');
          text(g, incoming ? m.in : m.out, 0, .59, .21, .18, theme.edge);
          for (const x of [-.5, .5]) cylinder(g, x, .13, .2, .13, .12, palette.dark, Math.PI / 2);
        } else {
          for (const x of [-.6, .6]) cylinder(g, x, .98, 0, .06, 1.95, theme.edge);
          box(g, 0, 1.85, 0, 1.5, .43, .15, incoming ? theme.accent : theme.secondary);
          text(g, incoming ? m.entry : m.exit, 0, 1.87, .085, .17, palette.cream);
        }
      } else if (node.kind === 'delay') {
        box(g, 0, .06, 0, 1.45, .12, 1.45, '#b7c0a8');
        cylinder(g, 0, .65, 0, .06, 1.2, theme.edge);
        const clock = cylinder(g, 0, 1.32, 0, .42, .1, palette.cream, Math.PI / 2);
        clock.rotation.z = 0; clock.rotation.x = Math.PI / 2; box(g, 0, 1.43, .07, .035, .24, .03, theme.edge); box(g, .09, 1.32, .07, .2, .035, .03, theme.accent);
      } else {
        const plate = box(g, 0, .12, 0, 1.2, .15, 1.2, theme.secondary); plate.rotation.y = Math.PI / 4;
        cylinder(g, 0, .69, 0, .045, 1.1, theme.edge);
        box(g, 0, 1.1, 0, 1.35, .38, .12, palette.cream); text(g, m.split, 0, 1.11, .07, .15, theme.edge);
      }
      register(g, node.id);
    }
    // Only sealed trace actors are rendered. Playback caps each node/state tray;
    // the parent labels aggregation and retains exact queue and system counts.
    const actorGeometry = world === 'factory' ? rounded(.24, .22, .24, .015) : own(new THREE.CapsuleGeometry(.09, .25, 3, 6));
    geometries.set('actors', actorGeometry);
    const actors = own(new THREE.InstancedMesh(actorGeometry, mat(world === 'factory' ? palette.box : theme.accent), 500));
    actors.castShadow = true; actors.count = 0; actors.frustumCulled = false; scene.add(actors);
    const actorTops = world === 'factory' ? own(new THREE.InstancedMesh(rounded(.06, .012, .245, .003), mat('#edcf93'), 500)) : null;
    if (actorTops) { actorTops.count = 0; actorTops.frustumCulled = false; scene.add(actorTops); }
    const dummy = new THREE.Object3D();
    const labelLayer = document.createElement('div'); labelLayer.className = 'scene-label-layer'; cleanups.push(() => labelLayer.remove()); host.appendChild(labelLayer);
    const moveReadout = document.createElement('div'); moveReadout.className = 'move-guide-readout'; moveReadout.hidden = true; cleanups.push(() => moveReadout.remove()); host.appendChild(moveReadout);
    const guideLines = (['x', 'z'] as const).map(() => {
      const geometry = own(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geometry, own(new THREE.LineDashedMaterial({ color: '#416a3b', dashSize: .22, gapSize: .14, depthTest: false, depthWrite: false, transparent: true, opacity: .85 })));
      line.visible = false; line.renderOrder = 4; scene.add(line); return line;
    });
    const previewPoints = new Map<string, Point>();
    const visualPoint = (id: string) => previewPoints.get(id) ?? layout[id];
    const connectorLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); connectorLayer.classList.add('scene-label-connectors'); connectorLayer.setAttribute('aria-hidden', 'true'); labelLayer.appendChild(connectorLayer);
    const connectors = new Map<string, SVGLineElement>();
    const labels: Label[] = [];
    nodes.forEach((node, index) => {
      const el = document.createElement('button'); el.className = `station-label node-${node.kind}`; el.dataset.stationId = node.id; el.type = 'button';
      el.innerHTML = '<span class="station-number"></span><span class="station-name"></span><span class="station-queue"></span>';
      el.querySelector('.station-number')!.textContent = node.kind === 'service' ? String(services.findIndex(s => s.id === node.id) + 1).padStart(2, '0') : node.kind === 'queue' ? m.q : node.kind === 'source' ? m.in : node.kind === 'sink' ? m.out : node.kind === 'delay' ? m.t : '↗';
      el.querySelector('.station-name')!.textContent = node.label;
      el.setAttribute('aria-label', m.select(node.label, stepKindLabels[node.kind]));
      const connector = document.createElementNS('http://www.w3.org/2000/svg', 'line'); connectorLayer.appendChild(connector); connectors.set(node.id, connector);
      el.addEventListener('click', event => latest.current.onSelect(node.id, event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : latest.current.moving && latest.current.selectedIds?.includes(node.id) ? 'inspect' : 'single'));
      el.addEventListener('pointerenter', () => { hover = node.id; requestRender(); });
      el.addEventListener('pointerleave', () => { hover = null; requestRender(); }); labelLayer.appendChild(el);
      const p = layout[node.id]; labels.push({ el, node, position: new THREE.Vector3(p.x, node.kind === 'service' ? (world === 'festival' ? 3 : 2.8) : node.kind === 'queue' ? .25 : 2.2, p.z) });
      el.style.zIndex = String(index + 1);
    });
    const bounds = new THREE.Box3(new THREE.Vector3(extent.minX - .5, -.8, extent.minZ - .5), new THREE.Vector3(extent.maxX + .5, 3.6, extent.maxZ + .5));
    const corners: THREE.Vector3[] = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
    let hover: string | null = null, renderCount = 0, edgeFocus: string | null | undefined;
    let presentedFlow: Props['flow'], presentedWalk: FlowWalk | null | undefined, presentedManual: number | null | undefined;
    let flowDirty = true;
    let manuallyShown: number | null = null, currentConnection: number | null = null;
    let coincidenceFocus = '';
    let manualContext: { flow: Props['flow']; selected: string | null; moving: boolean } | null = null;
    let flowIds = new Set<string>(), viewedIds = new Set<string>(), flowEdges = new Set<number>();
    function requestRender() { if (alive && !handle && !document.hidden) { host.dataset.renderPending = 'true'; handle = requestAnimationFrame(draw); } }
    invalidate.current = requestRender;
    function fit() {
      const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
      cameraDirection.set(24, Math.max(17, Math.min(29, 29 * 1.8 / (w / h))), 33).normalize();
      const center = bounds.getCenter(new THREE.Vector3()); controls.target.copy(center);
      camera.position.copy(center).addScaledVector(cameraDirection, Math.max(80, extent.width + extent.depth)); camera.lookAt(center); camera.updateMatrixWorld(true);
      const inverse = camera.matrixWorldInverse;
      const viewCorners = corners.map(point => point.clone().applyMatrix4(inverse));
      const viewWidth = Math.max(...viewCorners.map(p => p.x)) - Math.min(...viewCorners.map(p => p.x));
      const viewHeight = Math.max(...viewCorners.map(p => p.y)) - Math.min(...viewCorners.map(p => p.y));
      const aspect = w / h, vertical = Math.max(viewHeight / .82, viewWidth / (aspect * .88));
      camera.left = -vertical * aspect / 2; camera.right = vertical * aspect / 2; camera.top = vertical / 2; camera.bottom = -vertical / 2;
      camera.zoom = 1; controls.minZoom = .65; controls.maxZoom = 6; camera.updateProjectionMatrix(); controls.update(); requestRender();
    }
    const rendererSize = new THREE.Vector2();
    const observer = new ResizeObserver(() => {
      if (!alive) return;
      try {
      const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
      renderer.getSize(rendererSize);
      if (rendererSize.x !== w || rendererSize.y !== h) renderer.setSize(w, h);
      fit();
      } catch { fail(); }
    }); cleanups.push(() => observer.disconnect()); observer.observe(host);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let down: { x: number; y: number; hit: string | null; pointerId: number; toggle: boolean; origin: Point | null; ids: string[]; preview: LayoutTranslation | null; gesture: MoveGesture | null; dragging: boolean } | null = null;
    function hit(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera); return raycaster.intersectObjects(pickables, false)[0]?.object.userData.nodeId as string | undefined;
    }
    function pointerDown(e: PointerEvent) {
      if (e.button !== 0 || down) return;
      const nodeId = hit(e) ?? null, point = new THREE.Vector3();
      const origin = raycaster.ray.intersectPlane(ground, point) ? { x: point.x, z: point.z } : null;
      const selectedIds = latest.current.selectedIds ?? (latest.current.selected ? [latest.current.selected] : []);
      down = { x: e.clientX, y: e.clientY, hit: nodeId, pointerId: e.pointerId, toggle: e.shiftKey || e.ctrlKey || e.metaKey, origin,
        ids: nodeId ? selectedIds.includes(nodeId) ? [...selectedIds] : [nodeId] : [], preview: null, gesture: null, dragging: false };
      if (latest.current.moving && nodeId) { controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); }
    }
    function pointerUp(e: PointerEvent) {
      if (!down || down.pointerId !== e.pointerId) return;
      if (down.dragging) updateDrag(e);
      const completed = down;
      const delta = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (delta < 5) latest.current.onSelect(completed.hit, completed.toggle ? 'toggle' : latest.current.moving && completed.hit && latest.current.selectedIds?.includes(completed.hit) ? 'inspect' : 'single');
      const commit = completed.dragging ? completed.gesture?.finish() : null;
      pointerCancel();
      if (commit) latest.current.onMove?.(commit.ids, commit.delta);
    }
    function updateDrag(e: PointerEvent) {
      if (!down || down.pointerId !== e.pointerId || !down.hit || !down.origin || down.toggle || !latest.current.moving) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && !down.dragging) return;
      hit(e); const point = new THREE.Vector3(); if (!raycaster.ray.intersectPlane(ground, point)) return;
      if (!down.dragging) { down.dragging = true; down.gesture = beginMoveGesture(latest.current.project, down.ids, down.hit); latest.current.onSelect(down.hit, down.ids.includes(down.hit) && latest.current.selectedIds?.includes(down.hit) ? 'inspect' : 'single'); }
      down.preview = down.gesture!.preview({ x: point.x - down.origin.x, z: point.z - down.origin.z });
      previewPoints.clear();
      if (down.preview && !down.preview.error) for (const id of down.preview.ids) { const p = down.preview.points[id]; previewPoints.set(id, p); stageGroups.get(id)?.position.set(p.x, .08, p.z); }
      renderer.shadowMap.needsUpdate = true; requestRender();
    }
    function pointerMove(e: PointerEvent) {
      const nodeId = hit(e) ?? null;
      if (!down) { renderer.domElement.style.cursor = nodeId ? latest.current.moving ? 'move' : 'pointer' : 'grab'; if (hover !== nodeId) { hover = nodeId; requestRender(); } }
      else updateDrag(e);
    }
    const pointerCancel = () => {
      const pointerId = down?.pointerId;
      down?.gesture?.cancel();
      for (const id of previewPoints.keys()) { const p = layout[id]; stageGroups.get(id)?.position.set(p.x, .08, p.z); }
      previewPoints.clear(); down = null; controls.enabled = true; moveReadout.hidden = true; guideLines.forEach(line => { line.visible = false; });
      delete host.dataset.movePreview; delete host.dataset.alignmentGuides;
      if (pointerId !== undefined && renderer.domElement.hasPointerCapture(pointerId)) renderer.domElement.releasePointerCapture(pointerId);
      renderer.shadowMap.needsUpdate = true; requestRender();
    };
    cancelInteraction = pointerCancel;
    cancelPreview.current = pointerCancel;
    const cancelEvent = () => pointerCancel();
    const lostCapture = (event: PointerEvent) => { if (latest.current.moving && down?.pointerId === event.pointerId) pointerCancel(); };
    const moveKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && down?.dragging) { event.preventDefault(); event.stopPropagation(); pointerCancel(); } };
    const pointerLeave = () => { hover = null; requestRender(); };
    const visible = () => { if (!document.hidden) requestRender(); };
    const cameraChanged = () => {
      const target = controls.target;
      const next = new THREE.Vector3(Math.max(extent.minX, Math.min(extent.maxX, target.x)), Math.max(-2, Math.min(4, target.y)), Math.max(extent.minZ, Math.min(extent.maxZ, target.z)));
      const delta = next.sub(target); controls.target.add(delta); camera.position.add(delta); requestRender();
    };
    const focusSelected = () => {
      const point = layout[latest.current.selected ?? '']; if (!point) return;
      // Ordinary focus still centers the inspected step after connection framing.
      const vertical = camera.top - camera.bottom; camera.top = vertical / 2; camera.bottom = -vertical / 2;
      const horizontal = camera.right - camera.left; camera.left = -horizontal / 2; camera.right = horizontal / 2;
      const target = new THREE.Vector3(point.x, .8, point.z), delta = target.clone().sub(controls.target);
      controls.target.copy(target); camera.position.add(delta); camera.zoom = Math.max(camera.zoom, Math.min(3, Math.max(extent.width, extent.depth) / 8)); camera.updateProjectionMatrix(); controls.update(); requestRender();
    };
    const showConnection = (event: Event) => {
      const index: unknown = (event as CustomEvent).detail;
      if (!Number.isInteger(index) || !shapes.has(index as number) || latest.current.moving) return;
      const shape = shapes.get(index as number)!, link = links[index as number], a = layout[link.from], b = layout[link.to];
      const points = shape.points.map(point => new THREE.Vector3(point.x, point.y, point.z));
      for (const point of [a, b]) for (const x of [-1.7, 1.7]) for (const z of [-1.7, 1.7]) for (const y of [0, 3.8]) points.push(new THREE.Vector3(point.x + x, y, point.z + z));
      const connectionBounds = new THREE.Box3().setFromPoints(points), center = connectionBounds.getCenter(new THREE.Vector3());
      const delta = center.clone().sub(controls.target); controls.target.copy(center); camera.position.add(delta); camera.updateMatrixWorld(true);
      const projected = points.map(point => point.clone().applyMatrix4(camera.matrixWorldInverse));
      const w = host.clientWidth, h = host.clientHeight, hostRect = host.getBoundingClientRect();
      const paper = host.closest('.world-workspace')?.querySelector('.flow-guide-panel')?.getBoundingClientRect();
      const safeTop = 54, safeBottom = Math.max(safeTop + 60, Math.min(h - 46, paper ? paper.top - hostRect.top - 12 : h - 46));
      const framing = connectionFraming(projected, { width: w, height: h, safeTop, safeBottom });
      if (!framing) return;
      Object.assign(camera, framing); camera.updateProjectionMatrix(); controls.update();
      manuallyShown = index as number; manualContext = { flow: latest.current.flow, selected: latest.current.selected, moving: Boolean(latest.current.moving) }; presentedManual = undefined;
      const fitted = points.map(point => point.clone().project(camera));
      host.dataset.connectionFit = JSON.stringify({ index, from: link.from, to: link.to, safeTop, safeBottom,
        minX: Math.min(...fitted.map(p => (p.x * .5 + .5) * w)), maxX: Math.max(...fitted.map(p => (p.x * .5 + .5) * w)),
        minY: Math.min(...fitted.map(p => (-p.y * .5 + .5) * h)), maxY: Math.max(...fitted.map(p => (-p.y * .5 + .5) * h)), zoom: camera.zoom });
      requestRender();
    };
    cleanups.push(() => {
      renderer.domElement.removeEventListener('pointercancel', pointerCancel); renderer.domElement.removeEventListener('lostpointercapture', lostCapture); renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('pointermove', pointerMove);
      host.removeEventListener('queuelab:fit', fit); host.removeEventListener('queuelab:focus', focusSelected); host.removeEventListener('queuelab:show-connection', showConnection); host.removeEventListener('queuelab:cancel-move', cancelEvent); host.removeEventListener('keydown', moveKey); controls.removeEventListener('change', cameraChanged); document.removeEventListener('visibilitychange', visible);
    });
    renderer.domElement.addEventListener('pointercancel', pointerCancel); renderer.domElement.addEventListener('lostpointercapture', lostCapture); renderer.domElement.addEventListener('pointerleave', pointerLeave);
    renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp); renderer.domElement.addEventListener('pointermove', pointerMove);
    host.addEventListener('queuelab:fit', fit); host.addEventListener('queuelab:focus', focusSelected); host.addEventListener('queuelab:show-connection', showConnection); host.addEventListener('queuelab:cancel-move', cancelEvent); host.addEventListener('keydown', moveKey); controls.addEventListener('change', cameraChanged); document.addEventListener('visibilitychange', visible);
    function draw() {
      handle = 0; if (!alive || document.hidden) return;
      try {
      const started = performance.now(), current = latest.current;
      const currentNodes = new Map(current.project.model.nodes.map(node => [node.id, node]));
      for (const plate of capacityPlates) {
        const node = currentNodes.get(plate.id);
        const content = `${String(plate.index + 1).padStart(2, '0')} / ${node?.kind === 'service' && Number.isFinite(node.servers) ? node.servers : '—'}×`;
        if (content !== plate.content) { plate.update(content); plate.content = content; }
      }
      const selectionSet = new Set(current.selectedIds ?? (current.selected ? [current.selected] : []));
      host.dataset.selectedIds = JSON.stringify([...selectionSet]);
      host.dataset.primarySelection = current.selected ?? '';
      const preview = down?.dragging ? down.preview : null;
      moveReadout.hidden = !preview;
      if (preview) {
        moveReadout.textContent = preview.error ?? m.movePreview(preview.ids.length, preview.delta.x.toFixed(2), preview.delta.z.toFixed(2), preview.guides.length > 0);
        host.dataset.movePreview = JSON.stringify({ ids: preview.ids, delta: preview.delta, points: preview.points, error: preview.error });
        host.dataset.alignmentGuides = JSON.stringify(preview.guides);
      }
      for (const [i, line] of guideLines.entries()) {
        const guide = preview?.guides[i]; line.visible = Boolean(guide);
        if (!guide) continue;
        const from = Math.min(guide.from, guide.to) - .7, to = Math.max(guide.from, guide.to) + .7;
        const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
        positions.setXYZ(0, guide.axis === 'x' ? guide.value : from, .14, guide.axis === 'x' ? from : guide.value);
        positions.setXYZ(1, guide.axis === 'x' ? guide.value : to, .14, guide.axis === 'x' ? to : guide.value);
        positions.needsUpdate = true; line.geometry.computeBoundingSphere(); line.computeLineDistances();
      }
      if (manuallyShown !== null && (manualContext?.flow !== current.flow || manualContext?.selected !== current.selected || manualContext?.moving !== Boolean(current.moving))) manuallyShown = null;
      const activeFlow = current.moving ? null : current.flow;
      if (flowDirty || activeFlow !== presentedFlow || manuallyShown !== presentedManual) {
        flowDirty = false;
        presentedFlow = activeFlow; presentedManual = manuallyShown;
        if ((activeFlow?.walk ?? null) !== presentedWalk) {
          presentedWalk = activeFlow?.walk ?? null;
          flowEdges = new Set(presentedWalk?.links.filter(link => {
            const actual = links[link.index];
            return actual?.from === link.from && actual.to === link.to && actual.probability === link.probability;
          }).map(link => link.index) ?? []);
          flowIds = new Set(presentedWalk?.ids ?? []);
          const overviewPositions: number[] = [];
          for (const index of flowEdges) {
            const shape = shapes.get(index); if (shape) overviewPositions.push(...ribbonPositions(shape.points, .065), ...arrowPositions(shape));
          }
          updateOverlay(overview, overviewPositions);
        }
        const requestedConnection = manuallyShown ?? activeFlow?.walk.links[activeFlow.cursor]?.index ?? null;
        currentConnection = requestedConnection !== null && (manuallyShown !== null || flowEdges.has(requestedConnection)) && shapes.has(requestedConnection) ? requestedConnection : null;
        const activeLink = currentConnection === null ? null : links[currentConnection];
        viewedIds = new Set(activeLink ? [activeLink.from, activeLink.to] : []);
        const shape = currentConnection === null ? null : shapes.get(currentConnection);
        updateOverlay(activeConnection, shape ? ribbonPositions(shape.points, .17) : []);
        updateOverlay(activeArrow, shape ? arrowPositions(shape) : []);
        host.dataset.flowGuide = JSON.stringify({ anchor: activeFlow?.walk.anchor ?? null, cursor: activeFlow?.cursor ?? null,
          ids: activeFlow?.walk.ids ?? [], edges: [...flowEdges], viewing: activeLink ? { from: activeLink.from, to: activeLink.to, coincident: shape?.coincident } : null });
        edgeFocus = undefined;
      }
      const neighbors = dense ? new Set(links.filter(link => selectionSet.has(link.from) || selectionSet.has(link.to)).flatMap(link => [link.from, link.to])) : new Set<string>();
      for (const [id, ring] of rings) {
        ring.visible = selectionSet.has(id) || hover === id || neighbors.has(id) || flowIds.has(id) || viewedIds.has(id);
        (ring.material as THREE.MeshBasicMaterial).color.set(selectionSet.has(id) ? theme.accent : theme.secondary);
      }
      const focusIds = [...selectionSet].filter(id => currentNodes.has(id)).sort();
      const selectedEdgeFocus = focusIds.length ? JSON.stringify(focusIds) : null;
      if (edgeFocus !== selectedEdgeFocus) {
        edgeFocus = selectedEdgeFocus;
        const guided = flowEdges.size > 0 || currentConnection !== null;
        const emphasizedIndices = new Set(flowEdges); if (currentConnection !== null) emphasizedIndices.add(currentConnection);
        const nextCoincidenceFocus = guided ? JSON.stringify([...emphasizedIndices].sort((a, b) => a - b)) : selectedEdgeFocus ?? 'all';
        if (coincidentEdges.size && coincidenceFocus !== nextCoincidenceFocus) {
          coincidenceFocus = nextCoincidenceFocus;
          const basePositions: number[] = [], focusPositions: number[] = [];
          for (const index of coincidentEdges) {
            const link = links[index], shape = shapes.get(index)!;
            const emphasized = guided ? emphasizedIndices.has(index) : selectionSet.has(link.from) || selectionSet.has(link.to);
            (emphasized ? focusPositions : basePositions).push(...ribbonPositions(shape.points, .075), ...arrowPositions(shape));
          }
          updateOverlay(baseCoincident, basePositions); updateOverlay(focusedCoincident, focusPositions);
          baseCoincident.material = guided || edgeFocus !== null ? faded(connectionMaterial) : connectionMaterial;
        }
        for (const edge of edgeVisuals) {
          const incident = selectionSet.has(edge.from) || selectionSet.has(edge.to);
          const emphasized = guided ? flowEdges.has(edge.index) || currentConnection === edge.index : incident;
          edge.highlight.visible = !guided && incident;
          for (const item of edge.meshes) item.mesh.material = (guided || edgeFocus !== null) && !emphasized
            ? Array.isArray(item.material) ? item.material.map(faded) : faded(item.material) : item.material;
        }
        host.dataset.highlightedEdges = JSON.stringify((guided ? topology.links.filter(link => flowEdges.has(link.index) || currentConnection === link.index) : edgeVisuals.filter(edge => edge.highlight.visible)).map(({ from, to }) => ({ from, to })));
        host.dataset.dimmedEdgeCount = String(guided ? edgeVisuals.filter(edge => !flowEdges.has(edge.index) && currentConnection !== edge.index).length : edgeFocus !== null ? edgeVisuals.filter(edge => !edge.highlight.visible).length : 0);
      }
      const grouped: Record<string, number> = {}, count = Math.min(current.frame.actors.length, 500); actors.count = count; if (actorTops) actorTops.count = count;
      current.frame.actors.slice(0, count).forEach((actor, index) => {
        const node = currentNodes.get(actor.nodeId), p = visualPoint(actor.nodeId) ?? { x: 0, z: 0 };
        const rank = grouped[`${actor.nodeId}-${actor.state}`] ?? 0; grouped[`${actor.nodeId}-${actor.state}`] = rank + 1;
        const waiting = actor.state === 'waiting';
        const cell = rank % 24, x = waiting ? p.x + (cell % 4) * .27 - .4 : p.x + (rank % 3) * .3 - .3;
        const z = waiting ? p.z + Math.floor(cell / 4) * .27 + .35 : p.z + (node?.kind === 'service' ? .65 : 0);
        const y = world === 'factory' ? (waiting ? .27 + Math.floor(rank / 24) * .23 : .98) : .49 + Math.floor(rank / 24) * .48;
        dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); actors.setMatrixAt(index, dummy.matrix);
        if (actorTops) { dummy.position.y += .116; dummy.updateMatrix(); actorTops.setMatrixAt(index, dummy.matrix); }
      });
      actors.instanceMatrix.needsUpdate = true; if (actorTops) actorTops.instanceMatrix.needsUpdate = true;
      for (const part of parts) {
        const busy = current.frame.busy[part.nodeId] ?? 0;
        const motion = !current.reducedMotion && busy ? Math.sin(current.frame.time * .14) : 0;
        if (part.kind === 'press') part.mesh.position.y = part.rest - Math.max(0, motion) * .19;
        else if (part.kind === 'scanner') part.mesh.position.x = part.rest + motion * .31;
      }
      const projected = corners.map(point => point.clone().project(camera));
      host.dataset.projectedBounds = JSON.stringify({ minX: Math.min(...projected.map(p => p.x)), maxX: Math.max(...projected.map(p => p.x)), minY: Math.min(...projected.map(p => p.y)), maxY: Math.max(...projected.map(p => p.y)) });
      const occupied: LabelRect[] = [];
      // Label callouts avoid projected machine bodies as well as one another.
      const bodyRects = services.map(node => {
        const p = visualPoint(node.id), points: THREE.Vector3[] = [];
        for (const x of [-1.25, 1.25]) for (const y of [.55, world === 'festival' ? 2.55 : 2.4]) for (const z of [-.9, .9]) points.push(new THREE.Vector3(p.x + x, y, p.z + z).project(camera));
        const xs = points.map(v => (v.x * .5 + .5) * host.clientWidth), ys = points.map(v => (-v.y * .5 + .5) * host.clientHeight);
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      });
      const orderedLabels = [...labels].sort((a, b) => Number(current.selected === b.node.id) - Number(current.selected === a.node.id) || Number(selectionSet.has(b.node.id) || hover === b.node.id) - Number(selectionSet.has(a.node.id) || hover === a.node.id) || Number(b.node.kind === 'service') - Number(a.node.kind === 'service'));
      const viewingFrom = currentConnection === null ? null : links[currentConnection]?.from;
      orderedLabels.sort((a, b) => Number(viewedIds.has(b.node.id)) - Number(viewedIds.has(a.node.id)) || Number(viewingFrom === b.node.id) - Number(viewingFrom === a.node.id));
      const paper = current.flow || manuallyShown !== null ? host.closest('.world-workspace')?.querySelector('.flow-guide-panel')?.getBoundingClientRect() : null;
      const labelViewportHeight = paper ? Math.min(host.clientHeight, paper.top - host.getBoundingClientRect().top + (host.clientWidth < 500 ? 56 : 42) - 8) : host.clientHeight;
      for (const label of orderedLabels) {
        const primary = selectionSet.has(label.node.id) || hover === label.node.id;
        const queue = label.node.kind === 'queue' ? current.frame.queues[label.node.id] ?? 0 : current.project.model.nodes.filter(n => n.kind === 'queue' && n.next === label.node.id).reduce((sum, n) => sum + (current.frame.queues[n.id] ?? 0), 0);
        const visibleLabel = primary || viewedIds.has(label.node.id) || (!dense && (label.node.kind === 'service'));
        const connector = connectors.get(label.node.id)!; connector.style.display = 'none';
        label.el.hidden = !visibleLabel; if (!visibleLabel) continue;
        label.el.classList.toggle('is-selected', selectionSet.has(label.node.id)); label.el.classList.toggle('is-hovered', hover === label.node.id);
        label.el.classList.toggle('is-flow-node', viewedIds.has(label.node.id));
        label.el.setAttribute('aria-pressed', String(selectionSet.has(label.node.id)));
        const currentName = currentNodes.get(label.node.id)?.label ?? label.node.label;
        label.el.title = currentName;
        const activeLink = currentConnection === null ? null : links[currentConnection];
        label.el.querySelector('.station-name')!.textContent = viewedIds.has(label.node.id) ? activeLink?.from === label.node.id ? m.viewingFrom(currentName) : m.viewingTo(currentName) : currentName;
        label.el.setAttribute('aria-label', m.select(currentName, stepKindLabels[label.node.kind]));
        label.el.querySelector('.station-queue')!.textContent = queue ? m.waiting(queue) : '';
        label.el.classList.toggle('has-queue', queue > 0);
        const visual = visualPoint(label.node.id);
        const point = new THREE.Vector3(visual.x, label.position.y, visual.z).project(camera), w = host.clientWidth, h = host.clientHeight;
        if (Math.abs(point.x) > 1.1 || Math.abs(point.y) > 1.1) { label.el.hidden = true; continue; }
        const width = label.el.offsetWidth, height = label.el.offsetHeight;
        // The two viewed endpoints get stable top-to-bottom callouts. Their
        // leaders retain exact object association even when equipment overlaps.
        const labelY = paper && viewedIds.has(label.node.id) ? 47 : (-point.y * .5 + .5) * h - height;
        const placed = placeLabel({ x: (point.x * .5 + .5) * w - width / 2, y: labelY, width, height }, { width: w, height: labelViewportHeight }, occupied, bodyRects);
        if (!placed) { label.el.hidden = true; continue; }
        const { x: labelX, y } = placed;
        occupied.push(placed); label.el.style.transform = `translate(${labelX}px,${y}px)`;
        label.el.style.zIndex = primary ? '200' : label.node.kind === 'service' ? '100' : '50';
        label.el.dataset.screenX = String((point.x * .5 + .5) * w); label.el.dataset.screenY = String((-point.y * .5 + .5) * h);
        const anchorX = (point.x * .5 + .5) * w, anchorY = (-point.y * .5 + .5) * h;
        if (Math.hypot(labelX + width / 2 - anchorX, y + height - anchorY) > 9) { connector.style.display = ''; connector.setAttribute('x1', String(labelX + width / 2)); connector.setAttribute('y1', String(y + height)); connector.setAttribute('x2', String(anchorX)); connector.setAttribute('y2', String(anchorY + 6)); connector.classList.toggle('is-selected', current.selected === label.node.id); }
      }
      host.dataset.pickPoints = JSON.stringify(nodes.map(node => { const p = visualPoint(node.id), v = new THREE.Vector3(p.x, node.kind === 'service' ? 1.3 : node.kind === 'queue' ? .2 : .6, p.z + .2).project(camera); return { id: node.id, x: (v.x * .5 + .5) * host.clientWidth, y: (-v.y * .5 + .5) * host.clientHeight }; }));
      host.dataset.camera = JSON.stringify({ position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom, left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom });
      renderer.render(scene, camera); renderCount++;
      host.dataset.renderCount = String(renderCount); host.dataset.renderMs = String(performance.now() - started); host.dataset.drawCalls = String(renderer.info.render.calls);
      host.dataset.rendererResources = JSON.stringify({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 });
      host.dataset.actorCount = String(count); host.dataset.renderPending = 'false'; host.dataset.status = 'ready';
      } catch { fail(); }
    }
    updateConnectivity.current = nextNodes => {
      if (!alive) return;
      try {
        // Build off-scene first. Every allocation is also in the scene registry,
        // so a partial build failure follows the same complete fallback cleanup.
        const next = buildConnections(nextNodes);
        cancelInteraction();
        // Retain the controls object and camera, but cancel its active gesture.
        // Releasing capture alone leaves OrbitControls' two-touch state alive.
        controls.disconnect(); lifetime.releasePointers(); controls.connect(renderer.domElement);
        // Keep controls ahead of the scene handlers, as on initial setup.
        renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerdown', pointerDown);
        renderer.domElement.removeEventListener('pointercancel', pointerCancel); renderer.domElement.addEventListener('pointercancel', pointerCancel);
        disposeConnections(connections);
        connections = next;
        ({ links, topology, shapes, sharedEdges, coincidentEdges, edgeVisuals } = next);
        scene.add(next.group); describeConnections();
        manuallyShown = currentConnection = null; manualContext = null;
        presentedFlow = undefined; presentedWalk = undefined; presentedManual = undefined; flowDirty = true;
        flowIds.clear(); viewedIds.clear(); flowEdges.clear(); edgeFocus = undefined; coincidenceFocus = '';
        for (const overlay of [overview, activeConnection, activeArrow, baseCoincident, focusedCoincident]) updateOverlay(overlay, []);
        delete host.dataset.connectionFit;
        renderer.shadowMap.needsUpdate = true; requestRender();
      } catch { fail(); }
    };
    fit(); requestRender();
    } catch { fail(); }
    return cleanup;
  }, [geometryKey, props.quality, props.resetKey, sceneAttempt]);
  useEffect(() => {
    if (appliedConnectivityKey.current === connectivityKey) return;
    appliedConnectivityKey.current = connectivityKey;
    if (updateConnectivity.current) updateConnectivity.current(props.project.model.nodes);
    // A later link edit can retry a failed scene, just as a reset or geometry edit.
    else setSceneAttempt(attempt => attempt + 1);
  }, [connectivityKey]);
  useEffect(() => { rendererLifetime.current?.renderer.domElement.setAttribute('aria-label', m.interactiveWorldLabel(props.project.name)); }, [props.project.name]);
  // A sealed playback frame, selection or preference invalidates exactly one render.
  // Motion is bounded by frame.time; pausing does not leave a GPU animation loop running.
  useEffect(() => { invalidate.current(); }, [props.frame, props.selected, props.selectedIds, props.reducedMotion, props.moving, props.flow]);
  useEffect(() => { cancelPreview.current(); }, [props.project.id, props.project.revision, props.moving]);
  return <div ref={mount} className={`world-scene ${props.moving ? 'is-moving' : ''}`} data-testid="world-scene">
    {error && <div className="scene-fallback"><h3>{m.yourBrowserCouldNotOpenThe3dView}</h3><p>{m.useTheModelEditorToViewAndEditEvery}</p></div>}
  </div>;
}
