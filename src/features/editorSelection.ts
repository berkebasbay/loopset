/** Ordered, bounded by the document's nodes. The primary alone drives the inspector. */
export interface EditorSelection { ids: string[]; primary: string | null }
export type SelectionIntent = 'single' | 'toggle' | 'inspect';
export const emptySelection = (): EditorSelection => ({ ids: [], primary: null });

export function pruneSelection(selection: EditorSelection, nodes: readonly { id: string }[]): EditorSelection {
  const allowed = new Set(nodes.map(node => node.id));
  const ids = [...new Set(selection.ids)].filter(id => allowed.has(id));
  const primary = selection.primary && ids.includes(selection.primary) ? selection.primary : ids.at(-1) ?? null;
  return ids.length === selection.ids.length && ids.every((id, i) => id === selection.ids[i]) && primary === selection.primary
    ? selection : { ids, primary };
}

export function selectStep(selection: EditorSelection, id: string | null, intent: SelectionIntent = 'single'): EditorSelection {
  if (id === null) return emptySelection();
  if (intent === 'inspect' && selection.ids.includes(id)) return { ids: selection.ids, primary: id };
  if (intent !== 'toggle') return { ids: [id], primary: id };
  if (!selection.ids.includes(id)) return { ids: [...selection.ids, id], primary: id };
  const ids = selection.ids.filter(item => item !== id);
  return { ids, primary: selection.primary === id ? ids.at(-1) ?? null : selection.primary };
}

/** Identity edits replace just this member; deleting/undoing still prunes against actual nodes. */
export function remapSelection(selection: EditorSelection, from: string, to: string): EditorSelection {
  return { ids: [...new Set(selection.ids.map(id => id === from ? to : id))], primary: selection.primary === from ? to : selection.primary };
}

export function reconcileSelection(selection: EditorSelection, before: readonly { id: string; samplingId: string }[], after: readonly { id: string; samplingId: string }[]): EditorSelection {
  let next = selection;
  for (const id of selection.ids) if (!after.some(node => node.id === id)) {
    const previous = before.find(node => node.id === id);
    const renamed = previous && after.find(node => node.samplingId === previous.samplingId);
    if (renamed) next = remapSelection(next, id, renamed.id);
  }
  return pruneSelection(next, after);
}
