import { expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { connectNext } from '../src/features/modelEdits';
import { modelLinks } from '../src/scene/graph';

it('rewires the actual model immutably and exposes that edge to the scene', () => {
  const before = createExample('factory');
  const next = connectNext(before, 'station-b', 'exit');
  expect(modelLinks(next.model.nodes)).toContainEqual({ from: 'station-b', to: 'exit' });
  expect(modelLinks(before.model.nodes)).toContainEqual({ from: 'station-b', to: 'queue-c' });
  expect(next.revision).toBe(before.revision + 1);
});
it('rejects missing destinations and unsupported/invalid connections without changing the draft', () => {
  const before = createExample('factory'); const exact = JSON.stringify(before);
  expect(() => connectNext(before, 'station-b', 'missing')).toThrow('no longer exists');
  expect(() => connectNext(before, 'exit', 'station-a')).toThrow('weighted routes');
  expect(() => connectNext(before, 'queue-a', 'queue-a')).toThrow();
  expect(JSON.stringify(before)).toBe(exact);
});
