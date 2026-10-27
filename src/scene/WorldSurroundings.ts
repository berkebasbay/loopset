import * as THREE from 'three';
import type { World } from '../model/types';
import type { sceneExtent } from './graph';

type Extent = ReturnType<typeof sceneExtent>;
type Load = (file: string, accept: (template: THREE.Group) => void) => void;
type Placement = { x: number; z: number; y?: number; turn?: number; height?: number; width?: number; depth?: number; scale?: number };
type Part = { object: THREE.Group; place: (extent: Extent) => Placement; natural: THREE.Vector3 };
const nvidia = (name: string) => `/assets/simready/${name}.glb`;
const kenney = (pack: string, name: string) => `/assets/kenney/${pack}/${name}.glb`;

/** Sourced scenery only: no model nodes, pick volumes, clocks or simulation data. */
export class WorldSurroundings {
  private readonly root = new THREE.Group();
  private readonly back = new THREE.Group();
  private readonly side = new THREE.Group();
  private readonly parts: Part[] = [];
  private readonly materials = new Map<THREE.Material, THREE.Material>();
  private readonly annotations = new THREE.Group();
  private readonly annotationMaterial = new THREE.LineBasicMaterial({ color: '#d7d7be', transparent: true, opacity: .8 });
  private readonly world: World;
  private extent: Extent;
  private extentKey = '';

