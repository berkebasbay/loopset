import type { Project } from '../model/types';
import { findLibraryAsset } from '../catalog/registry';
import { setNodeAsset } from './facilityCommands';
import { NumberField } from './EditFields';
import { facilityMessages as m } from '../ui/messages/facility';

export function EquipmentAppearance({ project, nodeId, onChange, onLibrary }: { project: Project; nodeId: string; onChange: (project: Project, label?: string) => void; onLibrary: (origin: HTMLElement) => void }) {
  const reference = project.facility?.nodeAssets[nodeId];
  const asset = reference && findLibraryAsset(reference.assetId);
  const supported = asset?.version === reference?.assetVersion;
  return <details className="facility-equipment-choice"><summary>{m.selectedEquipment}</summary><p>{m.visualScope}</p>
    {reference && <><p>{supported ? asset!.name : m.unavailableReference}</p>{supported && (['rotation', 'scale'] as const).map(key => <NumberField key={key} label={m[key]} contextKey={`${project.id}:${nodeId}:appearance:${key}`} value={reference[key]} min={key === 'scale' ? .1 : -360} max={key === 'scale' ? 10 : 360} step="any" onChange={value => onChange(setNodeAsset(project, nodeId, reference.assetId, { rotation: reference.rotation, scale: reference.scale, [key]: value }), m.assetChanged)} />)}<button type="button" onClick={() => onChange(setNodeAsset(project, nodeId, null), m.assetChanged)}>{m.originalAppearance}</button></>}
    <button type="button" onClick={event => onLibrary(event.currentTarget)}>{m.applyAppearance}</button>
  </details>;
}
