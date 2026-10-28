import data from '../../examples/facility.json';
import type { Project } from '../model/types';
import { validateProject } from '../model/validate';
import { knownAssetReference } from '../catalog/registry';
import { facilityMessages as m } from '../ui/messages/facility';

/** The initial facility uses the enhanced Factory starter while preserving its numerical process. */
export function createWorkshopFacility(): Project {
  const project = structuredClone(data) as unknown as Project;
  if (validateProject(project).some(issue => issue.severity === 'error') || project.facility?.objects.some(object => !knownAssetReference(object.assetId, object.assetVersion))) throw new Error(m.exampleUnavailable);
  project.id = `facility-${crypto.randomUUID().slice(0, 8)}`;
  return project;
}
