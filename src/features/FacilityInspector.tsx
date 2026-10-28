import { useEffect, useState } from 'react';
import { Copy, RotateCcw, Trash2 } from 'lucide-react';
import type { FacilityObject, Project } from '../model/types';
import { findLibraryAsset } from '../catalog/registry';
import { changeFacilityObject, nextQuarterTurn } from './facilityCommands';
import { NumberField, usePendingEdit } from './EditFields';
import { facilityMessages as m } from '../ui/messages/facility';
import { assetURL } from '../assetUrl';

interface Props { project: Project; selectedId: string | null; onSelect: (id: string) => void; onChange: (project: Project, label?: string) => void; onDuplicate: (id: string) => void; onRemove: (id: string) => void; disabled: boolean }
export function FacilityInspector(props: Props) {
  const { project, selectedId, onSelect } = props;
  const selected = project.facility?.objects.find(object => object.id === selectedId);
  return <div className="facility-inspector"><h2 tabIndex={-1} data-facility-heading={selected?.id ?? ''}>{selected?.name ?? m.objects}</h2><p className="ease-help">{m.objectsCount(project.facility?.objects.length ?? 0)}</p>{selected ? <ObjectControls key={`${project.id}:${selected.id}`} {...props} object={selected} /> : <p className="ease-help">{project.facility?.objects.length ? m.noSelection : m.noObjects}</p>}<ul className="facility-object-list" aria-label={m.objects}>{project.facility?.objects.map(object => <li key={object.id}><button type="button" aria-pressed={selectedId === object.id} onClick={() => onSelect(object.id)}>{object.name}</button></li>)}</ul></div>;
}
function ObjectControls({ project, object, onChange, onDuplicate, onRemove, disabled }: Props & { object: FacilityObject }) {
  const [name, setName] = useState(object.name), [error, setError] = useState('');
  useEffect(() => setName(object.name), [object.name]);
  usePendingEdit(`${project.id}:${object.id}:facility-name`, name !== object.name);
  const asset = findLibraryAsset(object.assetId);
  function commit(patch: Partial<FacilityObject>) { try { onChange(changeFacilityObject(project, object.id, patch), m.changed(object.name)); setError(''); } catch (error) { setError(error instanceof Error ? error.message : m.invalidFacility); } }
  return <fieldset disabled={disabled} className="facility-object-controls">{asset?.version === object.assetVersion ? <><img className="facility-object-preview" src={assetURL(asset.thumbnail)} alt="" width="256" height="160" /><a href={asset.source} target="_blank" rel="noreferrer">{m.source}</a></> : <p role="status" className="ease-help">{m.unavailableReference}</p>}<p className="ease-help">{m.visualScope}</p><label>{m.name}<input value={name} maxLength={160} onChange={event => setName(event.currentTarget.value)} onBlur={() => { if (name !== object.name) commit({ name }); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit({ name }); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setName(object.name); setError(''); } }} /></label>{(['x', 'z', 'y', 'rotation', 'scale'] as const).map(key => <NumberField key={key} label={m[key]} contextKey={`${project.id}:${object.id}:${key}`} value={object[key] ?? 0} min={key === 'scale' ? .1 : key === 'y' ? 0 : key === 'rotation' ? -360 : -100} max={key === 'scale' ? 10 : key === 'y' ? 50 : key === 'rotation' ? 360 : 100} step="any" displayPrecision={2} onChange={value => commit({ [key]: value })} />)}<div className="facility-object-actions"><button type="button" onClick={() => commit({ rotation: nextQuarterTurn(object.rotation) })}><RotateCcw size={15} />{m.rotate}</button><button type="button" onClick={() => onDuplicate(object.id)}><Copy size={15} />{m.duplicate}</button><button type="button" onClick={() => onRemove(object.id)}><Trash2 size={15} />{m.remove}</button></div>{error && <p role="alert" className="ease-error">{error}</p>}</fieldset>;
}
