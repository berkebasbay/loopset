import { useMemo, useState, type DragEvent } from 'react';
import { Plus, Users, X, Check, Clock3, Search, ChevronLeft, ChevronRight, Box, ArrowDownToLine } from 'lucide-react';
import { assetURL } from '../assetUrl';
import type { Point, Project, World } from '../model/types';
import { buildPrefabsFor } from '../scene/catalogAssets';
import { libraryAssets, type AssetCategory, type LibraryAsset } from '../catalog/registry';
import { isLayoutOnly } from '../model/workspace';
import { templateMessages as tm } from '../ui/messages/templates';
import { FACILITY_OBJECT_LIMIT } from '../model/facilityValidation';
import { processCells, type CellSettings } from './facilityCommands';
import { LIBRARY_DRAG_TYPE, type LibraryDrop } from '../catalog/drag';
export type { LibraryDrop } from '../catalog/drag';
import { processEaseMessages as pm } from '../ui/messages/modelEdits';
import { appMessages as m } from '../ui/messages/App';
import { facilityMessages as f } from '../ui/messages/facility';

export type LibraryTab = 'objects' | 'cells' | 'steps';
export interface BuildPrefab { readonly id: string; readonly label: string; readonly kind: 'service' | 'queue' | 'delay'; readonly thumbnail: string; readonly description: string; readonly source?: string }
interface Props {
  world: World; project: Project; serviceCount: number; insertionLabel?: string; insertionId?: string; followingLabel?: string;
  insertionOptions: readonly { id: string; label: string }[]; onInsertionChange: (id: string) => void;
  disabled: boolean; disabledReason?: string; onAdd: (prefab: BuildPrefab) => void; onClose: () => void;
  onPlace: (asset: LibraryAsset, mode: 'visual' | 'process', settings: CellSettings, point?: Point) => void;
  onCell: (id: string, settings: CellSettings) => void; onAppearance: (asset: LibraryAsset) => void;
  selectedStep: boolean; selectedObject: boolean; onReplace: (asset: LibraryAsset) => void;
  onNew: () => void; onExample: () => void; onSaveTemplate: () => void; onStartProcess: () => void;
  activeTab: LibraryTab; onTabChange: (tab: LibraryTab) => void;
}
const PAGE_SIZE = 12;
const categories = Object.keys(f.categories) as AssetCategory[];

