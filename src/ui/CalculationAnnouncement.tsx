import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RunStatus } from '../model/types';

export interface CalculationAnnouncement { message: string; surface: number; sequence: number }
const empty: CalculationAnnouncement = { message: '', surface: 0, sequence: 0 };
const hidden: CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0 };

/** One active request and one bounded presentation value; never retain models/results. */
export function createCalculationAnnouncement(notify: (event: CalculationAnnouncement) => void) {
  let alive = true; let active: string | null = null; let lastStarted: string | null = null;
  let stopping = false; let event = empty;
  function publish(message: string, surface: number) {
    event = { message: message.slice(0, 512), surface, sequence: event.sequence + 1 }; notify(event);
  }
  return {
    activate() { alive = true; },
    begin(id: string, message: string, surface = 0) {
      if (!alive || !id || id.length > 128 || id === lastStarted) return false;
      active = id; lastStarted = id; stopping = false; publish(message, surface); return true;
    },
    stopping(id: string, message: string, surface = 0) {
      if (!alive || id !== active || stopping) return false;
      stopping = true; publish(message, surface); return true;
    },
    finish(id: string, message: string, surface = 0) {
      if (!alive || id !== active) return false;
      active = null; stopping = false; publish(message, surface); return true;
    },
    invalidate(surface = 0) {
      active = null; stopping = false;
      if (alive && event.message) publish('', surface);
    },
    dispose() { alive = false; active = null; stopping = false; },
  };
}

export interface NumericalSnapshot { projectId: string; modelHash: string; seed: number; valid: boolean }
export const sameNumericalSnapshot = (requested: NumericalSnapshot, current: NumericalSnapshot) => requested.valid && current.valid
  && requested.projectId === current.projectId && requested.modelHash === current.modelHash && requested.seed === current.seed;

/** Non-completed outcomes retain their existing error/incomplete channels. */
export function completedSimulationNotice(
  facts: { status: RunStatus; name: string; completed: number; unfinished: number; earlier: boolean },
  format: (name: string, completed: number, unfinished: number, earlier: boolean) => string,
): string {
  return facts.status === 'completed' ? format(facts.name, facts.completed, facts.unfinished, facts.earlier) : '';
}

export function useCalculationAnnouncement() {
  const [announcement, setAnnouncement] = useState(empty);
  const controller = useRef<ReturnType<typeof createCalculationAnnouncement> | null>(null);
  if (!controller.current) controller.current = createCalculationAnnouncement(setAnnouncement);
  useEffect(() => { const current = controller.current!; current.activate(); return () => current.dispose(); }, []);
  return { announcement, controller: controller.current };
}

/** The caller selects the current main/dialog epoch, keeping old text out of a newly opened scope. */
export function CalculationStatus({ announcement, active = true, label }: { announcement: CalculationAnnouncement; active?: boolean; label: string }) {
  return <div role="status" aria-live="polite" aria-atomic="true" aria-label={label} data-calculation-status data-announcement-sequence={announcement.sequence} style={hidden}>{active ? announcement.message : ''}</div>;
}
