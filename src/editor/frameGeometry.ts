import type { Rect } from '../core/types';

export type FrameResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** At zero margins a full-span frame cannot move until that axis is made smaller. */
export function frameMovementHint(rect: Rect): string | null {
  const fullWidth = rect.width >= 1 - 1e-9, fullHeight = rect.height >= 1 - 1e-9;
  if (fullWidth && fullHeight) return '照片框已贴满整页，先拖边点缩小，再拖动位置';
  if (fullWidth) return '已贴满页宽，先拖侧边缩窄后可左右移动';
  if (fullHeight) return '已贴满页高，先拖上下边缩短后可上下移动';
  return null;
}

/** Rectangles and deltas use page fractions; resizing keeps the opposite edge fixed. */
export function dragFrameRect(rect: Rect, dx: number, dy: number, handle: FrameResizeHandle | null, minWidth = .005, minHeight = .005): Rect {
  if (![rect.x, rect.y, rect.width, rect.height, dx, dy, minWidth, minHeight].every(Number.isFinite)) throw new Error('照片框位置必须为有效数值');
  if (!handle) return { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.width), y: clamp(rect.y + dy, 0, 1 - rect.height) };
  let left = rect.x, right = rect.x + rect.width, top = rect.y, bottom = rect.y + rect.height;
  const minimumW = Math.min(rect.width, Math.max(.0001, minWidth)), minimumH = Math.min(rect.height, Math.max(.0001, minHeight));
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minimumW);
  if (handle.includes('e')) right = clamp(right + dx, left + minimumW, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minimumH);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minimumH, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
