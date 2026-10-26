export type LabelRect = { x: number; y: number; width: number; height: number };
export function placeLabel(anchor: LabelRect, viewport: { width: number; height: number }, occupied: LabelRect[], bodies: LabelRect[]): LabelRect | null {
  const { width, height } = anchor;
  const minX = 10, maxX = viewport.width - width - 10, minY = 47, maxY = viewport.height - height - (viewport.width < 500 ? 56 : 42);
  if (maxX < minX || maxY < minY) return null;
  const x = Math.max(minX, Math.min(maxX, anchor.x)), y = Math.max(minY, Math.min(maxY, anchor.y));
  const overlaps = (candidate: LabelRect, rectangles: LabelRect[]) => rectangles.some(rect => candidate.x < rect.x + rect.width + 8 && candidate.x + width + 8 > rect.x && candidate.y < rect.y + rect.height + 8 && candidate.y + height + 8 > rect.y);
  const candidates: LabelRect[] = [];
  for (let row = 0; row <= Math.ceil((maxY - minY) / (height + 8)); row++) {
    for (const direction of row ? [-1, 1] : [0]) {
      const cy = Math.max(minY, Math.min(maxY, y + row * (height + 8) * direction));
      for (const col of [0, -1, 1, -2, 2, -3, 3]) candidates.push({ x: Math.max(minX, Math.min(maxX, x + col * (width * .72 + 8))), y: cy, width, height });
    }
  }
  // Stay close to the actual object: a short vertical shift is clearer than
  // placing its caption several columns away on an otherwise free row.
  candidates.sort((a, b) => (a.x - x) ** 2 + (a.y - y) ** 2 - (b.x - x) ** 2 - (b.y - y) ** 2);
  return candidates.find(candidate => !overlaps(candidate, occupied) && !overlaps(candidate, bodies))
    ?? candidates.find(candidate => !overlaps(candidate, occupied)) ?? null;
}
