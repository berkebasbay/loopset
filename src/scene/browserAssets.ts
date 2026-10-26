/** Source-derived first-view assets; the original catalogue remains the detail tier. */
export const BROWSER_LOD_FILES = [
  'simready/box_corrugated_brown_b08.glb', 'simready/chair_office_amf_black_a01.glb',
  'simready/computer_monitor_office_a01.glb', 'simready/computer_scanner_barcode_a01.glb',
  'simready/conveyor_belt_a05.glb', 'simready/desk_a01.glb',
  'simready/furniture_workbench_standard_e01.glb', 'simready/instrument_caliper_a01.glb',
  'simready/lamp_ceiling_1m_rectangle_a01.glb', 'simready/serviceTool_brake_lathe_a01.glb',
  'simready/storage_shelf_basic_a01.glb', 'simready/structure_wall_straight_a01.glb',
  'characters/worker.glb', 'characters/worker-female.glb',
  'characters/casual-character.glb', 'characters/visitor-female.glb',
] as const;
const initialAssets = new Set<string>(BROWSER_LOD_FILES);

export function initialBrowserAssetURL(url: string): string {
  const file = url.startsWith('/assets/') ? url.slice('/assets/'.length) : '';
  return initialAssets.has(file) ? `/assets/lod/${file}` : url;
}

/** Low-power mode stays in the first-view tier; detail is only for one primary object. */
export function isDetailInspection(zoom: number, quality: 'high' | 'low' | undefined): boolean {
  return zoom >= 1.8 && quality !== 'low';
}
