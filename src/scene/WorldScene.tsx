import { assetURL } from '../assetUrl';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Focus, Minus, Plus, RotateCcw } from 'lucide-react';
import type { Point, Project, RunResult } from '../model/types';
import type { WorldFrame } from '../playback';
import type { SelectionIntent } from '../features/editorSelection';
import { beginMoveGesture, type MoveGesture, type LayoutTranslation } from '../features/layoutCommands';
import { sceneLayout } from './graph';
import { capacityCell, capacityLayout, stationCopies, MAX_3D_CELLS } from './capacityFootprint';
import { connectionFraming, connectionShapes, flowTopology, sharedPositionLinks, type FlowWalk } from './flowPresentation';
import { CATALOG_ASSETS, nodeCatalogAssets, type CatalogAsset, type AssetPlacement } from './catalogAssets';
import { initialBrowserAssetURL, isDetailInspection } from './browserAssets';
import { CatalogStore } from './CatalogStore';
import { AnimatedPeople } from './AnimatedPeople';
import { PeopleMotion, type PersonTarget } from './peopleMotion';
import { operatorTargets } from './operatorLayout';
import { WorldSurroundings } from './WorldSurroundings';
import { placeLabel, type LabelRect } from './labelLayout';
import { stepKindLabels } from '../ui/messages/labels';
import { worldSceneMessages as m } from '../ui/messages/WorldScene';
import { facilityMessages as fm } from '../ui/messages/facility';
import { findLibraryAsset } from '../catalog/registry';
import { LIBRARY_DRAG_TYPE, type LibraryDrop } from '../catalog/drag';
import { FacilityLayer } from './FacilityLayer';
import './workspaceScene.css';

export { placeLabel } from './labelLayout';
interface Props {
  project: Project; frame: WorldFrame; selected: string | null; selectedIds?: string[];
  reducedMotion: boolean; moving?: boolean; quality?: 'high' | 'low'; resetKey?: number; editable?: boolean;
  onSelect: (id: string | null, intent?: SelectionIntent) => void;
  onMove?: (ids: string[], delta: Point) => void;
  onCapacityChange?: (id: string, delta: number) => void; onEditNode?: (id: string) => void;
  flow?: { walk: FlowWalk; cursor: number } | null;
  playing?: boolean; playbackSpeed?: number; replayUntil?: number; runKey?: string; seekEpoch?: number; result?: RunResult | null;
  onMoveStart?: () => void;
  selectedFacilityId?: string | null;
  onSelectFacility?: (id: string) => void;
  onMoveFacility?: (id: string, point: Point) => void;
  onDropAsset?: (payload: LibraryDrop, point: Point) => void;
}
type Disposable = { dispose(): void };
type Lifetime = { renderer: THREE.WebGLRenderer; store: CatalogStore; dispose(): void };
type CapacityImpostor = { mesh: THREE.InstancedMesh; target: THREE.WebGLRenderTarget; direction: THREE.Vector3; center: THREE.Vector3; width: number; height: number; dirty: boolean; environment: THREE.Texture | null };
type VisualNode = { group: THREE.Group; art: THREE.Group; copies: THREE.Group[]; label: HTMLButtonElement; name: HTMLSpanElement; badge: HTMLSpanElement; connector: SVGLineElement; pin: SVGCircleElement; ring: THREE.Mesh; loaded: boolean; count: number; triangles: number; impostor?: CapacityImpostor; footprint?: THREE.LineSegments };
type SavedView = { projectId: string; position: THREE.Vector3; target: THREE.Vector3; zoom: number; left: number; right: number; top: number; bottom: number; manual: boolean };

/** Only return a screen point which the real input hit test accepts. */
export function visiblePickPoint(bounds: THREE.Box3, camera: THREE.Camera, viewport: { width: number; height: number }, accepts: (x: number, y: number) => boolean): { x: number; y: number } | null {
  const points: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z).project(camera));
  if (points.every(p => p.z < -1 || p.z > 1)) return null;
  const minX = Math.max(1, Math.min(...points.map(p => (p.x * .5 + .5) * viewport.width))), maxX = Math.min(viewport.width - 1, Math.max(...points.map(p => (p.x * .5 + .5) * viewport.width)));
  const minY = Math.max(1, Math.min(...points.map(p => (-p.y * .5 + .5) * viewport.height))), maxY = Math.min(viewport.height - 1, Math.max(...points.map(p => (-p.y * .5 + .5) * viewport.height)));
  if (minX > maxX || minY > maxY) return null;
  for (const fy of [.5, .02, .98, .25, .75, .1, .9]) for (const fx of [.5, .25, .75, .02, .98, .1, .9]) {
    const x = minX + (maxX - minX) * fx, y = minY + (maxY - minY) * fy;
    if (accepts(x, y)) return { x, y };
  }
  return null;
}

