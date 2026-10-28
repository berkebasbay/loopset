import { findLibraryAsset } from '../catalog/registry';
import { mutateProject } from '../model/commands';
import { FACILITY_OBJECT_LIMIT } from '../model/facilityValidation';
import { validateProject } from '../model/validate';
import type { AssetReference, FacilityLayout, FacilityObject, Point, Project } from '../model/types';
import { facilityMessages as m } from '../ui/messages/facility';
import { addNode, uniqueIdentity } from './modelEdits';
import { capacityCell, capacityLayout } from '../scene/capacityFootprint';
import { sceneLayout } from '../scene/graph';

const layout = (project: Project): FacilityLayout => project.facility ??= { version: 1, objects: [], nodeAssets: {} };
function checked(project: Project): Project {
  const issue = validateProject(project).find(issue => issue.severity === 'error');
  if (issue) throw new Error(issue.message);
  return project;
}
export function assetReference(id: string): AssetReference {
  const asset = findLibraryAsset(id); if (!asset) throw new Error(m.invalidReference);
  return { assetId: asset.id, assetVersion: asset.version, rotation: 0, scale: 1 };
}
export function defaultPlacement(project: Project): Point {
  const occupied = new Set(project.facility?.objects.map(object => `${object.x.toFixed(1)}:${object.z.toFixed(1)}`));
  for (let i = 0; i <= FACILITY_OBJECT_LIMIT; i++) {
    const cell = capacityCell(i), point = { x: cell.x - 8, z: cell.z + 12 };
    if (!occupied.has(`${point.x.toFixed(1)}:${point.z.toFixed(1)}`)) return point;
  }
  throw new Error(m.tooManyObjects);
}
export function setFacilityScenery(project: Project, visible: boolean): Project {
  return checked(mutateProject(project, copy => { layout(copy).scenery = visible; }));
}
export function replaceFacilityAsset(project: Project, id: string, assetId: string): Project {
  const asset = findLibraryAsset(assetId); if (!asset) throw new Error(m.invalidReference);
  return checked(mutateProject(project, copy => {
    const object = copy.facility?.objects.find(object => object.id === id); if (!object) throw new Error(m.missingObject);
    const old = findLibraryAsset(object.assetId);
    object.assetId = asset.id; object.assetVersion = asset.version;
    if (old?.name === object.name) object.name = asset.name;
  }));
}
export function placeFacilityObject(project: Project, assetId: string, point = defaultPlacement(project)): { project: Project; id: string } {
  const asset = findLibraryAsset(assetId); if (!asset) throw new Error(m.invalidReference);
  const id = uniqueIdentity('object', project.facility?.objects.map(object => object.id) ?? []);
  const next = mutateProject(project, copy => {
    const facility = layout(copy);
    if (facility.objects.length >= FACILITY_OBJECT_LIMIT) throw new Error(m.tooManyObjects);
    facility.objects.push({ id, name: asset.name, ...assetReference(assetId), x: point.x, z: point.z, y: 0 });
  });
  return { project: checked(next), id };
}
export function changeFacilityObject(project: Project, id: string, patch: Partial<Pick<FacilityObject, 'x' | 'y' | 'z' | 'rotation' | 'scale' | 'name'>>): Project {
  return checked(mutateProject(project, copy => {
    const object = copy.facility?.objects.find(object => object.id === id);
    if (!object) throw new Error(m.missingObject);
    for (const key of ['x', 'y', 'z', 'rotation', 'scale', 'name'] as const) if (Object.hasOwn(patch, key)) Object.assign(object, { [key]: patch[key] });
  }));
}
export function nextQuarterTurn(angle: number): number {
  if (!Number.isFinite(angle) || angle < -360 || angle > 360) throw new Error(m.invalidTransform);
  return ((angle + 90) % 360 + 360) % 360;
}
export function removeFacilityObject(project: Project, id: string): Project {
  if (!project.facility?.objects.some(object => object.id === id)) throw new Error(m.missingObject);
  return mutateProject(project, copy => { layout(copy).objects = layout(copy).objects.filter(object => object.id !== id); });
}
export function duplicateFacilityObject(project: Project, id: string): { project: Project; id: string } {
  const object = project.facility?.objects.find(object => object.id === id);
  if (!object) throw new Error(m.missingObject);
  const newId = uniqueIdentity('object', project.facility!.objects.map(object => object.id));
  let prefix = ''; for (const character of object.name) { if (prefix.length + character.length > 149) break; prefix += character; }
  const names = new Set(project.facility!.objects.map(object => object.name)); let count = 1;
  while (names.has(m.copyName(prefix, count))) count++;
  const next = mutateProject(project, copy => {
    if (layout(copy).objects.length >= FACILITY_OBJECT_LIMIT) throw new Error(m.tooManyObjects);
    layout(copy).objects.push({ ...object, id: newId, name: m.copyName(prefix, count), x: object.x > 96 ? object.x - 3 : object.x + 3 });
  });
  return { project: checked(next), id: newId };
}
export function setNodeAsset(project: Project, nodeId: string, assetId: string | null, transform?: Pick<AssetReference, 'rotation' | 'scale'>): Project {
  if (!project.model.nodes.some(node => node.id === nodeId)) throw new Error(m.invalidStep);
  return checked(mutateProject(project, copy => {
    if (assetId === null) { if (copy.facility) delete copy.facility.nodeAssets[nodeId]; }
    else {
      const previous = copy.facility?.nodeAssets[nodeId];
      layout(copy).nodeAssets[nodeId] = { ...assetReference(assetId), rotation: transform?.rotation ?? previous?.rotation ?? 0, scale: transform?.scale ?? previous?.scale ?? 1 };
    }
  }));
}

