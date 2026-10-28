export const LIBRARY_DRAG_TYPE = 'application/x-loopset-asset';
export interface LibraryDrop {
  assetId: string; cellId?: string; mode: 'visual' | 'process'; projectId: string; revision: number;
  settings: { seconds: number; team: string };
}
