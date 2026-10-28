export type AssetCategory = 'equipment' | 'storage' | 'structure' | 'furniture' | 'containers' | 'lighting' | 'safety' | 'accessories';
export interface LibraryAsset {
  id: string;
  version: string;
  name: string;
  category: AssetCategory;
  role: 'process' | 'visual';
  file: string;
  thumbnail: string;
  bytes: number;
  sha256: string;
  dimensions: readonly [number, number, number];
  triangles: number;
  source: string;
}
