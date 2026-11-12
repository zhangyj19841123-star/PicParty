import { describe, it, expect } from 'vitest';
import { blendBackgroundPixels } from './backgroundPreview';

describe('background preview compositing', () => {
  it('matches linear-light export for half-transparent white over black', () => {
    const pixels = new Uint8ClampedArray([255, 255, 255, 255]);
    blendBackgroundPixels(pixels, '#000000', .5);
    expect([...pixels]).toEqual([188, 188, 188, 255]);
  });
  it('combines PNG alpha with layer opacity and keeps solid color at zero', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 128, 123, 45, 67, 0]);
    blendBackgroundPixels(pixels, '#000000', .5);
    expect([...pixels]).toEqual([137, 0, 0, 255, 0, 0, 0, 255]);
    const hidden = new Uint8ClampedArray([50, 25, 0, 255]);
    blendBackgroundPixels(hidden, '#123456', 0);
    expect([...hidden]).toEqual([18, 52, 86, 255]);
  });
});
