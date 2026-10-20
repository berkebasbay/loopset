import { describe, expect, it } from 'vitest';
import { placeLabel } from '../src/scene/WorldScene';

describe('scene label pointer regions', () => {
  it('keeps the three mobile Service buttons separate even when scenic bodies fill the preferred area', () => {
    const occupied: { x: number; y: number; width: number; height: number }[] = [];
    const viewport = { width: 348, height: 360 };
    const body = [{ x: 0, y: 80, width: 348, height: 200 }];
    for (const anchor of [
      { x: 126.48, y: 99.05, width: 144.92, height: 32 },
      { x: 80.02, y: 123.22, width: 137.67, height: 32 },
      { x: 101, y: 151.13, width: 145.84, height: 32 },
    ]) {
      const placed = placeLabel(anchor, viewport, occupied, body);
      expect(placed).not.toBeNull();
      if (!placed) throw new Error('A label that fits the mobile viewport was hidden.');
      expect(placed.x).toBeGreaterThanOrEqual(10);
      expect(placed.x + placed.width).toBeLessThanOrEqual(viewport.width - 10);
      expect(placed.y).toBeGreaterThanOrEqual(47);
      expect(placed.y + placed.height).toBeLessThanOrEqual(viewport.height - 56);
      for (const previous of occupied) {
        const intersectWidth = Math.min(placed.x + placed.width, previous.x + previous.width) - Math.max(placed.x, previous.x);
        const intersectHeight = Math.min(placed.y + placed.height, previous.y + previous.height) - Math.max(placed.y, previous.y);
        expect(intersectWidth <= -8 || intersectHeight <= -8).toBe(true);
      }
      occupied.push(placed);
    }
  });

  it('keeps room for the scene status line and mobile aggregation caption after viewport clamping', () => {
    for (const anchor of [{ x: -300, y: -100 }, { x: 900, y: 900 }]) {
      const placed = placeLabel({ ...anchor, width: 145, height: 32 }, { width: 348, height: 360 }, [], []);
      expect(placed).not.toBeNull();
      expect(placed!.x).toBeGreaterThanOrEqual(10);
      expect(placed!.x + placed!.width).toBeLessThanOrEqual(338);
      expect(placed!.y).toBeGreaterThanOrEqual(47);
      expect(placed!.y + placed!.height).toBeLessThanOrEqual(304);
    }
  });

  it('does not manufacture a clickable region when the viewport has no safe room', () => {
    expect(placeLabel({ x: 10, y: 50, width: 145, height: 32 }, { width: 160, height: 100 }, [], [])).toBeNull();
    expect(placeLabel({ x: 10, y: 50, width: 145, height: 32 }, { width: 348, height: 360 }, [{ x: 0, y: 0, width: 348, height: 360 }], [])).toBeNull();
  });
});
