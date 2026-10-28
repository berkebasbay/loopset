import { useMemo, useState } from 'react';
import { Plus, Users, X, Clock3, Search, ChevronLeft, ChevronRight, Box } from 'lucide-react';
import { assetURL } from '../assetUrl';
import type { Point, Project, World } from '../model/types';
import { buildPrefabsFor } from '../scene/catalogAssets';
import { libraryAssets, type AssetCategory, type LibraryAsset } from '../catalog/registry';
import { processCells, type CellSettings } from './facilityCommands';
import { LIBRARY_DRAG_TYPE, type LibraryDrop } from '../catalog/drag';
export type { LibraryDrop } from '../catalog/drag';
import { processEaseMessages as pm } from '../ui/messages/modelEdits';
import { appMessages as m } from '../ui/messages/App';
import { facilityMessages as f } from '../ui/messages/facility';

export interface BuildPrefab { readonly id: string; readonly label: string; readonly kind: 'service' | 'queue' | 'delay'; readonly thumbnail: string; readonly description: string; readonly source?: string }
interface Props {
  world: World; project: Project; serviceCount: number; insertionLabel?: string; insertionId?: string; followingLabel?: string;
  insertionOptions: readonly { id: string; label: string }[]; onInsertionChange: (id: string) => void;
  disabled: boolean; disabledReason?: string; onAdd: (prefab: BuildPrefab) => void; onClose: () => void;
  onPlace: (asset: LibraryAsset, mode: 'visual' | 'process', settings: CellSettings, point?: Point) => void;
  onCell: (id: string, settings: CellSettings) => void;
  onAppearance: (asset: LibraryAsset) => void;
  selectedStep: boolean;
  selectedObject: boolean;
  onReplace: (asset: LibraryAsset) => void;
  onNew: () => void;
  onExample: () => void;
}
const PAGE_SIZE = 18;
const categories = Object.keys(f.categories) as AssetCategory[];