  constructor(scene: THREE.Scene, world: World, extent: Extent, load: Load) {
    this.extent = extent; this.world = world;
    this.root.name = `${world}-surroundings`;
    this.root.userData.scenery = true;
    this.root.add(this.back, this.side, this.annotations); scene.add(this.root);
    const add = (file: string, place: Part['place'], parent = this.root) => load(file, template => {
      const model = template.clone(true);
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
      if (box.isEmpty() || !Number.isFinite(size.length())) throw new Error('Invalid scenery geometry');
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
      const object = new THREE.Group(); object.add(model);
      model.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh; mesh.castShadow = file !== nvidia('environment_floor_a01') && file !== kenney('nature-kit', 'ground_grass'); mesh.receiveShadow = true;
          const adapt = (source: THREE.Material) => {
            const cached = this.materials.get(source); if (cached) return cached;
            const material = source.clone() as THREE.MeshStandardMaterial;
            if (material.isMeshStandardMaterial) {
              if (/leafs/i.test(material.name)) { material.color.set('#5f7c45'); material.metalness = 0; }
              if (material.name === 'grass') { material.color.set('#5b7d4c'); material.metalness = 0; }
              if (material.name === 'woodBark') { material.color.set('#80613e'); material.metalness = 0; }
              if (material.name === 'wood') material.color.set('#b99a71');
              if (material.name === 'red') material.color.set(world === 'festival' ? '#be674d' : '#788666');
              if (file === nvidia('environment_floor_a01')) { material.color.set(world === 'festival' ? '#626b73' : world === 'service' ? '#b5ad9f' : '#8d979e'); material.roughness = .9; }
              if (file === kenney('racing-kit', 'overheadLights')) {
                if (material.name === 'grey') { material.color.set('#57636b'); material.metalness = .45; material.roughness = .45; }
                if (material.name === 'road') material.color.set('#262c32');
                if (material.name === 'red') { material.color.set('#fff0c4'); material.emissive.set('#ffc86a'); material.emissiveIntensity = .65; material.roughness = .25; }
              }
              if (file === kenney('racing-kit', 'tentRoofDouble')) {
                if (material.name === 'grass') { material.color.set('#c7b28b'); material.metalness = 0; }
                if (material.name === 'grey') { material.color.set('#697579'); material.metalness = .35; }
              }
              if (material.name === 'glass') { material.color.set('#b7cdd5'); material.opacity = .25; material.depthWrite = false; }
            }
            this.materials.set(source, material); return material;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(adapt) : adapt(mesh.material);
        }
      });
      parent.add(object); this.parts.push({ object, natural: size, place });
      this.position(this.parts.at(-1)!, this.extent);
    });

    // A real ground asset extends beyond the active slab; this removes the
    // floating-video-screen impression without obscuring the process controls.
    add(world !== 'festival' ? nvidia('environment_floor_a01') : kenney('nature-kit', 'ground_grass'), e => ({ x: e.x + 4, z: e.z, y: -.32, width: e.width + 38, depth: e.depth + 30, height: .25 }));

    if (world === 'factory') {
      // The source is an actual steel-framed wall, viewed from its room side.
      for (let i = 0; i < 4; i++) add(nvidia('structure_wall_straight_a01'), e => ({ x: e.minX + (i + .5) * e.width / 4, z: e.minZ - .5, width: .28, depth: e.width / 4, height: 4.4, turn: -Math.PI / 2 }), this.back);
      for (let i = 0; i < 2; i++) add(nvidia('structure_wall_straight_a01'), e => ({ x: e.minX - .4, z: e.minZ + (i + .5) * 3.2, width: .28, depth: 3.2, height: 4.4 }), this.side);
      add(nvidia('storage_shelf_basic_a01'), e => ({ x: e.minX + 2.8, z: e.minZ + .8, height: 3.1, turn: Math.PI / 2 }));
      for (let i = 0; i < 5; i++) add(nvidia('box_corrugated_brown_b08-actor'), e => ({ x: e.minX + 1.9 + i % 3 * .6, z: e.minZ + .8, y: .35 + Math.floor(i / 3) * 1.05, height: .45 }));
      add(nvidia('furniture_workbench_standard_e01'), e => ({ x: e.maxX - 2.3, z: e.minZ + .8, height: 1.7, turn: -Math.PI / 2 }));
      for (const side of [-1, 1]) {
        add(nvidia('lamp_ceiling_1m_rectangle_a01'), e => ({ x: e.x + side * e.width * .25, z: e.minZ + .4, y: 4.05, width: 3.5, height: .2, depth: 1.2 }));
        add(nvidia('pallet_a01'), e => ({ x: e.maxX + 1.7, z: e.z + side * 1.8, height: .27 }));
      }
      // Actual open garage bays and sourced loading stock, not invented vehicles.
      add(kenney('racing-kit', 'pitsGarage'), e => ({ x: e.maxX + 6.4, z: e.minZ + 2.6, width: 5.8, height: 3, depth: 4 }));
      for (let i = 0; i < 4; i++) {
        add(nvidia('pallet_a01'), e => ({ x: e.maxX + 3.2 + i % 2 * 2.2, z: e.z + 2.2 + Math.floor(i / 2) * 2, height: .27 }));
        add(nvidia('box_corrugated_brown_b08-actor'), e => ({ x: e.maxX + 3.2 + i % 2 * 2.2, z: e.z + 2.2 + Math.floor(i / 2) * 2, y: .3, height: .8 }));
      }
    } else if (world === 'festival') {
      for (const side of [-1, 1]) {
        add(kenney('racing-kit', side < 0 ? 'tentLong' : 'tent'), e => ({ x: e.x + side * e.width * .26, z: e.minZ - .7, height: 3.8, turn: Math.PI }));
        add(kenney('racing-kit', 'lightPostModern'), e => ({ x: e.x + side * (e.width / 2 + .4), z: e.minZ + 3, height: 4.5 }));
        add(kenney('furniture-kit', 'bench'), e => ({ x: e.x + side * (e.width / 2 + 1.8), z: e.z + 1, height: 1.15, turn: side * Math.PI / 2 }));
      }
      // A real event field: pavilion, lighting truss and audience stands.
      add(nvidia('environment_floor_a01'), e => ({ x: e.maxX + 7.4, z: e.minZ - .5, y: -.05, width: 7.8, height: .45, depth: 4.8 }));
      add(kenney('racing-kit', 'tentRoofDouble'), e => ({ x: e.maxX + 7.4, z: e.minZ - .7, y: .4, width: 8.2, height: 4.1, depth: 5.2 }));
      add(kenney('racing-kit', 'overheadLights'), e => ({ x: e.maxX + 7.4, z: e.minZ + 1.3, y: .4, width: 7.2, height: 4, depth: .45 }));
      for (const side of [-1, 1]) add(kenney('racing-kit', 'grandStand'), e => ({ x: e.maxX + 7.4 + side * 5, z: e.z - .5, width: 4.4, height: 2.5, depth: 2.6, turn: side * Math.PI / 3 }));
    } else {
      for (let i = 0; i < 4; i++) add(kenney('furniture-kit', 'wallWindow'), e => ({ x: e.minX + (i + .5) * (e.width + 8) / 4, z: e.minZ - .4, width: (e.width + 8) / 4, depth: .22, height: 4.1 }), this.back);
      for (let i = 0; i < 2; i++) add(kenney('furniture-kit', 'wallHalf'), e => ({ x: e.minX - .3, z: e.minZ + (i + .5) * 3, width: 3, depth: .22, height: 1.5, turn: Math.PI / 2 }), this.side);
      add(kenney('furniture-kit', 'bookcaseOpen'), e => ({ x: e.minX + 2.2, z: e.minZ + .7, height: 2.5 }));
      add(kenney('furniture-kit', 'bench'), e => ({ x: e.maxX - 2.4, z: e.minZ + .8, height: 1.1, turn: Math.PI }));
      add(kenney('furniture-kit', 'rugRectangle'), e => ({ x: e.maxX - 2.4, z: e.minZ + 1.7, width: 4.4, depth: 2.6, height: .025, y: .02 }));
      for (const side of [-1, 1]) add('/assets/kenney/potted-plant.glb', e => ({ x: e.x + side * (e.width / 2 - .7), z: e.minZ + 1.4, height: 2.2 }));
      add(kenney('furniture-kit', 'loungeSofa'), e => ({ x: e.maxX + 4.1, z: e.minZ + 1.1, width: 3.8, height: 1.1, depth: 1.3, turn: Math.PI }));
      add(kenney('furniture-kit', 'table'), e => ({ x: e.maxX + 4.1, z: e.z + .2, width: 3.3, height: .9, depth: 2 }));
      for (const side of [-1, 1]) add(nvidia('chair_office_amf_black_a01'), e => ({ x: e.maxX + 4.1, z: e.z + .2 + side * 1.6, height: 1.3, turn: side > 0 ? Math.PI : 0 }));
    }
    // Boundary landscaping, at the sides rather than in the working lanes.
    for (const side of [-1, 1]) add('/assets/kenney/potted-plant.glb', e => ({ x: e.x + side * (e.width / 2 + .3), z: e.maxZ - .8, height: 1.2 }));
  }

  viewExtent() {
    const e = this.extent, extra = this.world === 'festival' ? 14 : this.world === 'factory' ? 10 : 8;
    const minX = e.minX, maxX = e.maxX + extra, minZ = e.minZ - (this.world === 'festival' ? 4 : 1), maxZ = e.maxZ + 2;
    return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  }

  festivalDestination(id: string) {
    let hash = 0; for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    return { x: this.extent.maxX + 5.3 + hash % 8 * .6, y: 0, z: this.extent.z - 1.5 + Math.floor(hash / 8) % 6 * .6 };
  }

  festivalHeading(id: string) {
    const point = this.festivalDestination(id);
    return Math.atan2(this.extent.maxX + 7.4 - point.x, this.extent.minZ - .5 - point.z);
  }

  private markPaths() {
    for (const child of [...this.annotations.children]) { (child as THREE.LineSegments).geometry.dispose(); child.removeFromParent(); }
    const e = this.extent, points: THREE.Vector3[] = [];
    const line = (x1: number, z1: number, x2: number, z2: number) => points.push(new THREE.Vector3(x1, -.055, z1), new THREE.Vector3(x2, -.055, z2));
    if (this.world === 'factory') {
      for (let i = 0; i < 5; i++) line(e.maxX + 1.5, e.z + i * 1.5, e.maxX + 8.5, e.z + i * 1.5);
      line(e.maxX + 1.5, e.z, e.maxX + 1.5, e.z + 6); line(e.maxX + 8.5, e.z, e.maxX + 8.5, e.z + 6);
    } else if (this.world === 'festival') {
      for (const side of [-1, 1]) { line(e.maxX - 1, e.z + side * .75, e.maxX + 4.2, e.z + side * .75); line(e.maxX + 4.2, e.z + side * .75, e.maxX + 7.4, e.z - 2.6 + side * .75); }
    }
    if (points.length) this.annotations.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), this.annotationMaterial));
  }

  private position(part: Part, extent: Extent) {
    const p = part.place(extent), { natural, object } = part;
    const scale = p.scale ?? (p.height ? p.height / Math.max(.001, natural.y) : 1);
    object.scale.set(p.width ? p.width / Math.max(.001, natural.x) : scale, p.height ? p.height / Math.max(.001, natural.y) : scale, p.depth ? p.depth / Math.max(.001, natural.z) : scale);
    object.position.set(p.x, p.y ?? .01, p.z); object.rotation.y = p.turn ?? 0;
  }

  update(extent: Extent, camera: THREE.Camera): boolean {
    const key = [extent.minX, extent.maxX, extent.minZ, extent.maxZ].join(':');
    const changed = key !== this.extentKey;
    this.extent = extent;
    if (changed) { this.extentKey = key; this.parts.forEach(part => this.position(part, extent)); this.markPaths(); }
    // Cutaway walls disappear when orbiting outside that side of the room.
    const backVisible = camera.position.z >= extent.minZ, sideVisible = camera.position.x >= extent.minX;
    const visibilityChanged = this.back.visible !== backVisible || this.side.visible !== sideVisible;
    this.back.visible = backVisible; this.side.visible = sideVisible;
    return changed || visibilityChanged;
  }

  dispose() { this.root.removeFromParent(); this.annotations.children.forEach(child => (child as THREE.LineSegments).geometry.dispose()); this.annotationMaterial.dispose(); this.root.clear(); this.parts.length = 0; this.materials.forEach(material => material.dispose()); this.materials.clear(); }
}
