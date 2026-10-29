import { starterCopy, starterMessages } from '../ui/messages/starterTemplates';
import type { World } from '../model/types';
export type StarterId = keyof typeof starterCopy;
export type StarterCategory = keyof typeof starterMessages.categories;
export interface StarterTemplate {
  id: StarterId; category: StarterCategory; world: World; minutes: number;
  copy: typeof starterCopy[StarterId];
}
const definitions: [StarterId, StarterCategory, World, number][] = [
  ['service', 'service', 'service', 60], ['festival', 'events', 'festival', 60],
  ['factory', 'production', 'factory', 60], ['workshop', 'production', 'factory', 120],
  ['machining', 'production', 'factory', 120], ['quality', 'production', 'factory', 120],
  ['print', 'production', 'factory', 480], ['packing', 'logistics', 'factory', 120],
  ['fulfillment', 'logistics', 'factory', 120], ['returns', 'logistics', 'factory', 120],
  ['parcel', 'logistics', 'factory', 120], ['repair', 'service', 'factory', 120],
];
export const starterTemplates: readonly StarterTemplate[] = definitions.map(([id, category, world, minutes]) => ({ id, category, world, minutes, copy: starterCopy[id] }));
export const findStarter = (id: string) => starterTemplates.find(item => item.id === id);
