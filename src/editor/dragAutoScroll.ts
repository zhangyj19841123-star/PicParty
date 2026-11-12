import type { AssetDragPoint } from './assetDrag';

interface ScrollBounds { left: number; top: number; right: number; bottom: number }

/** CSS-pixel speed; leave gutters and controls outside the scroll surface untouched. */
export function dragScrollVelocity(bounds: ScrollBounds, point: AssetDragPoint, axis: 'x' | 'y'): number {
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom, point.clientX, point.clientY].every(Number.isFinite)
    || point.clientX < bounds.left || point.clientX > bounds.right || point.clientY < bounds.top || point.clientY > bounds.bottom) return 0;
  const start = axis === 'x' ? bounds.left : bounds.top, end = axis === 'x' ? bounds.right : bounds.bottom;
  const position = axis === 'x' ? point.clientX : point.clientY, band = Math.min(36, (end - start) / 3);
  if (!(band > 0)) return 0;
  if (position < start + band) return -600 * (1 - (position - start) / band);
  if (position > end - band) return 600 * (1 - (end - position) / band);
  return 0;
}

export function startDragAutoScroll(onScroll: () => void): { update(point: AssetDragPoint): void; stop(): void } {
  let point: AssetDragPoint | null = null, animation: number | null = null, stopped = false, previousTime: number | null = null;
  const target = () => {
    if (!point) return null;
    const element = document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>('.overview-scroll,.strip-scroll');
    if (!element) return null;
    const horizontal = element.classList.contains('strip-scroll');
    const velocity = dragScrollVelocity(element.getBoundingClientRect(), point, horizontal ? 'x' : 'y');
    return velocity ? { element, horizontal, velocity } : null;
  };
  const schedule = () => { if (!stopped && animation === null && target()) animation = window.requestAnimationFrame(tick); };
  const tick = (time: number) => {
    animation = null; if (stopped) return;
    const current = target();
    if (!current) { previousTime = null; return; }
    const seconds = previousTime === null ? 1 / 60 : Math.max(0, Math.min(.05, (time - previousTime) / 1000)); previousTime = time;
    const before = current.horizontal ? current.element.scrollLeft : current.element.scrollTop;
    if (current.horizontal) current.element.scrollLeft += current.velocity * seconds;
    else current.element.scrollTop += current.velocity * seconds;
    const after = current.horizontal ? current.element.scrollLeft : current.element.scrollTop;
    if (after !== before) onScroll();
    schedule();
  };
  return {
    update(value) { if (stopped) return; point = { clientX: value.clientX, clientY: value.clientY }; schedule(); },
    stop() { stopped = true; point = null; previousTime = null; if (animation !== null) window.cancelAnimationFrame(animation); animation = null; },
  };
}
