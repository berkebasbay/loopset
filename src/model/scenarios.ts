import { mutateProject } from './commands';
import type { Project, ScenarioSnapshot } from './types';
import { validateProject } from './validate';

export type PresentationSnapshot = Pick<Project, 'world' | 'layout' | 'facility'>;
export function capturePresentation(project: PresentationSnapshot): PresentationSnapshot {
  return structuredClone({ world: project.world, layout: project.layout, ...(project.facility ? { facility: project.facility } : {}) });
}
export function saveScenario(project: Project, name: string, model = project.model, presentation: PresentationSnapshot = project): Project {
  if (!name.trim() || name.trim().length > 80) throw new Error('Give the scenario a name of 1–80 characters.');
  if ((project.scenarios?.length ?? 0) >= 20) throw new Error('Keep up to 20 saved scenarios per project. Download a separate project for more.');
  const nodeIds = new Set(model.nodes.map(node => node.id));
  const visual = capturePresentation(presentation);
  visual.layout = Object.fromEntries(Object.entries(visual.layout).filter(([id]) => nodeIds.has(id)));
  if (visual.facility) visual.facility.nodeAssets = Object.fromEntries(Object.entries(visual.facility.nodeAssets).filter(([id]) => nodeIds.has(id)));
  const errors = validateProject({ ...project, ...visual, facility: visual.facility, model }).filter(i => i.severity === 'error');
  if (errors.length) throw new Error(`Repair the model before saving a scenario: ${errors[0].message}`);
  const snapshot: ScenarioSnapshot = { id: `scenario-${crypto.randomUUID().slice(0, 8)}`, name: name.trim(), createdAt: new Date().toISOString(), ...visual, model: structuredClone(model) };
  const next = mutateProject(project, p => { p.scenarios = [...(p.scenarios ?? []), snapshot]; });
  if (new TextEncoder().encode(JSON.stringify(next, null, 2)).length > 4_999_000) throw new Error('This scenario would exceed the portable project size. Download a separate project or reduce imported samples.');
  return next;
}

export function restoreScenario(project: Project, id: string): Project {
  const scenario = project.scenarios?.find(s => s.id === id);
  if (!scenario) throw new Error('This saved scenario no longer exists.');
  return mutateProject(project, p => { p.model = structuredClone(scenario.model); p.layout = structuredClone(scenario.layout); p.world = scenario.world; if (scenario.facility) p.facility = structuredClone(scenario.facility); else delete p.facility; });
}

export function removeScenario(project: Project, id: string): Project {
  return mutateProject(project, p => { p.scenarios = p.scenarios?.filter(s => s.id !== id); });
}
