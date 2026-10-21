/** English product messages for SelectionMoveControls. Keep model data and canonical identifiers at the call site. */
export const selectionMoveControlsMessages = {
  visualMoveHelp: "Relative positions stay together. Visual distance does not change modeled timing.",
  moveAmountVisualUnits: "Move amount (visual units)",
  moveSelected: (name: string) => `Move selected ${name}`,
  invalidMoveAmount: "Enter a move amount greater than 0 and no more than 200.",
  directions: { left: 'left', right: 'right', back: 'back', forward: 'forward' },
  moveLegend: (count: number) => `Move ${count > 1 ? `${count} selected steps` : 'selected step'} visually`,
} as const;
