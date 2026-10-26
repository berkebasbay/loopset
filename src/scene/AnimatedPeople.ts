import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export type PersonDraw = {
  id: string;
  variant: number;
  nodeId: string;
  role: 'visitor' | 'operator';
  position: { x: number; y: number; z: number };
  heading: number;
  moving: boolean;
  distance: number;
  activity?: 'work';
  activityPhase?: number;
};

const PERSON_LIMIT = 600;
const WALK_POSES = 16;
const WORK_POSES = 16;
const WORK_START = 1 + WALK_POSES;
type ActorMaterial = THREE.Material | THREE.Material[];
type ActorMesh = THREE.InstancedMesh<THREE.BufferGeometry, ActorMaterial>;
type PosePart = { geometry: THREE.BufferGeometry; material: ActorMaterial };
type Pose = { parts: PosePart[] };
type Variant = { template: THREE.Group; height: number; poses: Pose[]; scale: number; workChecked: boolean };
type Bucket = { variant: number; pose: number; capacity: number; meshes: ActorMesh[] };
type RawPose = { parts: PosePart[]; bounds: THREE.Box3; anchor: THREE.Vector3 };

function terminalName(clip: THREE.AnimationClip) {
  return clip.name.split('|').at(-1)?.toLowerCase() ?? '';
}

function visibleMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute('position')?.count) return;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (!parent.visible) return;
    if (Math.abs(object.matrixWorld.determinant()) < 1e-12) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.every(material => !material.visible)) return;
    result.push(mesh);
  });
  return result;
}

/** Bake the source animation after skinning; the cached source is never mutated. */
function samplePose(root: THREE.Group): RawPose {
  root.updateMatrixWorld(true);
  const parts: PosePart[] = [], bounds = new THREE.Box3();
  const vector = new THREE.Vector3();
  try { for (const mesh of visibleMeshes(root)) {
    const geometry = mesh.geometry.clone();
    parts.push({ geometry, material: mesh.material });
    const sourcePositions = mesh.geometry.getAttribute('position');
    // glTF may use normalized integer positions. World-space skinned output
    // needs floats rather than writing metres back into a quantized attribute.
    const positions = new THREE.Float32BufferAttribute(new Float32Array(sourcePositions.count * 3), 3);
    geometry.setAttribute('position', positions);
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.update();
    for (let index = 0; index < sourcePositions.count; index++) {
      vector.fromBufferAttribute(sourcePositions, index);
      if (skinned.isSkinnedMesh) skinned.applyBoneTransform(index, vector);
      vector.applyMatrix4(mesh.matrixWorld);
      positions.setXYZ(index, vector.x, vector.y, vector.z);
    }
    geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
    geometry.morphAttributes = {}; geometry.morphTargetsRelative = false;
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!);
  } } catch (error) { parts.forEach(part => part.geometry.dispose()); throw error; }
  if (bounds.isEmpty() || !Number.isFinite(bounds.max.length())) {
    parts.forEach(part => part.geometry.dispose());
    throw new Error('The person source has no visible finite body geometry.');
  }
  // Body/hips anchor removes root XZ translation while keeping the source limbs.
  const body = root.getObjectByName('Body') ?? root.getObjectByName('Hips') ?? root.getObjectByName('Root');
  const anchor = body ? body.getWorldPosition(new THREE.Vector3()) : bounds.getCenter(new THREE.Vector3());
  return { parts, bounds, anchor };
}

function groundPose(raw: RawPose, scale: number): Pose {
  try { for (const part of raw.parts) {
    part.geometry.translate(-raw.anchor.x, -raw.bounds.min.y, -raw.anchor.z);
    part.geometry.scale(scale, scale, scale);
    part.geometry.computeVertexNormals();
    part.geometry.computeBoundingBox(); part.geometry.computeBoundingSphere();
  } } catch (error) { raw.parts.forEach(part => part.geometry.dispose()); throw error; }
  return { parts: raw.parts };
}

function releasePoseSource(root: THREE.Group, mixer: THREE.AnimationMixer) {
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse(object => { const skinned = object as THREE.SkinnedMesh; if (skinned.isSkinnedMesh) skeletons.add(skinned.skeleton); });
  skeletons.forEach(skeleton => skeleton.dispose());
}

