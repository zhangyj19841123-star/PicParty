import { describe, expect, it } from 'vitest';
import { dragFrameRect, frameMovementHint } from './frameGeometry';
const rect = { x: .2, y: .3, width: .4, height: .25 };
describe('free frame pointer geometry', () => {
  it('moves a rectangle without changing its size and confines it to the page', () => {
    expect(dragFrameRect(rect, 10, -10, null)).toEqual({ ...rect, x: .6, y: 0 });
  });
  it('resizes width and height independently while anchoring the opposite corner', () => {
    const next = dragFrameRect(rect, -.1, -.2, 'nw');
    expect(next.x).toBeCloseTo(.1); expect(next.y).toBeCloseTo(.1);
    expect(next.width).toBeCloseTo(.5); expect(next.height).toBeCloseTo(.45);
    expect(next.x + next.width).toBeCloseTo(rect.x + rect.width);
    expect(next.y + next.height).toBeCloseTo(rect.y + rect.height);
  });
  it('allows one edge to resize without altering the perpendicular axis', () => {
    const next = dragFrameRect(rect, .15, .8, 'e');
    expect(next.width).toBeCloseTo(.55); expect(next.height).toBeCloseTo(rect.height); expect(next.y).toBe(rect.y);
  });
  it('prevents inverted and off-page rectangles even after a large pointer movement', () => {
    const small = dragFrameRect(rect, 10, 10, 'nw', .02, .03);
    expect(small.width).toBeCloseTo(.02); expect(small.height).toBeCloseTo(.03);
    const large = dragFrameRect(rect, 10, 10, 'se');
    expect(large.x + large.width).toBe(1); expect(large.y + large.height).toBe(1);
  });
  it('rejects non-finite pointer input', () => {
    expect(() => dragFrameRect(rect, NaN, 0, 'se')).toThrow();
  });
  it('keeps a full-width frame inside the page, then unlocks horizontal movement after an edge resize', () => {
    const fullWidth = { x: 0, y: 0, width: 1, height: .5 };
    expect(dragFrameRect(fullWidth, .15, .2, null)).toEqual({ ...fullWidth, y: .2 });
    const narrowed = dragFrameRect(fullWidth, -.2, 0, 'e');
    const moved = dragFrameRect(narrowed, .15, .2, null);
    expect(moved).toEqual({ x: .15, y: .2, width: .8, height: .5 });
  });
  it('describes the actual constrained axis only while it occupies the complete page span', () => {
    expect(frameMovementHint({ x: 0, y: .2, width: 1, height: .3 })).toMatch(/页宽/);
    expect(frameMovementHint({ x: .2, y: 0, width: .3, height: 1 })).toMatch(/页高/);
    expect(frameMovementHint({ x: 0, y: 0, width: 1, height: 1 })).toMatch(/整页/);
    expect(frameMovementHint(rect)).toBeNull();
  });
});
