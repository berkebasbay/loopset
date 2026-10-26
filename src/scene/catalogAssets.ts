import type { ModelNode, World } from '../model/types';

export type CatalogAssetId = 'lathe' | 'workbench' | 'conveyor' | 'pallet' | 'floor' | 'desk' | 'monitor' | 'chair' | 'carton' | 'caliper' | 'scanner';
export interface CatalogAsset { id: CatalogAssetId; file: string; thumbnail: string; label: string; provider: 'NVIDIA'; size: number; turn?: number; metricScale?: number }
const asset = (id: CatalogAssetId, name: string, label: string, size: number, turn = 0): CatalogAsset => ({ id, file: `/assets/simready/${name}.glb`, thumbnail: `/assets/simready/${name}.png`, label, provider: 'NVIDIA', size, turn, metricScale: 1.5 });
export const CATALOG_ASSETS: Record<CatalogAssetId, CatalogAsset> = {
  lathe: asset('lathe', 'serviceTool_brake_lathe_a01', 'Metalworking lathe', 2.6),
  workbench: asset('workbench', 'furniture_workbench_standard_e01', 'Inspection bench', 2.7, -Math.PI / 2),
  conveyor: asset('conveyor', 'conveyor_belt_a05', 'Packing conveyor', 2.8),
  pallet: asset('pallet', 'pallet_a01', 'Material buffer', 1.9),
  floor: asset('floor', 'environment_floor_a01', 'Studio floor', 1),
  desk: asset('desk', 'desk_a01', 'Service desk', 2.7, -Math.PI / 2),
  monitor: asset('monitor', 'computer_monitor_office_a01', 'Control screen', 1.05),
  chair: asset('chair', 'chair_office_amf_black_a01', 'Waiting chair', 1.25),
  carton: asset('carton', 'box_corrugated_brown_b08', 'Work item', .38),
  caliper: asset('caliper', 'instrument_caliper_a01', 'Inspection caliper', .65),
  scanner: asset('scanner', 'computer_scanner_barcode_a01', 'Ticket scanner', .6),
};
export interface ProcessPrefab { id: string; label: string; kind: 'service' | 'queue' | 'delay'; thumbnail: string; description: string; source?: string }
export function buildPrefabsFor(world: World, _serviceCount: number): readonly ProcessPrefab[] {
  const title = world === 'factory' ? 'Workstation' : world === 'festival' ? 'Check-in desk' : 'Service desk';
  return [
    { id: 'workstation', label: title, kind: 'service', thumbnail: CATALOG_ASSETS[world === 'factory' ? 'workbench' : 'desk'].thumbnail, description: world === 'factory' ? 'Process work with equipment and operators.' : world === 'festival' ? 'Check visitors in before they continue.' : 'Help customers at a staffed desk.', source: 'NVIDIA SimReady' },
    { id: 'waiting', label: 'Waiting area', kind: 'queue', thumbnail: world === 'factory' ? CATALOG_ASSETS.pallet.thumbnail : world === 'service' ? CATALOG_ASSETS.chair.thumbnail : '', description: world === 'factory' ? 'Hold work until a station is ready.' : 'Give visitors a place to wait.', source: world === 'festival' ? 'People queue · Quaternius' : 'NVIDIA SimReady' },
    { id: 'delay', label: 'Delay', kind: 'delay', thumbnail: '', description: 'Add a modeled pause or travel time.', source: 'Model annotation' },
  ];
}
export interface AssetPlacement { asset: CatalogAssetId; x?: number; z?: number; y?: number; turn?: number; scale?: number }
export function nodeCatalogAssets(world: World, node: ModelNode, _serviceIndex: number): AssetPlacement[] {
  // Abstract time/routing and open arrival/exit locations are editor annotations,
  // never unrelated furniture presented as working equipment.
  if (node.kind === 'delay' || node.kind === 'route') return [];
  if (node.kind === 'source' || node.kind === 'sink') return world === 'factory' ? [{ asset: 'pallet' }] : [];
  if (node.kind === 'queue') return world === 'factory' ? [{ asset: 'pallet' }]
    : world === 'service' ? [{ asset: 'chair', x: -.75, z: -.4 }, { asset: 'chair', x: .75, z: -.4 }] : [];
  if (world === 'factory') {
    if (node.samplingId === 'factory-station-a') return [{ asset: 'lathe' }];
    if (node.samplingId === 'factory-station-b') return [{ asset: 'workbench' }, { asset: 'caliper', x: -.45, y: 1.16, z: .1, turn: Math.PI / 2 }, { asset: 'monitor', x: .6, y: 1.16, z: -.25 }];
    if (node.samplingId === 'factory-station-c') return [{ asset: 'conveyor' }];
    return [{ asset: 'workbench' }];
  }
  if (world === 'festival') {
    if (node.samplingId === 'festival-station-c') return [];
    return [{ asset: 'desk' }, { asset: 'monitor', x: -.5, y: 1.14 }, ...(node.samplingId === 'festival-station-b' ? [{ asset: 'scanner' as const, x: .55, y: 1.14 }] : [])];
  }
  return [{ asset: 'desk' }, { asset: 'monitor', y: 1.14 }, { asset: 'chair', z: -.9 }];
}