function bakeVariant(template: THREE.Group, height: number): { poses: Pose[]; scale: number } {
  const idle = template.animations.find(clip => terminalName(clip) === 'idle')
    ?? template.animations.find(clip => ['man_idle', 'woman_idle'].includes(terminalName(clip)));
  const walk = template.animations.find(clip => terminalName(clip) === 'walk')
    ?? template.animations.find(clip => ['walking', 'man_walking', 'woman_walking'].includes(terminalName(clip)));
  if (!idle || !Number.isFinite(idle.duration) || idle.duration < 0) throw new Error(`Person source “${template.name || 'unnamed'}” has no usable exact Idle animation.`);
  if (!walk || !Number.isFinite(walk.duration) || walk.duration <= 0) {
    throw new Error(`Person source “${template.name || 'unnamed'}” has no usable Walk animation; it cannot be shown gliding.`);
  }
  const root = cloneSkeleton(template) as THREE.Group;
  const mixer = new THREE.AnimationMixer(root);
  const poses: Pose[] = [];
  try {
    const idleAction = mixer.clipAction(idle); idleAction.reset().play();
    mixer.setTime(Math.min(.2, Math.max(0, idle.duration * .25)));
    const rawIdle = samplePose(root);
    const sourceHeight = rawIdle.bounds.max.y - rawIdle.bounds.min.y;
    if (!(sourceHeight > 0)) {
      rawIdle.parts.forEach(part => part.geometry.dispose());
      throw new Error('The person source has no measurable body height.');
    }
    // One fixed scale for every pose avoids changing body size during a stride.
    const scale = height / sourceHeight;
    poses.push(groundPose(rawIdle, scale));
    mixer.stopAllAction();
    const action = mixer.clipAction(walk); action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    for (let frame = 0; frame < WALK_POSES; frame++) {
      mixer.setTime(walk.duration * frame / WALK_POSES);
      poses.push(groundPose(samplePose(root), scale));
    }
    return { poses, scale };
  } catch (error) {
    poses.forEach(pose => pose.parts.forEach(part => part.geometry.dispose()));
    throw error;
  } finally {
    releasePoseSource(root, mixer);
  }
}

/** Optional bank: only an exact Interact clip may illustrate work. */
function bakeWorkPoses(template: THREE.Group, scale: number): Pose[] {
  const clip = template.animations.find(clip => terminalName(clip) === 'interact');
  if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) return [];
  const root = cloneSkeleton(template) as THREE.Group, mixer = new THREE.AnimationMixer(root), poses: Pose[] = [];
  try {
    mixer.clipAction(clip).reset().setLoop(THREE.LoopRepeat, Infinity).play();
    for (let frame = 0; frame < WORK_POSES; frame++) {
      mixer.setTime(clip.duration * frame / WORK_POSES);
      poses.push(groundPose(samplePose(root), scale));
    }
    return poses;
  } catch (error) {
    poses.forEach(pose => pose.parts.forEach(part => part.geometry.dispose()));
    throw error;
  } finally { releasePoseSource(root, mixer); }
}