/** Only sourced models are physical objects. Lines, rings and move guides are editor annotations. */
export function WorldScene(props: Props) {
  const mount = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const lifetime = useRef<Lifetime | null>(null), invalidate = useRef<() => void>(() => {});
  const cancelGesture = useRef<() => void>(() => {});
  const savedView = useRef<SavedView | null>(null), fitProject = useRef<(id: string) => void>(() => {});
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const retryAssets = useRef<() => void>(() => setAttempt(value => value + 1));
  const [contextFailed, setContextFailed] = useState(false);
  const geometryKey = JSON.stringify([props.project.world, props.project.model.nodes.map(node => [node.id, node.kind, node.samplingId]), props.project.facility?.nodeAssets, props.project.facility?.scenery]);

  useEffect(() => {
    const host = mount.current; if (!host) return;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
      renderer.domElement.dataset.testid = 'world-canvas'; renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('role', 'img');
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
      renderer.setClearColor('#dedacf'); renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      const store = new CatalogStore(); let disposed = false;
      const instance: Lifetime = { renderer, store, dispose() {
        if (disposed) return; disposed = true; cancelGesture.current(); store.dispose();
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
        if (lifetime.current === instance) lifetime.current = null;
      } };
      lifetime.current = instance; host.prepend(renderer.domElement);
      setContextFailed(false);
      return () => instance.dispose();
    } catch { setContextFailed(true); setFailed(true); }
  }, [attempt]);

  useEffect(() => {
    if (!mount.current || !lifetime.current) return;
    const host = mount.current, owned = lifetime.current;
    const { renderer, store } = owned, canvas = renderer.domElement;
    let viewProjectId = props.project.id;
    let manualView = savedView.current?.projectId === viewProjectId && savedView.current.manual;
    let alive = true, scheduled = 0, renderCount = 0, pending = 0, loadErrors = 0;
    const resources = new Set<Disposable>(), cleanups: (() => void)[] = [];
    const own = <T extends Disposable>(value: T): T => { resources.add(value); return value; };
    const world = props.project.world, scene = new THREE.Scene();
    const people = new AnimatedPeople(scene), peopleMotion = new PeopleMotion(), loadedVariants = new Set<number>();
    const operatorAssignments = new Map<string, string>();
    let motionInitialized = false, motionRun = '', motionEpoch = -1, motionLayout = props.project.layout;
    let lastPlaying = false, settleUntil = 0, motionClock = -Infinity;
    let activitySeconds = 0, activityTick: number | null = null;
    let traceSnapshot: RunResult | null | undefined;
    const entities = new Map<string, RunResult['entities'][number]>(), completeLocations = new Map<string, string>();
    const camera = new THREE.OrthographicCamera(-16, 16, 12, -12, .1, 3000);
    const direction = new THREE.Vector3(16, 34, 43).normalize();
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false; controls.enableRotate = true; controls.screenSpacePanning = false;
    controls.minPolarAngle = .18; controls.maxPolarAngle = Math.PI / 2.15;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN; controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.minZoom = .65; controls.maxZoom = 6;
    renderer.setPixelRatio(Math.min(devicePixelRatio, props.quality === 'low' ? 1 : 1.6));
    renderer.shadowMap.enabled = props.quality !== 'low' && props.project.model.nodes.length <= 30;
    renderer.shadowMap.needsUpdate = true;
    renderer.setClearColor(world === 'festival' ? '#d6dfc5' : world === 'factory' ? '#dedacf' : '#dce0d3');
    renderer.toneMappingExposure = 1;
    const hemi = new THREE.HemisphereLight('#fff8e9', '#a3ada0', .92); scene.add(hemi);
    const sunlight = new THREE.DirectionalLight(world === 'festival' ? '#ffdfad' : '#fff0d4', 1.8); sunlight.position.set(-12, 25, 18);
    sunlight.castShadow = renderer.shadowMap.enabled; sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.camera.left = -40; sunlight.shadow.camera.right = 40;
    sunlight.shadow.camera.top = 40; sunlight.shadow.camera.bottom = -40;
    sunlight.shadow.camera.far = 120; sunlight.shadow.normalBias = .025; sunlight.shadow.radius = 3;
    own(sunlight.shadow); scene.add(sunlight);
    const fill = new THREE.DirectionalLight('#e4eee7', .5); fill.position.set(15, 12, -8); scene.add(fill);
    const environmentURL = assetURL('/assets/environment/studio-small-09.hdr');
    let environmentState: 'idle' | 'pending' | 'ready' | 'failed' = 'idle';
    let environmentTarget: THREE.WebGLRenderTarget | null = null;
    host.dataset.environment = 'analytic-lighting';
    const detailTemplates = new Map<string, THREE.Group>(), detailPending = new Set<string>(), detailFailures = new Set<string>();
    type PlacedAsset = { definition: Pick<CatalogAsset, 'file' | 'size' | 'turn' | 'metricScale'>; placement: Omit<AssetPlacement, 'asset'>; lod?: THREE.Group; model?: THREE.Group; detail: boolean };
    const foreground = new Map<string, PlacedAsset[]>();
    const visuals = new Map<string, VisualNode>(), pickables: THREE.Mesh[] = [], pickCenters = new Map<string, THREE.Mesh>();
    const preview = new Map<string, Point>(), pickedSources = new Set<string>();
    const retainedURLs = new Set<string>();
    const retainedModel = (url: string) => { if (retainedURLs.has(url)) return store.load(url); retainedURLs.add(url); return store.retain(url); };
    const facilities = new FacilityLayer(scene, store, () => { renderer.shadowMap.needsUpdate = true; status(); requestRender(); }, () => setFailed(true));
    let facilityExtentKey = '';
    let facilityShadowRevision = -1;
    let hoveredId: string | null = null;
    let presentation = capacityLayout(props.project.model.nodes, sceneLayout(props.project));
    let layout = presentation.positions, extent = presentation.extent, topologyKey = '', currentConnection: number | null = null;
    let capacityKey = JSON.stringify(props.project.model.nodes.map(node => [node.id, stationCopies(node)]));
    let viewedIds = new Set<string>(), viewingFrom: string | null = null;
    let manualContext: { selected: string | null; topology: string; cursor: number | undefined } | null = null;
    let edgeGroup = new THREE.Group(), edgeOwned: Disposable[] = [];
    scene.add(edgeGroup);
    let floor: THREE.Group | null = null, floorDimensions = new THREE.Vector3(1, 1, 1);
    const svgNS = 'http://www.w3.org/2000/svg';
    const connectorLayer = document.createElementNS(svgNS, 'svg'); connectorLayer.classList.add('scene-label-connectors'); connectorLayer.setAttribute('aria-hidden', 'true'); host.appendChild(connectorLayer);
    const labelLayer = document.createElement('div'); labelLayer.className = 'scene-labels scene-label-layer'; host.appendChild(labelLayer);
    const readout = document.createElement('div'); readout.className = 'scene-move-readout'; readout.hidden = true; host.appendChild(readout);
    const loading = document.createElement('div'); loading.className = 'scene-loading'; loading.setAttribute('role', 'status'); host.appendChild(loading);
    let measureLabels = true, labelMeasureVersion = 0, labelPlacementKey = '', pickPointsKey = '', overlayVersion = 0;
    let labelSizes = new Map<string, { width: number; height: number }>();
    let previousPeopleShadows = '';
    const movingOverlays = new Set<Element>();
    const overlayMotions = new Map<Element, Set<string>>();
    let overlayIntersection: IntersectionObserver | null = null, overlayRootMargin = '';
    const overlayRects = new WeakMap<Element, DOMRect>();
    setFailed(false); host.dataset.status = 'loading'; host.dataset.world = world; host.dataset.assetPolicy = 'catalog-first';
    for (const key of ['pickPoints', 'flowGuide', 'connectionFit', 'alignmentGuides']) delete host.dataset[key];
    function requestRender() {
      if (alive && !scheduled && !document.hidden) { host.dataset.renderPending = 'true'; scheduled = requestAnimationFrame(draw); }
    }
    invalidate.current = requestRender;
    const pointFor = (id: string) => layout[id];
    const inspectionScale = () => Math.max(1, extent.width / 40, extent.depth / 28);
    function status() {
      const errors = loadErrors + detailFailures.size + facilities.stats().failed, remaining = pending + facilities.stats().pending;
      const unavailable = errors > 0 || renderer.getContext().isContextLost();
      setFailed(unavailable);
      host.dataset.pendingAssets = String(remaining); host.dataset.assetErrors = String(errors);
      host.dataset.status = remaining ? 'loading' : unavailable ? 'partial' : 'ready';
      host.dataset.catalogAssets = JSON.stringify([...pickedSources]);
      loading.hidden = remaining === 0; loading.textContent = `${fm.loading} · ${remaining}`;
    }
    function load(url: string, accept: (model: THREE.Group) => void) {
      url = initialBrowserAssetURL(url);
      pending++; status();
      retainedModel(url).then(model => {
        if (!alive) return;
        pickedSources.add(url); accept(model); renderer.shadowMap.needsUpdate = true;
      }).catch(() => { if (alive) { loadErrors++; setFailed(true); } }).finally(() => {
        if (!alive) return; pending--; status(); requestRender();
      });
    }
    function loadDetail(url: string) {
      if (detailPending.has(url) || detailTemplates.has(url) || detailFailures.has(url)) return;
      detailPending.add(url); pending++; status();
      retainedModel(url).then(template => {
        if (!alive) return;
        detailTemplates.set(url, template); pickedSources.add(url);
      }).catch(() => { if (alive) { detailFailures.add(url); setFailed(true); } }).finally(() => {
        if (!alive) return;
        detailPending.delete(url); pending--; status(); requestRender();
      });
    }
    function loadEnvironment() {
      if (environmentState !== 'idle') return;
      environmentState = 'pending'; pending++; status();
      new HDRLoader().load(environmentURL, texture => {
        if (!alive) { texture.dispose(); return; }
        const environment = new THREE.PMREMGenerator(renderer);
        try {
          environmentTarget = own(environment.fromEquirectangular(texture));
          environmentState = 'ready';
        } catch { environmentState = 'failed'; detailFailures.add(environmentURL); setFailed(true); }
        finally { texture.dispose(); environment.dispose(); pending--; status(); requestRender(); }
      }, undefined, () => {
        if (!alive) return;
        environmentState = 'failed'; detailFailures.add(environmentURL); pending--; setFailed(true); status(); requestRender();
      });
    }
    retryAssets.current = () => {
      facilities.retry();
      if (loadErrors || renderer.getContext().isContextLost()) { setAttempt(value => value + 1); return; }
      detailFailures.clear(); if (environmentState === 'failed') environmentState = 'idle';
      setFailed(false); status(); requestRender();
    };
    function modelCopy(template: THREE.Group, def: Pick<CatalogAsset, 'size' | 'turn' | 'metricScale'>) {
      const model = template.clone(true), box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      const normalizer = new THREE.Group(), scale = def.metricScale ?? def.size / Math.max(size.x, size.y, size.z, .001);
      model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z)); normalizer.add(model);
      normalizer.scale.setScalar(scale); normalizer.rotation.y = def.turn ?? 0;
      model.traverse(object => { if ((object as THREE.Mesh).isMesh) { const mesh = object as THREE.Mesh; mesh.castShadow = true; mesh.receiveShadow = true; } });
      return normalizer;
    }
    const surroundings = own(new WorldSurroundings(scene, world, extent, load, props.project.facility?.scenery !== false));
    function addProxy(group: THREE.Group, id: string) {
      group.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(group).applyMatrix4(group.matrixWorld.clone().invert());
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1.6, 0, -.6), new THREE.Vector3(1.6, 2.7, 4.0));
      const size = bounds.getSize(new THREE.Vector3());
      const proxy = new THREE.Mesh(own(new THREE.BoxGeometry(Math.max(.15, size.x), Math.max(.15, size.y), Math.max(.15, size.z))), own(new THREE.MeshBasicMaterial({ visible: false })));
      proxy.position.copy(bounds.getCenter(new THREE.Vector3())); proxy.userData.nodeId = id; group.add(proxy); pickables.push(proxy);
      if (!pickCenters.has(id)) pickCenters.set(id, proxy);
    }
    function removeProxies(id: string) {
      for (let i = pickables.length - 1; i >= 0; i--) {
        const proxy = pickables[i]; if (proxy.userData.nodeId !== id) continue;
        proxy.removeFromParent(); pickables.splice(i, 1);
        const owned = [proxy.geometry, ...(Array.isArray(proxy.material) ? proxy.material : [proxy.material])];
        for (const resource of owned) if (resources.delete(resource)) resource.dispose();
        if ((proxy as THREE.InstancedMesh).isInstancedMesh && resources.delete(proxy as THREE.InstancedMesh)) (proxy as THREE.InstancedMesh).dispose();
      }
      pickCenters.delete(id);
    }
    function rebuildCopies(id: string, visual: VisualNode) {
      removeProxies(id);
      for (const copy of visual.copies.slice(1)) copy.removeFromParent();
      visual.copies = [visual.art];
      visual.triangles = 0;
      visual.art.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) visual.triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3; });
      if (visual.impostor) visual.impostor.dirty = true;
      visual.loaded = true; visual.count = -1; renderer.shadowMap.needsUpdate = true;
    }
    function drawImpostor(visual: VisualNode) {
      let value = visual.impostor;
      if (!value) {
        const target = own(new THREE.WebGLRenderTarget(256, 256)); target.texture.colorSpace = THREE.LinearSRGBColorSpace;
        const geometry = own(new THREE.PlaneGeometry(1, 1)), material = own(new THREE.MeshBasicMaterial({ map: target.texture, alphaTest: .03, side: THREE.DoubleSide }));
        const mesh = own(new THREE.InstancedMesh(geometry, material, 1000)); mesh.frustumCulled = false; mesh.count = 0; visual.group.add(mesh);
        value = visual.impostor = { mesh, target, direction: new THREE.Vector3(), center: new THREE.Vector3(), width: 1, height: 1, dirty: true, environment: null };
      }
      const direction = camera.position.clone().sub(controls.target).normalize();
      if (!value.dirty && value.direction.angleTo(direction) < .015 && value.environment === scene.environment) return value;
      const source = visual.art.clone(true); source.position.set(0, 0, 0);
      const capture = new THREE.Scene(); capture.add(source); capture.environment = scene.environment; capture.environmentIntensity = scene.environmentIntensity;
      capture.add(hemi.clone(), fill.clone()); const light = sunlight.clone(); light.castShadow = false; capture.add(light);
      const bounds = new THREE.Box3().setFromObject(source); bounds.getCenter(value.center);
      const captureCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 200);
      captureCamera.position.copy(value.center).addScaledVector(direction, 30); captureCamera.lookAt(value.center); captureCamera.updateMatrixWorld(true);
      const projected: THREE.Vector3[] = [];
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) projected.push(new THREE.Vector3(x, y, z).applyMatrix4(captureCamera.matrixWorldInverse));
      value.width = Math.max(.1, Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x))) * 1.02;
      value.height = Math.max(.1, Math.max(...projected.map(p => p.y)) - Math.min(...projected.map(p => p.y))) * 1.02;
      captureCamera.left = -value.width / 2; captureCamera.right = value.width / 2; captureCamera.top = value.height / 2; captureCamera.bottom = -value.height / 2; captureCamera.updateProjectionMatrix();
      const oldTarget = renderer.getRenderTarget(), oldColor = renderer.getClearColor(new THREE.Color()), oldAlpha = renderer.getClearAlpha(), oldShadows = renderer.shadowMap.enabled;
      try { renderer.setRenderTarget(value.target); renderer.setClearColor(0, 0); renderer.shadowMap.enabled = false; renderer.render(capture, captureCamera); }
      finally { renderer.setRenderTarget(oldTarget); renderer.setClearColor(oldColor, oldAlpha); renderer.shadowMap.enabled = oldShadows; }
      value.direction.copy(direction); value.environment = scene.environment; value.dirty = false;
      return value;
    }
    function syncCapacity(id: string, visual: VisualNode, count: number, realCount: number) {
      if (!visual.loaded) return;
      if (visual.count !== count || visual.copies.length !== realCount) {
        removeProxies(id);
        for (const copy of visual.copies.slice(1)) copy.removeFromParent();
        visual.copies = [visual.art];
        for (let i = 1; i < realCount; i++) { const copy = visual.art.clone(true); visual.group.add(copy); visual.copies.push(copy); }
        visual.copies.forEach((copy, i) => { const p = capacityCell(i); copy.position.set(p.x, 0, p.z); });
        const bounds = new THREE.Box3().setFromObject(visual.art).applyMatrix4(visual.art.matrixWorld.clone().invert());
        if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1.3, 0, -1), new THREE.Vector3(1.3, 2, 1));
        const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
        const proxy = new THREE.InstancedMesh(own(new THREE.BoxGeometry(Math.max(.15, size.x), Math.max(.15, size.y), Math.max(.15, size.z))), own(new THREE.MeshBasicMaterial({ visible: false })), count);
        own(proxy); const matrix = new THREE.Matrix4();
        for (let i = 0; i < count; i++) { const p = capacityCell(i); matrix.makeTranslation(p.x + center.x, center.y, p.z + center.z); proxy.setMatrixAt(i, matrix); }
        proxy.instanceMatrix.needsUpdate = true; proxy.userData.nodeId = id; visual.group.add(proxy); pickables.push(proxy); pickCenters.set(id, proxy);
        if (visual.footprint) { visual.footprint.removeFromParent(); resources.delete(visual.footprint.geometry); visual.footprint.geometry.dispose(); }
        const points: THREE.Vector3[] = [];
        if (count > 1) for (let i = 0; i < count; i++) {
          const p = capacityCell(i), corners = [[-1.6, -1.8], [1.6, -1.8], [1.6, 1.8], [-1.6, 1.8]];
          for (let j = 0; j < 4; j++) { const a = corners[j], b = corners[(j + 1) % 4]; points.push(new THREE.Vector3(p.x + a[0], .015, p.z + a[1]), new THREE.Vector3(p.x + b[0], .015, p.z + b[1])); }
        }
        const geometry = own(new THREE.BufferGeometry().setFromPoints(points));
        const material = visual.footprint?.material ?? own(new THREE.LineBasicMaterial({ color: '#879990', transparent: true, opacity: .55 }));
        visual.footprint = new THREE.LineSegments(geometry, material); visual.group.add(visual.footprint);
        visual.footprint.visible = count > 1;
        visual.count = count; renderer.shadowMap.needsUpdate = true;
      }
      const extra = count - realCount;
      if (extra > 0 && visual.triangles > 0) {
        const impostor = drawImpostor(visual), matrix = new THREE.Matrix4(), scale = new THREE.Vector3(impostor.width, impostor.height, 1);
        for (let i = realCount; i < count; i++) { const p = capacityCell(i); matrix.compose(new THREE.Vector3(p.x + impostor.center.x, impostor.center.y, p.z + impostor.center.z), camera.quaternion, scale); impostor.mesh.setMatrixAt(i - realCount, matrix); }
        impostor.mesh.count = extra; impostor.mesh.instanceMatrix.needsUpdate = true;
      } else if (visual.impostor) visual.impostor.mesh.count = 0;
    }
    function syncForeground(id: string, visual: VisualNode, inspect: boolean) {
      let changed = false;
      for (const part of foreground.get(id) ?? []) {
        if (!part.lod) continue;
        const file = part.definition.file, supportsDetail = initialBrowserAssetURL(file) !== file;
        if (inspect && supportsDetail) loadDetail(file);
        const detail = inspect && supportsDetail && detailTemplates.has(file);
        const template = detail ? detailTemplates.get(file)! : part.lod;
        if (part.model && part.detail === detail) continue;
        part.model?.removeFromParent();
        const model = modelCopy(template, part.definition), placement = part.placement;
        model.position.set(placement.x ?? 0, placement.y ?? 0, placement.z ?? 0);
        model.rotation.y += placement.turn ?? 0; model.scale.multiplyScalar(placement.scale ?? 1);
        visual.art.add(model); part.model = model; part.detail = detail; changed = true;
      }
      if (changed) rebuildCopies(id, visual);
    }
    const nodes = props.project.model.nodes, services = nodes.filter(node => node.kind === 'service');
    for (const node of nodes) {
      const group = new THREE.Group(), art = new THREE.Group(); group.add(art); scene.add(group);
      const ring = new THREE.Mesh(own(new THREE.RingGeometry(node.kind === 'service' ? 1.7 : 1.1, node.kind === 'service' ? 1.83 : 1.23, 48)), own(new THREE.MeshBasicMaterial({ color: '#658f42', transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false })));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .04; group.add(ring);
      const label = document.createElement('button'); label.type = 'button'; label.className = `station-label scene-node-${node.kind}`; label.dataset.stationId = node.id;
      const name = document.createElement('span'), badge = document.createElement('span'); name.className = 'station-name'; badge.className = 'station-count'; badge.hidden = true; label.append(name, badge);
      const connector = document.createElementNS(svgNS, 'line'), pin = document.createElementNS(svgNS, 'circle'); pin.setAttribute('r', '2.5'); connectorLayer.append(connector, pin);
      label.addEventListener('click', event => latest.current.onSelect(node.id, event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : latest.current.selectedIds?.includes(node.id) ? 'inspect' : 'single'));
      label.addEventListener('pointerenter', () => { hoveredId = node.id; requestRender(); });
      label.addEventListener('pointerleave', () => { hoveredId = null; requestRender(); });
      labelLayer.appendChild(label);
      const visual: VisualNode = { group, art, copies: [art], label, name, badge, connector, pin, ring, loaded: false, count: -1, triangles: 0 }; visuals.set(node.id, visual);
      const override = props.project.facility?.nodeAssets[node.id], library = override && findLibraryAsset(override.assetId);
      const placements = nodeCatalogAssets(world, node, services.findIndex(service => service.id === node.id));
      const parts: PlacedAsset[] = override ? library && library.version === override.assetVersion ? [{ definition: { file: library.file, size: 3, metricScale: 1 }, placement: { turn: override.rotation * Math.PI / 180, scale: override.scale }, detail: false }] : [] : placements.map(placement => ({ definition: CATALOG_ASSETS[placement.asset], placement, detail: false }));
      if (override && !parts.length) { loadErrors++; setFailed(true); }
      foreground.set(node.id, parts);
      if (!parts.length) { addProxy(art, node.id); visual.loaded = true; }
      if (node.kind === 'queue' && parts.length) { const zone = new THREE.Group(); art.add(zone); addProxy(zone, node.id); }
      for (const part of parts) {
        load(part.definition.file, template => {
          part.lod = template;
          syncForeground(node.id, visual, false);
        });
      }
    }
    load(CATALOG_ASSETS.floor.file, template => {
      floor = template.clone(true); floorDimensions = new THREE.Box3().setFromObject(floor).getSize(new THREE.Vector3());
      const materials = new Map<THREE.Material, THREE.Material>();
      const adapt = (source: THREE.Material) => {
        let material = materials.get(source); if (material) return material;
        material = own(source.clone()); materials.set(source, material);
        const surface = material as THREE.MeshStandardMaterial;
        if (surface.isMeshStandardMaterial) { surface.color.lerp(new THREE.Color(world === 'festival' ? '#c8bb9e' : world === 'factory' ? '#ddd4bd' : '#e6dac5'), .7); surface.roughness = .96; surface.metalness = 0; }
        return material;
      };
      floor.traverse(object => {
        if (!(object as THREE.Mesh).isMesh) return;
        const mesh = object as THREE.Mesh; mesh.receiveShadow = true;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(adapt) : adapt(mesh.material);
      }); scene.add(floor);
    });
    type ActorBatch = { mesh: THREE.InstancedMesh; variant: number };
    const actorBatches: ActorBatch[] = [], dummy = new THREE.Object3D();
    function actorTemplate(template: THREE.Group, variant: number, sizing?: { height?: number; size?: number }) {
      const idle = template.animations.find(clip => clip.name.split('|').at(-1)?.toLowerCase() === 'idle');
      const mixer = idle ? new THREE.AnimationMixer(template) : null;
      if (idle && mixer) { mixer.clipAction(idle).play(); mixer.setTime(.2); }
      template.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(template), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      const scale = sizing?.size ? sizing.size / Math.max(size.x, size.y, size.z) : (sizing?.height ?? 2.4) / Math.max(size.y, .01);
      const transform = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
      template.traverse(object => {
        if (!(object as THREE.Mesh).isMesh) return;
        for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (!parent.visible) return;
        const source = object as THREE.Mesh, geometry = own(source.geometry.clone());
        if ((source as THREE.SkinnedMesh).isSkinnedMesh) {
          const skinned = source as THREE.SkinnedMesh; skinned.skeleton.update(); const positions = geometry.attributes.position;
          for (let i = 0; i < positions.count; i++) { const vector = new THREE.Vector3().fromBufferAttribute(positions, i); skinned.applyBoneTransform(i, vector); positions.setXYZ(i, vector.x, vector.y, vector.z); }
          geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight'); geometry.computeVertexNormals();
        }
        geometry.applyMatrix4(source.matrixWorld); geometry.applyMatrix4(transform);
        const mesh = own(new THREE.InstancedMesh(geometry, source.material, 500)); mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = props.quality !== 'low'; scene.add(mesh); actorBatches.push({ mesh, variant });
      });
      mixer?.stopAllAction(); mixer?.uncacheRoot(template);
    }
    if (world === 'factory') {
      load(CATALOG_ASSETS.carton.file.replace('.glb', '-actor.glb'), template => { actorTemplate(template, 0, { size: .3 }); actorTemplate(template, 4, { size: .3 }); });
      load('/assets/characters/worker.glb', template => { people.addVariant(0, template, 2.4); loadedVariants.add(0); });
      load('/assets/characters/worker-female.glb', template => { people.addVariant(1, template, 2.4); loadedVariants.add(1); });
    } else {
      load('/assets/characters/casual-character.glb', template => { people.addVariant(0, template, 2.4); loadedVariants.add(0); });
      load('/assets/characters/visitor-female.glb', template => { people.addVariant(1, template, 2.4); loadedVariants.add(1); });
    }
    function artHeight(project: Project) {
      return Math.max(4.8, ...(project.facility?.objects ?? []).map(object => (object.y ?? 0) + (findLibraryAsset(object.assetId)?.dimensions[1] ?? 0) * object.scale), ...Object.values(project.facility?.nodeAssets ?? {}).map(reference => (findLibraryAsset(reference.assetId)?.dimensions[1] ?? 0) * reference.scale));
    }
    function facilityExtent(project: Project) {
      const base = facilities.extent(presentation.extent, project.facility?.objects ?? []);
      let padding = 0;
      for (const reference of Object.values(project.facility?.nodeAssets ?? {})) {
        const dimensions = findLibraryAsset(reference.assetId)?.dimensions;
        const angle = reference.rotation * Math.PI / 180;
        if (dimensions) padding = Math.max(padding, Math.max(Math.abs(Math.cos(angle)) * dimensions[0] + Math.abs(Math.sin(angle)) * dimensions[2], Math.abs(Math.sin(angle)) * dimensions[0] + Math.abs(Math.cos(angle)) * dimensions[2]) * reference.scale / 2 - 2.2);
      }
      return { minX: base.minX - padding, maxX: base.maxX + padding, minZ: base.minZ - padding, maxZ: base.maxZ + padding, width: base.width + padding * 2, depth: base.depth + padding * 2, x: base.x, z: base.z };
    }
    function frameExtent(preserveDirection: boolean) {
      presentation = capacityLayout(latest.current.project.model.nodes, sceneLayout(latest.current.project)); layout = presentation.positions; extent = facilityExtent(latest.current.project);
      surroundings.update(extent, camera);
      const width = host.clientWidth, height = host.clientHeight; if (!width || !height) return;
      const framed = surroundings.viewExtent(), target = new THREE.Vector3(framed.x, .5, framed.z);
      const viewDirection = preserveDirection ? camera.position.clone().sub(controls.target).normalize() : direction;
      const maxHeight = artHeight(latest.current.project), distance = Math.max(160, Math.hypot(framed.width, framed.depth) * 1.5, maxHeight * 2);
      controls.target.copy(target); camera.position.copy(target).addScaledVector(viewDirection, distance); camera.far = Math.max(3000, distance * 3); camera.lookAt(target); camera.updateMatrixWorld(true);
      const corners: THREE.Vector3[] = [];
      for (const x of [framed.minX - 1.5, framed.maxX + 1.5]) for (const y of [-.2, maxHeight]) for (const z of [framed.minZ - 1.5, framed.maxZ]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
      const viewWidth = Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x));
      const viewHeight = Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y));
      const aspect = width / height, vertical = Math.max(viewHeight / .9, viewWidth / (aspect * .94));
      // Center the projected diorama, including the cutaway walls. Using only
      // the floor's world-space midpoint leaves a large empty foreground.
      const centerX = (Math.min(...corners.map(p => p.x)) + Math.max(...corners.map(p => p.x))) / 2;
      const centerY = (Math.min(...corners.map(p => p.y)) + Math.max(...corners.map(p => p.y))) / 2;
      camera.left = centerX - vertical * aspect / 2; camera.right = centerX + vertical * aspect / 2; camera.top = centerY + vertical / 2; camera.bottom = centerY - vertical / 2;
      camera.zoom = 1; camera.updateProjectionMatrix(); controls.update(); requestRender();
    }
    function fit() { manualView = false; frameExtent(false); }
    const resize = new ResizeObserver(() => {
      if (!alive || !host.clientWidth || !host.clientHeight) return;
      const width = host.clientWidth, height = host.clientHeight, previous = renderer.getSize(new THREE.Vector2());
      if (previous.x === width && previous.y === height) return;
      measureLabels = true;
      renderer.setSize(width, height);
      // A user-selected view survives a dock/viewport resize. In automatic
      // Fit mode the whole diorama should use the newly available space.
      if (!manualView) { frameExtent(true); return; }
      // Opening a dock or resizing a viewport is not a Fit command. Preserve
      // the user's view and vertical world scale; only the aspect changes.
      const vertical = camera.top - camera.bottom, center = (camera.left + camera.right) / 2;
      camera.left = center - vertical * width / height / 2; camera.right = center + vertical * width / height / 2;
      camera.updateProjectionMatrix(); requestRender();
    }); resize.observe(host);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let facilityDown: { id: string; pointer: number; x: number; y: number; start: Point; origin: THREE.Vector3; point: Point; dragging: boolean; projectId: string; revision: number } | null = null;
    let down: { x: number; y: number; id: number; node: string | null; origin: THREE.Vector3; toggle: boolean; person: boolean; gesture: MoveGesture | null; ids: string[]; dragging: boolean } | null = null;
    function pickAt(x: number, y: number) {
      pointer.set(x, y); raycaster.setFromCamera(pointer, camera);
      const objectHit = raycaster.intersectObjects(pickables, false).find(result => {
        for (let object: THREE.Object3D | null = result.object; object; object = object.parent) if (!object.visible) return false;
        return true;
      });
      const person = people.pick(raycaster);
      const facility = facilities.pick(raycaster);
      if (facility && (!objectHit || facility.distance < objectHit.distance) && (!person || facility.distance < person.distance)) return { id: facility.id, person: false, facility: true };
      if (person && (!objectHit || person.distance < objectHit.distance)) return { id: person.person.nodeId, person: true, facility: false };
      return objectHit ? { id: objectHit.object.userData.nodeId as string, person: false, facility: false } : null;
    }
    function hit(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      return pickAt((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    }
    function cancel() {
      if (facilityDown) {
        const finished = facilityDown; facilityDown = null; facilities.setPreview(finished.id, null);
        if (canvas.hasPointerCapture(finished.pointer)) canvas.releasePointerCapture(finished.pointer);
      }
      if (down && canvas.hasPointerCapture(down.id)) canvas.releasePointerCapture(down.id);
      down?.gesture?.cancel(); down = null; preview.clear(); controls.enabled = true; readout.hidden = true;
      delete host.dataset.movePreview; delete host.dataset.alignmentGuides; renderer.shadowMap.needsUpdate = true; requestRender();
    }
    cancelGesture.current = cancel;
    function pointerDown(event: PointerEvent) {
      if (event.button !== 0 || down || facilityDown) return;
      const picked = hit(event), node = picked?.id ?? null, origin = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(ground, origin)) return;
      if (picked?.facility) {
        const object = latest.current.project.facility?.objects.find(object => object.id === picked.id);
        if (!object) return;
        facilityDown = { id: object.id, pointer: event.pointerId, x: event.clientX, y: event.clientY, start: { x: object.x, z: object.z }, point: { x: object.x, z: object.z }, origin, dragging: false, projectId: latest.current.project.id, revision: latest.current.project.revision };
        if (latest.current.moving && latest.current.editable !== false) { controls.enabled = false; canvas.setPointerCapture(event.pointerId); }
        return;
      }
      const selected = latest.current.selectedIds ?? (latest.current.selected ? [latest.current.selected] : []);
      const ids = node ? selected.includes(node) ? [...selected] : [node] : [];
      down = { x: event.clientX, y: event.clientY, id: event.pointerId, node, origin, person: Boolean(picked?.person), toggle: event.shiftKey || event.ctrlKey || event.metaKey, gesture: null, ids, dragging: false };
      if (node && !picked?.person && latest.current.moving && latest.current.editable !== false) { controls.enabled = false; canvas.setPointerCapture(event.pointerId); }
    }
    function pointerMove(event: PointerEvent) {
      const picked = hit(event); canvas.style.cursor = picked ? picked.person ? 'pointer' : latest.current.moving ? 'move' : 'pointer' : 'grab';
      if (facilityDown?.pointer === event.pointerId) {
        if (!latest.current.moving || latest.current.editable === false || Math.hypot(event.clientX - facilityDown.x, event.clientY - facilityDown.y) < 5) return;
        const point = new THREE.Vector3(); if (!raycaster.ray.intersectPlane(ground, point)) return;
        if (!facilityDown.dragging) { facilityDown.dragging = true; latest.current.onMoveStart?.(); latest.current.onSelectFacility?.(facilityDown.id); }
        facilityDown.point = { x: Math.max(-100, Math.min(100, Math.round((facilityDown.start.x + point.x - facilityDown.origin.x) * 2) / 2)), z: Math.max(-100, Math.min(100, Math.round((facilityDown.start.z + point.z - facilityDown.origin.z) * 2) / 2)) };
        facilities.setPreview(facilityDown.id, facilityDown.point);
        readout.hidden = false; readout.textContent = `${fm.move}: ${facilityDown.point.x}, ${facilityDown.point.z}`;
        renderer.shadowMap.needsUpdate = true; requestRender(); return;
      }
      const hovered = picked && !picked.person ? picked.id : null;
      if (hovered !== hoveredId) { hoveredId = hovered; requestRender(); }
      if (!down || down.id !== event.pointerId || !down.node || down.person || down.toggle || !latest.current.moving || latest.current.editable === false) return;
      if (!down.dragging && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) return;
      const point = new THREE.Vector3(); if (!raycaster.ray.intersectPlane(ground, point)) return;
      if (!down.gesture) { latest.current.onMoveStart?.(); down.dragging = true; down.gesture = beginMoveGesture(latest.current.project, down.ids, down.node); latest.current.onSelect(down.node, 'inspect'); }
      // The moved knot has unit slope while ordering stays fixed. The old map's
      // interpolation slope is for points between stationary knots, not a knot
      // being translated. Snap/alignment still own the shared model delta.
      const next: LayoutTranslation | null = down.gesture.preview({ x: point.x - down.origin.x, z: point.z - down.origin.z });
      if (!next) return;
      preview.clear();
      if (!next.error) for (const id of next.ids) preview.set(id, next.points[id]);
      readout.hidden = false; readout.textContent = next.error ?? m.movePreview(next.ids.length, next.delta.x.toFixed(1), next.delta.z.toFixed(1), next.guides.length > 0);
      host.dataset.movePreview = JSON.stringify({ ids: next.ids, delta: next.delta, points: next.points, error: next.error });
      host.dataset.alignmentGuides = JSON.stringify(next.guides); renderer.shadowMap.needsUpdate = true; requestRender();
    }
    function pointerUp(event: PointerEvent) {
      if (facilityDown?.pointer === event.pointerId) {
        if (facilityDown.dragging) pointerMove(event);
        const finished = facilityDown, current = latest.current;
        cancel();
        if (finished.dragging && current.project.id === finished.projectId && current.project.revision === finished.revision) current.onMoveFacility?.(finished.id, finished.point);
        else if (Math.hypot(event.clientX - finished.x, event.clientY - finished.y) < 5) current.onSelectFacility?.(finished.id);
        return;
      }
      if (!down || down.id !== event.pointerId) return;
      if (down.dragging) pointerMove(event);
      const finished = down, commit = finished.gesture?.finish();
      if (!finished.dragging && Math.hypot(event.clientX - finished.x, event.clientY - finished.y) < 5) latest.current.onSelect(finished.node, finished.toggle ? 'toggle' : latest.current.moving && finished.node && latest.current.selectedIds?.includes(finished.node) ? 'inspect' : 'single');
      cancel(); if (commit) latest.current.onMove?.(commit.ids, commit.delta);
    }
    function key(event: KeyboardEvent) { if (event.key === 'Escape' && (down?.dragging || facilityDown)) { event.preventDefault(); event.stopPropagation(); cancel(); } }
    function dragOver(event: DragEvent) {
      if (event.target instanceof Element && event.target.closest('.scene-camera-tools,.scene-asset-warning')) return;
      if (latest.current.editable === false || !event.dataTransfer?.types.includes(LIBRARY_DRAG_TYPE)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; canvas.classList.add('facility-drop-target');
    }
    function dragLeave(event?: DragEvent) { if (event?.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return; canvas.classList.remove('facility-drop-target'); }
    function drop(event: DragEvent) {
      dragLeave();
      if (event.target instanceof Element && event.target.closest('.scene-camera-tools,.scene-asset-warning')) return;
      const text = event.dataTransfer?.getData(LIBRARY_DRAG_TYPE);
      if (!text || text.length > 10_000 || latest.current.editable === false) return;
      event.preventDefault();
      try {
        const payload = JSON.parse(text) as LibraryDrop;
        if (!findLibraryAsset(payload.assetId) || payload.projectId !== latest.current.project.id || payload.revision !== latest.current.project.revision) return;
        const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
        const point = new THREE.Vector3(); if (!raycaster.ray.intersectPlane(ground, point)) return;
        const position = { x: Math.round(point.x * 2) / 2, z: Math.round(point.z * 2) / 2 };
        manualView = true;
        latest.current.onDropAsset?.(payload, position);
      } catch { /* Unrelated or malformed drag data never changes the project. */ }
    }
    const focus = () => {
      const current = latest.current, object = current.project.facility?.objects.find(object => object.id === current.selectedFacilityId);
      const p = object ?? pointFor(current.selected ?? ''); if (!p) return;
      manualView = true;
      const horizontal = camera.right - camera.left, vertical = camera.top - camera.bottom;
      camera.left = -horizontal / 2; camera.right = horizontal / 2; camera.top = vertical / 2; camera.bottom = -vertical / 2;
      const asset = object && findLibraryAsset(object.assetId);
      const y = object ? (object.y ?? 0) + (asset?.dimensions[1] ?? 1) * object.scale / 2 : .8;
      const target = new THREE.Vector3(p.x, y, p.z), delta = target.clone().sub(controls.target);
      controls.target.copy(target); camera.position.add(delta);
      if (object) controls.maxZoom = 200 * inspectionScale();
      camera.zoom = object ? Math.max(.65, Math.min(200 * inspectionScale(), Math.min(horizontal, vertical) / Math.max(.3, Math.max(...(asset?.dimensions ?? [1, 1, 1])) * object.scale * 1.7))) : 2 * inspectionScale();
      camera.updateProjectionMatrix(); controls.update(); requestRender();
    };
    const zoom = (event: Event) => { const factor = (event as CustomEvent).detail; if (factor !== 1.25 && factor !== .8) return; manualView = true; camera.zoom = Math.max(.65, Math.min(controls.maxZoom, camera.zoom * factor)); camera.updateProjectionMatrix(); controls.update(); requestRender(); };
    const connection = (event: Event) => {
      const index: unknown = (event as CustomEvent).detail, current = latest.current;
      if (!Number.isInteger(index) || current.moving || current.editable === false) return;
      const topology = flowTopology(current.project.model.nodes), link = topology.links.find(link => link.index === index);
      if (!link) return;
      const shape = connectionShapes(topology, Object.fromEntries([...visuals.keys()].map(id => [id, pointFor(id)]))).get(link.index);
      if (!shape) return;
      scene.updateMatrixWorld(true);
      // Fit the geometry actually drawn on the floor and the current equipment,
      // rather than estimating zoom from the distance between the two node IDs.
      const points = [...shape.points.map(point => new THREE.Vector3(point.x, .09, point.z)), ...shape.arrow.map(point => new THREE.Vector3(point.x, .1, point.z))];
      for (const id of new Set([link.from, link.to])) {
        const visual = visuals.get(id); if (!visual) continue;
        const bounds = new THREE.Box3().setFromObject(visual.group);
        if (bounds.isEmpty()) continue;
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z));
      }
      const width = host.clientWidth, height = host.clientHeight, hostRect = host.getBoundingClientRect();
      const paper = host.closest('.world-workspace')?.querySelector('.flow-guide-panel')?.getBoundingClientRect();
      const overlaps = paper && paper.left < hostRect.right && paper.right > hostRect.left && paper.top < hostRect.bottom && paper.bottom > hostRect.top;
      const safeTop = 54, safeBottom = Math.min(height - 46, overlaps ? paper.top - hostRect.top - 12 : height - 46);
      if (!width || safeBottom <= safeTop) return;
      const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3()), delta = center.clone().sub(controls.target);
      controls.target.copy(center); camera.position.add(delta); controls.update(); camera.updateMatrixWorld(true);
      const framing = connectionFraming(points.map(point => point.clone().applyMatrix4(camera.matrixWorldInverse)), { width, height, safeTop, safeBottom });
      if (!framing) return;
      manualView = true;
      Object.assign(camera, framing); camera.updateProjectionMatrix(); controls.update(); camera.updateMatrixWorld(true);
      currentConnection = link.index; manualContext = { selected: current.selected, topology: JSON.stringify(topology.links), cursor: current.flow?.cursor };
      const fitted = points.map(point => point.clone().project(camera));
      host.dataset.connectionFit = JSON.stringify({ index: link.index, from: link.from, to: link.to, safeTop, safeBottom,
        minX: Math.min(...fitted.map(point => (point.x * .5 + .5) * width)), maxX: Math.max(...fitted.map(point => (point.x * .5 + .5) * width)),
        minY: Math.min(...fitted.map(point => (-point.y * .5 + .5) * height)), maxY: Math.max(...fitted.map(point => (-point.y * .5 + .5) * height)), zoom: camera.zoom });
      requestRender();
    };
    const visible = () => { if (!document.hidden) requestRender(); };
    const generatedDOM = (node: Node) => node === canvas || labelLayer.contains(node) || connectorLayer.contains(node) || readout.contains(node) || loading.contains(node);
    // Caption writes and telemetry are owned here; other DOM can cover a real
    // pointer target even while playback is paused. Observe those changes once,
    // instead of asking elementFromPoint thousands of times on every frame.
    const overlayObserver = new MutationObserver(records => {
      if (!alive) return;
      const changed = new Map<Element, { layout: boolean; typography: boolean }>();
      const add = (element: Element, layout: boolean, typography = false) => {
        const old = changed.get(element); changed.set(element, { layout: layout || Boolean(old?.layout), typography: typography || Boolean(old?.typography) });
      };
      const attributes = new Map<Element, Map<string, string | null>>();
      for (const record of records) if (record.type === 'attributes' && record.target instanceof Element && record.attributeName) {
        const first = attributes.get(record.target) ?? new Map<string, string | null>();
        if (!first.has(record.attributeName)) first.set(record.attributeName, record.oldValue);
        attributes.set(record.target, first);
      }
      for (const record of records) {
        if (generatedDOM(record.target) || record.target === host && record.type === 'attributes' && record.attributeName?.startsWith('data-')) continue;
        // React temporarily clears/restores controlled input type/name. A net
        // unchanged attribute has no new hit-test geometry to invalidate.
        if (record.type === 'attributes' && record.target instanceof Element && record.attributeName && record.target.getAttribute(record.attributeName) === attributes.get(record.target)?.get(record.attributeName)) continue;
        if (record.type === 'childList') {
          for (const node of [...record.addedNodes, ...record.removedNodes]) {
            if (generatedDOM(node)) continue;
            if (node instanceof Element) for (const element of [node, ...node.querySelectorAll('*')]) add(element, true);
            else if (record.target instanceof Element) add(record.target, true);
          }
          continue;
        }
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        if (element) add(element, record.type === 'attributes' && ['class', 'style', 'hidden', 'open', 'inert', 'popover'].includes(record.attributeName ?? ''), record.type === 'attributes' && (record.attributeName === 'class' || record.attributeName === 'style'));
      }
      if (!changed.size) return;
      const view = host.getBoundingClientRect();
      const overlaps = (rect: DOMRect) => rect.width > 0 && rect.height > 0 && rect.left < view.right && rect.right > view.left && rect.top < view.bottom && rect.bottom > view.top;
      let affected = false;
      for (const [element, change] of changed) {
        const previous = overlayRects.get(element);
        const rect = element.getBoundingClientRect();
        overlayRects.set(element, rect);
        const same = previous && rect.left === previous.left && rect.top === previous.top && rect.width === previous.width && rect.height === previous.height;
        if (same && !change.layout) continue;
        let inView = overlaps(rect) || Boolean(previous && overlaps(previous));
        // Text can shrink an overlay away from an earlier rejected sample.
        if (!inView) for (let parent = element.parentElement; parent; parent = parent.parentElement) { const old = overlayRects.get(parent); if (old && overlaps(old)) { inView = true; break; } }
        if (inView) { affected = true; if (change.typography) measureLabels = true; }
      }
      if (affected) { overlayVersion++; requestRender(); }
    });
    overlayObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
    const refreshOverlayROI = (rect: DOMRect) => {
      const top = Math.max(0, Math.min(innerHeight, rect.top)), bottom = Math.max(top, Math.min(innerHeight, rect.bottom));
      const left = Math.max(0, Math.min(innerWidth, rect.left)), right = Math.max(left, Math.min(innerWidth, rect.right));
      const margin = `${-top}px ${right - innerWidth}px ${bottom - innerHeight}px ${-left}px`;
      if (margin === overlayRootMargin) return;
      overlayRootMargin = margin; overlayIntersection?.disconnect();
      // Native intersection tracking notices an overlay sliding into the canvas
      // without polling a header spinner or another unrelated infinite animation.
      overlayIntersection = new IntersectionObserver(entries => {
        if (!alive || margin !== overlayRootMargin) return;
        let changed = false;
        for (const entry of entries) {
          const shown = overlayMotions.has(entry.target) && entry.target.isConnected && entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
          if (shown === movingOverlays.has(entry.target)) continue;
          if (shown) movingOverlays.add(entry.target); else movingOverlays.delete(entry.target);
          changed = true;
        }
        if (changed) { overlayVersion++; requestRender(); }
      }, { rootMargin: margin });
      for (const element of overlayMotions.keys()) overlayIntersection.observe(element);
    };
    const overlayMotion = (event: Event) => {
      if (!(event.target instanceof Element) || generatedDOM(event.target)) return;
      const target = event.target, rect = target.getBoundingClientRect(), view = host.getBoundingClientRect(), previous = overlayRects.get(target);
      const token = event.type.startsWith('transition') ? `transition:${(event as TransitionEvent).propertyName}:${(event as TransitionEvent).pseudoElement}` : `animation:${(event as AnimationEvent).animationName}:${(event as AnimationEvent).pseudoElement}`;
      const starts = event.type === 'transitionrun' || event.type === 'animationstart';
      const motions = overlayMotions.get(target) ?? new Set<string>();
      if (starts) { motions.add(token); overlayMotions.set(target, motions); refreshOverlayROI(view); overlayIntersection!.observe(target); }
      else { motions.delete(token); if (!motions.size) { overlayMotions.delete(target); overlayIntersection?.unobserve(target); } }
      const overlaps = (value: DOMRect) => value.width > 0 && value.height > 0 && value.left < view.right && value.right > view.left && value.top < view.bottom && value.bottom > view.top;
      const affected = movingOverlays.has(target) || overlaps(rect) || Boolean(previous && overlaps(previous));
      if (motions.size && overlaps(rect)) movingOverlays.add(target); else if (!motions.size) movingOverlays.delete(target);
      overlayRects.set(target, rect);
      if (affected) { overlayVersion++; requestRender(); }
    };
    const viewportMoved = () => { overlayVersion++; requestRender(); };
    const fontChanged = () => { measureLabels = true; overlayVersion++; requestRender(); };
    for (const name of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) document.addEventListener(name, overlayMotion, true);
    window.addEventListener('scroll', viewportMoved, true); window.addEventListener('resize', viewportMoved);
    document.addEventListener('toggle', viewportMoved, true); document.addEventListener('beforetoggle', viewportMoved, true);
    document.fonts.addEventListener('loadingdone', fontChanged);
    let gestureView: { position: THREE.Vector3; target: THREE.Vector3; zoom: number } | null = null;
    const viewStarted = () => { gestureView = { position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom }; };
    const viewChanged = () => {
      // OrbitControls starts on pointerdown, including an ordinary selection.
      // Only an actual navigation change opts out of automatic framing.
      if (gestureView && (!camera.position.equals(gestureView.position) || !controls.target.equals(gestureView.target) || camera.zoom !== gestureView.zoom)) manualView = true;
      requestRender();
    };
    const viewEnded = () => { gestureView = null; };
    controls.addEventListener('start', viewStarted); controls.addEventListener('change', viewChanged); controls.addEventListener('end', viewEnded);
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', cancel);
    host.addEventListener('dragover', dragOver); host.addEventListener('dragleave', dragLeave); host.addEventListener('drop', drop);
    const lostCapture = () => { if (down || facilityDown) cancel(); };
    const contextLost = () => { setContextFailed(true); setFailed(true); requestRender(); };
    const contextRestored = () => { setContextFailed(false); status(); requestRender(); };
    const pointerLeave = () => { if (hoveredId) { hoveredId = null; requestRender(); } };
    canvas.addEventListener('lostpointercapture', lostCapture); canvas.addEventListener('pointerleave', pointerLeave);
    canvas.addEventListener('webglcontextlost', contextLost); canvas.addEventListener('webglcontextrestored', contextRestored);
    host.addEventListener('queuelab:fit', fit); host.addEventListener('queuelab:focus', focus); host.addEventListener('queuelab:zoom', zoom); host.addEventListener('queuelab:cancel-move', cancel); host.addEventListener('queuelab:show-connection', connection);
    document.addEventListener('keydown', key, true); document.addEventListener('visibilitychange', visible);

    function edges() {
      edgeOwned.forEach(resource => resource.dispose()); edgeOwned = []; edgeGroup.clear();
      const topology = flowTopology(latest.current.project.model.nodes), shapes = connectionShapes(topology, Object.fromEntries([...visuals.keys()].map(id => [id, pointFor(id)])));
      const chosen = new Set(latest.current.flow?.walk.links.map(link => link.index) ?? []);
      const active = currentConnection ?? latest.current.flow?.walk.links[latest.current.flow.cursor]?.index;
      const activeLink = topology.links.find(link => link.index === active);
      viewedIds = new Set(activeLink ? [activeLink.from, activeLink.to] : []); viewingFrom = activeLink?.from ?? null;
      const selectedNodes = new Set(latest.current.selectedIds ?? (latest.current.selected ? [latest.current.selected] : []));
      const highlighted: { from: string; to: string }[] = [];
      for (const link of topology.links) {
        const shape = shapes.get(link.index); if (!shape) continue;
        const selected = chosen.has(link.index) || active === link.index || (!latest.current.flow && (selectedNodes.has(link.from) || selectedNodes.has(link.to)));
        const geometry = new THREE.BufferGeometry().setFromPoints(shape.points.map(p => new THREE.Vector3(p.x, .09, p.z)));
        const material = new THREE.LineBasicMaterial({ color: active === link.index ? '#507f25' : selected ? '#709650' : '#8795a0', transparent: true, opacity: selected ? .95 : .4 });
        const line = new THREE.Line(geometry, material); edgeGroup.add(line); edgeOwned.push(geometry, material);
        const arrowGeometry = new THREE.BufferGeometry().setFromPoints(shape.arrow.map(p => new THREE.Vector3(p.x, .1, p.z)));
        const arrow = new THREE.Line(arrowGeometry, material); edgeGroup.add(arrow); edgeOwned.push(arrowGeometry);
        if (selected) highlighted.push({ from: link.from, to: link.to });
      }
      host.dataset.edges = JSON.stringify(topology.links); host.dataset.sharedPositionEdges = JSON.stringify(sharedPositionLinks(topology, layout));
      host.dataset.highlightedEdges = JSON.stringify(highlighted); host.dataset.dimmedEdgeCount = String(topology.links.length - highlighted.length);
      const flow = latest.current.flow;
      host.dataset.flowGuide = JSON.stringify({ anchor: flow?.walk.anchor ?? null, cursor: flow?.cursor ?? null, ids: flow?.walk.ids ?? [], edges: [...chosen],
        viewing: activeLink ? { from: activeLink.from, to: activeLink.to, coincident: shapes.get(activeLink.index)?.coincident } : null });
    }
    function draw() {
      scheduled = 0; if (!alive) return;
      const started = performance.now(), current = latest.current;
      const candidateLayout = { ...sceneLayout(current.project), ...Object.fromEntries(preview) };
      presentation = capacityLayout(current.project.model.nodes, candidateLayout); layout = presentation.positions;
      facilities.sync(current.project.facility?.objects ?? [], current.selectedFacilityId ?? null);
      if (facilities.stats().revision !== facilityShadowRevision) { facilityShadowRevision = facilities.stats().revision; renderer.shadowMap.needsUpdate = true; }
      extent = facilityExtent(current.project);
      const nextFacilityExtent = `${extent.minX}:${extent.maxX}:${extent.minZ}:${extent.maxZ}:${artHeight(current.project)}`;
      if (nextFacilityExtent !== facilityExtentKey) { const changed = facilityExtentKey !== ''; facilityExtentKey = nextFacilityExtent; if (changed && !manualView && !facilityDown && !down?.dragging) frameExtent(false); }
      host.dataset.facility = JSON.stringify(facilities.stats()); host.dataset.assetCache = JSON.stringify(store.stats()); status();
      controls.maxZoom = (current.selectedFacilityId ? 200 : 6) * inspectionScale();
      const nextCapacityKey = JSON.stringify(current.project.model.nodes.map(node => [node.id, stationCopies(node)]));
      if (nextCapacityKey !== capacityKey) { capacityKey = nextCapacityKey; surroundings.update(extent, camera); if (!manualView) frameExtent(true); }
      canvas.setAttribute('aria-label', m.interactiveWorldLabel(current.project.name));
      const byId = new Map(current.project.model.nodes.map(node => [node.id, node])), selected = new Set(current.selectedIds ?? (current.selected ? [current.selected] : []));
      camera.updateMatrixWorld(true);
      const detailPoint = current.selected ? pointFor(current.selected) : undefined;
      const detailProjection = detailPoint ? new THREE.Vector3(detailPoint.x, 1, detailPoint.z).project(camera) : null;
      const detail = Boolean(current.selected && foreground.get(current.selected)?.length && detailProjection && Math.abs(detailProjection.x) <= 1.2 && Math.abs(detailProjection.y) <= 1.2) && isDetailInspection(camera.zoom, current.quality);
      if (detail || (current.project.facility?.objects.length ?? 0) > 0 && current.quality !== 'low') loadEnvironment();
      scene.environment = environmentTarget?.texture ?? null;
      scene.environmentIntensity = .5;
      host.dataset.environment = scene.environment ? 'Poly Haven Studio Small 09 / CC0' : 'analytic-lighting';
      let triangleBudget = 6_000_000;
      const capacityDrawn: { id: string; count: number; full3D: number; sourceImpostors: number; laneMarkers: number }[] = [];
      for (const [id, visual] of visuals) {
        const node = byId.get(id), p = pointFor(id); if (!node || !p) continue;
        syncForeground(id, visual, detail && id === current.selected);
        visual.group.position.set(p.x, 0, p.z); visual.ring.visible = selected.has(id) || hoveredId === id;
        (visual.ring.material as THREE.MeshBasicMaterial).opacity = selected.has(id) ? .9 : .42;
        const count = stationCopies(node), projectedPixels = 3 / Math.max(.01, camera.top - camera.bottom) * camera.zoom * host.clientHeight;
        const nearLimit = projectedPixels >= 18 ? MAX_3D_CELLS : 1;
        const realCount = Math.max(1, Math.min(count, nearLimit, Math.floor(triangleBudget / Math.max(1, visual.triangles))));
        triangleBudget -= realCount * visual.triangles;
        syncCapacity(id, visual, count, realCount);
        if (visual.loaded) capacityDrawn.push({ id, count: visual.count, full3D: visual.triangles ? visual.copies.length : 0, sourceImpostors: visual.impostor?.mesh.count ?? 0, laneMarkers: visual.triangles ? 0 : (visual.footprint?.geometry.attributes.position.count ?? 0) / 8 });
        const accessibleLabel = m.select(node.label, stepKindLabels[node.kind]);
        if (visual.label.getAttribute('aria-label') !== accessibleLabel) visual.label.setAttribute('aria-label', accessibleLabel);
        if (visual.label.getAttribute('aria-pressed') !== String(selected.has(id))) { visual.label.setAttribute('aria-pressed', String(selected.has(id))); measureLabels = true; }
        visual.label.classList.toggle('is-selected', selected.has(id));
        const queue = current.frame.queues[id] ?? 0;
        if (visual.name.textContent !== node.label) { visual.name.textContent = node.label; visual.label.title = node.label; measureLabels = true; }
        const countLabel = queue ? m.waiting(queue) : node.kind === 'sink' && current.project.model.nodes.filter(item => item.kind === 'sink').length === 1 ? `${current.frame.completed} completed` : '';
        if (visual.badge.textContent !== countLabel) { visual.badge.textContent = countLabel; measureLabels = true; }
        if (visual.badge.hidden !== !countLabel) { visual.badge.hidden = !countLabel; measureLabels = true; }
      }
      host.dataset.capacityCopies = JSON.stringify(capacityDrawn); host.dataset.sceneExtent = JSON.stringify(extent);
      host.dataset.detailAssets = JSON.stringify([...foreground.values()].flatMap(parts => parts.filter(part => part.detail && part.model).map(part => part.definition.file)));
      if (floor) { floor.scale.set(extent.width / floorDimensions.x, 1, extent.depth / floorDimensions.z); floor.position.set(extent.x, -floorDimensions.y, extent.z); }
      if (surroundings.update(extent, camera)) renderer.shadowMap.needsUpdate = true;
      if (manualContext && (manualContext.selected !== current.selected || manualContext.cursor !== current.flow?.cursor || manualContext.topology !== JSON.stringify(flowTopology(current.project.model.nodes).links))) { currentConnection = null; manualContext = null; delete host.dataset.connectionFit; }
      const edgeKey = JSON.stringify([current.project.model.nodes.map(node => [node.id, 'next' in node ? node.next : node.kind === 'route' ? node.branches : null]), layout, [...preview], current.selected, current.selectedIds, current.flow?.cursor, current.flow?.walk.links, currentConnection]);
      if (edgeKey !== topologyKey) { topologyKey = edgeKey; edges(); }
      if (traceSnapshot !== current.result) {
        traceSnapshot = current.result; entities.clear(); completeLocations.clear();
        for (const entity of current.result?.entities ?? []) entities.set(entity.id, entity);
        for (const event of current.result?.events ?? []) if (event.kind === 'complete') completeLocations.set(event.entityId, event.nodeId);
      }
      const now = performance.now();
      const resetLocation = !motionInitialized || current.frame.time < motionClock || motionRun !== (current.runKey ?? '') || motionEpoch !== (current.seekEpoch ?? 0) || motionLayout !== current.project.layout || preview.size > 0 || current.reducedMotion;
      if (resetLocation) activitySeconds = current.frame.time / 15;
      else if (current.playing && !current.reducedMotion && activityTick !== null) activitySeconds += Math.min(.05, Math.max(0, (now - activityTick) / 1000));
      activityTick = now;
      const personTargets: PersonTarget[] = [];
      const effectiveLayout = Object.fromEntries(Object.entries(layout).map(([id, p]) => [id, pointFor(id) ?? p]));
      const staffTargets = operatorTargets(current.project, current.frame, effectiveLayout, operatorAssignments, { seconds: activitySeconds, active: !current.reducedMotion && current.frame.time < (current.replayUntil ?? current.project.model.horizon) });
      const actorLimit = Math.min(500, world === 'factory' ? 500 : (world === 'festival' ? 528 : 560) - staffTargets.length, current.frame.actors.length), rank: Record<string, number> = Object.create(null);
      const variantFor = (id: string) => { let hash = 0; for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0; return hash & 1; };
      const matrices: THREE.Matrix4[][] = Array.from({ length: 6 }, () => []);
      for (let i = 0; i < actorLimit; i++) {
        const actor = current.frame.actors[i], p = pointFor(actor.nodeId); if (!p) continue;
        const key = `${actor.nodeId}:${actor.state}`, position = rank[key] ?? 0; rank[key] = position + 1;
        const modeledNode = byId.get(actor.nodeId);
        if (world === 'factory' && actor.state === 'working' && modeledNode?.kind === 'service') {
          const cell = capacityCell(position % stationCopies(modeledNode)), x = p.x + cell.x, z = p.z + cell.z;
          if (modeledNode.samplingId === 'factory-station-c') dummy.position.set(x, 1.12, z + .4);
          else if (modeledNode.samplingId === 'factory-station-b') dummy.position.set(x - .6, 1.18, z + .05);
          else dummy.position.set(x + 1.4, .04, z + .4);
        } else dummy.position.set(p.x + (position % 4) * (world === 'factory' ? .37 : .8) - (world === 'factory' ? .55 : 1.2), world === 'factory' ? .35 + Math.floor(position / 24) * .31 : .04, p.z + (actor.state === 'working' ? 1.2 : .7) + Math.floor((position % 24) / 4) * (world === 'factory' ? .4 : .6));
        dummy.rotation.set(0, world !== 'factory' || actor.state === 'waiting' ? Math.PI : 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
        if (world === 'factory') matrices[0].push(dummy.matrix.clone());
        else {
          const entry = pointFor(entities.get(actor.id)?.sourceId ?? '') ?? pointFor(current.project.model.nodes.find(node => node.kind === 'source')?.id ?? '');
          personTargets.push({ id: actor.id, variant: variantFor(actor.id), nodeId: actor.nodeId, role: 'visitor', position: { x: dummy.position.x, y: 0, z: dummy.position.z }, heading: dummy.rotation.y, spawn: entry ? { x: entry.x, y: 0, z: entry.z } : undefined });
        }
      }
      if (world === 'festival') {
        const completedLimit = Math.min(80, Math.max(0, 560 - staffTargets.length - personTargets.length));
        const completed = completedLimit ? [...entities.values()].filter(record => record.status === 'completed' && record.endedAt !== undefined && record.endedAt <= current.frame.time).slice(-completedLimit) : [];
        const exit = current.project.model.nodes.find(node => node.kind === 'sink'), entry = exit ? pointFor(exit.id) : null;
        for (const record of completed) personTargets.push({ id: record.id, variant: variantFor(record.id), nodeId: exit?.id ?? '', role: 'visitor', position: surroundings.festivalDestination(record.id), heading: surroundings.festivalHeading(record.id), spawn: entry ? { x: entry.x, y: 0, z: entry.z } : undefined });
      }
      personTargets.push(...staffTargets);
      if (resetLocation || current.playing) settleUntil = 0;
      const endedNaturally = lastPlaying && !current.playing && !resetLocation && current.frame.time >= (current.replayUntil ?? current.project.model.horizon);
      if (endedNaturally) settleUntil = now + 10_000;
      // Finish ordinary walks after the numerical replay ends. Very distant
      // user-authored layouts get a finite final placement, never a frozen stride.
      const settleExpired = settleUntil > 0 && now >= settleUntil;
      const resetMotion = resetLocation || settleExpired;
      if (settleExpired) settleUntil = 0;
      const animate = !current.reducedMotion && (Boolean(current.playing) || now < settleUntil && !resetMotion);
      const motion = peopleMotion.step(personTargets, { now, animate, reset: resetMotion, speed: 3.6 * Math.sqrt(Math.max(1, (current.playbackSpeed ?? 15) / 15)), retire: person => {
        if (person.role === 'operator') {
          const entry = pointFor(current.project.model.nodes.find(node => node.kind === 'source')?.id ?? '');
          return entry ? { ...person, position: { x: entry.x, y: 0, z: entry.z } } : null;
        }
        const record = entities.get(person.id);
        if (!record || record.endedAt === undefined || record.endedAt > current.frame.time) return null;
        const destination = record.status === 'completed' ? completeLocations.get(person.id) : record.status === 'reneged' || record.status === 'balked' ? record.sourceId : null;
        if (world === 'festival' && record.status === 'completed') return { ...person, nodeId: destination ?? person.nodeId, position: surroundings.festivalDestination(person.id) };
        const point = destination ? pointFor(destination) : null;
        return point && destination ? { ...person, nodeId: destination, position: { x: point.x, y: 0, z: point.z + 1 } } : null;
      } });
      people.update(motion.people);
      const peopleShadows = JSON.stringify(motion.people);
      if (resetMotion || peopleShadows !== previousPeopleShadows) renderer.shadowMap.needsUpdate = true;
      previousPeopleShadows = peopleShadows;
      if (!motion.moving) settleUntil = 0;
      motionInitialized = true; motionRun = current.runKey ?? ''; motionEpoch = current.seekEpoch ?? 0; motionLayout = current.project.layout; motionClock = current.frame.time; lastPlaying = Boolean(current.playing);
      if (animate && (motion.moving || current.playing && motion.working)) requestRender();
      const sinks = current.project.model.nodes.filter(node => node.kind === 'sink'), exit = sinks.length === 1 ? sinks[0] : null, exitPoint = exit ? pointFor(exit.id) : null;
      const completedMarkers = exit ? Math.min(world === 'factory' ? 24 : 0, current.frame.completed) : 0;
      if (exitPoint) for (let i = 0; i < completedMarkers; i++) {
        dummy.position.set(exitPoint.x + (i % 4) * .37 - .55, world === 'factory' ? .313 : 0, exitPoint.z + .6 + Math.floor(i / 4) * .42);
        dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); matrices[world === 'factory' ? 4 : 4 + i % 2].push(dummy.matrix.clone());
      }
      for (const { mesh, variant } of actorBatches) {
        const values = matrices[variant]; let changed = mesh.count !== values.length; mesh.count = values.length;
        values.forEach((matrix, i) => {
          if (!matrix.elements.some((value, j) => Math.fround(value) !== mesh.instanceMatrix.array[i * 16 + j])) return;
          mesh.setMatrixAt(i, matrix); changed = true;
        });
        if (changed) { mesh.instanceMatrix.needsUpdate = true; renderer.shadowMap.needsUpdate = true; }
      }
      camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
      const paper = current.flow || currentConnection !== null ? host.closest('.world-workspace')?.querySelector('.flow-guide-panel')?.getBoundingClientRect() : null;
      const hostRect = host.getBoundingClientRect(), paperOverlaps = paper && paper.left < hostRect.right && paper.right > hostRect.left && paper.top < hostRect.bottom && paper.bottom > hostRect.top;
      if (overlayMotions.size) refreshOverlayROI(hostRect);
      const labelViewportHeight = paperOverlaps ? Math.min(host.clientHeight, paper.top - hostRect.top + (host.clientWidth < 500 ? 56 : 42) - 8) : host.clientHeight;
      // Read the complete batch before positioning. Offscreen captions keep
      // their measured size until content, typography or viewport changes.
      if (measureLabels) {
        for (const visual of visuals.values()) visual.label.hidden = false;
        labelSizes = new Map([...visuals].map(([id, visual]) => [id, { width: visual.label.offsetWidth || 130, height: visual.label.offsetHeight || 30 }]));
        measureLabels = false; labelMeasureVersion++;
      }
      const ordered = [...visuals].sort(([a], [b]) => Number(viewedIds.has(b)) - Number(viewedIds.has(a)) || Number(b === viewingFrom) - Number(a === viewingFrom) || Number(b === current.selected) - Number(a === current.selected));
      const nextPlacementKey = JSON.stringify([camera.matrixWorld.elements, camera.projectionMatrix.elements, layout, host.clientWidth, labelViewportHeight, labelMeasureVersion, ordered.map(([id]) => id), current.selectedIds, current.selected, current.runKey, staffTargets.length]);
      if (nextPlacementKey !== labelPlacementKey) {
      labelPlacementKey = nextPlacementKey;
      const occupied: LabelRect[] = [];
      // Keep captions off staff heads/bodies. Group their small bounds by step
      // so a crowd does not turn caption placement into per-person polling.
      const staffBounds = new Map<string, THREE.Box3>();
      for (const person of staffTargets) {
        const bounds = staffBounds.get(person.nodeId) ?? new THREE.Box3();
        bounds.expandByPoint(new THREE.Vector3(person.position.x - .6, .02, person.position.z - .6));
        bounds.expandByPoint(new THREE.Vector3(person.position.x + .6, 2.55, person.position.z + .6));
        staffBounds.set(person.nodeId, bounds);
      }
      const bodies: LabelRect[] = [...staffBounds.values()].map(bounds => {
        const points: THREE.Vector3[] = [];
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z).project(camera));
        const xs = points.map(point => (point.x * .5 + .5) * host.clientWidth), ys = points.map(point => (-point.y * .5 + .5) * host.clientHeight);
        const x = Math.min(...xs), y = Math.min(...ys);
        return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
      });
      for (const [id, visual] of ordered) {
        const p = pointFor(id); if (!p) continue;
        const projected = new THREE.Vector3(p.x, byId.get(id)?.kind === 'service' ? 3 : byId.get(id)?.kind === 'queue' ? world === 'factory' ? .9 : 2.7 : byId.get(id)?.kind === 'route' || byId.get(id)?.kind === 'delay' ? .5 : world === 'factory' ? 1.1 : 2.7, p.z).project(camera);
        const { width, height } = labelSizes.get(id)!;
        const placed = placeLabel({ x: (projected.x * .5 + .5) * host.clientWidth - width / 2, y: (-projected.y * .5 + .5) * host.clientHeight - height, width, height }, { width: host.clientWidth, height: labelViewportHeight }, occupied, bodies);
        visual.label.hidden = !placed;
        visual.connector.style.display = placed ? '' : 'none'; visual.pin.style.display = placed ? '' : 'none';
        if (placed) {
          occupied.push(placed); visual.label.style.left = `${placed.x}px`; visual.label.style.top = `${placed.y}px`;
          const pin = new THREE.Vector3(p.x, byId.get(id)?.kind === 'service' ? 1.5 : .12, p.z).project(camera);
          const x = (pin.x * .5 + .5) * host.clientWidth, y = (-pin.y * .5 + .5) * host.clientHeight;
          const endX = Math.max(placed.x + 6, Math.min(placed.x + width - 6, x)), endY = Math.max(placed.y, Math.min(placed.y + height, y));
          visual.connector.setAttribute('x1', String(x)); visual.connector.setAttribute('y1', String(y)); visual.connector.setAttribute('x2', String(endX)); visual.connector.setAttribute('y2', String(endY));
          visual.pin.setAttribute('cx', String(x)); visual.pin.setAttribute('cy', String(y)); visual.connector.classList.toggle('is-selected', selected.has(id)); visual.pin.classList.toggle('is-selected', selected.has(id));
        }
      }
      }
      // Camera invariants use stable node anchors. Pointer samples below can
      // legitimately change when captions or people occlude a hit location.
      host.dataset.nodeProjections = JSON.stringify([...visuals].map(([id, visual]) => {
        const point = visual.group.getWorldPosition(new THREE.Vector3()).project(camera);
        return { id, x: (point.x * .5 + .5) * host.clientWidth, y: (-point.y * .5 + .5) * host.clientHeight };
      }));
      let movingOverlayInView = false;
      for (const element of movingOverlays) {
        if (!element.isConnected) { movingOverlays.delete(element); continue; }
        const previous = overlayRects.get(element), rect = element.getBoundingClientRect(); overlayRects.set(element, rect);
        const overlaps = (value: DOMRect) => value.width > 0 && value.height > 0 && value.left < hostRect.right && value.right > hostRect.left && value.top < hostRect.bottom && value.bottom > hostRect.top;
        if (overlaps(rect) || previous && overlaps(previous)) movingOverlayInView = true;
      }
      for (const element of overlayMotions.keys()) if (!element.isConnected) { overlayIntersection?.unobserve(element); overlayMotions.delete(element); movingOverlays.delete(element); }
      // Sample the real semantic hit test, including people and DOM overlays.
      // An occluded proxy center is not a usable pointer-drag starting point.
      const nextPickPointsKey = JSON.stringify([camera.matrixWorld.elements, camera.projectionMatrix.elements, hostRect.left, hostRect.top, hostRect.width, hostRect.height, labelPlacementKey,
        [...pickCenters].map(([id, proxy]) => [id, proxy.uuid, proxy.matrixWorld.elements, (proxy as THREE.InstancedMesh).count ?? 1]),
        facilities.stats().revision, current.selectedFacilityId, [...loadedVariants], motion.people.map(person => [person.id, person.nodeId, person.variant, person.position, person.heading]), loading.hidden, loading.textContent, loadErrors, detailFailures.size, overlayVersion, movingOverlayInView ? renderCount : 0]);
      if (nextPickPointsKey !== pickPointsKey) {
      pickPointsKey = nextPickPointsKey;
      host.dataset.pickPoints = JSON.stringify(current.project.model.nodes.map(node => {
        const proxy = pickCenters.get(node.id); if (!proxy) return null;
        proxy.geometry.computeBoundingBox();
        const instanced = proxy as THREE.InstancedMesh, samples = instanced.isInstancedMesh ? Math.min(instanced.count, 24) : 1;
        for (let i = 0; i < samples; i++) {
          const matrix = new THREE.Matrix4(); if (instanced.isInstancedMesh) instanced.getMatrixAt(i, matrix);
          const bounds = proxy.geometry.boundingBox!.clone().applyMatrix4(matrix).applyMatrix4(proxy.matrixWorld);
          const point = visiblePickPoint(bounds, camera, { width: host.clientWidth, height: host.clientHeight }, (x, y) => {
            const element = document.elementFromPoint(hostRect.left + x, hostRect.top + y);
            if (element !== canvas) { if (element && !generatedDOM(element)) overlayRects.set(element, element.getBoundingClientRect()); return false; }
            const hit = pickAt(x / host.clientWidth * 2 - 1, -y / host.clientHeight * 2 + 1);
            return hit?.id === node.id && !hit.person;
          });
          if (point) return { id: node.id, ...point };
        }
        return null;
      }).filter(point => point !== null));
      }
      if (movingOverlays.size) requestRender();
      renderer.render(scene, camera); host.dataset.renderCount = String(++renderCount);
      host.dataset.renderMs = String(performance.now() - started); host.dataset.drawCalls = String(renderer.info.render.calls); host.dataset.renderPending = 'false';
      host.dataset.rendererResources = JSON.stringify({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
      const represented = [...new Set(actorBatches.map(batch => batch.variant))].filter(variant => variant < (world === 'factory' ? 1 : 2)).reduce((count, variant) => count + matrices[variant].length, 0);
      host.dataset.operatorRepresentations = String(motion.people.filter(person => person.role === 'operator' && loadedVariants.has(person.variant)).length); host.dataset.walkingPeople = String(motion.people.filter(person => person.moving && loadedVariants.has(person.variant)).length); host.dataset.completedRepresentations = String(completedMarkers);
      host.dataset.workingPeople = String(motion.people.filter(person => person.activity === 'work' && !person.moving && loadedVariants.has(person.variant)).length);
      host.dataset.festivalAttendees = String(world === 'festival' ? motion.people.filter(person => person.role === 'visitor' && entities.get(person.id)?.status === 'completed' && loadedVariants.has(person.variant)).length : 0);
      host.dataset.actorCount = String(world === 'factory' ? represented : motion.people.filter(person => person.role === 'visitor' && current.frame.actors.some(actor => actor.id === person.id) && loadedVariants.has(person.variant)).length); host.dataset.retainedActorCount = String(current.frame.actors.length); host.dataset.nodeCount = String(visuals.size); host.dataset.camera = JSON.stringify({ position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom, left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom });
    }
    const previousView = savedView.current;
    if (previousView?.projectId === viewProjectId) {
      camera.position.copy(previousView.position); controls.target.copy(previousView.target);
      camera.zoom = previousView.zoom; camera.top = previousView.top; camera.bottom = previousView.bottom;
      const vertical = camera.top - camera.bottom, center = (previousView.left + previousView.right) / 2;
      const aspect = host.clientWidth / Math.max(1, host.clientHeight);
      camera.left = center - vertical * aspect / 2; camera.right = center + vertical * aspect / 2;
      camera.updateProjectionMatrix(); controls.update(); requestRender();
    } else fit();
    fitProject.current = id => { if (id !== viewProjectId) { viewProjectId = id; fit(); } };
    requestRender();
    return () => {
      savedView.current = { projectId: viewProjectId, position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom, left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, manual: manualView };
      fitProject.current = () => {};
      retryAssets.current = () => setAttempt(value => value + 1);
      alive = false; cancelGesture.current = () => {}; invalidate.current = () => {}; cancelAnimationFrame(scheduled); cancel();
      resize.disconnect(); overlayObserver.disconnect(); overlayIntersection?.disconnect();
      controls.removeEventListener('start', viewStarted); controls.removeEventListener('change', viewChanged); controls.removeEventListener('end', viewEnded); controls.dispose();
      document.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', visible);
      for (const name of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) document.removeEventListener(name, overlayMotion, true);
      window.removeEventListener('scroll', viewportMoved, true); window.removeEventListener('resize', viewportMoved); document.fonts.removeEventListener('loadingdone', fontChanged);
      document.removeEventListener('toggle', viewportMoved, true); document.removeEventListener('beforetoggle', viewportMoved, true);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('lostpointercapture', lostCapture); canvas.removeEventListener('pointerleave', pointerLeave);
      canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored);
      host.removeEventListener('dragover', dragOver); host.removeEventListener('dragleave', dragLeave); host.removeEventListener('drop', drop);
      host.removeEventListener('queuelab:fit', fit); host.removeEventListener('queuelab:focus', focus); host.removeEventListener('queuelab:zoom', zoom); host.removeEventListener('queuelab:cancel-move', cancel); host.removeEventListener('queuelab:show-connection', connection);
      cleanups.forEach(cleanup => cleanup()); edgeOwned.forEach(resource => resource.dispose()); resources.forEach(resource => resource.dispose());
      facilities.dispose(); people.dispose(); peopleMotion.clear(); scene.clear();
      for (const url of retainedURLs) store.release(url);
      renderer.renderLists.dispose(); connectorLayer.remove(); labelLayer.remove(); readout.remove(); loading.remove(); host.dataset.renderPending = 'false';
    };
  }, [geometryKey, props.quality, props.resetKey, attempt]);
  useEffect(() => { fitProject.current(props.project.id); }, [props.project.id]);
  useEffect(() => { invalidate.current(); }, [props.project, props.frame, props.selected, props.selectedIds, props.selectedFacilityId, props.moving, props.flow, props.reducedMotion, props.playing, props.seekEpoch, props.runKey]);
  useEffect(() => { cancelGesture.current(); }, [props.project.id, props.project.revision, props.moving]);
  return <div ref={mount} className={`world-scene catalog-world ${props.moving ? 'is-moving' : ''}`} data-testid="world-scene">
    <div className="scene-camera-tools" role="group" aria-label={m.worldCamera}><button aria-label={m.zoomIn} onClick={() => mount.current?.dispatchEvent(new CustomEvent('queuelab:zoom', { detail: 1.25 }))}><Plus size={17} /></button><button aria-label={m.zoomOut} onClick={() => mount.current?.dispatchEvent(new CustomEvent('queuelab:zoom', { detail: .8 }))}><Minus size={17} /></button><button aria-label={m.showWholeWorld} onClick={() => mount.current?.dispatchEvent(new Event('queuelab:fit'))}><Focus size={17} /></button></div>
    {failed && <div className="scene-asset-warning" role="status">{contextFailed ? m.contextUnavailable : m.assetsUnavailable}<button onClick={() => retryAssets.current()}><RotateCcw size={14} />{m.retryWorld}</button></div>}
  </div>;
}
