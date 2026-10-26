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
  private extent: Extent;
  private extentKey = '';

  constructor(scene: THREE.Scene, world: World, extent: Extent, load: Load) {
    this.extent = extent;
    this.root.name = `${world}-surroundings`;
    this.root.userData.scenery = true;
    this.root.add(this.back, this.side); scene.add(this.root);
    const add = (file: string, place: Part['place'], parent = this.root) => load(file, template => {
      const model = template.clone(true);
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
      if (box.isEmpty() || !Number.isFinite(size.length())) throw new Error('Invalid scenery geometry');
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
      const object = new THREE.Group(); object.add(model);
      model.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh; mesh.castShadow = true; mesh.receiveShadow = true;
          const adapt = (source: THREE.Material) => {
            const cached = this.materials.get(source); if (cached) return cached;
            const material = source.clone() as THREE.MeshStandardMaterial;
            if (material.isMeshStandardMaterial) {
              if (/leafs/i.test(material.name)) { material.color.set('#5f7c45'); material.metalness = 0; }
              if (material.name === 'grass') { material.color.set('#5b7d4c'); material.metalness = 0; }
              if (material.name === 'woodBark') { material.color.set('#80613e'); material.metalness = 0; }
              if (material.name === 'wood') material.color.set('#b99a71');
              if (material.name === 'red') material.color.set(world === 'festival' ? '#be674d' : '#788666');
              if (file === nvidia('environment_floor_a01')) { material.color.set('#8d979e'); material.roughness = .9; }
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
    add(world === 'factory' ? nvidia('environment_floor_a01') : kenney('nature-kit', 'ground_grass'), e => ({ x: e.x, z: e.z, y: -.32, width: e.width + 38, depth: e.depth + 36, height: .25 }));
    const tree = (x: number, z: number, height: number, detailed = false) => add(kenney('nature-kit', detailed ? 'tree_detailed' : 'tree_oak'), e => ({ x: e.x + x * (e.width / 2 + 3), z: z < 0 ? e.minZ + z : e.maxZ + z, height, turn: x * 1.4 }));

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
      tree(1, -2, 4.5); tree(-1, -2.6, 5.4, true);
    } else if (world === 'festival') {
      for (const side of [-1, 1]) {
        add(kenney('racing-kit', side < 0 ? 'tentLong' : 'tent'), e => ({ x: e.x + side * e.width * .26, z: e.minZ - .7, height: 3.8, turn: Math.PI }));
        add(kenney('racing-kit', 'lightPostModern'), e => ({ x: e.x + side * (e.width / 2 + .4), z: e.minZ + 3, height: 4.5 }));
        add(kenney('furniture-kit', 'bench'), e => ({ x: e.x + side * (e.width / 2 + 1.8), z: e.z + 1, height: 1.15, turn: side * Math.PI / 2 }));
      }
      tree(-1, -2.5, 5.6, true); tree(1, -3, 5.1); tree(-1.22, -1, 4.2); tree(1.22, -1, 4.7, true);
      for (const side of [-1, 1]) add(kenney('nature-kit', 'stone_largeA'), e => ({ x: e.x + side * (e.width / 2 + 4), z: e.maxZ - 1, height: .7, turn: side }));
    } else {
      for (let i = 0; i < 4; i++) add(kenney('furniture-kit', 'wallWindow'), e => ({ x: e.minX + (i + .5) * e.width / 4, z: e.minZ - .4, width: e.width / 4, depth: .22, height: 4.1 }), this.back);
      for (let i = 0; i < 2; i++) add(kenney('furniture-kit', 'wallHalf'), e => ({ x: e.minX - .3, z: e.minZ + (i + .5) * 3, width: 3, depth: .22, height: 1.5, turn: Math.PI / 2 }), this.side);
      add(kenney('furniture-kit', 'bookcaseOpen'), e => ({ x: e.minX + 2.2, z: e.minZ + .7, height: 2.5 }));
      add(kenney('furniture-kit', 'bench'), e => ({ x: e.maxX - 2.4, z: e.minZ + .8, height: 1.1, turn: Math.PI }));
      add(kenney('furniture-kit', 'rugRectangle'), e => ({ x: e.maxX - 2.4, z: e.minZ + 1.7, width: 4.4, depth: 2.6, height: .025, y: .02 }));
      for (const side of [-1, 1]) add('/assets/kenney/potted-plant.glb', e => ({ x: e.x + side * (e.width / 2 - .7), z: e.minZ + 1.4, height: 2.2 }));
      tree(-1, -3, 5.3, true); tree(1, -3, 5.5);
    }
    // Boundary landscaping, at the sides rather than in the working lanes.
    for (const side of [-1, 1]) add('/assets/kenney/potted-plant.glb', e => ({ x: e.x + side * (e.width / 2 + .3), z: e.maxZ - .8, height: 1.2 }));
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
    if (changed) { this.extentKey = key; this.parts.forEach(part => this.position(part, extent)); }
    // Cutaway walls disappear when orbiting outside that side of the room.
    const backVisible = camera.position.z >= extent.minZ, sideVisible = camera.position.x >= extent.minX;
    const visibilityChanged = this.back.visible !== backVisible || this.side.visible !== sideVisible;
    this.back.visible = backVisible; this.side.visible = sideVisible;
    return changed || visibilityChanged;
  }

  dispose() { this.root.removeFromParent(); this.root.clear(); this.parts.length = 0; this.materials.forEach(material => material.dispose()); this.materials.clear(); }
}
