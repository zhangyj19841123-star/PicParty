const standards = [
  { label: '2:3', width: 4000, height: 6000 },
  { label: '3:4', width: 3000, height: 4000 },
  { label: '4:5', width: 3200, height: 4000 },
  { label: '9:16', width: 2160, height: 3840 },
  { label: '1:1', width: 3000, height: 3000 },
];

/** First-photo sizing always produces a portrait 2:3 canvas. Use effective
 * ImageAsset dimensions after EXIF orientation; the project's output size is
 * frozen after this first import. The range matches the canvas UI limits. */
export function portraitCanvasFromPhoto(width: number, height: number): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('照片有效尺寸须为正整数');
  }
  const minimumScale = 50; // At least 100×150 pixels.
  const maximumScale = Math.min(Math.floor(16000 / 3), Math.floor(Math.sqrt(100_000_000 / 6)));
  const scale = Math.max(minimumScale, Math.min(maximumScale, Math.floor(Math.max(width, height) / 3)));
  return { width: scale * 2, height: scale * 3 };
}

/** Camera dimensions are rounded to whole pixels, so ratio matching uses 1% tolerance. */
export function matchPhotoSize(width: number, height: number) {
  if (width <= 0 || height <= 0 || !Number.isFinite(width / height)) throw new Error('照片尺寸无效');
  const landscape = width > height, ratio = Math.min(width, height) / Math.max(width, height);
  const matches = standards.map(size => ({ ...size, error: Math.abs(ratio / (size.width / size.height) - 1) })).sort((a, b) => a.error - b.error);
  const nearest = matches[0];
  if (nearest.error > 0.01) return { label: '自定义', width, height, matched: false };
  return { label: landscape ? nearest.label.split(':').reverse().join(':') : nearest.label, width: landscape ? nearest.height : nearest.width, height: landscape ? nearest.width : nearest.height, matched: true };
}