export interface CellSettings { seconds: number; team: 'new' | 'none' | string }
export interface ProcessCell { id: string; name: string; assetId: string; seconds: number }
export const processCells: readonly ProcessCell[] = [
  { id: 'machining', name: m.machining, assetId: 'serviceTool_brake_lathe_a01', seconds: 45 },
  { id: 'inspection', name: m.inspection, assetId: 'furniture_workbench_standard_e01', seconds: 30 },
  { id: 'packing', name: m.packing, assetId: 'furniture_workbench_standard_e01', seconds: 60 },
  { id: 'reception', name: m.reception, assetId: 'desk_a01', seconds: 45 },
  { id: 'service', name: m.service, assetId: 'desk_a01', seconds: 90 },
];
/** Preserve exact drops where possible; snap across expanded station bands. */
export function alignInsertedProcess(before: Project, inserted: { project: Project; id: string }, target: Point): { project: Project; id: string; snapped?: boolean } {
  if (![target.x, target.z].every(Number.isFinite)) throw new Error(m.unavailableDrop);
  const prior = new Set(before.model.nodes.map(node => node.id));
  const added = inserted.project.model.nodes.filter(node => !prior.has(node.id)).map(node => node.id);
  if (!added.includes(inserted.id)) throw new Error(m.invalidCell);
  const initial = capacityLayout(before.model.nodes, sceneLayout(before)).toModel(target);
  let snapped = false;
  const next = mutateProject(inserted.project, copy => {
    const origin = copy.layout[inserted.id], shift = { x: initial.x - origin.x, z: initial.z - origin.z };
    for (const id of added) copy.layout[id] = { x: copy.layout[id].x + shift.x, z: copy.layout[id].z + shift.z };
    if (added.some(id => Math.abs(copy.layout[id].x) > 100 || Math.abs(copy.layout[id].z) > 100)) throw new Error(m.unavailableDrop);
    const seen = new Set<string>();
    let bestDistance = Infinity, best = Object.fromEntries(added.map(id => [id, { ...copy.layout[id] }]));
    for (let attempt = 0; attempt < 32; attempt++) {
      const actual = capacityLayout(copy.model.nodes, sceneLayout(copy)).positions[inserted.id];
      const delta = { x: target.x - actual.x, z: target.z - actual.z };
      const distance = delta.x ** 2 + delta.z ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = Object.fromEntries(added.map(id => [id, { ...copy.layout[id] }])); }
      if (Math.abs(delta.x) < 1e-7 && Math.abs(delta.z) < 1e-7) return;
      const key = `${copy.layout[inserted.id].x.toFixed(7)}:${copy.layout[inserted.id].z.toFixed(7)}`;
      if (seen.has(key)) break; seen.add(key);
      if (added.some(id => Math.abs(copy.layout[id].x + delta.x) > 100 || Math.abs(copy.layout[id].z + delta.z) > 100)) break;
      for (const id of added) {
        const point = { x: copy.layout[id].x + delta.x, z: copy.layout[id].z + delta.z };
        copy.layout[id] = point;
      }
    }
    // A station band's edges can be discontinuities for the newly added knot.
    // Check nearby existing knots as well as the iterative estimate.
    const candidateOrigin = best[inserted.id], previousPositions = sceneLayout(before);
    const nearby = (axis: 'x' | 'z') => [candidateOrigin[axis], ...[...new Set(before.model.nodes.map(node => previousPositions[node.id][axis]))]
      .sort((a, b) => Math.abs(a - candidateOrigin[axis]) - Math.abs(b - candidateOrigin[axis])).slice(0, 4)];
    const base = best;
    for (const x of nearby('x')) for (const z of nearby('z')) {
      const delta = { x: x - candidateOrigin.x, z: z - candidateOrigin.z };
      if (added.some(id => Math.abs(base[id].x + delta.x) > 100 || Math.abs(base[id].z + delta.z) > 100)) continue;
      for (const id of added) copy.layout[id] = { x: base[id].x + delta.x, z: base[id].z + delta.z };
      const actual = capacityLayout(copy.model.nodes, sceneLayout(copy)).positions[inserted.id];
      const distance = (target.x - actual.x) ** 2 + (target.z - actual.z) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = Object.fromEntries(added.map(id => [id, { ...copy.layout[id] }])); }
    }
    for (const id of added) copy.layout[id] = best[id];
    snapped = bestDistance > 1e-14;
  });
  return { project: checked(next), id: inserted.id, snapped };
}
export function insertEquipment(project: Project, assetId: string, anchorId: string, settings: CellSettings, point?: Point, cellName?: string): { project: Project; id: string } {
  const asset = findLibraryAsset(assetId), anchor = project.model.nodes.find(node => node.id === anchorId);
  if (!asset || !anchor || !('next' in anchor) || !Number.isFinite(settings.seconds) || settings.seconds <= 0 || settings.seconds > 31_536_000) throw new Error(m.invalidCell);
  const added = addNode(project, 'service');
  const next = mutateProject(added.project, copy => {
    const previous = copy.model.nodes.find(node => node.id === anchorId)!;
    const node = copy.model.nodes.find(node => node.id === added.id)!;
    if (!('next' in previous) || node.kind !== 'service') throw new Error(m.invalidCell);
    node.next = previous.next; previous.next = node.id; node.label = cellName ?? asset.name;
    node.duration = { kind: 'constant', value: settings.seconds };
    if (settings.team === 'new') {
      if (copy.model.resources.length >= 50) throw new Error(m.invalidCell);
      const id = uniqueIdentity('team', copy.model.resources.map(pool => pool.id));
      copy.model.resources.push({ id, label: m.newTeamName(node.label), installedCapacity: 1, capacity: 1, calendar: [], costPerHour: 0, overtimeCostPerHour: 0 });
      node.resources = [{ poolId: id, units: 1 }];
    } else if (settings.team !== 'none') {
      const teamId = settings.team.startsWith('pool:') ? settings.team.slice(5) : settings.team;
      if (!copy.model.resources.some(pool => pool.id === teamId)) throw new Error(m.invalidCell);
      node.resources = [{ poolId: teamId, units: 1 }];
    }
    const origin = copy.layout[anchorId] ?? { x: 0, z: 0 };
    copy.layout[node.id] = point ?? { x: Math.min(96, origin.x + 4), z: Math.min(96, origin.z + 3) };
    layout(copy).nodeAssets[node.id] = assetReference(assetId);
  });
  return { project: checked(next), id: added.id };
}
export function insertProcessCell(project: Project, cellId: string, anchorId: string, settings: CellSettings, point?: Point): { project: Project; id: string } {
  const cell = processCells.find(cell => cell.id === cellId), anchor = project.model.nodes.find(node => node.id === anchorId);
  if (!cell || anchor?.kind === 'queue') throw new Error(m.invalidCell);
  const inserted = insertEquipment(project, cell.assetId, anchorId, settings, point, cell.name);
  const queue = addNode(inserted.project, 'queue');
  const next = mutateProject(queue.project, copy => {
    const previous = copy.model.nodes.find(node => node.id === anchorId)!;
    const waiting = copy.model.nodes.find(node => node.id === queue.id)!;
    if (!('next' in previous) || waiting.kind !== 'queue') throw new Error(m.invalidCell);
    previous.next = waiting.id; waiting.next = inserted.id; waiting.label = m.waitName(cell.name);
    const location = copy.layout[inserted.id]; copy.layout[waiting.id] = { x: Math.max(-100, location.x - 2.5), z: location.z };
  });
  return { project: checked(next), id: inserted.id };
}
