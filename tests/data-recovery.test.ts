import { describe, expect, it } from 'vitest';
import { createExample } from '../src/examples';
import { recoveryProjectKey, serializeDraftRecovery } from '../src/features/DataTools';
import { openProjectJSON } from '../src/storage/projectFile';

describe('unvalidated draft repair artifacts', () => {
  it('preserves invalid numeric values explicitly without posing as a project file', () => {
    const project = createExample('factory'); project.model.horizon = NaN; project.model.warmup = Infinity; project.model.slaSeconds = -Infinity;
    const text = serializeDraftRecovery(project); const backup = JSON.parse(text);
    expect(backup.format).toBe('queuelab-unvalidated-draft');
    expect(backup.project.model.horizon).toEqual({ queuelabNonFinite: 'NaN' });
    expect(backup.project.model.warmup).toEqual({ queuelabNonFinite: 'Infinity' });
    expect(backup.project.model.slaSeconds).toEqual({ queuelabNonFinite: '-Infinity' });
    expect(backup.instructions).toContain('not a portable QueueLab project');
    expect(() => openProjectJSON(text)).toThrow();
    expect(Number.isNaN(project.model.horizon)).toBe(true);
  });
  it('does not confuse different invalid values or revisions when acknowledging a snapshot', () => {
    const a = createExample('factory'); a.model.horizon = NaN;
    const b = structuredClone(a); b.model.horizon = Infinity;
    const c = structuredClone(a); c.revision++;
    expect(recoveryProjectKey(a)).not.toBe(recoveryProjectKey(b));
    expect(recoveryProjectKey(a)).not.toBe(recoveryProjectKey(c));
    const saved = structuredClone(a); saved.savedAt = new Date().toISOString();
    expect(recoveryProjectKey(a)).toBe(recoveryProjectKey(saved));
  });
  it('retains disconnected graph and empty text for manual or in-tab repair', () => {
    const project = createExample('factory'); project.name = ''; const node = project.model.nodes[0]; if ('next' in node) node.next = '';
    const backup = JSON.parse(serializeDraftRecovery(project));
    expect(backup.project.name).toBe(''); expect(backup.project.model.nodes[0].next).toBe('');
    expect(() => openProjectJSON(JSON.stringify(backup.project))).toThrow();
  });
  it('bounds raw repair downloads rather than truncating data', () => {
    const project = createExample('factory'); project.description = 'x'.repeat(5_000_001);
    expect(() => serializeDraftRecovery(project)).toThrow('5 MB');
  });
});
