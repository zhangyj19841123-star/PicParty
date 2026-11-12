import { describe, expect, it } from 'vitest';
import { matchPhotoSize, portraitCanvasFromPhoto } from './photoSize';
describe('photo aspect matching', () => {
  it('accepts rounded camera proportions', () => {
    expect(matchPhotoSize(1365, 2048)).toMatchObject({ label: '2:3', width: 4000, height: 6000 });
    expect(matchPhotoSize(3024, 4032).label).toBe('3:4');
    expect(matchPhotoSize(4000, 5000).label).toBe('4:5');
  });
  it('handles landscape and preserves unusual dimensions', () => {
    expect(matchPhotoSize(2048, 1365)).toMatchObject({ label: '3:2', width: 6000, height: 4000 });
    expect(matchPhotoSize(2000, 3500)).toMatchObject({ width: 2000, height: 3500, matched: false });
  });
  it('matches effective 4672×7008 camera pixels to the unified 2:3 standard canvas', () => {
    expect(matchPhotoSize(4672, 7008)).toEqual({ label: '2:3', width: 4000, height: 6000, matched: true });
  });
});

describe('first-photo portrait canvas', () => {
  it('uses effective long-edge pixels and retains a vertical 2:3 canvas for either orientation', () => {
    expect(portraitCanvasFromPhoto(4672, 7008)).toEqual({ width: 4672, height: 7008 });
    expect(portraitCanvasFromPhoto(7008, 4672)).toEqual({ width: 4672, height: 7008 });
    expect(portraitCanvasFromPhoto(3024, 4032)).toEqual({ width: 2688, height: 4032 });
    expect(portraitCanvasFromPhoto(4032, 3024)).toEqual({ width: 2688, height: 4032 });
    expect(portraitCanvasFromPhoto(1365, 2048)).toEqual({ width: 1364, height: 2046 });
  });

  it('keeps exact 2:3 integer pixels within the canvas size and 100 MP limits', () => {
    expect(portraitCanvasFromPhoto(1, 1)).toEqual({ width: 100, height: 150 });
    expect(portraitCanvasFromPhoto(100, 149)).toEqual({ width: 100, height: 150 });
    expect(portraitCanvasFromPhoto(100, 150)).toEqual({ width: 100, height: 150 });
    const maximum = portraitCanvasFromPhoto(100000, 100000);
    expect(maximum).toEqual({ width: 8164, height: 12246 });
    expect(maximum.width * maximum.height).toBeLessThanOrEqual(100_000_000);
    expect((maximum.width + 2) * (maximum.height + 3)).toBeGreaterThan(100_000_000);
  });

  it('rejects non-finite, fractional, non-positive, and unsafe photo dimensions', () => {
    for (const invalid of [0, -1, 2.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => portraitCanvasFromPhoto(invalid, 7008)).toThrow(/尺寸/);
      expect(() => portraitCanvasFromPhoto(4672, invalid)).toThrow(/尺寸/);
    }
  });
});
