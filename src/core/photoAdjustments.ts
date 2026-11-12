import type { PhotoAdjustments } from './types';

export const ADJUSTMENT_KEYS = ['exposure', 'temperature', 'tint', 'contrast', 'highlights', 'brightness', 'shadows', 'vibrance', 'saturation', 'blacks'] as const;

/** Every call returns a separate neutral value, safe to put in document state. */
export function defaultAdjustments(): PhotoAdjustments {
  return { exposure: 0, temperature: 0, tint: 0, contrast: 0, highlights: 0, brightness: 0, shadows: 0, vibrance: 0, saturation: 0, blacks: 0 };
}

export function adjustmentLimit(key: keyof PhotoAdjustments): number { return key === 'exposure' ? 3 : 100; }

/** Older transforms may omit the object, and older adjustment objects may omit
 * fields. Both mean neutral; invalid explicit values must never reach rendering. */
export function normalizeAdjustments(value: unknown): PhotoAdjustments {
  const result = defaultAdjustments();
  if (value === undefined) return result;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效项目：照片调整应为对象');
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(key => !(ADJUSTMENT_KEYS as readonly string[]).includes(key))) throw new Error('无效项目：照片调整包含不支持的参数');
  for (const key of ADJUSTMENT_KEYS) {
    if (!Object.hasOwn(source, key)) continue;
    const current = source[key], limit = adjustmentLimit(key);
    if (typeof current !== 'number' || !Number.isFinite(current) || current < -limit || current > limit) {
      throw new Error(`无效项目：照片调整 ${key} 超出范围`);
    }
    result[key] = current;
  }
  return result;
}
