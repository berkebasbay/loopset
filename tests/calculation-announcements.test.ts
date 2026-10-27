import { describe, expect, it } from 'vitest';
import { completedSimulationNotice, createCalculationAnnouncement, sameNumericalSnapshot, type CalculationAnnouncement } from '../src/ui/CalculationAnnouncement';
import { appMessages } from '../src/ui/messages/App';
import { experimentsPanelMessages } from '../src/ui/messages/ExperimentsPanel';
import type { RunStatus } from '../src/model/types';

function channel() {
  const events: CalculationAnnouncement[] = [];
  return { events, controller: createCalculationAnnouncement(event => events.push(event)) };
}

describe('bounded calculation announcement lifecycle', () => {
  it('emits one start, optional stopping and one terminal for the active request', () => {
    const { events, controller } = channel();
    expect(controller.begin('run-a', 'Started', 1)).toBe(true);
    expect(controller.begin('run-a', 'Duplicate start', 1)).toBe(false);
    expect(controller.stopping('run-a', 'Stopping', 2)).toBe(true);
    expect(controller.stopping('run-a', 'Duplicate stopping', 2)).toBe(false);
    expect(controller.finish('run-a', '', 2)).toBe(true);
    expect(controller.finish('run-a', 'False success', 2)).toBe(false);
    expect(events.map(event => event.message)).toEqual(['Started', 'Stopping', '']);
    expect(events.map(event => event.surface)).toEqual([1, 2, 2]);
  });

  it('does not publish old terminal or cancel messages after a newer request', () => {
    const { events, controller } = channel();
    controller.begin('old', 'Old snapshot'); controller.begin('new', 'New snapshot');
    expect(controller.finish('old', 'Old completed')).toBe(false);
    expect(controller.stopping('old', 'Old stopping')).toBe(false);
    controller.finish('new', 'New completed');
    expect(events.map(event => event.message)).toEqual(['Old snapshot', 'New snapshot', 'New completed']);
  });

  it('invalidates a replaced document and suppresses later outcomes', () => {
    const { events, controller } = channel();
    controller.begin('old-document', 'Calculating'); controller.invalidate(8);
    expect(controller.finish('old-document', 'Obsolete completed', 8)).toBe(false);
    expect(events.at(-1)).toMatchObject({ message: '', surface: 8 });
  });

  it('silently retires errors/cancelled/incomplete operations so the existing channel owns their feedback', () => {
    const { events, controller } = channel();
    for (const id of ['error', 'cancelled', 'limited']) { controller.begin(id, 'Started'); controller.finish(id, ''); }
    expect(events.map(event => event.message)).toEqual(['Started', '', 'Started', '', 'Started', '']);
    expect(controller.finish('limited', 'Completed')).toBe(false);
  });

  it('does not deduplicate an identical outcome across distinct requests', () => {
    const { events, controller } = channel();
    controller.begin('one', 'Started'); controller.finish('one', 'Completed');
    controller.begin('two', 'Started'); controller.finish('two', 'Completed');
    expect(events.map(event => event.message)).toEqual(['Started', 'Completed', 'Started', 'Completed']);
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('does not publish after disposal and can reconnect without resurrecting a pending operation', () => {
    const { events, controller } = channel();
    controller.begin('old', 'Started'); controller.dispose();
    expect(controller.finish('old', 'Completed')).toBe(false);
    expect(controller.begin('while-closed', 'Started')).toBe(false);
    controller.activate();
    expect(controller.finish('old', 'Completed')).toBe(false);
    expect(controller.begin('new', 'Started')).toBe(true);
    expect(events.map(event => event.message)).toEqual(['Started', 'Started']);
  });

  it('keeps independent controller tokens independent and caps retained presentation text', () => {
    const main = channel(), experiments = channel();
    main.controller.begin('same-id', 'x'.repeat(10_000)); experiments.controller.begin('same-id', 'Experiment');
    main.controller.invalidate(); experiments.controller.finish('same-id', 'Experiment finished');
    expect(main.events[0].message).toHaveLength(512);
    expect(experiments.events.map(event => event.message)).toEqual(['Experiment', 'Experiment finished']);
    expect(main.controller.begin('x'.repeat(129), 'Too large')).toBe(false);
  });
});

describe('truthful snapshot and outcome presentation', () => {
  it('uses numerical applicability, not revision/layout/presentation changes', () => {
    const request = { projectId: 'a', modelHash: 'sealed', seed: 4207, valid: true };
    expect(sameNumericalSnapshot(request, { ...request })).toBe(true);
    expect(sameNumericalSnapshot({ ...request, valid: false }, request)).toBe(false);
    for (const changed of [{ ...request, projectId: 'b' }, { ...request, modelHash: 'edited' }, { ...request, seed: 99 }, { ...request, valid: false }]) expect(sameNumericalSnapshot(request, changed)).toBe(false);
  });

  it.each<RunStatus>(['cancelled', 'limited', 'failed'])('cannot describe %s as a completed simulation', status => {
    expect(completedSimulationNotice({ status, name: 'Sealed model', completed: 20, unfinished: 3, earlier: false }, appMessages.calculationCompleted)).toBe('');
  });

  it('describes the sealed model and cohort counts while explicitly qualifying an edited draft', () => {
    const message = completedSimulationNotice({ status: 'completed', name: 'Sealed model', completed: 77, unfinished: 3, earlier: true }, appMessages.calculationCompleted);
    expect(message).toContain('“Sealed model”'); expect(message).toContain('77 completed, 3 unfinished');
    expect(message).toContain('Your draft has changed'); expect(message).not.toContain('current plan');
  });

  it('keeps incomplete/unpaired/unverified experiment outcomes explicit in the bounded aggregate message', () => {
    const m = experimentsPanelMessages;
    const incomplete = m.experimentFinished('Requested snapshot', 12, 2, true, m.unpairedFinished);
    expect(incomplete).toContain('12 model runs recorded'); expect(incomplete).toContain('2 model runs are incomplete');
    expect(incomplete).toContain('not paired'); expect(incomplete).toContain('earlier snapshot');
    expect(m.experimentFinished('Search', 8, 0, false, m.searchNoCandidate)).toContain('No feasible training candidate');
    expect(m.experimentFinished('Search', 10, 0, false, m.searchNotVerified)).toContain('is not verified');
    expect(m.experimentFinished('Search', 10, 0, false, m.searchVerified)).toContain('passed held-out verification');
  });
});