export function BuildTray({ world, project, serviceCount, insertionLabel, insertionId, followingLabel, insertionOptions, onInsertionChange, disabled, disabledReason, onAdd, onClose, onPlace, onCell, onAppearance, selectedStep, selectedObject, onReplace, onNew, onExample }: Props) {
  const [tab, setTab] = useState<'steps' | 'cells' | 'objects'>('steps');
  const [query, setQuery] = useState(''), [category, setCategory] = useState<AssetCategory | ''>(''), [page, setPage] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null), [cellId, setCellId] = useState(processCells[0].id);
  const [seconds, setSeconds] = useState('45'), [team, setTeam] = useState('new'), [mode, setMode] = useState<'visual' | 'process'>('visual');
  const matches = useMemo(() => {
    const terms = query.toLocaleLowerCase('en').trim().split(/\s+/).filter(Boolean);
    return libraryAssets.filter(asset => (!category || asset.category === category) && terms.every(term => `${asset.name} ${asset.category}`.toLocaleLowerCase('en').includes(term))).sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) || a.name.localeCompare(b.name));
  }, [query, category]);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const selected = libraryAssets.find(asset => asset.id === chosen);
  const cell = processCells.find(item => item.id === cellId)!;
  const settings: CellSettings = { seconds: Number(seconds), team };
  const validTime = seconds.trim() !== '' && Number.isFinite(settings.seconds) && settings.seconds > 0 && settings.seconds <= 604800;
  const anchor = project.model.nodes.find(node => node.id === insertionId);
  const processLimit = project.model.nodes.length >= 100;
  const canCell = !disabled && project.model.nodes.length <= 98 && validTime && Boolean(anchor && 'next' in anchor && anchor.kind !== 'queue');
  function choose(asset: LibraryAsset) { setChosen(asset.id); setMode(asset.role === 'process' ? 'process' : 'visual'); }
  const processSettings = <div className="library-process-settings"><p>{f.cellTimeScope}</p><label>{f.duration}<input type="number" min="0.001" step="any" max="604800" value={seconds} onChange={event => setSeconds(event.currentTarget.value)} /></label><label>{f.resourceChoice}<select value={team} onChange={event => setTeam(event.currentTarget.value)}><option value="new">{f.newTeam}</option><option value="none">{f.noneTeam}</option>{project.model.resources.map(pool => <option key={pool.id} value={`pool:${pool.id}`}>{pool.label}</option>)}</select></label></div>;
  return <section id="process-blocks" className="build-tray facility-library" aria-label={m.processBlocks}>
    <div className="library-heading"><div><small>{f.libraryScope}</small><strong>{f.library}</strong><div className="library-starts"><button type="button" className="library-new" onClick={onNew}><Plus size={13} />{f.newFacility}</button><button type="button" className="library-new" onClick={onExample}>{f.exampleFacility}</button></div></div><button type="button" className="tray-close" aria-label={m.closeBuildTray} onClick={onClose}><X size={18} /></button></div>
    <div className="library-tabs" aria-label={f.library}>{(['steps', 'cells', 'objects'] as const).map(value => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === 'steps' ? f.steps : value === 'cells' ? f.cells : f.catalogue}{value === 'objects' && <span>{libraryAssets.length}</span>}</button>)}</div>
    {tab !== 'objects' || mode === 'process' ? <div className="build-tray-heading library-anchor"><label>{m.addAfter}<select aria-label={m.addAfter} value={insertionId ?? ''} disabled={!insertionOptions.length} onChange={event => onInsertionChange(event.currentTarget.value)}>{!insertionOptions.length && <option value="">{m.chooseStep}</option>}{insertionOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><p className="build-link-preview" role="status">{disabledReason ?? (insertionLabel && followingLabel ? pm.insertionPreview(insertionLabel, followingLabel) : pm.chooseInsertion)}</p></div> : null}
    <div className="library-scroll">
      {tab === 'steps' && <div className="build-tray-items library-basic-steps">{buildPrefabsFor(world, serviceCount).map(prefab => <button type="button" className="build-prefab" key={prefab.id} disabled={disabled || processLimit || !insertionLabel} onClick={() => onAdd(prefab)} title={`${m.addProcessLabel(prefab.label)}. ${prefab.description}${prefab.source ? ` · ${prefab.source}` : ''}`}><span className="prefab-preview">{prefab.thumbnail ? <img src={assetURL(prefab.thumbnail)} alt="" width="64" height="64" loading="lazy" /> : prefab.kind === 'delay' ? <Clock3 size={27} aria-hidden="true" /> : <Users size={27} aria-hidden="true" />}</span><span className="prefab-copy"><strong>{prefab.label}</strong><small>{prefab.description}</small></span><Plus size={16} /></button>)}</div>}
      {tab === 'cells' && <><p className="library-scope">{f.cellScope}</p><div className="library-cell-list">{processCells.map(item => { const art = libraryAssets.find(asset => asset.id === item.assetId); return <button type="button" aria-pressed={cellId === item.id} key={item.id} draggable={canCell} onDragStart={event => { const payload: LibraryDrop = { assetId: item.assetId, cellId: item.id, mode: 'process', projectId: project.id, revision: project.revision, settings: { seconds: cellId === item.id ? settings.seconds : item.seconds, team } }; event.dataTransfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify(payload)); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => { setCellId(item.id); setSeconds(String(item.seconds)); }}><img src={assetURL(art?.thumbnail ?? '')} alt="" width="64" height="64" loading="lazy" /><span>{item.name}</span><ChevronRight size={15} /></button>; })}</div>{processSettings}<button type="button" className="library-primary" disabled={!canCell} onClick={() => onCell(cell.id, settings)}><Plus size={16} />{f.addCell}</button></>}
      {tab === 'objects' && <><label className="library-search"><Search size={16} /><input type="search" aria-label={f.search} placeholder={f.search} value={query} onChange={event => { setQuery(event.currentTarget.value); setPage(0); }} /></label><label className="library-category"><span>{f.catalogue}</span><select aria-label={f.catalogue} value={category} onChange={event => { setCategory(event.currentTarget.value as AssetCategory | ''); setPage(0); }}><option value="">{f.all}</option>{categories.filter(value => libraryAssets.some(asset => asset.category === value)).map(value => <option key={value} value={value}>{f.categories[value]}</option>)}</select></label><p className="library-count" role="status">{f.resultCount(matches.length)}</p>
        <div className="library-grid">{matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(asset => <button type="button" key={asset.id} className="library-tile" aria-pressed={chosen === asset.id} aria-label={asset.name} draggable={!disabled && !(processLimit && (chosen === asset.id ? mode === 'process' : asset.role === 'process'))} onClick={() => choose(asset)} onDragStart={event => { const payload: LibraryDrop = { assetId: asset.id, mode: chosen === asset.id ? mode : asset.role === 'process' ? 'process' : 'visual', projectId: project.id, revision: project.revision, settings }; event.dataTransfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify(payload)); event.dataTransfer.effectAllowed = 'copy'; }} title={f.drag(asset.name)}><img src={assetURL(asset.thumbnail)} alt="" width="112" height="96" loading="lazy" /><span>{asset.name}</span></button>)}</div>
        {!matches.length && <p className="library-scope">{f.noMatches}</p>}{pages > 1 && <div className="library-pagination"><button type="button" aria-label={f.previous} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><span>{f.page(currentPage + 1, pages)}</span><button type="button" aria-label={f.next} disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></div>}
        {selected && <section className="library-chosen" aria-label={f.selected}><strong>{selected.name}</strong><small>{f.dimensions}: {selected.dimensions.map(n => n.toLocaleString('en', { maximumFractionDigits: 2 })).join(' × ')} m · {f.size(selected.bytes)}</small><a href={selected.source} target="_blank" rel="noreferrer">{f.source}</a>{selected.role === 'process' && <label>{f.use}<select value={mode} onChange={event => setMode(event.currentTarget.value as 'visual' | 'process')}><option value="process">{f.processMode}</option><option value="visual">{f.visualMode}</option></select></label>}<p>{mode === 'process' ? f.equipmentScope : f.visualScope}</p>{mode === 'process' && processSettings}<button type="button" className="library-primary" disabled={disabled || mode === 'process' && (processLimit || !insertionLabel || !validTime)} onClick={() => onPlace(selected, mode, settings)}><Plus size={16} />{mode === 'process' ? f.addProcess : f.place}</button>{selectedObject && <button type="button" className="library-secondary" disabled={disabled} onClick={() => onReplace(selected)}>{f.replace}</button>}{selectedStep && <button type="button" className="library-secondary" disabled={disabled} onClick={() => onAppearance(selected)}><Box size={15} />{f.applyAppearance}</button>}</section>}
      </>}
    </div>
  </section>;
}
