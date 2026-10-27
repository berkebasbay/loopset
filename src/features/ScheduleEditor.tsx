import { useEffect, useId, useRef, useState } from 'react';
import type { CapacityPeriod, RateSegment } from '../model/types';
import { MAX_ARRIVALS_PER_HOUR } from '../model/limits';
import { NumberField, TimeField, usePendingEdit } from './EditFields';
import { easeMessages as m } from '../ui/messages/ease';

interface Shared { horizon: number; contextKey: string; disabled?: boolean }
export type ScheduleEditorProps = Shared & (
  { kind: 'arrival'; segments: RateSegment[]; onChange: (segments: RateSegment[]) => void }
  | { kind: 'calendar'; periods: CapacityPeriod[]; baseCapacity: number; installedCapacity: number; onChange: (periods: CapacityPeriod[]) => void }
);
interface Slot { start: number; end: number; value: number }
export function Timeline({ slots, horizon, kind, onSelect }: { slots: readonly Slot[]; horizon: number; kind: 'arrival' | 'calendar'; onSelect?: (index: number) => void }) {
  const maximum = Math.max(1, ...slots.map(slot => Number.isFinite(slot.value) ? slot.value : 0));
  const bounded = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v / horizon) ? v / horizon * 100 : 0));
  let last = 0; const gaps: { start: number; end: number }[] = [];
  for (const slot of slots) { if (slot.start > last) gaps.push({ start: last, end: slot.start }); last = Math.max(last, slot.end); }
  if (last < horizon) gaps.push({ start: last, end: horizon });
  return <figure className="ease-timeline" aria-label={kind === 'arrival' ? m.timelineArrival : m.timelineCalendar}>
    <div className="ease-timeline-track">
      {gaps.map((gap, i) => <span key={`gap-${i}`} className="ease-timeline-gap" style={{ left: `${bounded(gap.start)}%`, width: `${Math.max(0, bounded(gap.end) - bounded(gap.start))}%` }} title={m.timelineGap(m.duration(gap.start), m.duration(gap.end))} />)}
      {slots.map((slot, i) => <button key={i} type="button" className={`ease-timeline-period${slot.value === 0 ? ' is-zero' : ''}`} style={{ left: `${bounded(slot.start)}%`, width: `${Math.max(.2, bounded(slot.end) - bounded(slot.start))}%`, height: `${Math.max(12, slot.value / maximum * 100)}%` }} aria-label={m.editPeriod(i + 1)} title={m.timelineLabel(m.duration(slot.start), m.duration(slot.end), kind === 'arrival' ? m.timelineRate(String(slot.value)) : m.timelineCapacity(String(slot.value)))} onClick={() => onSelect?.(i)} tabIndex={onSelect ? 0 : -1}><span>{slot.value.toLocaleString('en', { maximumFractionDigits: 2 })}</span></button>)}
    </div><figcaption><span>{m.duration(0)}</span><span>{m.duration(horizon)}</span></figcaption>{gaps.length > 0 && <details className="ease-gap-list"><summary>{m.gapsHeading(gaps.length)}</summary><ul>{gaps.map((gap, i) => <li key={i}>{kind === 'arrival' ? m.timelineGap(m.duration(gap.start), m.duration(gap.end)) : m.baseGap(m.duration(gap.start), m.duration(gap.end))}</li>)}</ul></details>}
  </figure>;
}
function issues(slots: readonly Slot[], horizon: number, maximum: number, whole: boolean) {
  const result: string[] = []; let last = 0;
  for (const [i, slot] of slots.entries()) {
    if (!Number.isFinite(slot.start) || !Number.isFinite(slot.end) || slot.start < 0 || slot.end <= slot.start || slot.end > horizon) result.push(m.invalidPeriod(i + 1));
    if (slot.start < last) result.push(m.overlap(i + 1));
    if (!Number.isFinite(slot.value) || slot.value < 0 || slot.value > maximum || whole && !Number.isInteger(slot.value)) result.push(m.invalidRate(i + 1));
    last = slot.end;
  }
  if (slots.length > 200) result.push(m.periodLimit);
  return result;
}
/** Explicit break insertion is previewed before applying; existing periods outside it survive. */
export function insertCalendarBreak(periods: readonly CapacityPeriod[], start: number, end: number, horizon: number, installedCapacity: number): CapacityPeriod[] {
  const problems = issues(periods.map(period => ({ start: period.start, end: period.end, value: period.capacity })), horizon, installedCapacity, true);
  if (problems.length) throw new Error(problems[0]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > horizon) throw new Error(m.invalidPeriod(periods.length + 1));
  const next: CapacityPeriod[] = [];
  for (const period of periods) {
    if (period.end <= start || period.start >= end) next.push({ ...period });
    else { if (period.start < start) next.push({ ...period, end: start }); if (period.end > end) next.push({ ...period, start: end }); }
  }
  next.push({ start, end, capacity: 0 }); next.sort((a, b) => a.start - b.start);
  if (next.length > 200) throw new Error(m.periodLimit);
  return next;
}
export function ScheduleEditor(props: ScheduleEditorProps) {
  const { kind, horizon, contextKey, disabled } = props;
  const original: Slot[] = kind === 'arrival' ? props.segments.map(p => ({ start: p.start, end: p.end, value: p.perHour })) : props.periods.map(p => ({ start: p.start, end: p.end, value: p.capacity }));
  const signature = JSON.stringify(original);
  const [draft, setDraft] = useState<Slot[]>(original); const [error, setError] = useState(''); const root = useRef<HTMLDivElement>(null); const rows = useRef<(HTMLDivElement | null)[]>([]); const id = useId();
  const [breakStart, setBreakStart] = useState(horizon / 2); const [breakLength, setBreakLength] = useState(Math.min(300, horizon / 10));
  useEffect(() => { setDraft(JSON.parse(signature) as Slot[]); setError(''); }, [signature, contextKey]);
  const maximum = kind === 'arrival' ? MAX_ARRIVALS_PER_HOUR : props.installedCapacity;
  const problems = issues(draft, horizon, maximum, kind === 'calendar'); const changed = JSON.stringify(draft) !== signature;
  usePendingEdit(`${contextKey}:time-plan`, changed);
  function update(index: number, patch: Partial<Slot>) { setDraft(previous => previous.map((slot, i) => i === index ? { ...slot, ...patch } : slot)); setError(''); }
  function apply() {
    if (root.current?.querySelector('[data-pending="true"]')) { setError(m.applyFieldsFirst); return; }
    if (problems.length) { setError(problems[0]); return; }
    try {
      if (props.kind === 'arrival') props.onChange(draft.map(p => ({ start: p.start, end: p.end, perHour: p.value })));
      else props.onChange(draft.map(p => ({ start: p.start, end: p.end, capacity: p.value })));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : m.editFailed); }
  }
  function add() {
    if (draft.length >= 200) { setError(m.periodLimit); return; }
    const start = draft.at(-1)?.end ?? 0;
    if (start >= horizon) { setError(m.addPeriodNoSpace); return; }
    setDraft([...draft, { start, end: horizon, value: kind === 'arrival' ? 0 : props.baseCapacity }]); setError('');
  }
  function addBreak() {
    if (props.kind !== 'calendar') return;
    const end = breakStart + breakLength;
    if (!(breakStart >= 0 && breakLength > 0 && end <= horizon) || problems.length || root.current?.querySelector('[data-pending="true"]')) { setError(m.invalidPeriod(draft.length + 1)); return; }
    let next: Slot[];
    try { next = insertCalendarBreak(draft.map(slot => ({ start: slot.start, end: slot.end, capacity: slot.value })), breakStart, end, horizon, props.installedCapacity).map(period => ({ start: period.start, end: period.end, value: period.capacity })); }
    catch (e) { setError(e instanceof Error ? e.message : m.editFailed); return; }
    setDraft(next); setError('');
  }
  return <div ref={root} className="ease-schedule" aria-labelledby={`${id}-title`}>
    <h4 id={`${id}-title`}>{kind === 'arrival' ? m.timelineArrival : m.timelineCalendar}</h4>
    <p className="ease-help">{props.kind === 'arrival' ? m.arrivalGapScope : m.calendarGapScope(props.baseCapacity)}</p>
    <Timeline slots={draft} horizon={horizon} kind={kind} onSelect={i => rows.current[i]?.querySelector<HTMLInputElement>('input')?.focus()} />
    {!draft.length && <p className="ease-help">{kind === 'arrival' ? m.emptyArrivalPlan : m.emptyCalendar}</p>}
    <div className="ease-periods">{draft.map((slot, i) => <div className="ease-period" key={i} ref={element => { rows.current[i] = element; }}>
      <div className="ease-period-heading"><strong>{m.period(i + 1)}</strong><button type="button" className="ease-link" disabled={disabled} onClick={() => setDraft(draft.filter((_, index) => index !== i))}>{m.removePeriod(i + 1)}</button></div>
      <TimeField label={m.periodStart(i + 1)} contextKey={`${contextKey}:period:${i}:start`} value={slot.start} min={0} max={horizon} defaultUnit="minutes" disabled={disabled} onChange={start => update(i, { start })} />
      <TimeField label={m.periodEnd(i + 1)} contextKey={`${contextKey}:period:${i}:end`} value={slot.end} min={0} max={horizon} defaultUnit="minutes" disabled={disabled} onChange={end => update(i, { end })} />
      <NumberField label={kind === 'arrival' ? m.periodRate(i + 1) : m.periodCapacity(i + 1)} contextKey={`${contextKey}:period:${i}:value`} value={slot.value} min={0} max={maximum} step={kind === 'calendar' ? 1 : 'any'} disabled={disabled} onChange={value => update(i, { value })} />
    </div>)}</div>
    <button className="ease-button" type="button" disabled={disabled || draft.length >= 200} onClick={add}>{m.addPeriod}</button>
    {props.kind === 'calendar' && <details className="ease-disclosure"><summary>{m.addBreak}</summary><p className="ease-help">{m.breakScope}</p><TimeField label={m.breakStart} value={breakStart} min={0} max={horizon} defaultUnit="minutes" contextKey={`${contextKey}:break-start`} disabled={disabled} onChange={setBreakStart} /><TimeField label={m.breakDuration} value={breakLength} min={Number.MIN_VALUE} max={horizon} defaultUnit="minutes" contextKey={`${contextKey}:break-length`} disabled={disabled} onChange={setBreakLength} /><button className="ease-button" type="button" disabled={disabled} onClick={addBreak}>{m.addBreak}</button></details>}
    {problems.length > 0 && <ul className="ease-problems" role="alert">{problems.map((problem, i) => <li key={i}>{problem}</li>)}</ul>}
    {changed && <><p className="ease-help">{m.reviewSchedule}</p><div className="ease-actions"><button className="ease-button ease-primary" type="button" disabled={disabled || problems.length > 0} onClick={apply}>{m.applySchedule}</button><button className="ease-button" type="button" onClick={() => { setDraft(JSON.parse(signature) as Slot[]); setError(''); }}>{m.cancelSchedule}</button></div></>}
    {error && <p role="alert" className="ease-error">{error}</p>}
  </div>;
}
