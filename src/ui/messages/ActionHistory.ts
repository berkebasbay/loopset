/** English product messages for ActionHistory. Keep model data and canonical identifiers at the call site. */
export const actionHistoryMessages = {
  projectActionHistory: "Project action history",
  editsBelongToThisOpenProjectUndoAndRedo: "Edits belong to this open project. Undo and Redo keep revision numbers increasing. Camera, selection and replay stay outside history.",
  recentProjectActionsScrollToInspect: "Recent project actions, scroll to inspect",
  latestEdit: "Latest edit",
  applied: "Applied",
  nextRedo: "Next redo",
  undone: "Undone",
  noRetainedEditsInThisProject: "No retained edits in this project.",
  budgetSummary: (revision: number, retainedActions: number, actionLimit: number, estimatedMiB: string, byteLimitMiB: number) => `Revision ${revision} · ${retainedActions}/${actionLimit} actions · ${estimatedMiB}/${byteLimitMiB} MiB serialized payload estimate.`,
  oldestHistoryEntriesExpireAtTheseLimitsProjectData: "Oldest history entries expire at these limits; project data and recovery copies stay available. Layout edits retain point changes. Document snapshots count once by object identity; shared nested data may be counted again. This estimate is not a JavaScript heap limit.",
  historyEstimateUnavailable: "Some draft payloads could not be estimated. The 50-action limit still applies; those drafts remain in memory for Undo.",
  expiredEntries: (count: number) => `${count} older history ${count === 1 ? 'entry has' : 'entries have'} expired to keep history within its limits. The open project was kept.`,
  actionButton: (action: 'undo' | 'redo', label?: string) => `${action === 'undo' ? 'Undo' : 'Redo'}${label !== undefined ? `: ${label}` : ''}`,
  actionName: (action: 'undo' | 'redo', label?: string) => `${action === 'undo' ? 'Undo' : 'Redo'}${label !== undefined ? ` ${label}` : ''}`,
} as const;
