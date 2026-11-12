import type { FrameRef, Rect } from '../core/types';
import type { FrameResizeHandle } from './frameGeometry';

type Point = { x: number; y: number };
const handles: FrameResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Shared by painted handles and click-outside detection, in whichever coordinate space is supplied. */
export function frameControlPoints(rect: Rect): Array<Point & { handle: FrameResizeHandle }> {
  return handles.map(handle => ({
    handle,
    x: rect.x + (handle.includes('w') ? 0 : handle.includes('e') ? rect.width : rect.width / 2),
    y: rect.y + (handle.includes('n') ? 0 : handle.includes('s') ? rect.height : rect.height / 2),
  }));
}

/** A covered frame body is outside; its visible topmost resize controls still belong to it. */
export function frameEditPointerInside(selected: FrameRef, topmost: FrameRef | null, screenRect: Rect, point: Point, clip: Rect, tolerance = 8): boolean {
  if (![screenRect.x, screenRect.y, screenRect.width, screenRect.height, point.x, point.y, tolerance].every(Number.isFinite)
    || screenRect.width <= 0 || screenRect.height <= 0 || tolerance < 0
    || point.x < clip.x || point.y < clip.y || point.x >= clip.x + clip.width || point.y >= clip.y + clip.height) return false;
  if (topmost?.pageId === selected.pageId && topmost.frameId === selected.frameId) return true;
  return frameControlPoints(screenRect).some(control => Math.abs(point.x - control.x) <= tolerance && Math.abs(point.y - control.y) <= tolerance);
}
