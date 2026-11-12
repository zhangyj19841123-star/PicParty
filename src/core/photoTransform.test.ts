import { describe, expect, it } from 'vitest';
import type { CoverResult, Rect } from './types';
import { focusAfterDrag } from './photoTransform';

const frame: Rect = { x: 20, y: 30, width: 100, height: 50 };
const cover = (rotation = 0, centerX = 70, centerY = 55): CoverResult => ({
  scale: 1, x: centerX - 500, y: centerY - 250, width: 1000, height: 500,
  centerX, centerY, rotation, crop: { x: 0, y: 0, width: 100, height: 50 },
});

describe('direct photo drag geometry', () => {
  it('moves the rendered image with the pointer in unrotated source coordinates', () => {
    expect(focusAfterDrag(frame, 1000, 500, cover(), 100, -50)).toEqual({ focusX: 0.4, focusY: 0.6 });
  });

  it('inverse-rotates pointer movement for a 90 degree photo', () => {
    const focus = focusAfterDrag(frame, 1000, 500, cover(90), 20, 100);
    expect(focus.focusX).toBeCloseTo(0.4);
    expect(focus.focusY).toBeCloseTo(0.54);
  });

  it('inverse-rotates arbitrary angles without changing normalized focus units', () => {
    const focus = focusAfterDrag(frame, 1000, 500, cover(45), 100, 100);
    expect(focus.focusX).toBeCloseTo(0.5 - Math.SQRT2 / 10);
    expect(focus.focusY).toBeCloseTo(0.5);
  });

  it('begins from the visible clamped composition and prevents edge jumps', () => {
    const edgeFrame = { x: 0, y: 0, width: 100, height: 100 };
    const edgeCover: CoverResult = {
      ...cover(), scale: 0.2, x: 0, y: 0, width: 200, height: 100,
      centerX: 100, centerY: 50,
    };
    expect(focusAfterDrag(edgeFrame, 1000, 500, edgeCover, 0, 0)).toEqual({ focusX: 0.25, focusY: 0.5 });
    expect(focusAfterDrag(edgeFrame, 1000, 500, edgeCover, -10, 0).focusX).toBeCloseTo(0.3);
    expect(focusAfterDrag(edgeFrame, 1000, 500, edgeCover, 1000, -1000)).toEqual({ focusX: 0, focusY: 1 });
  });

  it('rejects invalid geometry rather than propagating non-finite focus', () => {
    expect(() => focusAfterDrag(frame, 0, 500, cover(), 0, 0)).toThrow();
    expect(() => focusAfterDrag(frame, 1000, 500, { ...cover(), scale: NaN }, 0, 0)).toThrow();
    expect(() => focusAfterDrag(frame, 1000, 500, cover(), Infinity, 0)).toThrow();
  });
});
