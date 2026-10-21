import { actionHistoryMessages as m } from '../ui/messages/ActionHistory';
import { HISTORY_ACTION_LIMIT, HISTORY_BYTE_LIMIT, type EditorHistory } from './editorHistory';
import './editorControls.css';

interface Props { history: EditorHistory; revision: number; onUndo: () => void; onRedo: () => void }
export function ActionHistory({ history, revision, onUndo, onRedo }: Props) {
  const undo = history.past.at(-1), redo = history.future[0];
  return <section className="action-history" aria-label={m.projectActionHistory}>
    <p>{m.editsBelongToThisOpenProjectUndoAndRedo}</p>
    <div className="history-actions"><button className="secondary-button" disabled={!undo} onClick={onUndo} aria-label={m.actionName('undo', undo?.label)}>{m.actionButton('undo', undo?.label)}</button><button className="secondary-button" disabled={!redo} onClick={onRedo} aria-label={m.actionName('redo', redo?.label)}>{m.actionButton('redo', redo?.label)}</button></div>
    <div className="history-evidence" role="region" aria-label={m.recentProjectActionsScrollToInspect} tabIndex={0}>
      {history.past.length + history.future.length ? <ol>{[...history.past.map(entry => ({ entry, applied: true })), ...history.future.map(entry => ({ entry, applied: false }))].map(({ entry, applied }) => <li key={entry.id} className={applied ? '' : 'history-undone'}><span>{entry.label}</span><small>{applied ? entry === undo ? m.latestEdit : m.applied : entry === redo ? m.nextRedo : m.undone}</small></li>)}</ol> : <p>{m.noRetainedEditsInThisProject}</p>}
    </div>
    <p className="history-budget">{m.revision}{revision} · {history.past.length + history.future.length}/{HISTORY_ACTION_LIMIT}{m.actions}{(history.estimatedBytes / 1024 / 1024).toFixed(2)}/{HISTORY_BYTE_LIMIT / 1024 / 1024}{m.miBSerializedPayloadEstimate}</p>
    <p className="history-budget">{m.oldestHistoryEntriesExpireAtTheseLimitsProjectData}</p>
    {history.discarded > 0 && <p className="history-notice" role="status">{m.expiredEntries(history.discarded)}</p>}
    {history.estimateUnavailable && <p className="history-notice" role="status">{m.historyEstimateUnavailable}</p>}
  </section>;
}
