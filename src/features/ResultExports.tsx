import { useLayoutEffect, useRef, useState } from 'react';
import type { RunResult } from '../model/types';
import { downloadText, safeFilename } from '../storage/csv';
import { printResult, resultCSV, resultReportHTML } from '../storage/report';
import { downloadResultPNG, resultCardPNG } from '../storage/resultCard';
import { fileEaseMessages as m } from '../ui/messages/fileEase';

export interface OperationFocusOptions { fallback?: () => HTMLElement | null; allowProjectChange?: boolean }
/** Disabled native buttons lose focus while an operation is pending. Restore only
 * that loss, never a focus change made by the user or another document context. */
export function captureDataOperationFocus(root: HTMLElement | null, projectId: string, options: OperationFocusOptions = {}) {
  if (!root) return null;
  const doc = root.ownerDocument; const trigger = doc.activeElement as HTMLElement | null;
  if (!trigger || !root.contains(trigger) || typeof trigger.focus !== 'function') return null;
  let interrupted = false; let finished = false;
  const onFocus = (event: Event) => {
    if (event.target !== trigger && event.target !== doc.body && event.target !== doc.documentElement) interrupted = true;
  };
  const onPointer = (event: Event) => { if (event.target !== trigger && !trigger.contains(event.target as Node | null)) interrupted = true; };
  const onBlur = () => { interrupted = true; };
  doc.addEventListener('focusin', onFocus, true); doc.addEventListener('pointerdown', onPointer, true);
  doc.defaultView?.addEventListener('blur', onBlur);
  const detach = () => {
    doc.removeEventListener('focusin', onFocus, true); doc.removeEventListener('pointerdown', onPointer, true);
    doc.defaultView?.removeEventListener('blur', onBlur);
  };
  return { cancel() { finished = true; detach(); }, complete(currentProjectId: string) {
    if (finished) return;
    finished = true; detach();
    const active = doc.activeElement;
    if (interrupted || !root.isConnected || (!options.allowProjectChange && currentProjectId !== projectId)
      || (active !== trigger && active !== doc.body && active !== doc.documentElement)) return;
    const target = [trigger, options.fallback?.()].find(candidate => candidate?.isConnected && root.contains(candidate) && !candidate.matches(':disabled') && !candidate.closest('[hidden], [inert]'));
    target?.focus();
  } };
}
export type ResultExportFormat = 'json' | 'csv' | 'png' | 'html' | 'pdf';
export function serializeRunJSON(result: RunResult): string {
  return JSON.stringify({ format: 'queuelab-run-v1', ...result }, null, 2);
}
export async function exportRun(result: RunResult, format: ResultExportFormat, filename?: string): Promise<void> {
  const name = filename ?? `${result.model.name}-${result.status}-${result.id.slice(0, 8)}`;
  if (format === 'json') downloadText(serializeRunJSON(result), safeFilename(name, 'json'), 'application/json;charset=utf-8');
  else if (format === 'csv') downloadText(resultCSV(result), safeFilename(name, 'csv'), 'text/csv;charset=utf-8');
  else if (format === 'html') downloadText(resultReportHTML(result), safeFilename(name, 'html'), 'text/html;charset=utf-8');
  else if (format === 'png') {
    if (!filename) await downloadResultPNG(result);
    else {
      const { blob } = await resultCardPNG(result); const url = URL.createObjectURL(blob);
      try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeFilename(filename, 'png'); anchor.hidden = true; document.body.append(anchor); try { anchor.click(); } finally { anchor.remove(); } }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
  }
  else printResult(result);
}
interface Props {
  result: RunResult; filename?: string; stale?: boolean; disabled?: boolean;
  onStatus?: (message: string) => void; onError?: (message: string) => void;
  perform?: (operation: () => void | Promise<void>, focus?: OperationFocusOptions) => void | Promise<void>;
}
export function ResultExports({ result, filename, stale = false, disabled = false, onStatus, onError, perform }: Props) {
  const [busy, setBusy] = useState(false); const [completedOperation, setCompletedOperation] = useState(0); const [status, setStatus] = useState(''); const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null); const currentId = useRef(result.id); currentId.current = result.id;
  const active = useRef(false); const focus = useRef<ReturnType<typeof captureDataOperationFocus>>(null);
  useLayoutEffect(() => { if (!busy) { focus.current?.complete(currentId.current); focus.current = null; } }, [busy, completedOperation]);
  useLayoutEffect(() => () => { focus.current?.cancel(); }, []);
  async function request(format: ResultExportFormat) {
    if (active.current || disabled) return;
    active.current = true; setBusy(true); setError(''); setStatus('');
    const snapshot = result;
    if (!perform) focus.current = captureDataOperationFocus(root.current, snapshot.id, { fallback: () => root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? null });
    try {
      const operation = async () => {
        await exportRun(snapshot, format, filename);
        const message = format === 'pdf' ? m.printRequested(snapshot.id) : m.downloadRequested(format.toUpperCase(), snapshot.id);
        if (onStatus) onStatus(message); else setStatus(message);
      };
      if (perform) await perform(operation); else await operation();
    } catch (e) {
      const message = e instanceof Error ? e.message : m.exportFailed;
      if (onError) onError(message); else setError(message);
    } finally { active.current = false; setBusy(false); setCompletedOperation(value => value + 1); }
  }
  const formats: [ResultExportFormat, string][] = [['json', m.json], ['csv', m.csv], ['png', m.png], ['html', m.html], ['pdf', m.pdf]];
  return <div ref={root} className="ql-result-exports" data-result-export-id={result.id}>
    <h4>{m.reportFormats}</h4>
    <p className="ql-help"><strong>{result.status === 'completed' ? m.completed : m.incomplete(result.status)}</strong> · {m.exportedIdentity(result.id)}</p>
    {stale && <p className="ql-notice">{m.stale}</p>}
    {result.status !== 'completed' && <p className="ql-notice">{m.incompleteScope}</p>}
    <div className="ql-actions">{formats.map(([format, label]) => <button key={format} className="ql-button" type="button" disabled={disabled || busy} onClick={() => void request(format)}>{label}</button>)}</div>
    <div aria-live="polite" aria-atomic="true">{!onStatus && busy && <p className="ql-help">{m.exporting}</p>}{!onStatus && status && <p role="status" className="ql-help">{status}</p>}{!onError && error && <p role="alert" className="ql-error">{error}</p>}</div>
  </div>;
}
