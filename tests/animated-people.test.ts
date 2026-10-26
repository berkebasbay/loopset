import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AnimatedPeople, type PersonDraw } from '../src/scene/AnimatedPeople';

function character(prefix = '', interact = true) {
  const root = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  const body = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.5, .4), material);
  body.name = 'Body'; body.position.y = .75; root.add(body);
  const arm = new THREE.Group(); arm.name = 'Arm'; arm.position.set(.45, 1.4, 0); root.add(arm);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(.2, .9, .2), material); hand.position.y = -.35; arm.add(hand);
  const clip = (name: string, values: number[]) => new THREE.AnimationClip(prefix + name, 1, [new THREE.NumberKeyframeTrack('Arm.rotation[z]', [0, .5, 1], values)]);
  root.animations = [clip('Idle', [0, 0, 0]), clip('Walk', [0, -.7, 0]), clip('Gun_Interact', [2, 2, 2])];
  if (interact) root.animations.push(clip('Interact', [0, 1.4, 0]));
  return { root, body, hand, material };
}

const worker = (changes: Partial<PersonDraw> = {}): PersonDraw => ({
  id: 'worker', variant: 0, nodeId: 'station', role: 'operator', position: { x: 0, y: 0, z: 0 },
  heading: Math.PI, moving: false, distance: 0, activity: 'work', activityPhase: .25, ...changes,
});

function drawnGeometry(scene: THREE.Scene) {
  return scene.children.filter((object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh && object.count > 0 && !object.userData.readOnlyNPC).map(mesh => mesh.geometry);
}

function vertices(scene: THREE.Scene) {
  return drawnGeometry(scene).map(geometry => Array.from(geometry.attributes.position.array));
}

describe('source interaction poses for factory work', () => {
  it.each(['', 'CharacterArmature|'])('uses exact %sInteract poses, freezes a phase and gives walking priority', prefix => {
    const source = character(prefix), scene = new THREE.Scene(), people = new AnimatedPeople(scene);
    const originalVertices = Array.from(source.hand.geometry.attributes.position.array);
    people.addVariant(0, source.root);
    people.update([worker({ activity: undefined })]); const idle = vertices(scene);
    people.update([worker()]); const reach = vertices(scene);
    people.update([worker({ activityPhase: .5 })]); const fullReach = vertices(scene);
    expect(reach).not.toEqual(idle);
    expect(fullReach).not.toEqual(reach);
    people.update([worker({ activityPhase: .5 })]); expect(vertices(scene)).toEqual(fullReach);
    people.update([worker({ moving: true, distance: .72, activityPhase: .1 })]); const stride = vertices(scene);
    people.update([worker({ moving: true, distance: .72, activityPhase: .8 })]); expect(vertices(scene)).toEqual(stride);
    expect(stride).not.toEqual(fullReach);
    expect(source.root.getObjectByName('Arm')!.rotation.z).toBe(0);
    expect(Array.from(source.hand.geometry.attributes.position.array)).toEqual(originalVertices);
    expect(source.root.animations.map(clip => clip.name)).toContain(prefix + 'Interact');
    people.dispose(); source.body.geometry.dispose(); source.hand.geometry.dispose(); source.material.dispose();
  });

  it('allocates the optional work bank once and disposes owned poses without disposing shared source art', () => {
    const source = character(), scene = new THREE.Scene(), people = new AnimatedPeople(scene);
    const clone = vi.spyOn(source.hand.geometry, 'clone');
    const sourceDisposals = vi.fn(), materialDisposals = vi.fn();
    source.hand.geometry.addEventListener('dispose', sourceDisposals); source.material.addEventListener('dispose', materialDisposals);
    people.addVariant(0, source.root); const initialClones = clone.mock.calls.length;
    people.update([worker({ activity: undefined })]); expect(clone).toHaveBeenCalledTimes(initialClones);
    people.update([worker()]); const workClones = clone.mock.calls.length;
    expect(workClones).toBeGreaterThan(initialClones);
    const baked = drawnGeometry(scene), poseDisposals = vi.fn(); baked.forEach(geometry => geometry.addEventListener('dispose', poseDisposals));
    people.update([worker({ activityPhase: .75 })]); expect(clone).toHaveBeenCalledTimes(workClones);
    people.dispose(); people.dispose();
    expect(poseDisposals).toHaveBeenCalledTimes(baked.length);
    expect(sourceDisposals).not.toHaveBeenCalled(); expect(materialDisposals).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);
    clone.mockRestore(); source.body.geometry.dispose(); source.hand.geometry.dispose(); source.material.dispose();
  });

  it('keeps Idle when no exact Interact exists instead of selecting a gun or combat clip', () => {
    const source = character('', false), scene = new THREE.Scene(), people = new AnimatedPeople(scene);
    people.addVariant(0, source.root);
    people.update([worker({ activity: undefined })]); const idle = vertices(scene);
    people.update([worker({ activityPhase: .5 })]); expect(vertices(scene)).toEqual(idle);
    people.dispose(); source.body.geometry.dispose(); source.hand.geometry.dispose(); source.material.dispose();
  });
});

describe('normalized glTF positions', () => {
  it('bakes quantized source coordinates into float world-space poses', () => {
    const plain = character(), quantized = character();
    for (const mesh of [quantized.body, quantized.hand]) {
      const positions = mesh.geometry.getAttribute('position');
      mesh.geometry.setAttribute('position', new THREE.Int16BufferAttribute(Int16Array.from(positions.array, value => Math.round(Number(value) * 32767)), 3, true));
    }
    const a = new THREE.Scene(), b = new THREE.Scene(), peopleA = new AnimatedPeople(a), peopleB = new AnimatedPeople(b);
    peopleA.addVariant(0, plain.root); peopleB.addVariant(0, quantized.root);
    peopleA.update([worker({ activityPhase: .5 })]); peopleB.update([worker({ activityPhase: .5 })]);
    const reference = vertices(a).flat(), actual = vertices(b).flat();
    expect(actual.length).toBe(reference.length);
    expect(Math.max(...actual.map((value, index) => Math.abs(value - reference[index])))).toBeLessThan(.001);
    expect(drawnGeometry(b).every(geometry => geometry.getAttribute('position').array instanceof Float32Array)).toBe(true);
    peopleA.dispose(); peopleB.dispose();
    for (const source of [plain, quantized]) { source.body.geometry.dispose(); source.hand.geometry.dispose(); source.material.dispose(); }
  });
});
