import { HISTORY_ACTION_LIMIT, HISTORY_BYTE_LIMIT, type EditorHistory } from './editorHistory';
import './editorControls.css';

interface Props { history: EditorHistory; revision: number; onUndo: () => void; onRedo: () => void }
export function ActionHistory({ history, revision, onUndo, onRedo }: Props) {
  const undo = history.past.at(-1), redo = history.future[0];
  return <section className="action-history" aria-label="Project action history">
    <p>Edits belong to this open project. Undo and Redo keep revision numbers increasing. Camera, selection and replay stay outside history.</p>
    <div className="history-actions"><button className="secondary-button" disabled={!undo} onClick={onUndo} aria-label={undo ? `Undo ${undo.label}` : 'Undo'}>Undo{undo ? `: ${undo.label}` : ''}</button><button className="secondary-button" disabled={!redo} onClick={onRedo} aria-label={redo ? `Redo ${redo.label}` : 'Redo'}>Redo{redo ? `: ${redo.label}` : ''}</button></div>
    <div className="history-evidence" role="region" aria-label="Recent project actions, scroll to inspect" tabIndex={0}>
      {history.past.length + history.future.length ? <ol>{[...history.past.map(entry => ({ entry, applied: true })), ...history.future.map(entry => ({ entry, applied: false }))].map(({ entry, applied }) => <li key={entry.id} className={applied ? '' : 'history-undone'}><span>{entry.label}</span><small>{applied ? entry === undo ? 'Latest edit' : 'Applied' : entry === redo ? 'Next redo' : 'Undone'}</small></li>)}</ol> : <p>No retained edits in this project.</p>}
    </div>
    <p className="history-budget">Revision {revision} · {history.past.length + history.future.length}/{HISTORY_ACTION_LIMIT} actions · {(history.estimatedBytes / 1024 / 1024).toFixed(2)}/{HISTORY_BYTE_LIMIT / 1024 / 1024} MiB serialized payload estimate.</p>
    <p className="history-budget">Oldest history entries expire at these limits; project data and recovery copies stay available. Layout edits retain point changes. Document snapshots count once by object identity; shared nested data may be counted again. This estimate is not a JavaScript heap limit.</p>
    {history.discarded > 0 && <p className="history-notice" role="status">{history.discarded} older history {history.discarded === 1 ? 'entry has' : 'entries have'} expired to keep history within its limits. The open project was kept.</p>}
    {history.estimateUnavailable && <p className="history-notice" role="status">Some draft payloads could not be estimated. The 50-action limit still applies; those drafts remain in memory for Undo.</p>}
  </section>;
}
