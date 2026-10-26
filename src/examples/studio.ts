import { createExample } from './index';
import type { World } from '../model/types';

/** Spacious presentation for new studio examples. Existing saved layouts stay untouched. */
export function createStudioExample(world: World) {
  const project = createExample(world);
  project.layout = {
    arrivals: { x: -9.5, z: 1.5 }, 'queue-a': { x: -5.5, z: 1.5 }, 'station-a': { x: -5.5, z: -2.8 },
    'queue-b': { x: 0, z: 1.5 }, 'station-b': { x: 0, z: -2.8 },
    'queue-c': { x: 5.5, z: 1.5 }, 'station-c': { x: 5.5, z: -2.8 }, exit: { x: 9.5, z: -2.8 },
  };
  return project;
}
