import type { Project, RunResult } from '../model/types';
import { canonical, modelHash } from '../model/identity';

export const LEARNING_STEP_ID = 'station-b';
export const LEARNING_POOL_ID = 'specialists';
export const LEARNING_PREFERENCES_KEY = 'loopset-learning-v1';
export const LEARNING_SESSION_KEY = 'loopset-practice-v1';
export interface LearningSession {
  version: 1; projectId: string; returnProjectId: string | null;
  baseHash: string; changedHash: string; seed: number;
  selected: boolean; ran: boolean; reviewed: boolean;
  finished?: boolean; savedName?: string;
}
export type LearningStage = 'preparing' | 'select' | 'edit' | 'run' | 'review' | 'save' | 'complete' | 'off-track' | 'baseline';
export const learningStages = ['select', 'edit', 'run', 'review', 'save'] as const;

export function createLearningSession(project: Project, returnProjectId: string | null): LearningSession | null {
  const step = project.model.nodes.find(node => node.id === LEARNING_STEP_ID);
  const pool = project.model.resources.find(item => item.id === LEARNING_POOL_ID);
  if (project.world !== 'service' || step?.kind !== 'service' || !step.resources.some(item => item.poolId === LEARNING_POOL_ID) || pool?.capacity !== 2 || pool.installedCapacity < 3) return null;
  const changed = structuredClone(project.model);
  changed.resources.find(item => item.id === LEARNING_POOL_ID)!.capacity = 3;
  return { version: 1, projectId: project.id, returnProjectId, baseHash: modelHash(project.model), changedHash: modelHash(changed), seed: project.model.seed, selected: false, ran: false, reviewed: false };
}

export function learningModelMatches(project: Project, session: LearningSession): boolean {
  return project.id === session.projectId && project.model.seed === session.seed && [session.baseHash, session.changedHash].includes(modelHash(project.model));
}
export function originalLearningProject(project: Project, session: LearningSession): Project | null {
  if (!learningModelMatches(project, session)) return null;
  const original = structuredClone(project);
  const pool = original.model.resources.find(item => item.id === LEARNING_POOL_ID);
  if (!pool) return null;
  pool.capacity = 2;
  return modelHash(original.model) === session.baseHash ? original : null;
}
export function learningRunMatches(run: RunResult | null, hash: string, seed: number): boolean {
  return Boolean(run?.status === 'completed' && run.modelHash === hash && run.seed === seed && modelHash(run.model) === hash);
}
export function learningStage(input: {
  session: LearningSession; project: Project; baseline: RunResult | null; result: RunResult | null;
  pending: boolean; running: boolean; valid: boolean; comparable: boolean;
}): LearningStage {
  const { session, project, baseline, result, pending, running, valid, comparable } = input;
  if (session.finished) return 'complete';
  if (!valid || !learningModelMatches(project, session)) return 'off-track';
  if (!learningRunMatches(baseline, session.baseHash, session.seed)) return running ? 'preparing' : 'baseline';
  if (!session.selected) return 'select';
  if (modelHash(project.model) !== session.changedHash || pending) return 'edit';
  if (!session.ran || !learningRunMatches(result, session.changedHash, session.seed) || !comparable) return 'run';
  return session.reviewed ? 'save' : 'review';
}

export function parseLearningSession(text: string | null): LearningSession | null {
  if (!text || text.length > 2048) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const r = v as Record<string, unknown>;
    const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 160 && !x.includes('\0');
    const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{8,64}$/.test(x);
    if (r.version !== 1 || !id(r.projectId) || !(r.returnProjectId === null || id(r.returnProjectId)) || !hash(r.baseHash) || !hash(r.changedHash) || r.baseHash === r.changedHash || typeof r.seed !== 'number' || !Number.isSafeInteger(r.seed) || typeof r.selected !== 'boolean' || typeof r.ran !== 'boolean' || typeof r.reviewed !== 'boolean') return null;
    return { version: 1, projectId: r.projectId, returnProjectId: r.returnProjectId, baseHash: r.baseHash, changedHash: r.changedHash, seed: r.seed, selected: r.selected, ran: r.ran, reviewed: r.reviewed };
  } catch { return null; }
}
export function readLearningSession(): LearningSession | null {
  try { return parseLearningSession(sessionStorage.getItem(LEARNING_SESSION_KEY)); } catch { return null; }
}
export function rememberLearningSession(session: LearningSession | null): void {
  try {
    if (!session || session.finished) { sessionStorage.removeItem(LEARNING_SESSION_KEY); return; }
    const { version, projectId, returnProjectId, baseHash, changedHash, seed, selected, ran, reviewed } = session;
    sessionStorage.setItem(LEARNING_SESSION_KEY, JSON.stringify({ version, projectId, returnProjectId, baseHash, changedHash, seed, selected, ran, reviewed }));
  } catch { /* The lesson still works in memory; project saves report their own failures. */ }
}
export function hasSeenLearningWelcome(): boolean {
  try { return localStorage.getItem(LEARNING_PREFERENCES_KEY) === 'seen'; } catch { return false; }
}
export function rememberLearningWelcome(): void {
  try { localStorage.setItem(LEARNING_PREFERENCES_KEY, 'seen'); } catch { /* Optional preference, not a project save. */ }
}

/** Storage canonicalizes object keys and supplies a new save timestamp. */
export function learningReturnMatches(previous: Project, saved: Project): boolean {
  return canonical({ ...previous, savedAt: undefined }) === canonical({ ...saved, savedAt: undefined });
}
