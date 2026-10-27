import { assetURL } from '../assetUrl';
import { Plus, Users, X, Clock3 } from 'lucide-react';
import type { World } from '../model/types';
import { buildPrefabsFor } from '../scene/catalogAssets';
import { processEaseMessages as pm } from '../ui/messages/modelEdits';
import { appMessages as m } from '../ui/messages/App';

export interface BuildPrefab {
  readonly id: string;
  readonly label: string;
  readonly kind: 'service' | 'queue' | 'delay';
  readonly thumbnail: string;
  readonly description: string;
  readonly source?: string;
}
interface Props {
  world: World;
  serviceCount: number;
  insertionLabel?: string;
  insertionId?: string;
  followingLabel?: string;
  insertionOptions: readonly { id: string; label: string }[];
  onInsertionChange: (id: string) => void;
  disabled: boolean;
  disabledReason?: string;
  onAdd: (prefab: BuildPrefab) => void;
  onClose: () => void;
}

export function BuildTray({ world, serviceCount, insertionLabel, insertionId, followingLabel, insertionOptions, onInsertionChange, disabled, disabledReason, onAdd, onClose }: Props) {
  const prefabs: readonly BuildPrefab[] = buildPrefabsFor(world, serviceCount);
  return <section id="process-blocks" className="build-tray" aria-label={m.processBlocks}>
    <div className="build-tray-heading"><strong>{m.processBlocks}</strong><label>{m.addAfter}<select aria-label={m.addAfter} value={insertionId ?? ''} disabled={!insertionOptions.length} onChange={event => onInsertionChange(event.currentTarget.value)}>{!insertionOptions.length && <option value="">{m.chooseStep}</option>}{insertionOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><small role={disabledReason || !insertionLabel ? 'status' : undefined}>{disabledReason ?? (insertionLabel ? m.chooseStepType : m.selectInsertionPoint)}</small></div>
    <p className="build-link-preview" role="status">{insertionLabel && followingLabel ? pm.insertionPreview(insertionLabel, followingLabel) : pm.chooseInsertion}</p>
    <div className="build-tray-items">
      {prefabs.map(prefab => <button type="button" className="build-prefab" key={prefab.id} disabled={disabled || !insertionLabel} onClick={() => onAdd(prefab)} title={`${m.addProcessLabel(prefab.label)}. ${prefab.description}${prefab.source ? ` · ${prefab.source}` : ''}`}>
        <span className="prefab-preview">{prefab.thumbnail ? <img src={assetURL(prefab.thumbnail)} alt="" width="64" height="64" loading="lazy" /> : prefab.kind === 'delay' ? <Clock3 size={27} color="#4d6758" aria-hidden="true" /> : <Users size={27} color="#4d6758" aria-hidden="true" />}</span>
        <span className="prefab-copy"><strong>{prefab.label}</strong><small>{prefab.description}</small></span><Plus size={16} />
      </button>)}
    </div>
    <button type="button" className="tray-close" aria-label={m.closeBuildTray} onClick={onClose}><X size={15} /></button>
  </section>;
}
