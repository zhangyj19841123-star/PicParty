import { normalizeWatermarkPlacement, resolveWatermarkRect, type WatermarkPlacement, type WatermarkSize } from '../core/watermarkPlacement';
import { blendBackgroundPixels } from './backgroundPreview';

export interface WatermarkPixels extends WatermarkSize { data: Uint8ClampedArray }
const linear = new Uint16Array(256), encoded = new Uint8Array(65536);
for (let index = 0; index < linear.length; index++) {
  const value = index / 255;
  linear[index] = Math.round((value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * 65535);
}
for (let index = 0; index < encoded.length; index++) {
  const value = index / 65535;
  encoded[index] = Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
}
const validPixels = (pixels: WatermarkPixels) => Number.isSafeInteger(pixels.width) && Number.isSafeInteger(pixels.height)
  && pixels.width > 0 && pixels.height > 0 && pixels.data.length === pixels.width * pixels.height * 4;
const scaled16 = (value: number, multiplier: number) => Math.floor((value * multiplier + 32767) / 65535);

/** Match render_placement's premultiplied 16-bit linear-sRGB source-over
 * composition. The reference is already flattened to opaque white, as it is
 * in the native photo pipeline. PNG alpha and the user's opacity multiply. */
export function blendWatermarkPixels(photo: WatermarkPixels, watermark: WatermarkPixels, left: number, top: number, opacity: number): void {
  if (!validPixels(photo) || !validPixels(watermark) || !Number.isSafeInteger(left) || !Number.isSafeInteger(top)
    || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('水印预览尺寸或透明度无效');
  const layer = Math.round(opacity * 65535);
  if (layer === 0) return;
  const startX = Math.max(0, left), startY = Math.max(0, top);
  const endX = Math.min(photo.width, left + watermark.width), endY = Math.min(photo.height, top + watermark.height);
  for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
    const sourceIndex = ((y - top) * watermark.width + x - left) * 4, destinationIndex = (y * photo.width + x) * 4;
    const sourceAlpha = watermark.data[sourceIndex + 3], alpha = scaled16(sourceAlpha * 257, layer);
    if (alpha === 0) continue;
    for (let channel = 0; channel < 3; channel++) {
      const premultiplied = Math.floor((linear[watermark.data[sourceIndex + channel]] * sourceAlpha + 127) / 255);
      const combined = scaled16(premultiplied, layer) + scaled16(linear[photo.data[destinationIndex + channel]], 65535 - alpha);
      photo.data[destinationIndex + channel] = encoded[Math.min(65535, combined)];
    }
    photo.data[destinationIndex + 3] = 255;
  }
}

type PreviewImage = HTMLImageElement | HTMLCanvasElement;
const imageIds = new WeakMap<PreviewImage, number>();
let nextImageId = 0;
const photoCache = new Map<string, WatermarkPixels>();
const PHOTO_CACHE_BUDGET = 32 * 1024 * 1024;
function sourceSize(image: PreviewImage): WatermarkSize {
  return image instanceof HTMLImageElement ? { width: image.naturalWidth, height: image.naturalHeight } : { width: image.width, height: image.height };
}
function canvasPixels(image: PreviewImage, width: number, height: number): WatermarkPixels {
  const scratch = document.createElement('canvas'); scratch.width = width; scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法生成水印预览');
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  scratch.width = scratch.height = 0;
  return { data, width, height };
}
function referencePixels(image: PreviewImage, width: number, height: number): WatermarkPixels {
  let id = imageIds.get(image);
  if (id === undefined) { id = ++nextImageId; imageIds.set(image, id); }
  const key = `${id}:${width}:${height}`, cached = photoCache.get(key);
  if (cached) { photoCache.delete(key); photoCache.set(key, cached); return cached; }
  const pixels = canvasPixels(image, width, height);
  // Transparent reference PNGs receive the same opaque white foundation that
  // photo_project uses for both JPG and PNG output.
  blendBackgroundPixels(pixels.data, '#ffffff', 1);
  photoCache.set(key, pixels);
  let bytes = [...photoCache.values()].reduce((total, item) => total + item.data.byteLength, 0);
  for (const [oldKey, item] of photoCache) {
    if (bytes <= PHOTO_CACHE_BUDGET) break;
    photoCache.delete(oldKey); bytes -= item.data.byteLength;
  }
  return pixels;
}

/** Paint the complete reference + watermark onto one canvas. Put selection
 * outlines/handles above this canvas, without a second CSS-opacity watermark.
 * Preview geometry is normalized against the original oriented dimensions;
 * the limited raster size affects only display sharpness, never export size. */
export function drawWatermarkPreview(
  canvas: HTMLCanvasElement, photo: PreviewImage, watermark: PreviewImage | undefined,
  photoSize: WatermarkSize, watermarkSize: WatermarkSize | undefined,
  placement: WatermarkPlacement, maxEdge = 1024,
): void {
  const original = sourceSize(photo);
  if (![original.width, original.height, photoSize.width, photoSize.height, maxEdge].every(value => Number.isFinite(value) && value > 0)
    || maxEdge > 2048) throw new Error('水印预览尺寸无效');
  const scale = Math.min(1, maxEdge / Math.max(photoSize.width, photoSize.height));
  const width = Math.max(1, Math.round(photoSize.width * scale)), height = Math.max(1, Math.round(photoSize.height * scale));
  const cached = referencePixels(photo, width, height), pixels: WatermarkPixels = { width, height, data: cached.data.slice() };
  if (watermark && watermarkSize) {
    const value = normalizeWatermarkPlacement(placement), rect = resolveWatermarkRect(photoSize, watermarkSize, value);
    const left = Math.round(rect.x * width / photoSize.width), top = Math.round(rect.y * height / photoSize.height);
    const right = Math.round((rect.x + rect.width) * width / photoSize.width), bottom = Math.round((rect.y + rect.height) * height / photoSize.height);
    if (right > left && bottom > top) blendWatermarkPixels(pixels, canvasPixels(watermark, right - left, bottom - top), left, top, value.opacity);
  }
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法生成水印预览');
  const output = context.createImageData(width, height); output.data.set(pixels.data); context.putImageData(output, 0, 0);
}
