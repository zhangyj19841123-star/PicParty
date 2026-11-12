import type { CoverResult, Rect } from './types';

/** Convert an on-canvas image drag into source-normalized focus. The rendered
 * image center gives the actual focus after cover has clamped it, so dragging a
 * photo at its edge starts from its visible position rather than stored intent. */
export function focusAfterDrag(
  rect: Rect, assetWidth: number, assetHeight: number, cover: CoverResult,
  dxDoc: number, dyDoc: number,
): { focusX: number; focusY: number } {
  if (![rect.x, rect.y, rect.width, rect.height, assetWidth, assetHeight, cover.scale,
    cover.centerX, cover.centerY, cover.rotation, dxDoc, dyDoc].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || assetWidth <= 0 || assetHeight <= 0 || cover.scale <= 0) {
    throw new Error('照片拖动尺寸或坐标不正确');
  }
  const radians = cover.rotation * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const x = rect.x + rect.width / 2 - cover.centerX - dxDoc;
  const y = rect.y + rect.height / 2 - cover.centerY - dyDoc;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    focusX: clamp(0.5 + (cos * x + sin * y) / (cover.scale * assetWidth)),
    focusY: clamp(0.5 + (-sin * x + cos * y) / (cover.scale * assetHeight)),
  };
}