export function BuildTray(props: Props) {
  const { world, project, serviceCount, insertionLabel, insertionId, followingLabel, insertionOptions, onInsertionChange, disabled, disabledReason, onAdd, onClose, onPlace, onCell, onAppearance, selectedStep, selectedObject, onReplace, onNew, onExample, onSaveTemplate, onStartProcess, activeTab: tab, onTabChange } = props;
  const [query, setQuery] = useState(''), [category, setCategory] = useState<AssetCategory | ''>(''), [page, setPage] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null), [cellId, setCellId] = useState(processCells[0].id);
  const [seconds, setSeconds] = useState('45'), [team, setTeam] = useState('new'), [mode, setMode] = useState<'visual' | 'process'>('visual');
  const matches = useMemo(() => {
    const terms = query.toLocaleLowerCase('en').trim().split(/\s+/).filter(Boolean);
    return libraryAssets.filter(asset => (!category || asset.category === category) && terms.every(term => `${asset.name} ${asset.category}`.toLocaleLowerCase('en').includes(term)))
      .sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) || a.name.localeCompare(b.name));
  }, [query, category]);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const selected = libraryAssets.find(asset => asset.id === chosen);
  const cell = processCells.find(item => item.id === cellId)!;
  const settings: CellSettings = { seconds: Number(seconds), team };
  const validTime = seconds.trim() !== '' && Number.isFinite(settings.seconds) && settings.seconds > 0 && settings.seconds <= 604800;
  const anchor = project.model.nodes.find(node => node.id === insertionId);
  const processLimit = project.model.nodes.length >= 100, objectLimit = (project.facility?.objects.length ?? 0) >= FACILITY_OBJECT_LIMIT;
  const teamLimit = team === 'new' && project.model.resources.length >= 50;
  const canCell = !disabled && project.model.nodes.length <= 98 && !teamLimit && validTime && Boolean(anchor && 'next' in anchor && anchor.kind !== 'queue');
  const layoutOnly = isLayoutOnly(project);
  const processMode = tab !== 'objects' || mode === 'process';
  const placementDisabled = disabled || (mode === 'visual' ? objectLimit : processLimit || teamLimit || !insertionLabel || !validTime);
  function choose(asset: LibraryAsset) { setChosen(asset.id); setMode('visual'); }
  function drag(event: DragEvent, assetId: string, dropMode: 'visual' | 'process', cell?: string, duration = settings.seconds) {
    const payload: LibraryDrop = { assetId, mode: dropMode, projectId: project.id, revision: project.revision, settings: { seconds: duration, team }, ...(cell ? { cellId: cell } : {}) };
    event.dataTransfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify(payload)); event.dataTransfer.effectAllowed = 'copy';
  }
  const anchorControl = <div className="library-anchor"><label>{m.addAfter}<select aria-label={m.addAfter} value={insertionId ?? ''} disabled={!insertionOptions.length} onChange={event => onInsertionChange(event.currentTarget.value)}>{!insertionOptions.length && <option value="">{m.chooseStep}</option>}{insertionOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><p>{insertionLabel && followingLabel ? pm.insertionPreview(insertionLabel, followingLabel) : pm.chooseInsertion}</p></div>;
  const processSettings = <div className="library-process-settings"><label>{f.duration}<input aria-label={f.duration} type="number" min="0.001" step="any" max="604800" value={seconds} onChange={event => setSeconds(event.currentTarget.value)} /></label><label>{f.resourceChoice}<select aria-label={f.resourceChoice} value={team} onChange={event => setTeam(event.currentTarget.value)}><option value="new">{f.newTeam}</option><option value="none">{f.noneTeam}</option>{project.model.resources.map(pool => <option key={pool.id} value={`pool:${pool.id}`}>{pool.label}</option>)}</select></label><p>{f.cellTimeScope}</p></div>;
  return <section id="process-blocks" className="build-tray facility-library" aria-label={m.processBlocks}>
    <header className="library-heading"><div><small>{f.availableModels(libraryAssets.length)}</small><h2>{f.library}</h2></div><button type="button" className="tray-close" aria-label={f.libraryClose} onClick={onClose}><X size={18} /></button></header>
    <div className="library-starts"><button type="button" onClick={onNew}><Plus size={16} />{f.blankSite}</button><button type="button" onClick={onExample}><Box size={16} />{tm.title}</button></div>
    <div className="library-tabs" aria-label={f.library}>{(['objects', 'cells', 'steps'] as const).map(value => <button type="button" key={value} aria-pressed={tab === value} onClick={() => onTabChange(value)}>{value === 'objects' ? f.models : value === 'cells' ? f.cells : f.steps}</button>)}</div>
    {tab === 'objects' && <div className="library-filters"><label className="library-search"><Search size={17} /><input type="search" aria-label={f.search} placeholder={f.search} value={query} onChange={event => { setQuery(event.currentTarget.value); setPage(0); }} /></label><label className="library-category"><span>{f.catalogue}</span><select aria-label={f.catalogue} value={category} onChange={event => { setCategory(event.currentTarget.value as AssetCategory | ''); setPage(0); }}><option value="">{f.all}</option>{categories.filter(value => libraryAssets.some(asset => asset.category === value)).map(value => <option key={value} value={value}>{f.categories[value]}</option>)}</select></label><p className="library-count" role="status">{f.resultCount(matches.length)}</p></div>}
    <div className="library-scroll">{layoutOnly && processMode && <div className="library-start-process"><p>{tm.startProcessScope}</p><button className="library-primary" type="button" disabled={disabled} onClick={onStartProcess}>{tm.startProcess}</button></div>}
      {tab === 'steps' && <>{anchorControl}<p className="library-scope">{f.processHint}</p><div className="library-basic-steps">{buildPrefabsFor(world, serviceCount).map(prefab => <button type="button" className="build-prefab" key={prefab.id} disabled={disabled || processLimit || !insertionLabel} onClick={() => onAdd(prefab)}><span className="prefab-preview">{prefab.thumbnail ? <img src={assetURL(prefab.thumbnail)} alt="" width="64" height="64" loading="lazy" /> : prefab.kind === 'delay' ? <Clock3 size={27} /> : <Users size={27} />}</span><span className="prefab-copy"><strong>{prefab.label}</strong><small>{prefab.description}</small></span><Plus size={16} /></button>)}</div></>}
      {tab === 'cells' && <><p className="library-scope">{f.cellScope}</p><div className="library-cell-list">{processCells.map(item => { const art = libraryAssets.find(asset => asset.id === item.assetId); return <button type="button" aria-pressed={cellId === item.id} key={item.id} draggable={canCell} onDragStart={event => drag(event, item.assetId, 'process', item.id, cellId === item.id ? settings.seconds : item.seconds)} onClick={() => { setCellId(item.id); setSeconds(String(item.seconds)); }}><img src={assetURL(art?.thumbnail ?? '')} alt="" width="64" height="64" loading="lazy" /><span>{item.name}</span><ChevronRight size={15} /></button>; })}</div></>}
      {tab === 'objects' && <><div className="library-grid">{matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(asset => {
        const dropMode = chosen === asset.id ? mode : 'visual';
        return <button type="button" key={asset.id} className="library-tile" aria-pressed={chosen === asset.id} aria-label={asset.name} draggable={!disabled && !(dropMode === 'process' ? processLimit || teamLimit || !validTime || !insertionLabel : objectLimit)} onClick={() => choose(asset)} onDragStart={event => drag(event, asset.id, dropMode)} title={f.drag(asset.name)}><img src={assetURL(asset.thumbnail)} alt="" width="144" height="110" loading="lazy" /><span className="library-tile-label">{asset.name}</span>{chosen === asset.id && <span className="library-selected-mark" aria-hidden="true"><Check size={12} strokeWidth={2.5} /></span>}</button>;
      })}</div>{!matches.length && <p className="library-scope">{f.noMatches}</p>}</>}
    </div>
    {tab === 'objects' && pages > 1 && <div className="library-pagination"><button type="button" aria-label={f.previous} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><span>{f.page(currentPage + 1, pages)}</span><button type="button" aria-label={f.next} disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></div>}
    {tab === 'objects' && selected ? <section className="library-chosen" aria-label={f.selected}>
      <div className="library-choice-details">
        <div className="library-chosen-summary"><img src={assetURL(selected.thumbnail)} alt="" width="54" height="48" /><div><strong>{selected.name}</strong><small>{selected.dimensions.map(n => n.toLocaleString('en', { maximumFractionDigits: 2 })).join(' × ')} m · {f.size(selected.bytes)}</small></div></div>
        {selected.role === 'process' && <label className="library-use">{f.use}<select aria-label={f.use} value={mode} onChange={event => setMode(event.currentTarget.value as 'visual' | 'process')}><option value="visual">{f.visualMode}</option><option value="process">{f.processMode}</option></select></label>}
        {mode === 'process' && <>{anchorControl}{processSettings}</>}
        <details className="library-options"><summary>{f.modelDetails}</summary><a href={selected.source} target="_blank" rel="noreferrer">{f.source}</a><p>{f.visualScope}</p>{selectedStep && <button type="button" className="library-secondary" disabled={disabled} onClick={() => onAppearance(selected)}>{f.applyAppearance}</button>}{selectedObject && <button type="button" className="library-secondary" disabled={disabled} onClick={() => onReplace(selected)}>{f.replace}</button>}</details>
      </div>
      <button type="button" className="library-primary" disabled={placementDisabled} onClick={() => onPlace(selected, mode, settings)}><Plus size={17} />{mode === 'process' ? f.addProcess : f.place}</button>
    </section> : tab === 'cells' ? <div className="library-cell-settings"><div className="library-choice-details">{anchorControl}{processSettings}</div><button type="button" className="library-primary" disabled={!canCell} onClick={() => onCell(cell.id, settings)}><Plus size={17} />{f.addCell}</button></div> : <p className="library-placement-help"><ArrowDownToLine size={16} />{tab === 'objects' ? f.layoutHint : f.processHint}</p>}
    <footer className="library-footnote"><div className="library-footnote-head"><span>{f.objectsCount(project.facility?.objects.length ?? 0)}</span><button type="button" onClick={onSaveTemplate}>{tm.save}</button></div><span role="status">{disabledReason && disabled ? disabledReason : mode === 'visual' && tab === 'objects' && objectLimit ? f.placementLimit : tab === 'cells' && project.model.nodes.length > 98 ? f.cellLimit : processMode && processLimit ? f.processLimit : processMode && teamLimit ? f.teamLimit : ''}</span></footer>
  </section>;
}
