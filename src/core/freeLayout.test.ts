import { describe, expect, it } from 'vitest';
import { normalizedFrameRect, normalizeLayoutFrames } from './freeLayout';

describe('normalized free frame geometry', () => {
  it('captures complete-page fractions and adapts without a source document size', () => {
    const frames = normalizeLayoutFrames([{ slotId: 'a', rect: { x: 400, y: 600, width: 2000, height: 1800 } }], { width: 4000, height: 6000, colorSpace: 'srgb' });
    expect(frames).toEqual([{ slotId: 'a', rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.3 } }]);
    expect(frames[0].rect.width * 2000).toBe(1000);
  });

  it('accepts overlapping frames and removes outer-edge round-off', () => {
    const rect = { x: 0.2, y: 0.1, width: 0.8 + 5e-10, height: 0.9 };
    expect(normalizedFrameRect(rect)).toEqual({ x: 0.2, y: 0.1, width: 0.8, height: 0.9 });
    expect(rect.width).toBeGreaterThan(0.8);
  });

  it('rejects nonfinite, nonpositive or out-of-page rectangles', () => {
    const valid = { x: 0, y: 0, width: 0.5, height: 0.5 };
    for (const patch of [{ x: NaN }, { y: Infinity }, { x: -0.1 }, { width: 0 }, { height: -1 }, { width: 1.1 }, { y: 0.8 }, { x: 1.0000000001, width: 1e-10 }]) {
      expect(() => normalizedFrameRect({ ...valid, ...patch })).toThrow();
    }
    expect(() => normalizeLayoutFrames([], { width: 0, height: 6000, colorSpace: 'srgb' })).toThrow();
  });
});
