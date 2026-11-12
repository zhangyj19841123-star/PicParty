import { describe, expect, it } from 'vitest';
import { ADJUSTMENT_KEYS, adjustmentLimit, defaultAdjustments, normalizeAdjustments } from './photoAdjustments';

describe('nondestructive photo adjustment values', () => {
  it('creates independent neutral objects for all ten controls', () => {
    const first = defaultAdjustments(), second = defaultAdjustments();
    expect(Object.keys(first)).toEqual([...ADJUSTMENT_KEYS]);
    expect(Object.values(first)).toEqual(Array(10).fill(0));
    first.exposure = 2;
    expect(second.exposure).toBe(0);
  });

  it('normalizes older omitted or partial values without modifying input', () => {
    expect(normalizeAdjustments(undefined)).toEqual(defaultAdjustments());
    const old = { exposure: 1.5, saturation: -20 };
    expect(normalizeAdjustments(old)).toEqual({ ...defaultAdjustments(), ...old });
    expect(old).toEqual({ exposure: 1.5, saturation: -20 });
  });

  it('accepts exposure EV and the other controls at their finite endpoints', () => {
    for (const key of ADJUSTMENT_KEYS) {
      const limit = adjustmentLimit(key);
      expect(normalizeAdjustments({ [key]: limit })[key]).toBe(limit);
      expect(normalizeAdjustments({ [key]: -limit })[key]).toBe(-limit);
      expect(() => normalizeAdjustments({ [key]: limit + 0.1 })).toThrow(/范围/);
      expect(() => normalizeAdjustments({ [key]: -limit - 0.1 })).toThrow(/范围/);
    }
    expect(adjustmentLimit('exposure')).toBe(3);
    expect(adjustmentLimit('brightness')).toBe(100);
  });

  it('rejects malformed objects and non-finite explicit values before rendering', () => {
    for (const invalid of [null, [], 'neutral', 0]) expect(() => normalizeAdjustments(invalid)).toThrow(/对象/);
    expect(() => normalizeAdjustments({ unknownControl: 20 })).toThrow(/不支持/);
    for (const key of ADJUSTMENT_KEYS) {
      for (const invalid of [NaN, Infinity, -Infinity, null, '20', true]) {
        expect(() => normalizeAdjustments({ [key]: invalid })).toThrow(/范围/);
      }
    }
  });
});
