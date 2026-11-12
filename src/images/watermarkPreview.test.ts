import { describe, expect, it } from 'vitest';
import { blendBackgroundPixels } from './backgroundPreview';
import { blendWatermarkPixels, type WatermarkPixels } from './watermarkPreview';

const pixels = (values: number[], width = values.length / 4, height = 1): WatermarkPixels => ({ data: new Uint8ClampedArray(values), width, height });
describe('watermark preview matches linear-light native output', () => {
  it('uses linear alpha rather than CSS opacity for a half-visible white logo on black', () => {
    const photo = pixels([0, 0, 0, 255]), watermark = pixels([255, 255, 255, 255]);
    blendWatermarkPixels(photo, watermark, 0, 0, 0.5);
    expect([...photo.data]).toEqual([188, 188, 188, 255]);
    expect([...watermark.data]).toEqual([255, 255, 255, 255]);
  });
  it('multiplies source PNG alpha by layer opacity and never leaks hidden RGB', () => {
    const photo = pixels([0, 0, 0, 255, 12, 34, 56, 255]), watermark = pixels([255, 0, 0, 128, 255, 200, 100, 0]);
    blendWatermarkPixels(photo, watermark, 0, 0, 0.5);
    expect([...photo.data]).toEqual([137, 0, 0, 255, 12, 34, 56, 255]);
  });
  it('uses the actual photo pixels under the logo rather than a solid preview background', () => {
    const photo = pixels([0, 0, 255, 255, 0, 255, 0, 255]), watermark = pixels([255, 0, 0, 255, 255, 0, 0, 255]);
    blendWatermarkPixels(photo, watermark, 0, 0, 0.5);
    expect([...photo.data]).toEqual([188, 0, 188, 255, 188, 188, 0, 255]);
  });
  it('touches only the positioned rectangle and clips safely at photo bounds', () => {
    const photo = pixels([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255], 2, 2);
    blendWatermarkPixels(photo, pixels([255, 255, 255, 255]), 1, 1, 1);
    expect([...photo.data]).toEqual([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 255, 255, 255, 255]);
    const clipped = pixels([0, 0, 0, 255, 0, 0, 0, 255]);
    blendWatermarkPixels(clipped, pixels([255, 0, 0, 255, 0, 255, 0, 255]), -1, 0, 1);
    expect([...clipped.data]).toEqual([0, 255, 0, 255, 0, 0, 0, 255]);
  });
  it('flattens a transparent reference PNG onto white before composing the watermark', () => {
    const photo = pixels([25, 50, 75, 0]), watermark = pixels([0, 0, 0, 255]);
    blendBackgroundPixels(photo.data, '#ffffff', 1);
    expect([...photo.data]).toEqual([255, 255, 255, 255]);
    blendWatermarkPixels(photo, watermark, 0, 0, 0.5);
    expect([...photo.data]).toEqual([188, 188, 188, 255]);
  });
  it('keeps originals unchanged for invisible watermarks and rejects malformed buffers or opacity', () => {
    const photo = pixels([10, 20, 30, 255]), before = photo.data.slice(), mark = pixels([255, 255, 255, 255]);
    blendWatermarkPixels(photo, mark, 0, 0, 0);
    blendWatermarkPixels(photo, mark, 5, 5, 1);
    expect(photo.data).toEqual(before);
    for (const opacity of [-1, 2, NaN, Infinity]) expect(() => blendWatermarkPixels(photo, mark, 0, 0, opacity)).toThrow(/透明度/);
    expect(() => blendWatermarkPixels({ ...photo, width: 2 }, mark, 0, 0, 1)).toThrow(/尺寸/);
    expect(() => blendWatermarkPixels(photo, mark, 0.5, 0, 1)).toThrow(/尺寸/);
  });
});
