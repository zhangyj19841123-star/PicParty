const linear = new Float64Array(256);
const encoded = new Uint8Array(65536);
for (let i = 0; i < 256; i++) { const s = i / 255; linear[i] = s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }
for (let i = 0; i < 65536; i++) { const l = i / 65535; encoded[i] = Math.round(255 * (l <= .0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - .055)); }

/** Match the native renderer's linear-light alpha compositing. */
export function blendBackgroundPixels(pixels: Uint8ClampedArray, color: string, opacity: number): void {
  if (!/^#[\da-f]{6}$/i.test(color) || !Number.isFinite(opacity) || opacity < 0 || opacity > 1 || pixels.length % 4 !== 0) throw new Error('背景颜色或透明度无效');
  const bg = [1, 3, 5].map(offset => linear[parseInt(color.slice(offset, offset + 2), 16)]);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255 * opacity;
    for (let channel = 0; channel < 3; channel++) pixels[i + channel] = encoded[Math.max(0, Math.min(65535, Math.round((linear[pixels[i + channel]] * alpha + bg[channel] * (1 - alpha)) * 65535)))];
    pixels[i + 3] = 255;
  }
}

const ids = new WeakMap<object, number>();
let nextId = 0;
const cache = new Map<string, { image: HTMLCanvasElement; bytes: number }>();
export function backgroundPreview(image: HTMLImageElement | HTMLCanvasElement, color: string, opacity: number): HTMLImageElement | HTMLCanvasElement {
  let id = ids.get(image); if (id === undefined) { id = ++nextId; ids.set(image, id); }
  const key = JSON.stringify([id, color, opacity]), saved = cache.get(key);
  if (saved) { cache.delete(key); cache.set(key, saved); return saved.image; }
  const canvas = document.createElement('canvas'); canvas.width = image instanceof HTMLImageElement ? image.naturalWidth : image.width; canvas.height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  blendBackgroundPixels(data.data, color, opacity); ctx.putImageData(data, 0, 0);
  cache.set(key, { image: canvas, bytes: data.data.byteLength });
  let bytes = [...cache.values()].reduce((total, entry) => total + entry.bytes, 0);
  for (const [oldKey, entry] of cache) { if (bytes <= 32 * 1024 * 1024) break; cache.delete(oldKey); bytes -= entry.bytes; }
  return canvas;
}
