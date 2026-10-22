import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExample } from '../src/examples';
import { simulate } from '../src/engine';
import { printResult } from '../src/storage/report';

const result = simulate(createExample('festival').model);

function printWindow(readyState = 'complete') {
  let ready!: () => void;
  const fontsReady = new Promise<void>(resolve => { ready = resolve; });
  const document = { open: vi.fn(), write: vi.fn(), close: vi.fn(), readyState, fonts: { ready: fontsReady } };
  const tasks: (() => void)[] = [];
  let load!: () => void;
  const popup = {
    document, closed: false, opener: {}, focus: vi.fn(), print: vi.fn(),
    setTimeout: vi.fn((callback: () => void) => { tasks.push(callback); return tasks.length; }),
    addEventListener: vi.fn((_: string, callback: () => void) => { load = callback; }),
  };
  const open = vi.fn(() => popup);
  vi.stubGlobal('window', { open });
  return { popup, document, open, ready, tasks, load: () => load() };
}

describe('report print lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waits for font/layout readiness and a later task, even after synchronous load', async () => {
    const state = printWindow();
    printResult(result);
    expect(state.popup.opener).toBeNull();
    expect(state.document.write).toHaveBeenCalledWith(expect.stringContaining(result.modelHash));
    expect(state.popup.print).not.toHaveBeenCalled();
    expect(state.tasks).toHaveLength(0);
    state.load(); state.load();
    state.ready(); await Promise.resolve();
    expect(state.tasks).toHaveLength(1);
    expect(state.popup.print).not.toHaveBeenCalled();
    state.tasks[0]();
    expect(state.popup.print).toHaveBeenCalledTimes(1);
  });

  it('also waits when the document completes asynchronously', async () => {
    const state = printWindow('loading');
    printResult(result);
    state.ready(); await Promise.resolve();
    expect(state.tasks).toHaveLength(0);
    state.load(); await Promise.resolve();
    expect(state.tasks).toHaveLength(1);
    state.tasks[0]();
    expect(state.popup.print).toHaveBeenCalledTimes(1);
  });

  it('does not print when the owner closes the tab before readiness', async () => {
    const state = printWindow();
    printResult(result);
    state.popup.closed = true;
    state.ready(); await Promise.resolve();
    expect(state.tasks).toHaveLength(0);
    expect(state.popup.print).not.toHaveBeenCalled();
  });

  it('does not print a replacement document after the task was scheduled', async () => {
    const state = printWindow();
    printResult(result);
    state.ready(); await Promise.resolve();
    state.popup.document = { ...state.document };
    state.tasks[0]();
    expect(state.popup.print).not.toHaveBeenCalled();
  });

  it('does not access or print a cross-origin replacement', async () => {
    const state = printWindow();
    printResult(result);
    Object.defineProperty(state.popup, 'document', { get() { throw new Error('cross-origin'); } });
    state.ready(); await Promise.resolve();
    expect(state.tasks).toHaveLength(0);
    expect(state.popup.print).not.toHaveBeenCalled();
  });

  it('reports a blocked popup synchronously', () => {
    vi.stubGlobal('window', { open: () => null });
    expect(() => printResult(result)).toThrow(/window|popup/i);
  });
});
