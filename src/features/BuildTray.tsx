import { Plus, Users, X, Clock3 } from 'lucide-react';
import type { World } from '../model/types';
import { buildPrefabsFor } from '../scene/catalogAssets';
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
  disabled: boolean;
  onAdd: (prefab: BuildPrefab) => void;
  onClose: () => void;
}

export function BuildTray({ world, serviceCount, insertionLabel, disabled, onAdd, onClose }: Props) {
  const prefabs: readonly BuildPrefab[] = buildPrefabsFor(world, serviceCount);
  return <section className="build-tray" aria-label={m.processBlocks}>
    <div className="build-tray-heading"><span>{m.assetLibrary}</span><strong>{m.processBlocks}</strong><small>{insertionLabel ? m.insertAfter(insertionLabel) : m.selectInsertionPoint}</small></div>
    <div className="build-tray-items">
      {prefabs.map(prefab => <button type="button" className="build-prefab" key={prefab.id} disabled={disabled || !insertionLabel} onClick={() => onAdd(prefab)} title={`${m.addProcessLabel(prefab.label)}. ${prefab.description}${prefab.source ? ` · ${prefab.source}` : ''}`}>
        <span className="prefab-preview">{prefab.thumbnail ? <img src={prefab.thumbnail} alt="" width="64" height="64" loading="lazy" /> : prefab.kind === 'delay' ? <Clock3 size={27} color="#4d6758" aria-hidden="true" /> : <Users size={27} color="#4d6758" aria-hidden="true" />}</span>
        <span className="prefab-copy"><strong>{prefab.label}</strong><small>{prefab.description}</small></span><Plus size={16} />
      </button>)}
    </div>
    <button type="button" className="tray-close" aria-label={m.closeBuildTray} onClick={onClose}><X size={15} /></button>
  </section>;
}
