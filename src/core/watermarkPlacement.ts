export interface WatermarkPlacement { x: number; y: number; widthRatio: number; opacity: number }
export interface WatermarkSize { width: number; height: number }
export interface WatermarkRect extends WatermarkSize { x: number; y: number }
export type WatermarkCorner = 'nw' | 'ne' | 'sw' | 'se';
export const WATERMARK_SIZE_LIMITS = { min: 0.01, max: 2 } as const;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const defaultWatermarkPlacement = (): WatermarkPlacement => ({ x: 0.95, y: 0.95, widthRatio: 0.2, opacity: 0.7 });

export function normalizeWatermarkPlacement(value: unknown): WatermarkPlacement {
  const result = defaultWatermarkPlacement();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const data = value as Record<string, unknown>;
  for (const key of ['x', 'y', 'opacity'] as const) if (finite(data[key])) result[key] = clamp(data[key], 0, 1);
  if (finite(data.widthRatio)) result.widthRatio = clamp(data.widthRatio, WATERMARK_SIZE_LIMITS.min, WATERMARK_SIZE_LIMITS.max);
  return result;
}

const validateSize = ({ width, height }: WatermarkSize) => {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) throw new Error('照片和水印尺寸须为正数');
};

/** Size follows the photo's short edge. x/y refer to the remaining movable
 * space, so one profile stays inside both portrait and landscape photographs. */
export function resolveWatermarkRect(photo: WatermarkSize, watermark: WatermarkSize, value: WatermarkPlacement): WatermarkRect {
  validateSize(photo); validateSize(watermark);
  const placement = normalizeWatermarkPlacement(value);
  const requestedWidth = Math.min(photo.width, photo.height) * placement.widthRatio;
  const ratio = watermark.height / watermark.width;
  const width = Math.min(requestedWidth, photo.width, photo.height / ratio), height = width * ratio;
  return { x: (photo.width - width) * placement.x, y: (photo.height - height) * placement.y, width, height };
}

export function moveWatermarkPlacement(photo: WatermarkSize, watermark: WatermarkSize, value: WatermarkPlacement, dx: number, dy: number): WatermarkPlacement {
  const placement = normalizeWatermarkPlacement(value), rect = resolveWatermarkRect(photo, watermark, placement);
  if (!finite(dx) || !finite(dy)) return placement;
  const remainingX = photo.width - rect.width, remainingY = photo.height - rect.height;
  return { ...placement,
    x: remainingX > 0 ? clamp((rect.x + dx) / remainingX, 0, 1) : placement.x,
    y: remainingY > 0 ? clamp((rect.y + dy) / remainingY, 0, 1) : placement.y,
  };
}

/** Project the dragged corner onto the watermark's aspect diagonal and keep
 * its opposite corner fixed. The preview never deforms or leaves the photo. */
export function resizeWatermarkPlacement(photo: WatermarkSize, watermark: WatermarkSize, value: WatermarkPlacement, corner: WatermarkCorner, dx: number, dy: number): WatermarkPlacement {
  const placement = normalizeWatermarkPlacement(value), rect = resolveWatermarkRect(photo, watermark, placement);
  if (!finite(dx) || !finite(dy)) return placement;
  const sx = corner.endsWith('e') ? 1 : -1, sy = corner.startsWith('s') ? 1 : -1;
  const anchorX = sx > 0 ? rect.x : rect.x + rect.width, anchorY = sy > 0 ? rect.y : rect.y + rect.height;
  const heightPerWidth = watermark.height / watermark.width, shortEdge = Math.min(photo.width, photo.height);
  const requested = rect.width + (sx * dx + sy * heightPerWidth * dy) / (1 + heightPerWidth ** 2);
  const maximum = Math.min(shortEdge * WATERMARK_SIZE_LIMITS.max,
    sx > 0 ? photo.width - anchorX : anchorX, (sy > 0 ? photo.height - anchorY : anchorY) / heightPerWidth);
  const width = clamp(requested, Math.min(shortEdge * WATERMARK_SIZE_LIMITS.min, maximum), maximum), height = width * heightPerWidth;
  const x = sx > 0 ? anchorX : anchorX - width, y = sy > 0 ? anchorY : anchorY - height;
  return { ...placement, widthRatio: width / shortEdge,
    x: photo.width > width ? clamp(x / (photo.width - width), 0, 1) : placement.x,
    y: photo.height > height ? clamp(y / (photo.height - height), 0, 1) : placement.y,
  };
}

export const WATERMARK_ANCHORS = [
  { name: '左上', x: 0, y: 0 }, { name: '上中', x: 0.5, y: 0 }, { name: '右上', x: 1, y: 0 },
  { name: '左中', x: 0, y: 0.5 }, { name: '居中', x: 0.5, y: 0.5 }, { name: '右中', x: 1, y: 0.5 },
  { name: '左下', x: 0, y: 1 }, { name: '下中', x: 0.5, y: 1 }, { name: '右下', x: 1, y: 1 },
] as const;
