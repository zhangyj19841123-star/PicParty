import type { DocumentSize, Rect, ResolvedFrame } from './types';

const EPSILON = 1e-9;
const invalid = (): never => { throw new Error('照片框须为页面内的有限正尺寸矩形'); };

/** Free layouts use fractions of the complete page, independent of margins. */
export function normalizedFrameRect(value: unknown): Rect {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  const { x, y, width, height } = input;
  if (![x, y, width, height].every(number => typeof number === 'number' && Number.isFinite(number))) return invalid();
  const rect = { x, y, width, height } as Rect;
  if (rect.x < 0 || rect.y < 0 || rect.x >= 1 || rect.y >= 1 || rect.width <= 0 || rect.height <= 0 || rect.width > 1 || rect.height > 1
    || rect.x + rect.width > 1 + EPSILON || rect.y + rect.height > 1 + EPSILON) return invalid();
  // Remove round-off at the outer edge so the saved rectangle stays in-page.
  return { ...rect, width: Math.min(rect.width, 1 - rect.x), height: Math.min(rect.height, 1 - rect.y) };
}

export function normalizeLayoutFrames(frames: ResolvedFrame[], document: DocumentSize): ResolvedFrame[] {
  if (!Number.isFinite(document.width) || !Number.isFinite(document.height) || document.width <= 0 || document.height <= 0) throw new Error('页面尺寸无效');
  return frames.map(({ slotId, rect }) => ({ slotId, rect: normalizedFrameRect({
    x: rect.x / document.width, y: rect.y / document.height,
    width: rect.width / document.width, height: rect.height / document.height,
  }) }));
}
