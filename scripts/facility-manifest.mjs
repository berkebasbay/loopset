export const catalogueReasonCodes = Object.freeze(['licence', 'distribution-limit', 'preview-unavailable', 'source-unavailable', 'source-limit', 'geometry-limit', 'unsupported-source']);

export function catalogueReason(reason) {
  return /licen[cs]e/i.test(reason) ? 'licence'
    : /distribution budget/i.test(reason) ? 'distribution-limit'
    : /thumbnail/i.test(reason) ? 'preview-unavailable'
    : /timeout|fetch failed|aborted|terminated|returned [45][0-9]{2}/i.test(reason) ? 'source-unavailable'
    : /byte budget|dependency count|page budget/i.test(reason) ? 'source-limit'
    : /geometry|model exceeds|2 MiB/i.test(reason) ? 'geometry-limit'
    : 'unsupported-source';
}

/** Preserve clean-clone status; local diagnostics never enter public output. */
export function mergeCatalogueExclusions(selection, availableIds, previous = [], outcomes = {}) {
  const prior = new Map(previous.map(item => [item.id, item.reasonCode]));
  return selection.flatMap(item => {
    if (availableIds.has(item.id)) return [];
    const local = outcomes[item.id];
    const code = local?.excluded ? catalogueReason(String(local.reason)) : prior.get(item.id);
    if (!code) return [];
    if (!catalogueReasonCodes.includes(code)) throw new Error('Invalid public catalogue reason code.');
    return [{ id: item.id, reasonCode: code }];
  });
}
