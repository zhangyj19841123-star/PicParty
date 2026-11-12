import { describe, expect, it } from 'vitest';
import { nativeDropPoint } from './dropCoordinates';

describe('native file-drop coordinates', () => {
  it('keeps macOS AppKit points on the same frame on Retina and standard displays', () => {
    for (const ratio of [1, 2]) expect(nativeDropPoint({ x: 1100, y: 700 }, ratio, 'MacIntel')).toEqual({ x: 1100, y: 700 });
  });
  it('converts actual physical pixels on other backends only once', () => {
    expect(nativeDropPoint({ x: 2200, y: 1400 }, 2, 'Win32')).toEqual({ x: 1100, y: 700 });
    expect(nativeDropPoint({ x: 1100, y: 700 }, 1, 'Linux')).toEqual({ x: 1100, y: 700 });
  });
  it('rejects invalid positions or display scales without picking an unrelated frame', () => {
    for (const ratio of [0, -1, Infinity, NaN]) expect(nativeDropPoint({ x: 100, y: 100 }, ratio, 'MacIntel')).toBeNull();
    expect(nativeDropPoint({ x: NaN, y: 100 }, 2, 'MacIntel')).toBeNull();
  });
});
