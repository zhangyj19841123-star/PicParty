import { normalizeLayoutFrames } from './freeLayout';
import { createPage, newId } from './templates';
import type { DocumentSize, ImageAsset, Project, ResolvedFrame, TemplateDefinition } from './types';
import { validateAsset, validateProject } from '../state/validateProject';

export const LONG_IMAGE_MIN_PHOTOS = 2;
export const LONG_IMAGE_MAX_PHOTOS = 64;
const MAX_SIDE = 32768;
const MAX_PIXELS = 268435456;

export type LongImageDirection = 'vertical' | 'horizontal';
export interface LongImageOptions {
  direction: LongImageDirection;
  /** Target photo width for vertical stitching, or photo height for horizontal stitching. */
  crossSize?: number;
  /** Inter-photo pixels before any automatic overall reduction. */
  gap?: number;
  name?: string;
}

export interface LongImagePlan {
  document: DocumentSize;
  direction: LongImageDirection;
  requestedCrossSize: number;
  /** Actual photo width/height after automatic reduction; may contain subpixels. */
  crossSize: number;
  gap: number;
  scale: number;
  /** Complete-page normalized rectangles, ready for a free template. */
  frames: ResolvedFrame[];
}

function integerOption(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label}须为 ${minimum} 到 ${maximum} 的整数`);
  }
  return value;
}

function projectName(options: LongImageOptions): string {
  if (options.name !== undefined && typeof options.name !== 'string') throw new Error('长图名称须为文字');
  const name = options.name?.trim() || (options.direction === 'vertical' ? '竖向长图' : '横向长图');
  if (name.length > 4096) throw new Error('项目名称不能超过 4096 个字符');
  return name;
}

function validateInputs(assets: readonly ImageAsset[], options: LongImageOptions): void {
  if (!Array.isArray(assets) || assets.length < LONG_IMAGE_MIN_PHOTOS || assets.length > LONG_IMAGE_MAX_PHOTOS) {
    throw new Error(`长图拼接请选择 ${LONG_IMAGE_MIN_PHOTOS} 到 ${LONG_IMAGE_MAX_PHOTOS} 张照片`);
  }
  if (!options || (options.direction !== 'vertical' && options.direction !== 'horizontal')) throw new Error('请选择竖向或横向拼接');
  projectName(options);
  const byId = new Map<string, ImageAsset>();
  const fields: (keyof ImageAsset)[] = ['id', 'originalPath', 'fileName', 'width', 'height', 'rawWidth', 'rawHeight', 'orientation', 'format', 'fingerprint', 'icc'];
  for (const asset of assets) {
    validateAsset(asset);
    const previous = byId.get(asset.id);
    if (previous && fields.some(field => previous[field] !== asset[field])) throw new Error('同一照片 ID 对应了不同的原图信息');
    byId.set(asset.id, asset);
  }
}

/** Build one source of truth for both the size preview and the editable project.
 * Every original photo keeps its effective EXIF-oriented aspect ratio. Pixel canvas
 * dimensions are integers; retaining subpixel frame geometry prevents rounding from
 * cropping narrow or mixed-aspect photos. At most one extra pixel surrounds an axis. */
export function planLongImageLayout(assets: readonly ImageAsset[], options: LongImageOptions): LongImagePlan {
  validateInputs(assets, options);
  const vertical = options.direction === 'vertical';
  const requestedCrossSize = integerOption(options.crossSize ?? (vertical ? assets[0].width : assets[0].height), vertical ? '统一宽度' : '统一高度', 1, 100000);
  const requestedGap = integerOption(options.gap ?? 0, '照片间距', 0, MAX_SIDE);
  const lengths = assets.map(asset => requestedCrossSize * (vertical ? asset.height / asset.width : asset.width / asset.height));
  const requestedLength = lengths.reduce((sum, length) => sum + length, 0) + requestedGap * (assets.length - 1);
  const dimensions = (scale: number) => ({
    cross: Math.max(1, Math.ceil(requestedCrossSize * scale)),
    length: Math.max(1, Math.ceil(requestedLength * scale)),
  });
  const fits = (scale: number) => {
    const { cross, length } = dimensions(scale);
    return cross <= MAX_SIDE && length <= MAX_SIDE && cross * length <= MAX_PIXELS;
  };

  let scale = Math.min(1, MAX_SIDE / requestedCrossSize, MAX_SIDE / requestedLength, Math.sqrt(MAX_PIXELS / (requestedCrossSize * requestedLength)));
  if (!fits(scale)) {
    // Ceil-to-pixel can cross the area limit even when the real-valued dimensions fit.
    // Search only toward a smaller scale and retain the largest safe pixel canvas.
    let low = 0, high = scale;
    for (let step = 0; step < 52; step++) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle; else high = middle;
    }
    scale = low;
  }
  const { cross, length } = dimensions(scale);
  const crossSize = requestedCrossSize * scale, gap = requestedGap * scale;
  const document: DocumentSize = { width: vertical ? cross : length, height: vertical ? length : cross, colorSpace: 'srgb' };
  // Center the photos in any fractional-pixel space introduced by the integer canvas.
  const crossOffset = (cross - crossSize) / 2;
  let cursor = 0;
  const pixelFrames = lengths.map((rawLength, index) => {
    const photoLength = rawLength * scale;
    const frame: ResolvedFrame = {
      slotId: `photo-${String(index + 1).padStart(2, '0')}`,
      rect: vertical
        ? { x: crossOffset, y: cursor, width: crossSize, height: photoLength }
        : { x: cursor, y: crossOffset, width: photoLength, height: crossSize },
    };
    cursor += photoLength + (index + 1 < assets.length ? gap : 0);
    return frame;
  });
  return { document, direction: options.direction, requestedCrossSize, crossSize, gap, scale, frames: normalizeLayoutFrames(pixelFrames, document) };
}

export function createLongImageProject(assets: readonly ImageAsset[], options: LongImageOptions): Project {
  const plan = planLongImageLayout(assets, options);
  const name = projectName(options);
  const id = newId('long-image-template');
  const template: TemplateDefinition = {
    id, version: 1, name, category: '长图', root: { kind: 'free', frames: structuredClone(plan.frames) },
    defaults: {}, slotOrder: plan.frames.map(frame => frame.slotId),
  };
  const page = createPage(id, { [id]: template }, plan.document);
  page.name = name;
  page.frames.forEach((frame, index) => { frame.imageAssetId = assets[index].id; });
  return validateProject({
    schemaVersion: 1, engineVersion: 1, id: newId('project'), name, canvasSizing: 'fixed',
    document: plan.document, pages: [page], assets: Object.fromEntries(assets.map(asset => [asset.id, structuredClone(asset)])),
    templates: { [id]: template },
  });
}
