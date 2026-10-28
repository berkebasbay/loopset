import type { AssetReference, FacilityObject, Project } from '../model/types';
import { findLibraryAsset } from '../catalog/registry';
import type { StarterId } from './catalogue';
import { capacityLayout } from '../scene/capacityFootprint';
import { sceneLayout } from '../scene/graph';

const assets = {
  wall: 'structure_wall_straight_a01', rack: 'rack_bulk_storage_a03', shelf: 'storage_shelf_basic_b01',
  pallet: 'pallet_a01', carton: 'box_corrugated_brown_b08', crate: 'crate_blue_a01',
  crateGreen: 'crate_green_a01', sofa: 'sofa_soft_b02', coffeeTable: 'furniture_table_coffee_low_a01',
  bench: 'furniture_workbench_standard_e01', packing: 'table_deluxe_packing_a01',
  table: 'table_metal_stainless_a03', desk: 'desk_a01', chair: 'chair_office_amf_black_a01',
  lathe: 'serviceTool_brake_lathe_a01', latheB: 'serviceTool_brake_lathe_b01', printer: 'equipment_3d_printer_a01',
  lamp: 'lamp_ceiling_1m_rectangle_a01', screen: 'computer_monitor_office_a01',
  rail: 'barrier_fence_metal_a02', gate: 'barrier_gate_safetyDock_a02',
  locker: 'facilityFurniture_lockerUnit_multiDoor_a01', bin: 'furniture_trashBin_lid_a01',
  fire: 'fireProtection_extinguisher_portable_b01', coffee: 'machine_coffee_vending_a01',
  inspect: 'serviceTool_camera_inspectionKit_a01', scanner: 'computer_scanner_barcode_a01',
} as const;
type Art = keyof typeof assets;
const rounded = (n: number) => Math.round(n * 1000) / 1000;
function reference(art: Art, rotation = 0, scale = 1): AssetReference {
  const asset = findLibraryAsset(assets[art]); if (!asset) throw new Error(`Missing starter artwork: ${assets[art]}`);
  return { assetId: asset.id, assetVersion: asset.version, rotation, scale };
}
/** Build-time authored set dressing. Every placement remains an ordinary editable object. */
export function dressStarter(project: Project, id: StarterId): void {
  const objects: FacilityObject[] = [];
  const coordinates = capacityLayout(project.model.nodes, sceneLayout(project));
  project.facility = { version: 1, scenery: id === 'festival', objects, nodeAssets: {} };
  const place = (art: Art, name: string, x: number, z: number, rotation = 0, scale = 1, y = 0, physical = false) => {
    const point = physical ? { x, z } : coordinates.toVisual({ x, z });
    objects.push({ id: `${id}-object-${objects.length + 1}`, name, ...reference(art, rotation, scale), x: rounded(point.x), z: rounded(point.z), y: rounded(y) });
  };
  const shell = (backX: number, backZ: number, panels: number, sidePanels = 4) => {
    const start = coordinates.toVisual({ x: backX, z: backZ });
    const end = coordinates.toVisual({ x: backX + (panels - 1) * 2.2, z: backZ + 1.1 + (sidePanels - 1) * 2.2 });
    const across = Math.max(1, Math.ceil((end.x - start.x) / 2.2) + 1), along = Math.max(1, Math.ceil((end.z - start.z - 1.1) / 2.2) + 1);
    for (let i = 0; i < across; i++) place('wall', `Back wall ${i + 1}`, start.x + i * 2.2, start.z, 90, .36, 0, true);
    for (let i = 0; i < along; i++) place('wall', `Side wall ${i + 1}`, start.x - 1.1, start.z + 1.1 + i * 2.2, 0, .36, 0, true);
  };
  const rack = (name: string, x: number, z: number, rotation = 0, filled = true, tote: Art = 'crate') => {
    place('rack', name, x, z, rotation);
    if (filled) for (let i = 0; i < 3; i++) place(tote, `${name} · tote ${i + 1}`, x, z, rotation, 1, .5 + i * .65);
  };
  const pallet = (name: string, x: number, z: number, boxes = 3) => {
    place('pallet', name, x, z);
    for (let i = 0; i < boxes; i++) place('carton', `${name} · carton ${i + 1}`, x + (i % 2 ? .22 : -.22), z + (Math.floor(i / 2) ? .22 : -.22), 0, 1.25, .21);
  };
  const light = (x: number, z: number) => place('lamp', 'Overhead work light', x, z, 0, 1.8, 3.9);
  const override = (node: string, art: Art, rotation = 0, scale = 1.5) => {
    if (!project.model.nodes.some(item => item.id === node)) throw new Error(`Unknown starter step ${id}/${node}`);
    project.facility!.nodeAssets[node] = reference(art, rotation, scale);
  };
  const safety = (x: number, z: number) => { place('fire', 'Wall-side fire extinguisher', x, z, 0, 1.5); place('bin', 'Waste collection', x + .9, z); };

  if (id === 'factory') {
    shell(-11, -9, 11, 6);
    for (let i = 0; i < 5; i++) rack(`Materials rack ${i + 1}`, -8 + i * 4, -6.8);
    for (let i = 0; i < 4; i++) pallet(`Dispatch pallet ${i + 1}`, 3 + i * 2, 6, 2);
    place('bench', 'Tool preparation bench', -9, 5, -90, 1.25); place('inspect', 'Bench inspection kit', -9, 5, 0, 1, 1.73);
    for (const x of [-6, 0, 6]) light(x, -2.8);
    place('fire', 'Entrance fire extinguisher', -11.8, 3.6, 0, 1.5); place('fire', 'Dispatch fire extinguisher', 10.8, -7.8, 0, 1.5); place('bin', 'Packing waste', 8.5, -2.8);
    override('station-c', 'packing', 0, 1.4);
  } else if (id === 'festival') {
    for (const z of [2.8, 5.2]) for (let i = 0; i < 7; i++) place('rail', `Entrance queue rail ${z}-${i}`, -11 + i * 1.22, z);
    for (let i = 0; i < 5; i++) place('rail', `Security approach rail ${i + 1}`, 5.2 + i * 1.22, 4.4);
    place('locker', 'Staff lockers', -3, -5.8, 90, 1.1); place('bin', 'Entrance recycling', -12, 6.5); place('bin', 'Exit recycling', 12, -4.5);
    place('table', 'Visitor assistance table', -12, -3.5, 90, 1.2); place('chair', 'Assistance chair', -13, -3.5, 90, 1.2);
  } else if (id === 'service') {
    shell(-11, -8, 10, 7);
    for (let i = 0; i < 2; i++) place('sofa', `Reception sofa ${i + 1}`, -9 + i * 3, 6, 90, 1.4);
    place('coffeeTable', 'Reception coffee table', -7.5, 4.6, 0, 1.3);
    place('table', 'Reception information table', -9, -5, 90, 1.1); place('screen', 'Reception information screen', -9, -5, 90, 1.2, .94);
    place('coffee', 'Staff coffee corner', 7.5, -5.6); place('locker', 'Staff storage', 5.6, -5.8, 90, 1.15);
    light(-7, -2); light(0, -2); light(0, 5);
    place('desk', 'Case preparation desk', -2, -5.8, 90, 1.3); place('screen', 'Case preparation screen', -2, -5.8, 90, 1.2, .99);
    safety(-12, 1); place('coffeeTable', 'Quiet consultation table', 8, 3, 90, 1.5);
    for (const z of [1.5, 4.5]) place('sofa', 'Consultation seating', 8, z, z < 3 ? -90 : 90, 1.4);
  } else if (id === 'workshop') {
    shell(-13.2, -11, 13, 6);
    for (let i = 0; i < 4; i++) rack(`Tool rack ${i + 1}`, -9 + i * 5, -8.5);
    override('prepare', 'bench', -90, 1.7); override('machine', 'lathe', 0, 1.8); override('finish', 'table', 90, 1.6);
    for (let i = 0; i < 3; i++) place('shelf', `Curing-zone shelf ${i + 1}`, 10, -3 + i * 2, 0, 1.2);
    pallet('Incoming material', -12, 7); pallet('Finished work', -6, 7); safety(-14, 2);
    for (const x of [-8, -1, 6]) light(x, -3);
  } else if (id === 'machining') {
    shell(-15.4, -12, 15, 6);
    override('prepare', 'bench', -90, 1.6); override('fast', 'lathe', 0, 1.9); override('slow', 'latheB', 90, 1.7); override('inspect', 'table', 90, 1.7);
    for (let i = 0; i < 5; i++) rack(`Tooling rack ${i + 1}`, -10 + i * 5, -9.5);
    for (const x of [-5, 4]) for (let i = 0; i < 3; i++) place('rail', `Machine perimeter ${x}-${i}`, x - 1.2 + i * 1.22, -6.3);
    pallet('Raw blanks', -14, 7); pallet('Inspected parts', 12, 7); safety(-16, 1);
    light(-5, -2); light(4, -2); light(11, 3);
  } else if (id === 'quality') {
    shell(-13.2, -12, 13, 5);
    override('inspect', 'bench', -90, 1.8); override('repair', 'table', 90, 1.8);
    for (let i = 0; i < 3; i++) rack(`Quarantine rack ${i + 1}`, -9 + i * 4, -9.5, 0, true, 'crate');
    place('table', 'Reference instrument table', 7, -9, 90, 1.5); place('inspect', 'Inspection camera kit', 7, -9, 0, 1.5, 1.275);
    for (const [x, z, label] of [[-11, 6, 'Incoming sample'], [9, 6, 'Accepted batch']] as const) pallet(label, x, z);
    for (let i = 0; i < 3; i++) place('crate', `Rework tote ${i + 1}`, 9, -3 + i, 0, 1.2);
    light(-3, 0); light(5, -6); safety(-14, 2);
  } else if (id === 'packing') {
    shell(-15.4, -12, 15, 6);
    override('standard', 'packing', 0, 1.5); override('bulky', 'packing', 0, 1.7); override('check', 'table', 90, 1.5);
    for (let i = 0; i < 5; i++) rack(`Packaging supplies ${i + 1}`, -10 + i * 5, -9.5);
    for (let i = 0; i < 5; i++) pallet(`Outbound parcel bay ${i + 1}`, -3 + i * 3.2, 8, i % 2 ? 2 : 4);
    place('scanner', 'Label scanner', 10, 0, 0, 1, 1.275); safety(-16, 2);
    for (const z of [-4, 3]) light(0, z); light(10, 0);
  } else if (id === 'fulfillment') {
    shell(-17.6, -13.5, 17, 8);
    override('pick', 'table', 90, 1.6); override('pack', 'packing', 0, 1.5); override('handoff', 'table', 90, 1.4);
    for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) rack(`Picking aisle ${row + 1} · rack ${column + 1}`, -12 + column * 3.6, -10 + row * 3.3);
    for (let i = 0; i < 5; i++) pallet(`Dispatch bay ${i + 1}`, 3 + i * 2.8, 7.5, 3);
    for (const x of [8, 13]) place('gate', 'Dock safety gate', x, -10.5, 0, 1.2);
    place('desk', 'Dispatch planning desk', 14, -6, 90, 1.3); place('screen', 'Dispatch planning screen', 14, -6, 90, 1.2, .99);
    safety(-18.5, 3); light(-8, 0); light(2, 0); light(11, 0);
  } else if (id === 'returns') {
    shell(-15.4, -12, 15, 7);
    override('triage', 'table', 90, 1.6); override('restock', 'packing', 0, 1.4); override('refurbish', 'bench', -90, 1.7);
    for (let i = 0; i < 4; i++) rack(`Refurbishment storage ${i + 1}`, -8 + i * 4.5, -9.5, 0, true, 'crateGreen');
    for (let i = 0; i < 4; i++) pallet(`Restock staging ${i + 1}`, 3 + i * 2.8, 8, 3);
    for (let i = 0; i < 3; i++) place('crate', `Unsorted return tote ${i + 1}`, -12, 4 + i, 0, 1.4);
    place('locker', 'Parts storage', 12, -7, 90, 1.1); safety(-16, 2); light(-5, 0); light(5, -4); light(5, 3);
  } else if (id === 'parcel') {
    shell(-15.4, -11.5, 15, 7);
    override('scan', 'table', 90, 1.6); override('sort', 'packing', 0, 1.5); override('dispatch', 'table', 90, 1.6);
    for (let i = 0; i < 5; i++) { pallet(`Inbound staging ${i + 1}`, -12 + i * 2.4, -8.2, 3); pallet(`Outbound staging ${i + 1}`, 2 + i * 2.4, 8, 3); }
    for (const x of [-9, 0, 9]) place('gate', 'Dock barrier', x, -10.1, 0, 1.2);
    place('desk', 'Dispatch desk', 13, -7, 90, 1.3); place('screen', 'Dispatch schedule display', 13, -7, 90, 1.1, .99);
    safety(-16, 1); light(-6, 0); light(2, 0); light(9, 2);
  } else if (id === 'repair') {
    shell(-13.2, -11, 13, 7);
    override('diagnose', 'bench', -90, 1.7); override('repair', 'bench', -90, 1.8); override('test', 'table', 90, 1.6);
    for (let i = 0; i < 5; i++) rack(`Parts rack ${i + 1}`, -9 + i * 4.4, -8.5);
    place('locker', 'Technician lockers', -11.5, 4, 90, 1.3); place('coffee', 'Break area', -11.5, 7);
    for (let i = 0; i < 3; i++) place('chair', `Break-area chair ${i + 1}`, -8 + i * 1.1, 7);
    pallet('Completed repairs', 9, 7, 2); safety(-14, 1); light(-6, -3); light(2, -3); light(8, 2);
  } else if (id === 'print') {
    shell(-13.2, -10, 13, 6);
    override('prepare', 'desk', 90, 1.5); override('print', 'printer', 0, 1.7); override('finish', 'table', 90, 1.6);
    for (let i = 0; i < 5; i++) rack(`Material library ${i + 1}`, -9 + i * 4.4, -7.5);
    for (let i = 0; i < 4; i++) place('rail', `Printer-zone rail ${i + 1}`, -2 + i * 1.22, -4.5);
    place('desk', 'Design review desk', -9, 5.5, 90, 1.4); place('screen', 'Design review screen', -9, 5.5, 90, 1.3, 1.064);
    place('chair', 'Designer chair', -9, 7, 0, 1.3); pallet('Finished prints', 9, 6, 2); safety(-14, 2);
    light(-6, -1); light(1, -1); light(8, -1);
  }
}
