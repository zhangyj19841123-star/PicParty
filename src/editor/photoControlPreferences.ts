export interface PhotoControlPosition { x: number; y: number }
export interface PhotoControlPreferences { position: PhotoControlPosition | null; opacity: number }
export interface PanelBounds { viewportWidth: number; viewportHeight: number; panelWidth: number; panelHeight: number }
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const PHOTO_CONTROL_PREFERENCES_KEY = 'frame-studio.photo-controls.v1';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function defaultPhotoControlPreferences(): PhotoControlPreferences { return { position: null, opacity: 90 }; }

export function normalizePhotoControlPreferences(value: unknown): PhotoControlPreferences {
  const result = defaultPhotoControlPreferences();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const data = value as Record<string, unknown>;
  if (finite(data.opacity)) result.opacity = clamp(data.opacity, 20, 100);
  if (data.position && typeof data.position === 'object' && !Array.isArray(data.position)) {
    const position = data.position as Record<string, unknown>;
    if (finite(position.x) && finite(position.y)) result.position = { x: clamp(position.x, 0, 1), y: clamp(position.y, 0, 1) };
  }
  return result;
}

export function readPhotoControlPreferences(storage?: PreferenceStorage): PhotoControlPreferences {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem(PHOTO_CONTROL_PREFERENCES_KEY);
    return saved ? normalizePhotoControlPreferences(JSON.parse(saved)) : defaultPhotoControlPreferences();
  } catch { return defaultPhotoControlPreferences(); }
}

export function writePhotoControlPreferences(preferences: PhotoControlPreferences, storage?: PreferenceStorage): void {
  try { (storage ?? globalThis.localStorage)?.setItem(PHOTO_CONTROL_PREFERENCES_KEY, JSON.stringify(normalizePhotoControlPreferences(preferences))); }
  catch { /* Preferences remain usable when storage is unavailable. */ }
}

function axis(viewport: number, panel: number) {
  const space = Math.max(0, viewport - panel);
  const min = Math.min(8, space / 2);
  return { min, max: Math.max(min, space - min) };
}

/** Fractions refer to the available movement range, not the photo or document. */
export function resolvePhotoControlPosition(position: PhotoControlPosition | null, bounds: PanelBounds, automatic: PhotoControlPosition): PhotoControlPosition {
  const x = axis(bounds.viewportWidth, bounds.panelWidth), y = axis(bounds.viewportHeight, bounds.panelHeight);
  return position ? {
    x: x.min + clamp(position.x, 0, 1) * (x.max - x.min),
    y: y.min + clamp(position.y, 0, 1) * (y.max - y.min),
  } : { x: clamp(automatic.x, x.min, x.max), y: clamp(automatic.y, y.min, y.max) };
}

export function photoControlPositionFraction(position: PhotoControlPosition, bounds: PanelBounds): PhotoControlPosition {
  const x = axis(bounds.viewportWidth, bounds.panelWidth), y = axis(bounds.viewportHeight, bounds.panelHeight);
  return {
    x: x.max === x.min ? 0 : clamp((position.x - x.min) / (x.max - x.min), 0, 1),
    y: y.max === y.min ? 0 : clamp((position.y - y.min) / (y.max - y.min), 0, 1),
  };
}
