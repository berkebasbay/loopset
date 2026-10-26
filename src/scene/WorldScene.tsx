import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Focus, Minus, Plus, RotateCcw } from 'lucide-react';
import type { Point, Project, RunResult } from '../model/types';
import type { WorldFrame } from '../playback';
import type { SelectionIntent } from '../features/editorSelection';
import { beginMoveGesture, type MoveGesture, type LayoutTranslation } from '../features/layoutCommands';
import { sceneExtent, sceneLayout } from './graph';
import { connectionShapes, flowTopology, sharedPositionLinks, type FlowWalk } from './flowPresentation';
import { CATALOG_ASSETS, nodeCatalogAssets, type CatalogAsset } from './catalogAssets';
import { CatalogStore } from './CatalogStore';
import { AnimatedPeople } from './AnimatedPeople';
import { PeopleMotion, type PersonTarget } from './peopleMotion';
import { operatorTargets } from './operatorLayout';
import { placeLabel, type LabelRect } from './labelLayout';
import { stepKindLabels } from '../ui/messages/labels';
import { worldSceneMessages as m } from '../ui/messages/WorldScene';
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
}
type Disposable = { dispose(): void };
type Lifetime = { renderer: THREE.WebGLRenderer; store: CatalogStore; dispose(): void };
type VisualNode = { group: THREE.Group; art: THREE.Group; copies: THREE.Group[]; label: HTMLButtonElement; ring: THREE.Mesh; loaded: boolean; count: number };

