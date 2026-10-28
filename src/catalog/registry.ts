import { libraryAssets } from './data';
export { libraryAssets } from './data';
export type { LibraryAsset, AssetCategory } from './types';

const assets = new Map(libraryAssets.map(asset => [asset.id, asset]));
export const findLibraryAsset = (id: string) => assets.get(id);
export const knownAssetReference = (id: unknown, version: unknown): boolean => typeof id === 'string' && assets.get(id)?.version === version;
