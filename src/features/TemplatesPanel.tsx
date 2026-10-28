import { useEffect, useRef, useState } from 'react';
import { Box, Download, FileUp, FolderOpen, LayoutTemplate, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import type { Project } from '../model/types';
import { StarterGallery } from './StarterGallery';
import type { StarterId } from '../templates/catalogue';
import { EmptyState } from '../ui/EmptyState';
import { templateMessages as m } from '../ui/messages/templates';
import { listTemplates, loadTemplate, removeTemplate, saveTemplate } from '../storage/templateStore';
import { instantiateTemplate, TEMPLATE_LIMIT, type TemplateMetadata } from '../storage/templateFormat';
import { openProjectJSON, serializeProject } from '../storage/projectFile';
import { downloadText, readLocalText, safeFilename } from '../storage/csv';
import './templates.css';

export type StarterTemplate = StarterId | 'blank';
interface Props {
  project: Project; intent: 'browse' | 'save'; blockedReason?: string; saveBlockedReason?: string;
  onStarter: (template: StarterTemplate) => void | Promise<void>; onUse: (project: Project) => boolean;
}
export function TemplatesPanel({ project, intent, blockedReason, saveBlockedReason, onStarter, onUse }: Props) {
  const [tab, setTab] = useState<'starters' | 'mine'>(intent === 'save' ? 'mine' : 'starters');
  const [showSave, setShowSave] = useState(intent === 'save');
  const [failedStarter, setFailedStarter] = useState<StarterTemplate | null>(null);
  const [items, setItems] = useState<TemplateMetadata[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [name, setName] = useState(project.name), [query, setQuery] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [imported, setImported] = useState<Project | null>(null), [removeId, setRemoveId] = useState<string | null>(null);
  const alive = useRef(false), operation = useRef(0), busyRef = useRef(false), input = useRef<HTMLInputElement>(null), nameInput = useRef<HTMLInputElement>(null), panel = useRef<HTMLDivElement>(null), saveOpener = useRef<HTMLButtonElement>(null);
  async function refresh() { const rows = await listTemplates(); if (alive.current) setItems(rows); }
  useEffect(() => {
    alive.current = true; let current = true;
    void listTemplates().then(rows => { if (current) { setItems(rows); setError(''); } }).catch(error => { if (current) setError(error instanceof Error ? error.message : m.storage); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; alive.current = false; operation.current++; };
  }, []);
  useEffect(() => { if (intent === 'save') requestAnimationFrame(() => { if (alive.current) nameInput.current?.focus(); }); }, [intent]);
  async function perform(action: (current: () => boolean) => Promise<void>, starter?: StarterTemplate) {
    if (busyRef.current) return;
    const token = ++operation.current; busyRef.current = true; setBusy(true); setError(''); setStatus(''); setFailedStarter(starter ?? null);
    const current = () => alive.current && operation.current === token;
    try { await action(current); if (current()) setFailedStarter(null); } catch (error) { if (current()) setError(error instanceof Error ? error.message : m.storage); }
    finally { busyRef.current = false; if (current()) setBusy(false); }
  }
  function save() {
    if (blockedReason || (!imported && saveBlockedReason)) return;
    const snapshot = structuredClone(imported ?? project), templateName = name;
    void perform(async current => {
      const saved = await saveTemplate(snapshot, templateName);
      if (!current()) return;
      setStatus(m.saved(saved.name)); setImported(null); setShowSave(false); setQuery(''); await refresh();
      requestAnimationFrame(() => { if (current()) panel.current?.querySelector<HTMLButtonElement>(`[data-template-id="${saved.id}"] .ql-primary`)?.focus(); });
    });
  }
  function loadFile(file?: File) {
    if (!file) return;
    void perform(async current => {
      const snapshot = openProjectJSON(await readLocalText(file));
      if (!current()) return;
      setImported(snapshot); setName(snapshot.name); setTab('mine'); setShowSave(true); setStatus(m.importReady);
      requestAnimationFrame(() => { if (current()) nameInput.current?.focus(); });
    });
  }
  const matches = items.filter(item => item.name.toLocaleLowerCase('en').includes(query.trim().toLocaleLowerCase('en')));
  const snapshot = imported ?? project;
  return <div ref={panel} className="templates-panel ql-feature">
    <p className="modal-intro">{m.intro}</p>
    <div className="templates-toolbar"><div className="ql-toolbar" role="group" aria-label={m.title}>
      <button type="button" disabled={busy} className={`ql-tab ${tab === 'starters' ? 'ql-active' : ''}`} aria-pressed={tab === 'starters'} onClick={() => { setTab('starters'); setError(''); setFailedStarter(null); }}>{m.starters}</button>
      <button type="button" disabled={busy} className={`ql-tab ${tab === 'mine' ? 'ql-active' : ''}`} aria-pressed={tab === 'mine'} onClick={() => { setTab('mine'); setError(''); setFailedStarter(null); }}>{m.mine}<span>{items.length}</span></button>
    </div><button ref={saveOpener} type="button" className="ql-button" disabled={busy} aria-expanded={showSave && tab === 'mine'} onClick={() => { setImported(null); setName(project.name); setTab('mine'); setShowSave(true); requestAnimationFrame(() => nameInput.current?.focus()); }}><Plus size={16} />{m.save}</button></div>
    {blockedReason && <p className="ql-import-preview" role="status">{blockedReason}</p>}
    {status && <p className="template-status" role="status">{status}</p>}
    {error && <div className="ql-error" role="alert"><p>{error}</p><button type="button" className="ql-button" disabled={busy} onClick={() => failedStarter ? void perform(async () => { await onStarter(failedStarter); }, failedStarter) : void perform(async () => { await refresh(); setLoading(false); })}>{m.retry}</button></div>}
    {tab === 'starters' ? <StarterGallery busy={busy} blocked={Boolean(blockedReason)} onChoose={id => void perform(async () => { await onStarter(id); }, id)} /> : <>
      {showSave && <section className="template-save" aria-label={m.saveTitle}><div><LayoutTemplate size={22} /><h3>{imported ? m.importReady : m.saveTitle}</h3></div><p className="ql-help">{m.saveDescription}</p><p className="template-source-summary">{m.summary(snapshot.facility?.objects.length ?? 0, snapshot.model.nodes.length)}</p>
        <form onSubmit={event => { event.preventDefault(); save(); }}><label>{m.name}<input ref={nameInput} value={name} maxLength={160} disabled={busy} onChange={event => setName(event.currentTarget.value)} /></label><button type="submit" className="ql-button ql-primary" disabled={busy || loading || Boolean(blockedReason) || (!imported && Boolean(saveBlockedReason)) || !name.trim()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{busy ? m.saving : imported ? m.saveImported : m.saveButton}</button></form>
        {!imported && saveBlockedReason && <p role="status" className="ql-help">{saveBlockedReason}</p>}
        <button type="button" className="ql-button template-cancel-save" disabled={busy} onClick={() => { saveOpener.current?.focus(); setImported(null); setName(project.name); setStatus(''); setShowSave(false); }}>{imported ? m.cancelImport : m.cancel}</button>
      </section>}
      <div className="template-library-tools"><label>{m.search}<input type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} /></label><button type="button" className="ql-button" disabled={busy} onClick={() => input.current?.click()}><FileUp size={16} />{m.import}</button><input ref={input} hidden type="file" accept=".json,application/json" aria-label={m.importInput} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; loadFile(file); }} /></div>
      <p className="template-library-scope">{m.localScope}<span>{items.length} / {TEMPLATE_LIMIT}</span></p>
      {loading ? <p role="status">{m.loading}</p> : matches.length ? <ul className="saved-template-list">{matches.map(item => <li key={item.id} data-template-id={item.id}>
        <Box size={23} aria-hidden="true" /><div><h3>{item.name}</h3><p>{m.summary(item.objects, item.steps)} · {new Date(item.createdAt).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })}</p></div>
        <div className="saved-template-actions"><button type="button" className="ql-button ql-primary" disabled={busy || Boolean(blockedReason)} onClick={() => void perform(async current => { const template = await loadTemplate(item.id); if (current()) onUse(instantiateTemplate(template)); })}><FolderOpen size={15} />{m.use}</button><button type="button" className="ql-button" aria-label={`${m.download}: ${item.name}`} disabled={busy} onClick={() => void perform(async current => { const template = await loadTemplate(item.id); if (!current()) return; downloadText(serializeProject(instantiateTemplate(template)), safeFilename(`${item.name}-template`, 'json'), 'application/json;charset=utf-8'); setStatus(m.downloadRequested); })}><Download size={15} /></button><button type="button" className="ql-button" data-template-remove aria-label={`${m.remove}: ${item.name}`} disabled={busy} onClick={() => setRemoveId(item.id)}><Trash2 size={15} /></button></div>
        {removeId === item.id && <div className="template-remove-review"><p>{m.removeQuestion(item.name)}</p><button type="button" className="ql-button ql-danger" disabled={busy} onClick={() => void perform(async current => { await removeTemplate(item.id); if (!current()) return; setRemoveId(null); setStatus(m.removed); await refresh(); })}>{m.confirmRemove}</button><button type="button" className="ql-button" disabled={busy} onClick={() => { panel.current?.querySelector<HTMLButtonElement>(`[data-template-id="${item.id}"] [data-template-remove]`)?.focus(); setRemoveId(null); }}>{m.cancel}</button></div>}
      </li>)}</ul> : <EmptyState icon={LayoutTemplate} title={query ? m.noMatches : m.empty} description={m.emptyHelp} />}
    </>}
  </div>;
}
