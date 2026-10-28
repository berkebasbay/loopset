import type { Project, ScenarioSnapshot, World } from './types';
import { createNewProject } from './newProject';
import { mutateProject } from './commands';
import { validateProject } from './validate';
import { templateMessages as m } from '../ui/messages/templates';

export function isLayoutOnly(project: Pick<Project | ScenarioSnapshot, 'workspaceMode' | 'model'>): boolean {
  return project.workspaceMode === 'layout' && project.model.nodes.length === 0;
}
export function createBlankProject(world: World = 'factory'): Project {
  const project = createNewProject(world);
  project.name = m.blankName; project.description = m.blankProjectDescription;
  project.model.name = m.blankModel; project.model.nodes = []; project.model.resources = [];
  project.layout = {}; project.workspaceMode = 'layout';
  project.facility = { version: 1, objects: [], nodeAssets: {}, scenery: false };
  return project;
}
export function startWorkspaceProcess(project: Project): Project {
  if (!isLayoutOnly(project)) throw new Error(m.cannotStart);
  const starter = createNewProject(project.world);
  const next = mutateProject(project, copy => {
    copy.model.nodes = starter.model.nodes;
    for (const node of copy.model.nodes) if (node.kind === 'service') node.resources = [];
    copy.layout = starter.layout;
    delete copy.workspaceMode;
  });
  const issue = validateProject(next).find(issue => issue.severity === 'error');
  if (issue) throw new Error(issue.message);
  return next;
}
