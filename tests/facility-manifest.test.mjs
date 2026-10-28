import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalogueExclusions } from '../scripts/facility-manifest.mjs';

test('clean regeneration preserves existing public exclusions without private logs', () => {
  const selection = [{ id: 'model-a' }, { id: 'model-b' }];
  const previous = [{ id: 'model-b', reasonCode: 'geometry-limit' }];
  const first = mergeCatalogueExclusions(selection, new Set(['model-a']), previous);
  assert.deepEqual(first, previous);
  assert.deepEqual(mergeCatalogueExclusions(selection, new Set(['model-a']), first), previous);
});
test('available assets remove exclusions and new outcomes override only technical status', () => {
  const selection = [{ id: 'model-a' }, { id: 'model-b' }];
  const prior = [{ id: 'model-a', reasonCode: 'source-unavailable' }, { id: 'model-b', reasonCode: 'unsupported-source' }];
  const outcomes = { 'model-b': { excluded: true, reason: 'Geometry conversion failed: LOCAL_DIAGNOSTIC_DETAIL' } };
  const result = mergeCatalogueExclusions(selection, new Set(['model-a']), prior, outcomes);
  assert.deepEqual(result, [{ id: 'model-b', reasonCode: 'geometry-limit' }]);
  assert(!JSON.stringify(result).includes('LOCAL_DIAGNOSTIC_DETAIL'));
  assert.equal(prior.length, 2);
});
test('unselected IDs and unknown public reason codes cannot enter the distribution', () => {
  assert.deepEqual(mergeCatalogueExclusions([{ id: 'model-a' }], new Set(), [{ id: 'other', reasonCode: 'geometry-limit' }]), []);
  assert.throws(() => mergeCatalogueExclusions([{ id: 'model-a' }], new Set(), [{ id: 'model-a', reasonCode: 'raw-diagnostic' }]));
});
