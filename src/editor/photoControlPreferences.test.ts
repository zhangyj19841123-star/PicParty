import { describe, expect, it } from 'vitest';
import {
  defaultPhotoControlPreferences, normalizePhotoControlPreferences, photoControlPositionFraction,
  readPhotoControlPreferences, resolvePhotoControlPosition, writePhotoControlPreferences,
} from './photoControlPreferences';

describe('rotation panel preferences', () => {
  it('persists opacity and a global normalized position through a new session', () => {
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    writePhotoControlPreferences({ position: { x: 0.25, y: 0.8 }, opacity: 55 }, storage);
    expect(readPhotoControlPreferences(storage)).toEqual({ position: { x: 0.25, y: 0.8 }, opacity: 55 });
    writePhotoControlPreferences({ position: null, opacity: 55 }, storage);
    expect(readPhotoControlPreferences(storage)).toEqual({ position: null, opacity: 55 });
  });

  it('falls back on corrupted or unavailable storage and validates stored values', () => {
    expect(readPhotoControlPreferences({ getItem: () => '{broken', setItem: () => {} })).toEqual(defaultPhotoControlPreferences());
    const unavailable = { getItem: (): string => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readPhotoControlPreferences(unavailable)).toEqual(defaultPhotoControlPreferences());
    expect(() => writePhotoControlPreferences(defaultPhotoControlPreferences(), unavailable)).not.toThrow();
    expect(normalizePhotoControlPreferences({ position: { x: 4, y: -2 }, opacity: 3 })).toEqual({ position: { x: 1, y: 0 }, opacity: 20 });
    expect(normalizePhotoControlPreferences({ position: { x: NaN, y: 0.4 }, opacity: '10' })).toEqual(defaultPhotoControlPreferences());
  });

  it('keeps a saved panel inside both the original and a smaller workspace', () => {
    const large = { viewportWidth: 1000, viewportHeight: 700, panelWidth: 340, panelHeight: 90 };
    const small = { ...large, viewportWidth: 420, viewportHeight: 180 };
    const fraction = photoControlPositionFraction({ x: 652, y: 602 }, large);
    expect(fraction).toEqual({ x: 1, y: 1 });
    expect(resolvePhotoControlPosition(fraction, small, { x: 200, y: 200 })).toEqual({ x: 72, y: 82 });
    expect(resolvePhotoControlPosition(null, small, { x: 200, y: -10 })).toEqual({ x: 72, y: 8 });
  });

  it('handles a workspace with no room to move without invalid coordinates', () => {
    const bounds = { viewportWidth: 340, viewportHeight: 90, panelWidth: 340, panelHeight: 90 };
    expect(photoControlPositionFraction({ x: 200, y: 100 }, bounds)).toEqual({ x: 0, y: 0 });
    expect(resolvePhotoControlPosition({ x: 1, y: 1 }, bounds, { x: 200, y: 100 })).toEqual({ x: 0, y: 0 });
  });
});