/** Source-posed, distance-driven instancing. The owning scene drives all updates. */
export class AnimatedPeople {
  private readonly scene: THREE.Scene;
  private readonly variants = new Map<number, Variant>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly proxyGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private readonly proxy = new THREE.InstancedMesh(this.proxyGeometry, this.proxyMaterial, PERSON_LIMIT);
  private readonly transform = new THREE.Object3D();
  private readonly drawn: PersonDraw[] = [];
  private disposed = false;
  private count = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.proxy.count = 0; this.proxy.frustumCulled = false;
    this.proxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.proxy.userData.readOnlyNPC = true;
    scene.add(this.proxy);
  }

  get renderedCount() { return this.count; }

  addVariant(variant: number, template: THREE.Group, height = 2.4) {
    if (this.disposed) return;
    if (!Number.isInteger(variant) || variant < 0 || !Number.isFinite(height) || height <= 0) {
      throw new Error('A person variant needs a nonnegative integer identity and a positive finite height.');
    }
    const previous = this.variants.get(variant);
    if (previous?.template === template && previous.height === height) return;
    // Bake before replacing an existing bank, so a bad source cannot destroy it.
    const bank = bakeVariant(template, height);
    if (previous) {
      for (const [key, bucket] of this.buckets) if (bucket.variant === variant) { this.disposeBucket(bucket); this.buckets.delete(key); }
      this.disposeVariant(previous);
    }
    this.variants.set(variant, { template, height, ...bank, workChecked: false });
    if (previous) this.update([...this.drawn]);
  }

  private disposeBucket(bucket: Bucket) {
    bucket.meshes.forEach(mesh => { mesh.removeFromParent(); mesh.dispose(); });
  }

  private disposeVariant(variant: Variant) {
    variant.poses.forEach(pose => pose.parts.forEach(part => part.geometry.dispose()));
  }

  private bucket(variantId: number, poseIndex: number, count: number): Bucket {
    const key = `${variantId}:${poseIndex}`, existing = this.buckets.get(key);
    if (existing && existing.capacity >= count) return existing;
    if (existing) this.disposeBucket(existing);
    let capacity = 8;
    while (capacity < count) capacity *= 2;
    capacity = Math.min(PERSON_LIMIT, capacity);
    const pose = this.variants.get(variantId)!.poses[poseIndex]!;
    const meshes = pose.parts.map(part => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true;
      mesh.receiveShadow = true; this.scene.add(mesh); return mesh;
    });
    const result = { variant: variantId, pose: poseIndex, capacity, meshes };
    this.buckets.set(key, result); return result;
  }

  update(people: readonly PersonDraw[]) {
    if (this.disposed) return;
    this.drawn.length = 0;
    const groups = new Map<string, { variant: number; pose: number; people: PersonDraw[] }>();
    const ids = new Set<string>();
    for (const person of people) {
      if (this.drawn.length >= PERSON_LIMIT) break;
      const variant = this.variants.get(person.variant);
      if (!variant || ids.has(person.id) || ![person.position.x, person.position.y, person.position.z, person.heading, person.distance].every(Number.isFinite)) continue;
      const phase = ((person.distance / (variant.height * .8)) % 1 + 1) % 1;
      let pose = person.moving ? 1 + Math.min(WALK_POSES - 1, Math.floor(phase * WALK_POSES)) : 0;
      if (!person.moving && person.activity === 'work' && Number.isFinite(person.activityPhase)) {
        if (!variant.workChecked) {
          variant.poses.push(...bakeWorkPoses(variant.template, variant.scale)); variant.workChecked = true;
        }
        const workPhase = ((person.activityPhase! % 1) + 1) % 1;
        if (variant.poses.length > WORK_START) pose = WORK_START + Math.floor(workPhase * WORK_POSES);
      }
      const snapshot = { ...person, position: { ...person.position } };
      this.drawn.push(snapshot); ids.add(person.id);
      const key = `${person.variant}:${pose}`;
      if (!groups.has(key)) groups.set(key, { variant: person.variant, pose, people: [] });
      groups.get(key)!.people.push(snapshot);
    }
    for (const bucket of this.buckets.values()) bucket.meshes.forEach(mesh => { mesh.count = 0; });
    for (const group of groups.values()) {
      const bucket = this.bucket(group.variant, group.pose, group.people.length);
      group.people.forEach((person, index) => {
        this.transform.position.set(person.position.x, person.position.y, person.position.z);
        this.transform.rotation.set(0, person.heading, 0); this.transform.scale.set(1, 1, 1); this.transform.updateMatrix();
        bucket.meshes.forEach(mesh => mesh.setMatrixAt(index, this.transform.matrix));
      });
      bucket.meshes.forEach(mesh => { mesh.count = group.people.length; mesh.instanceMatrix.needsUpdate = true; });
    }
    this.drawn.forEach((person, index) => {
      const height = this.variants.get(person.variant)!.height;
      this.transform.position.set(person.position.x, person.position.y + height / 2, person.position.z);
      this.transform.rotation.set(0, person.heading, 0); this.transform.scale.set(height * .4, height, height * .45); this.transform.updateMatrix();
      this.proxy.setMatrixAt(index, this.transform.matrix);
    });
    this.proxy.count = this.drawn.length; this.proxy.instanceMatrix.needsUpdate = true;
    this.proxy.boundingSphere = null; this.proxy.boundingBox = null;
    this.proxy.updateWorldMatrix(true, false);
    this.count = this.drawn.length;
  }

  pick(raycaster: THREE.Raycaster): { person: PersonDraw; distance: number } | null {
    if (this.disposed || !this.drawn.length) return null;
    const hit = raycaster.intersectObject(this.proxy, false).find(hit => hit.instanceId !== undefined && this.drawn[hit.instanceId]);
    if (hit?.instanceId === undefined) return null;
    const person = this.drawn[hit.instanceId];
    if (!person) return null;
    return { person: { ...person, position: { ...person.position } }, distance: hit.distance };
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.buckets.forEach(bucket => this.disposeBucket(bucket)); this.buckets.clear();
    this.variants.forEach(variant => this.disposeVariant(variant)); this.variants.clear();
    this.proxy.removeFromParent(); this.proxy.dispose(); this.proxyGeometry.dispose(); this.proxyMaterial.dispose();
    this.drawn.length = 0; this.count = 0;
  }
}
