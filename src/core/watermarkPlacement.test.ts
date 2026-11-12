import { describe, expect, it } from 'vitest';
import { defaultWatermarkPlacement, moveWatermarkPlacement, normalizeWatermarkPlacement, resizeWatermarkPlacement, resolveWatermarkRect, WATERMARK_ANCHORS, type WatermarkCorner } from './watermarkPlacement';

const photo = { width: 4000, height: 6000 }, mark = { width: 600, height: 200 };
describe('photograph watermark placement', () => {
  it('scales from the original short edge and keeps the same profile within mixed portrait and landscape photographs', () => {
    const placement = defaultWatermarkPlacement();
    for (const size of [photo, { width: 6000, height: 4000 }, { width: 1600, height: 1600 }]) {
      const rect = resolveWatermarkRect(size, mark, placement);
      expect(rect.width).toBe(Math.min(size.width, size.height) * 0.2);
      expect(rect.height / rect.width).toBeCloseTo(mark.height / mark.width);
      expect(rect.x).toBeCloseTo((size.width - rect.width) * 0.95);
      expect(rect.y).toBeCloseTo((size.height - rect.height) * 0.95);
    }
  });
  it('contains unusually wide or tall PNG watermarks without changing their aspect ratio', () => {
    for (const watermark of [{ width: 1000, height: 20 }, { width: 20, height: 1000 }]) {
      const rect = resolveWatermarkRect(photo, watermark, { x: 1, y: 1, widthRatio: 2, opacity: 1 });
      expect(rect.width).toBeLessThanOrEqual(photo.width);
      expect(rect.height).toBeLessThanOrEqual(photo.height);
      expect(rect.height / rect.width).toBeCloseTo(watermark.height / watermark.width);
      expect(rect.x + rect.width).toBeCloseTo(photo.width);
      expect(rect.y + rect.height).toBeCloseTo(photo.height);
    }
  });
  it('places every nine-grid anchor against the photo rather than an arbitrary preview size', () => {
    for (const anchor of WATERMARK_ANCHORS) {
      const rect = resolveWatermarkRect(photo, mark, { ...defaultWatermarkPlacement(), ...anchor });
      expect(rect.x).toBeCloseTo((photo.width - rect.width) * anchor.x);
      expect(rect.y).toBeCloseTo((photo.height - rect.height) * anchor.y);
    }
  });
  it('moves continuously in original pixels, clamps at boundaries and never changes size or opacity', () => {
    const placement = { x: 0.4, y: 0.6, widthRatio: 0.25, opacity: 0.42 };
    const before = resolveWatermarkRect(photo, mark, placement);
    const moved = moveWatermarkPlacement(photo, mark, placement, 300, -500), after = resolveWatermarkRect(photo, mark, moved);
    expect(after.x - before.x).toBeCloseTo(300);
    expect(after.y - before.y).toBeCloseTo(-500);
    expect(moved.widthRatio).toBe(placement.widthRatio); expect(moved.opacity).toBe(0.42);
    expect(moveWatermarkPlacement(photo, mark, placement, Infinity, 1)).toEqual(placement);
    expect(moveWatermarkPlacement(photo, mark, placement, 1e9, -1e9)).toMatchObject({ x: 1, y: 0 });
  });
  it.each(['nw', 'ne', 'sw', 'se'] as WatermarkCorner[])('resizes from the %s corner while holding the opposite corner fixed', corner => {
    const placement = { ...defaultWatermarkPlacement(), x: 0.4, y: 0.6 };
    const before = resolveWatermarkRect(photo, mark, placement);
    const sx = corner.endsWith('e') ? 1 : -1, sy = corner.startsWith('s') ? 1 : -1;
    const changed = resizeWatermarkPlacement(photo, mark, placement, corner, sx * 300, sy * 100);
    const after = resolveWatermarkRect(photo, mark, changed);
    expect(after.width).toBeCloseTo(before.width + 300);
    expect(after.height).toBeCloseTo(before.height + 100);
    expect(sx > 0 ? after.x : after.x + after.width).toBeCloseTo(sx > 0 ? before.x : before.x + before.width);
    expect(sy > 0 ? after.y : after.y + after.height).toBeCloseTo(sy > 0 ? before.y : before.y + before.height);
    expect(changed.opacity).toBe(placement.opacity);
  });
  it('limits corner growth by the fixed anchor and reduces smoothly to the minimum size', () => {
    const placement = { ...defaultWatermarkPlacement(), x: 0.5, y: 0.5 };
    const large = resolveWatermarkRect(photo, mark, resizeWatermarkPlacement(photo, mark, placement, 'se', 1e9, 1e9));
    expect(large.x + large.width).toBeLessThanOrEqual(photo.width + 1e-9);
    expect(large.y + large.height).toBeLessThanOrEqual(photo.height + 1e-9);
    const small = resizeWatermarkPlacement(photo, mark, placement, 'se', -1e9, -1e9);
    expect(small.widthRatio).toBeCloseTo(0.01);
    expect(resolveWatermarkRect(photo, mark, small).height / resolveWatermarkRect(photo, mark, small).width).toBeCloseTo(1 / 3);
  });
  it('repairs invalid settings and rejects zero or nonfinite image dimensions', () => {
    expect(normalizeWatermarkPlacement(null)).toEqual(defaultWatermarkPlacement());
    expect(normalizeWatermarkPlacement({ x: 2, y: -1, widthRatio: 4, opacity: -2 })).toEqual({ x: 1, y: 0, widthRatio: 2, opacity: 0 });
    expect(normalizeWatermarkPlacement({ x: NaN, y: Infinity, widthRatio: 'large', opacity: null })).toEqual(defaultWatermarkPlacement());
    for (const size of [{ width: 0, height: 100 }, { width: 100, height: -1 }, { width: NaN, height: 100 }]) {
      expect(() => resolveWatermarkRect(size, mark, defaultWatermarkPlacement())).toThrow(/尺寸/);
      expect(() => resolveWatermarkRect(photo, size, defaultWatermarkPlacement())).toThrow(/尺寸/);
    }
    const full = { width: 4000, height: 6000 };
    expect(moveWatermarkPlacement(photo, full, { x: 0.4, y: 0.6, widthRatio: 2, opacity: 1 }, 100, 100)).toMatchObject({ x: 0.4, y: 0.6 });
  });
});
