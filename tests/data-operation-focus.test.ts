import { describe, expect, it } from 'vitest';
import { captureDataOperationFocus } from '../src/features/DataTools';

// Finite DOM-contract checks, not a React mount or browser keyboard simulation.
// The live browser regression must additionally exercise native disabled focus
// loss and the post-render effect after each asynchronous operation settles.
function focusFixture() {
  const doc = Object.assign(new EventTarget(), { activeElement: null as Element | null, defaultView: new EventTarget() });
  class Element {
    isConnected = true;
    disabled = false;
    hidden = false;
    children = new Set<Element>();
    ownerDocument = doc as unknown as Document;
    focusCalls = 0;
    contains(node: unknown): boolean { return node === this || this.children.has(node as Element); }
    matches(selector: string) { return selector === ':disabled' && this.disabled; }
    closest() { return this.hidden ? this : null; }
    focus() { this.focusCalls++; doc.activeElement = this; emit('focusin', this); }
  }
  const body = new Element(); const documentElement = new Element();
  Object.assign(doc, { body, documentElement });
  const root = new Element(); const action = new Element(); const fallback = new Element(); const other = new Element();
  root.children.add(action); root.children.add(fallback); root.children.add(other);
  doc.activeElement = action;
  function emit(type: string, target: Element) {
    const event = new Event(type); Object.defineProperty(event, 'target', { value: target }); doc.dispatchEvent(event);
  }
  return { doc, root: root as unknown as HTMLElement, action, fallback, other, body, emit,
    disabledFocusLoss() { action.disabled = true; doc.activeElement = body; emit('focusin', body); action.disabled = false; },
  };
}

describe('data operation focus completion contract', () => {
  it('restores the connected action after native disabling leaves body focused', () => {
    const f = focusFixture(); const capture = captureDataOperationFocus(f.root, 'project');
    f.disabledFocusLoss(); capture?.complete('project');
    expect(f.doc.activeElement).toBe(f.action); expect(f.action.focusCalls).toBe(1);
    capture?.complete('project'); expect(f.action.focusCalls).toBe(1);
  });

  it('does not reclaim focus after the user moves elsewhere, even if it later returns to body', () => {
    const f = focusFixture(); const capture = captureDataOperationFocus(f.root, 'project');
    f.disabledFocusLoss(); f.other.focus(); f.doc.activeElement = f.body;
    capture?.complete('project'); expect(f.doc.activeElement).toBe(f.body); expect(f.action.focusCalls).toBe(0);
  });

  it('does not override an independently changed active element', () => {
    const f = focusFixture(); const capture = captureDataOperationFocus(f.root, 'project');
    f.disabledFocusLoss(); f.doc.activeElement = f.other;
    capture?.complete('project'); expect(f.doc.activeElement).toBe(f.other);
  });

  it('respects a pointer interaction or window blur while work is pending', () => {
    for (const interaction of ['pointer', 'blur']) {
      const f = focusFixture(); const capture = captureDataOperationFocus(f.root, 'project');
      f.disabledFocusLoss();
      if (interaction === 'pointer') f.emit('pointerdown', f.body);
      else f.doc.defaultView.dispatchEvent(new Event('blur'));
      capture?.complete('project'); expect(f.doc.activeElement).toBe(f.body);
    }
  });

  it('leaves unmounted components and cancelled focus work alone', () => {
    for (const teardown of ['unmount', 'cancel']) {
      const f = focusFixture(); const capture = captureDataOperationFocus(f.root, 'project');
      f.disabledFocusLoss();
      if (teardown === 'unmount') (f.root as unknown as { isConnected: boolean }).isConnected = false;
      else capture?.cancel();
      capture?.complete('project'); expect(f.action.focusCalls).toBe(0);
    }
  });

  it('uses the connected logical fallback when the completed action was removed', () => {
    const f = focusFixture(); const capture = captureDataOperationFocus(f.root, 'project', {
      fallback: () => f.fallback as unknown as HTMLElement,
    });
    f.disabledFocusLoss(); f.action.isConnected = false;
    capture?.complete('project'); expect(f.doc.activeElement).toBe(f.fallback);
  });

  it('rejects an unexpected document change but permits the operation’s explicit replacement', () => {
    for (const expected of [false, true]) {
      const f = focusFixture(); const capture = captureDataOperationFocus(f.root, 'old', {
        fallback: () => f.fallback as unknown as HTMLElement, allowProjectChange: expected,
      });
      f.disabledFocusLoss(); f.action.isConnected = false;
      capture?.complete('new'); expect(f.doc.activeElement).toBe(expected ? f.fallback : f.body);
    }
  });

  it('does not focus disabled or hidden completion targets', () => {
    for (const state of ['disabled', 'hidden'] as const) {
      const f = focusFixture(); const capture = captureDataOperationFocus(f.root, 'project');
      f.disabledFocusLoss(); f.action[state] = true;
      capture?.complete('project'); expect(f.action.focusCalls).toBe(0);
    }
  });

  it('does not capture operations started without focus inside this component', () => {
    const f = focusFixture(); f.doc.activeElement = f.body;
    expect(captureDataOperationFocus(f.root, 'project')).toBeNull();
    expect(captureDataOperationFocus(null, 'project')).toBeNull();
  });
});
