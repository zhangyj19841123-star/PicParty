import { describe, expect, it } from 'vitest';
import { dragScrollVelocity } from './dragAutoScroll';

const bounds = { left: 200, right: 900, top: 100, bottom: 700 };

describe('photo drag edge scrolling', () => {
  it('scrolls only near the inside edge, with proportional CSS-pixel speed in either axis', () => {
    expect(dragScrollVelocity(bounds, { clientX: 500, clientY: 100 }, 'y')).toBe(-600);
    expect(dragScrollVelocity(bounds, { clientX: 500, clientY: 682 }, 'y')).toBe(300);
    expect(dragScrollVelocity(bounds, { clientX: 500, clientY: 400 }, 'y')).toBe(0);
    expect(dragScrollVelocity(bounds, { clientX: 200, clientY: 400 }, 'x')).toBe(-600);
    expect(dragScrollVelocity(bounds, { clientX: 882, clientY: 400 }, 'x')).toBe(300);
    expect(dragScrollVelocity(bounds, { clientX: 500, clientY: 400 }, 'x')).toBe(0);
  });
  it('never scrolls another region, a toolbar outside the surface, or invalid bounds', () => {
    expect(dragScrollVelocity(bounds, { clientX: 500, clientY: 99 }, 'y')).toBe(0);
    expect(dragScrollVelocity(bounds, { clientX: 901, clientY: 699 }, 'y')).toBe(0);
    expect(dragScrollVelocity(bounds, { clientX: 899, clientY: 701 }, 'x')).toBe(0);
    expect(dragScrollVelocity(bounds, { clientX: Infinity, clientY: 699 }, 'y')).toBe(0);
    expect(dragScrollVelocity({ ...bounds, right: bounds.left }, { clientX: 200, clientY: 400 }, 'x')).toBe(0);
    expect(dragScrollVelocity({ left: 0, right: 20, top: 0, bottom: 20 }, { clientX: 10, clientY: 10 }, 'y')).toBe(0);
  });
});
