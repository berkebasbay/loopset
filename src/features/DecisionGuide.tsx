import type { Project, RunResult } from '../model/types';
import { bottleneckCandidate } from '../model/modelDiff';
import { facilityMessages as m } from '../ui/messages/facility';

/** Suggestions refer to a recorded snapshot; they never apply model edits. */
export function DecisionGuide({ project, result, onInspect }: { project: Project; result: RunResult | null; onInspect: (id: string) => void }) {
  if (!result) return null;
  const constrained = result.model.nodes.find(node => node.kind === 'service' && node.resources.some(requirement => {
    const pool = result.model.resources.find(pool => pool.id === requirement.poolId);
    return pool && pool.capacity < requirement.units * node.servers;
  }));
  const observed = bottleneckCandidate(result);
  const target = constrained ?? result.model.nodes.find(node => node.id === observed?.nodeId);
  return <section className="decision-guide" aria-label={m.nextTest}><h3>{m.nextTest}</h3><p>{constrained ? m.teamCheck : observed ? m.queueCheck : m.evidenceScope}</p>{target && project.model.nodes.some(node => node.id === target.id) && <button type="button" className="secondary-button" onClick={() => onInspect(target.id)}>{m.reviewNode(target.label)}</button>}<small>{m.repeatScope}</small></section>;
}