/** Only sourced models are physical objects. Lines, rings and move guides are editor annotations. */
export function WorldScene(props: Props) {
  const mount = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const lifetime = useRef<Lifetime | null>(null), invalidate = useRef<() => void>(() => {});
  const cancelGesture = useRef<() => void>(() => {});
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const geometryKey = JSON.stringify([props.project.world, props.project.model.nodes.map(node => [node.id, node.kind, node.samplingId])]);

  useEffect(() => {
    const host = mount.current; if (!host) return;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
      renderer.domElement.dataset.testid = 'world-canvas'; renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('role', 'img');
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
      renderer.setClearColor('#e8ebed'); renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      const store = new CatalogStore(); let disposed = false;
      const instance: Lifetime = { renderer, store, dispose() {
        if (disposed) return; disposed = true; cancelGesture.current(); store.dispose();
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
        if (lifetime.current === instance) lifetime.current = null;
      } };
      lifetime.current = instance; host.prepend(renderer.domElement);
      return () => instance.dispose();
    } catch { setFailed(true); }
  }, []);

  useEffect(() => {
    if (!mount.current || !lifetime.current) return;
    const host = mount.current, owned = lifetime.current;
    const { renderer, store } = owned, canvas = renderer.domElement;
    let alive = true, scheduled = 0, renderCount = 0, pending = 0, loadErrors = 0;
    const resources = new Set<Disposable>(), cleanups: (() => void)[] = [];
    const own = <T extends Disposable>(value: T): T => { resources.add(value); return value; };
    const world = props.project.world, scene = new THREE.Scene();
    const people = new AnimatedPeople(scene), peopleMotion = new PeopleMotion(), loadedVariants = new Set<number>();
    const operatorAssignments = new Map<string, string>();
    let motionInitialized = false, motionRun = '', motionEpoch = -1, motionLayout = props.project.layout;
    let lastPlaying = false, settleUntil = 0, motionClock = -Infinity;
    let traceSnapshot: RunResult | null | undefined;
    const entities = new Map<string, RunResult['entities'][number]>(), completeLocations = new Map<string, string>();
    const camera = new THREE.OrthographicCamera(-16, 16, 12, -12, .1, 3000);
    const direction = new THREE.Vector3(8, 30, 50).normalize();
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false; controls.enableRotate = true; controls.screenSpacePanning = false;
    controls.minPolarAngle = .18; controls.maxPolarAngle = Math.PI / 2.15;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN; controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.minZoom = .65; controls.maxZoom = 6;
    renderer.setPixelRatio(Math.min(devicePixelRatio, props.quality === 'low' ? 1 : 1.6));
    renderer.shadowMap.enabled = props.quality !== 'low' && props.project.model.nodes.length <= 30;
    renderer.shadowMap.needsUpdate = true;
    const hemi = new THREE.HemisphereLight('#ffffff', '#9aa9b6', .9); scene.add(hemi);
    const sunlight = new THREE.DirectionalLight('#fff6e6', 3.2); sunlight.position.set(-12, 25, 18);
    sunlight.castShadow = renderer.shadowMap.enabled; sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.camera.left = -40; sunlight.shadow.camera.right = 40;
    sunlight.shadow.camera.top = 40; sunlight.shadow.camera.bottom = -40;
    sunlight.shadow.camera.far = 120; sunlight.shadow.normalBias = .025;
    own(sunlight.shadow); scene.add(sunlight);
    const fill = new THREE.DirectionalLight('#d9e8ff', .7); fill.position.set(15, 12, -8); scene.add(fill);
    const environment = new THREE.PMREMGenerator(renderer);
    new HDRLoader().load('/assets/environment/studio-small-09.hdr', texture => {
      if (!alive) { texture.dispose(); environment.dispose(); return; }
      const target = own(environment.fromEquirectangular(texture));
      scene.environment = target.texture; scene.environmentIntensity = .65;
      texture.dispose(); environment.dispose(); host.dataset.environment = 'Poly Haven Studio Small 09 / CC0'; requestRender();
    }, undefined, () => { environment.dispose(); if (alive) host.dataset.environment = 'analytic-lighting'; });
    const visuals = new Map<string, VisualNode>(), pickables: THREE.Mesh[] = [];
    const preview = new Map<string, Point>(), pickedSources = new Set<string>();
    let layout = sceneLayout(props.project), extent = sceneExtent(layout), topologyKey = '', currentConnection: number | null = null;
    let manualContext: { selected: string | null; topology: string; cursor: number | undefined } | null = null;
    let edgeGroup = new THREE.Group(), edgeOwned: Disposable[] = [];
    scene.add(edgeGroup);
    let floor: THREE.Group | null = null, floorDimensions = new THREE.Vector3(1, 1, 1);
    const labelLayer = document.createElement('div'); labelLayer.className = 'scene-labels'; host.appendChild(labelLayer);
    const readout = document.createElement('div'); readout.className = 'scene-move-readout'; readout.hidden = true; host.appendChild(readout);
    const loading = document.createElement('div'); loading.className = 'scene-loading'; loading.setAttribute('role', 'status'); host.appendChild(loading);
    setFailed(false); host.dataset.status = 'loading'; host.dataset.world = world; host.dataset.assetPolicy = 'catalog-first';
    function requestRender() {
      if (alive && !scheduled && !document.hidden) { host.dataset.renderPending = 'true'; scheduled = requestAnimationFrame(draw); }
    }
    invalidate.current = requestRender;
    const pointFor = (id: string) => preview.get(id) ?? layout[id];
    function status() {
      host.dataset.pendingAssets = String(pending); host.dataset.assetErrors = String(loadErrors);
      host.dataset.status = pending ? 'loading' : loadErrors ? 'partial' : 'ready';
      host.dataset.catalogAssets = JSON.stringify([...pickedSources]);
      loading.hidden = pending === 0; loading.textContent = `Loading equipment · ${pending} remaining`;
    }
    function load(url: string, accept: (model: THREE.Group) => void) {
      pending++; status();
      store.load(url).then(model => {
        if (!alive) return;
        pickedSources.add(url); accept(model); renderer.shadowMap.needsUpdate = true;
      }).catch(() => { if (alive) { loadErrors++; setFailed(true); } }).finally(() => {
        if (!alive) return; pending--; status(); requestRender();
      });
    }
    function modelCopy(template: THREE.Group, def: Pick<CatalogAsset, 'size' | 'turn' | 'metricScale'>) {
      const model = template.clone(true), box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      const normalizer = new THREE.Group(), scale = def.metricScale ?? def.size / Math.max(size.x, size.y, size.z, .001);
      model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z)); normalizer.add(model);
      normalizer.scale.setScalar(scale); normalizer.rotation.y = def.turn ?? 0;
      model.traverse(object => { if ((object as THREE.Mesh).isMesh) { const mesh = object as THREE.Mesh; mesh.castShadow = true; mesh.receiveShadow = true; } });
      return normalizer;
    }
    function addProxy(group: THREE.Group, id: string) {
      group.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(group).applyMatrix4(group.matrixWorld.clone().invert());
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1.6, 0, -.6), new THREE.Vector3(1.6, 2.7, 4.0));
      const size = bounds.getSize(new THREE.Vector3());
      const proxy = new THREE.Mesh(own(new THREE.BoxGeometry(Math.max(.15, size.x), Math.max(.15, size.y), Math.max(.15, size.z))), own(new THREE.MeshBasicMaterial({ visible: false })));
      proxy.position.copy(bounds.getCenter(new THREE.Vector3())); proxy.userData.nodeId = id; group.add(proxy); pickables.push(proxy);
    }
    const nodes = props.project.model.nodes, services = nodes.filter(node => node.kind === 'service');
    for (const node of nodes) {
      const group = new THREE.Group(), art = new THREE.Group(); group.add(art); scene.add(group);
      const ring = new THREE.Mesh(own(new THREE.RingGeometry(node.kind === 'service' ? 1.7 : 1.1, node.kind === 'service' ? 1.76 : 1.16, 48)), own(new THREE.MeshBasicMaterial({ color: '#74a942', side: THREE.DoubleSide, depthWrite: false })));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .14; group.add(ring);
      const label = document.createElement('button'); label.type = 'button'; label.className = 'station-label'; label.dataset.stationId = node.id;
      label.addEventListener('click', event => latest.current.onSelect(node.id, event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : latest.current.selectedIds?.includes(node.id) ? 'inspect' : 'single'));
      labelLayer.appendChild(label);
      const visual: VisualNode = { group, art, copies: [art], label, ring, loaded: false, count: -1 }; visuals.set(node.id, visual);
      const placements = nodeCatalogAssets(world, node, services.findIndex(service => service.id === node.id));
      if (!placements.length) { addProxy(art, node.id); visual.loaded = true; }
      if (node.kind === 'queue' && placements.length) { const zone = new THREE.Group(); art.add(zone); addProxy(zone, node.id); }
      for (const placement of placements) {
        const def = CATALOG_ASSETS[placement.asset];
        load(def.file, template => {
          const model = modelCopy(template, def); model.position.set(placement.x ?? 0, placement.y ?? 0, placement.z ?? 0);
          model.rotation.y += placement.turn ?? 0; model.scale.multiplyScalar(placement.scale ?? 1); art.add(model);
          // Rebuild only bounded representative cells after each model of a compound station arrives.
          for (const copy of visual.copies.slice(1)) copy.removeFromParent();
          const oldProxies = pickables.filter(mesh => mesh.userData.nodeId === node.id);
          for (const proxy of oldProxies) { proxy.removeFromParent(); pickables.splice(pickables.indexOf(proxy), 1); }
          visual.copies = [art];
          for (let i = 1; i < (node.kind === 'service' ? 3 : 1); i++) { const copy = art.clone(true); group.add(copy); visual.copies.push(copy); }
          for (const copy of visual.copies) addProxy(copy, node.id);
          visual.loaded = true; visual.count = -1;
        });
      }
    }
    load(CATALOG_ASSETS.floor.file, template => {
      floor = template.clone(true); floorDimensions = new THREE.Box3().setFromObject(floor).getSize(new THREE.Vector3());
      floor.traverse(object => { if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).receiveShadow = true; }); scene.add(floor);
    });
    // Only the missing human/plant categories use a separately licensed source.
    for (const offset of [-1, 1]) load('/assets/kenney/potted-plant.glb', template => {
      const plant = modelCopy(template, { size: 1.3 });
      plant.position.set(extent.x + offset * (extent.width / 2 - 1), 0, extent.minZ + 1); scene.add(plant);
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
    function fit() {
      layout = sceneLayout(latest.current.project); extent = sceneExtent(layout);
      const width = host.clientWidth, height = host.clientHeight; if (!width || !height) return;
      const target = new THREE.Vector3(extent.x, .5, extent.z); controls.target.copy(target);
      camera.position.copy(target).addScaledVector(direction, 80); camera.lookAt(target); camera.updateMatrixWorld(true);
      const corners: THREE.Vector3[] = [];
      for (const x of [extent.minX, extent.maxX]) for (const y of [-.2, 3.3]) for (const z of [extent.minZ, extent.maxZ]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
      const viewWidth = Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x));
      const viewHeight = Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y));
      const aspect = width / height, vertical = Math.max(viewHeight / .88, viewWidth / (aspect * .92));
      camera.left = -vertical * aspect / 2; camera.right = vertical * aspect / 2; camera.top = vertical / 2; camera.bottom = -vertical / 2;
      camera.zoom = 1; camera.updateProjectionMatrix(); controls.update(); requestRender();
    }
    const resize = new ResizeObserver(() => {
      if (!alive || !host.clientWidth || !host.clientHeight) return;
      renderer.setSize(host.clientWidth, host.clientHeight); fit();
    }); resize.observe(host);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let down: { x: number; y: number; id: number; node: string | null; origin: THREE.Vector3; toggle: boolean; person: boolean; gesture: MoveGesture | null; ids: string[]; dragging: boolean } | null = null;
    function hit(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
      const objectHit = raycaster.intersectObjects(pickables, false).find(result => {
        for (let object: THREE.Object3D | null = result.object; object; object = object.parent) if (!object.visible) return false;
        return true;
      });
      const person = people.pick(raycaster);
      if (person && (!objectHit || person.distance < objectHit.distance)) return { id: person.person.nodeId, person: true };
      return objectHit ? { id: objectHit.object.userData.nodeId as string, person: false } : null;
    }
    function cancel() {
      if (down && canvas.hasPointerCapture(down.id)) canvas.releasePointerCapture(down.id);
      down?.gesture?.cancel(); down = null; preview.clear(); controls.enabled = true; readout.hidden = true;
      delete host.dataset.movePreview; renderer.shadowMap.needsUpdate = true; requestRender();
    }
    cancelGesture.current = cancel;
    function pointerDown(event: PointerEvent) {
      if (event.button !== 0 || down) return;
      const picked = hit(event), node = picked?.id ?? null, origin = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(ground, origin)) return;
      const selected = latest.current.selectedIds ?? (latest.current.selected ? [latest.current.selected] : []);
      down = { x: event.clientX, y: event.clientY, id: event.pointerId, node, origin, person: Boolean(picked?.person), toggle: event.shiftKey || event.ctrlKey || event.metaKey, gesture: null, ids: node ? selected.includes(node) ? [...selected] : [node] : [], dragging: false };
      if (node && !picked?.person && latest.current.moving && latest.current.editable !== false) { controls.enabled = false; canvas.setPointerCapture(event.pointerId); }
    }
    function pointerMove(event: PointerEvent) {
      const picked = hit(event); canvas.style.cursor = picked ? picked.person ? 'pointer' : latest.current.moving ? 'move' : 'pointer' : 'grab';
      if (!down || down.id !== event.pointerId || !down.node || down.person || down.toggle || !latest.current.moving || latest.current.editable === false) return;
      if (!down.dragging && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) return;
      const point = new THREE.Vector3(); if (!raycaster.ray.intersectPlane(ground, point)) return;
      if (!down.gesture) { latest.current.onMoveStart?.(); down.dragging = true; down.gesture = beginMoveGesture(latest.current.project, down.ids, down.node); latest.current.onSelect(down.node, 'inspect'); }
      const next: LayoutTranslation | null = down.gesture.preview({ x: point.x - down.origin.x, z: point.z - down.origin.z });
      if (!next) return;
      preview.clear();
      if (!next.error) for (const id of next.ids) preview.set(id, next.points[id]);
      readout.hidden = false; readout.textContent = next.error ?? m.movePreview(next.ids.length, next.delta.x.toFixed(1), next.delta.z.toFixed(1), next.guides.length > 0);
      host.dataset.movePreview = JSON.stringify({ ids: next.ids, delta: next.delta, guides: next.guides }); renderer.shadowMap.needsUpdate = true; requestRender();
    }
    function pointerUp(event: PointerEvent) {
      if (!down || down.id !== event.pointerId) return;
      if (down.dragging) pointerMove(event);
      const finished = down, commit = finished.gesture?.finish();
      if (!finished.dragging && Math.hypot(event.clientX - finished.x, event.clientY - finished.y) < 5) latest.current.onSelect(finished.node, finished.toggle ? 'toggle' : latest.current.moving && finished.node && latest.current.selectedIds?.includes(finished.node) ? 'inspect' : 'single');
      cancel(); if (commit) latest.current.onMove?.(commit.ids, commit.delta);
    }
    function key(event: KeyboardEvent) { if (event.key === 'Escape' && down?.dragging) { event.preventDefault(); event.stopPropagation(); cancel(); } }
    const focus = () => {
      const p = pointFor(latest.current.selected ?? ''); if (!p) return;
      const target = new THREE.Vector3(p.x, .8, p.z), delta = target.clone().sub(controls.target);
      controls.target.copy(target); camera.position.add(delta); camera.zoom = 2; camera.updateProjectionMatrix(); controls.update(); requestRender();
    };
    const zoom = (event: Event) => { const factor = (event as CustomEvent).detail; if (factor !== 1.25 && factor !== .8) return; camera.zoom = Math.max(.65, Math.min(6, camera.zoom * factor)); camera.updateProjectionMatrix(); controls.update(); requestRender(); };
    const connection = (event: Event) => { const index = (event as CustomEvent).detail; const link = flowTopology(latest.current.project.model.nodes).links.find(link => link.index === index); if (!link) return; currentConnection = index; manualContext = { selected: latest.current.selected, topology: JSON.stringify(flowTopology(latest.current.project.model.nodes).links), cursor: latest.current.flow?.cursor }; const a = pointFor(link.from), b = pointFor(link.to); if (!a || !b) return; const target = new THREE.Vector3((a.x + b.x) / 2, 1, (a.z + b.z) / 2), delta = target.clone().sub(controls.target); controls.target.copy(target); camera.position.add(delta); camera.zoom = Math.max(1, Math.min(2.4, 12 / Math.max(4, Math.hypot(b.x - a.x, b.z - a.z)))); camera.updateProjectionMatrix(); controls.update(); requestRender(); };
    const visible = () => { if (!document.hidden) requestRender(); };
    controls.addEventListener('change', requestRender);
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', cancel);
    const lostCapture = () => { if (down) cancel(); }; canvas.addEventListener('lostpointercapture', lostCapture);
    host.addEventListener('queuelab:fit', fit); host.addEventListener('queuelab:focus', focus); host.addEventListener('queuelab:zoom', zoom); host.addEventListener('queuelab:cancel-move', cancel); host.addEventListener('queuelab:show-connection', connection);
    document.addEventListener('keydown', key, true); document.addEventListener('visibilitychange', visible);

    function edges() {
      edgeOwned.forEach(resource => resource.dispose()); edgeOwned = []; edgeGroup.clear();
      const topology = flowTopology(latest.current.project.model.nodes), shapes = connectionShapes(topology, Object.fromEntries([...visuals.keys()].map(id => [id, pointFor(id)])));
      const chosen = new Set(latest.current.flow?.walk.links.map(link => link.index) ?? []);
      const active = currentConnection ?? latest.current.flow?.walk.links[latest.current.flow.cursor]?.index;
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
    }
    function draw() {
      scheduled = 0; if (!alive) return;
      const current = latest.current; layout = sceneLayout(current.project); extent = sceneExtent(layout);
      canvas.setAttribute('aria-label', m.interactiveWorldLabel(current.project.name));
      const byId = new Map(current.project.model.nodes.map(node => [node.id, node])), selected = new Set(current.selectedIds ?? (current.selected ? [current.selected] : []));
      for (const [id, visual] of visuals) {
        const node = byId.get(id), p = pointFor(id); if (!node || !p) continue;
        visual.group.position.set(p.x, 0, p.z); visual.ring.visible = selected.has(id);
        const count = node.kind === 'service' ? Math.max(1, Math.min(3, Math.floor(node.servers))) : 1;
        if (visual.count !== count) {
          visual.count = count;
          visual.copies.forEach((copy, i) => { copy.visible = i < count; copy.scale.setScalar(1); copy.position.set(count === 1 ? 0 : i === 0 ? -1.65 : i === 1 ? 1.65 : 0, 0, count > 2 && i === 2 ? -3.2 : 0); });
          renderer.shadowMap.needsUpdate = true;
        }
        visual.label.setAttribute('aria-label', m.select(node.label, stepKindLabels[node.kind])); visual.label.setAttribute('aria-pressed', String(selected.has(id)));
        visual.label.classList.toggle('is-selected', selected.has(id));
        const queue = current.frame.queues[id] ?? 0;
        visual.label.textContent = `${node.label}${queue ? ` · ${m.waiting(queue)}` : node.kind === 'sink' && current.project.model.nodes.filter(item => item.kind === 'sink').length === 1 ? ` · ${current.frame.completed} completed` : ''}`;
      }
      if (floor) { floor.scale.set(extent.width / floorDimensions.x, 1, extent.depth / floorDimensions.z); floor.position.set(extent.x, -floorDimensions.y, extent.z); }
      if (manualContext && (manualContext.selected !== current.selected || manualContext.cursor !== current.flow?.cursor || manualContext.topology !== JSON.stringify(flowTopology(current.project.model.nodes).links))) { currentConnection = null; manualContext = null; }
      const edgeKey = JSON.stringify([current.project.model.nodes.map(node => [node.id, 'next' in node ? node.next : node.kind === 'route' ? node.branches : null]), layout, [...preview], current.selected, current.flow?.cursor, current.flow?.walk.links, currentConnection]);
      if (edgeKey !== topologyKey) { topologyKey = edgeKey; edges(); }
      if (traceSnapshot !== current.result) {
        traceSnapshot = current.result; entities.clear(); completeLocations.clear();
        for (const entity of current.result?.entities ?? []) entities.set(entity.id, entity);
        for (const event of current.result?.events ?? []) if (event.kind === 'complete') completeLocations.set(event.entityId, event.nodeId);
      }
      const personTargets: PersonTarget[] = [];
      const actorLimit = Math.min(500, current.frame.actors.length), rank: Record<string, number> = Object.create(null);
      const variantFor = (id: string) => { let hash = 0; for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0; return hash & 1; };
      const matrices: THREE.Matrix4[][] = Array.from({ length: 6 }, () => []);
      for (let i = 0; i < actorLimit; i++) {
        const actor = current.frame.actors[i], p = pointFor(actor.nodeId); if (!p) continue;
        const key = `${actor.nodeId}:${actor.state}`, position = rank[key] ?? 0; rank[key] = position + 1;
        const modeledNode = byId.get(actor.nodeId);
        if (world === 'factory' && actor.state === 'working' && modeledNode?.kind === 'service') {
          const slots = Math.min(3, Math.max(1, modeledNode.servers)), slot = position % slots;
          const x = p.x + (slots === 1 ? 0 : slot === 0 ? -1.65 : slot === 1 ? 1.65 : 0);
          const z = p.z + (slots > 2 && slot === 2 ? -3.2 : 0);
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
      const effectiveLayout = { ...layout, ...Object.fromEntries(preview) };
      personTargets.push(...operatorTargets(current.project, current.frame, effectiveLayout, operatorAssignments));
      const now = performance.now();
      const resetLocation = !motionInitialized || current.frame.time < motionClock || motionRun !== (current.runKey ?? '') || motionEpoch !== (current.seekEpoch ?? 0) || motionLayout !== current.project.layout || preview.size > 0 || current.reducedMotion;
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
        const point = destination ? pointFor(destination) : null;
        return point && destination ? { ...person, nodeId: destination, position: { x: point.x, y: 0, z: point.z + 1 } } : null;
      } });
      people.update(motion.people);
      if (resetMotion || animate) renderer.shadowMap.needsUpdate = true;
      if (!motion.moving) settleUntil = 0;
      motionInitialized = true; motionRun = current.runKey ?? ''; motionEpoch = current.seekEpoch ?? 0; motionLayout = current.project.layout; motionClock = current.frame.time; lastPlaying = Boolean(current.playing);
      if (animate && motion.moving) requestRender();
      const sinks = current.project.model.nodes.filter(node => node.kind === 'sink'), exit = sinks.length === 1 ? sinks[0] : null, exitPoint = exit ? pointFor(exit.id) : null;
      const completedMarkers = exit ? Math.min(world === 'factory' ? 24 : 0, current.frame.completed) : 0;
      if (exitPoint) for (let i = 0; i < completedMarkers; i++) {
        dummy.position.set(exitPoint.x + (i % 4) * .37 - .55, world === 'factory' ? .313 : 0, exitPoint.z + .6 + Math.floor(i / 4) * .42);
        dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); matrices[world === 'factory' ? 4 : 4 + i % 2].push(dummy.matrix.clone());
      }
      for (const { mesh, variant } of actorBatches) { const values = matrices[variant]; mesh.count = values.length; values.forEach((matrix, i) => mesh.setMatrixAt(i, matrix)); mesh.instanceMatrix.needsUpdate = true; }
      camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
      const occupied: LabelRect[] = [];
      for (const [id, visual] of [...visuals].sort(([a], [b]) => a === current.selected ? -1 : b === current.selected ? 1 : 0)) {
        const p = pointFor(id); if (!p) continue;
        const projected = new THREE.Vector3(p.x, byId.get(id)?.kind === 'service' ? 3 : byId.get(id)?.kind === 'queue' ? world === 'factory' ? .9 : 2.7 : byId.get(id)?.kind === 'route' || byId.get(id)?.kind === 'delay' ? .5 : world === 'factory' ? 1.1 : 2.7, p.z).project(camera);
        const width = visual.label.offsetWidth || 130, height = visual.label.offsetHeight || 30;
        const placed = placeLabel({ x: (projected.x * .5 + .5) * host.clientWidth - width / 2, y: (-projected.y * .5 + .5) * host.clientHeight - height, width, height }, { width: host.clientWidth, height: host.clientHeight }, occupied, []);
        visual.label.hidden = !placed;
        if (placed) { occupied.push(placed); visual.label.style.left = `${placed.x}px`; visual.label.style.top = `${placed.y}px`; }
      }
      renderer.render(scene, camera); host.dataset.renderCount = String(++renderCount); host.dataset.renderPending = 'false';
      const represented = [...new Set(actorBatches.map(batch => batch.variant))].filter(variant => variant < (world === 'factory' ? 1 : 2)).reduce((count, variant) => count + matrices[variant].length, 0);
      host.dataset.operatorRepresentations = String(motion.people.filter(person => person.role === 'operator' && loadedVariants.has(person.variant)).length); host.dataset.walkingPeople = String(motion.people.filter(person => person.moving && loadedVariants.has(person.variant)).length); host.dataset.completedRepresentations = String(completedMarkers);
      host.dataset.actorCount = String(world === 'factory' ? represented : motion.people.filter(person => person.role === 'visitor' && current.frame.actors.some(actor => actor.id === person.id) && loadedVariants.has(person.variant)).length); host.dataset.retainedActorCount = String(current.frame.actors.length); host.dataset.nodeCount = String(visuals.size); host.dataset.camera = JSON.stringify({ position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom });
    }
    fit(); requestRender();
    return () => {
      alive = false; cancelGesture.current = () => {}; invalidate.current = () => {}; cancelAnimationFrame(scheduled); cancel();
      resize.disconnect(); controls.dispose(); document.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', visible);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('lostpointercapture', lostCapture);
      host.removeEventListener('queuelab:fit', fit); host.removeEventListener('queuelab:focus', focus); host.removeEventListener('queuelab:zoom', zoom); host.removeEventListener('queuelab:cancel-move', cancel); host.removeEventListener('queuelab:show-connection', connection);
      cleanups.forEach(cleanup => cleanup()); edgeOwned.forEach(resource => resource.dispose()); resources.forEach(resource => resource.dispose());
      people.dispose(); peopleMotion.clear(); scene.clear(); renderer.renderLists.dispose(); labelLayer.remove(); readout.remove(); loading.remove(); host.dataset.renderPending = 'false';
    };
  }, [geometryKey, props.quality, props.resetKey, attempt]);
  useEffect(() => { invalidate.current(); }, [props.project, props.frame, props.selected, props.selectedIds, props.moving, props.flow, props.reducedMotion, props.playing, props.seekEpoch, props.runKey]);
  useEffect(() => { cancelGesture.current(); }, [props.project.id, props.project.revision, props.moving]);
  return <div ref={mount} className={`world-scene catalog-world ${props.moving ? 'is-moving' : ''}`} data-testid="world-scene">
    <div className="scene-camera-tools" role="group" aria-label={m.worldCamera}><button aria-label={m.zoomIn} onClick={() => mount.current?.dispatchEvent(new CustomEvent('queuelab:zoom', { detail: 1.25 }))}><Plus size={17} /></button><button aria-label={m.zoomOut} onClick={() => mount.current?.dispatchEvent(new CustomEvent('queuelab:zoom', { detail: .8 }))}><Minus size={17} /></button><button aria-label={m.showWholeWorld} onClick={() => mount.current?.dispatchEvent(new Event('queuelab:fit'))}><Focus size={17} /></button></div>
    {failed && <div className="scene-asset-warning" role="status">Some equipment could not load. Model editing remains available.<button onClick={() => setAttempt(value => value + 1)}><RotateCcw size={14} />Retry assets</button></div>}
  </div>;
}
