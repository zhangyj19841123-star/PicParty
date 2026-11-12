import { describe, expect, it } from 'vitest';
import { hexToRGB, normalizedColor, rgbToHex } from './backgroundColor';

describe('background sRGB colors', () => {
  it('normalizes entered HEX values and expands short notation', () => {
    expect(normalizedColor(' #Ab09Ff ')).toBe('#ab09ff');
    expect(normalizedColor('a0F')).toBe('#aa00ff');
    expect(hexToRGB('#a0f')).toEqual({ r: 170, g: 0, b: 255 });
  });
  it('round trips all RGB channel boundaries without losing leading zeroes', () => {
    const color = { r: 0, g: 15, b: 255 };
    expect(rgbToHex(color)).toBe('#000fff');
    expect(hexToRGB(rgbToHex(color)!)).toEqual(color);
  });
  it('rejects malformed colors and out-of-range or noninteger RGB values', () => {
    for (const value of ['', '#ff', '#ffff', '#00000000', '0xff0000', 'red', '#gg0000']) expect(normalizedColor(value)).toBeNull();
    for (const r of [-1, 256, NaN, Infinity, 1.5]) expect(rgbToHex({ r, g: 0, b: 0 })).toBeNull();
  });
});
