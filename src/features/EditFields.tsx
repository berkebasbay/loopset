import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { easeMessages as m } from '../ui/messages/ease';
import './ease.css';

interface DraftRegistry { set: (id: string, pending: boolean) => void }
const DraftContext = createContext<DraftRegistry | null>(null);
export function NumericDraftProvider({ onPendingChange, children }: { onPendingChange: (pending: boolean) => void; children: ReactNode }) {
  const pending = useRef(new Set<string>()); const reported = useRef(false); const notify = useRef(onPendingChange); notify.current = onPendingChange;
  const set = useCallback((id: string, active: boolean) => {
    if (active) pending.current.add(id); else pending.current.delete(id);
    const next = pending.current.size > 0;
    if (next !== reported.current) { reported.current = next; notify.current(next); }
  }, []);
  const value = useMemo(() => ({ set }), [set]);
  useEffect(() => () => { if (reported.current) notify.current(false); }, []);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}
/** Registers UI-only unapplied edits. No value is written to the model. */
export function usePendingEdit(contextKey: string, pending: boolean) {
  const registry = useContext(DraftContext); const id = useId();
  useEffect(() => {
    const key = `${id}:${contextKey}`; registry?.set(key, pending);
    return () => registry?.set(key, false);
  }, [registry, id, contextKey, pending]);
}
export interface NumberFieldProps {
  label: string; value: number; onChange: (value: number) => void; contextKey: string;
  min?: number; max?: number; step?: number | 'any'; help?: string; disabled?: boolean;
  onPendingChange?: (pending: boolean) => void; compact?: boolean; trackPending?: boolean; displayPrecision?: number;
}
export function NumberField({ label, value, onChange, contextKey, min, max, step = 'any', help, disabled, onPendingChange, compact, trackPending = true, displayPrecision }: NumberFieldProps) {
  const id = useId(); const format = (v: number) => Number.isFinite(v) ? String(displayPrecision ? Number(v.toPrecision(displayPrecision)) : v) : '';
  const [draft, setDraft] = useState(() => format(value)); const [error, setError] = useState('');
  const currentContext = useRef(contextKey); currentContext.current = contextKey;
  useEffect(() => { setDraft(format(value)); setError(''); }, [value, contextKey]);
  const parsed = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(draft.trim()) ? Number(draft) : NaN;
  const dirty = draft !== format(value);
  const validStep = step === 'any' || !Number.isFinite(parsed) || (step === 1 ? Number.isInteger(parsed) : Math.abs((parsed - (min ?? 0)) / step - Math.round((parsed - (min ?? 0)) / step)) < 1e-7);
  const valid = Number.isFinite(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max) && validStep;
  usePendingEdit(contextKey, trackPending && dirty);
  const pendingCallback = useRef(onPendingChange); pendingCallback.current = onPendingChange;
  useEffect(() => { pendingCallback.current?.(dirty); return () => pendingCallback.current?.(false); }, [dirty, contextKey]);
  function reset() { setDraft(format(value)); setError(''); }
  function commit() {
    if (!dirty || currentContext.current !== contextKey || disabled) return;
    if (!valid) { setError(m.numberRange(min, max, step)); return; }
    try { onChange(parsed); setDraft(format(parsed)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : m.editFailed); }
  }
  return <div className={`ease-field${compact ? ' ease-field-compact' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <input id={id} type="text" inputMode="decimal" role="spinbutton" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Number.isFinite(parsed) ? parsed : undefined} aria-invalid={Boolean(error)} data-pending={dirty || undefined} aria-describedby={help || error || dirty ? `${id}-help` : undefined} value={draft} disabled={disabled} onChange={event => { setDraft(event.currentTarget.value); setError(''); }} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reset(); }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault(); const increment = step === 'any' ? 1 : step;
        if (Number.isFinite(parsed)) setDraft(String(parsed + (event.key === 'ArrowUp' ? increment : -increment)));
      }
    }} />
    {(help || error || dirty) && <small id={`${id}-help`} className={error ? 'ease-field-error' : ''}>{error ? <span role="alert">{error}</span> : dirty ? m.applyFieldHint : help}</small>}
  </div>;
}
export type TimeUnit = 'seconds' | 'minutes' | 'hours' | 'days';
export const TIME_SCALE: Record<TimeUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
export function TimeField({ label, value, onChange, contextKey, min = 0, max, help, disabled, trackPending = true, defaultUnit = 'seconds' }: Omit<NumberFieldProps, 'step' | 'onPendingChange' | 'compact'> & { defaultUnit?: TimeUnit }) {
  const [unit, setUnit] = useState<TimeUnit>(defaultUnit); const [pending, setPending] = useState(false); const id = useId();
  const scale = TIME_SCALE[unit];
  return <div className="ease-time-field">
    <div className="ease-time-value"><NumberField key={`${contextKey}:${unit}`} label={label} value={value / scale} onChange={v => onChange(v * scale)} contextKey={`${contextKey}:${unit}`} min={min / scale} max={max === undefined ? undefined : max / scale} disabled={disabled} help={help} onPendingChange={setPending} trackPending={trackPending} displayPrecision={12} /></div>
    <div className="ease-field ease-time-unit"><label htmlFor={id}>{m.timeUnit}</label><select id={id} aria-label={m.unitFor(label)} value={unit} disabled={disabled || pending} onChange={event => setUnit(event.currentTarget.value as TimeUnit)}>{(Object.keys(TIME_SCALE) as TimeUnit[]).map(key => <option key={key} value={key}>{m.units[key]}</option>)}</select></div>
  </div>;
}
