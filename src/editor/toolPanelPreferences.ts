import { create } from 'zustand';
import { readPhotoControlPreferences, type PhotoControlPosition } from './photoControlPreferences';

export { photoControlPositionFraction, resolvePhotoControlPosition } from './photoControlPreferences';
export type { PanelBounds, PhotoControlPosition } from './photoControlPreferences';
export type ToolPanelKind = 'rotation' | 'color';
export type ToolPanelPlacement = 'floating' | 'right';
export interface ToolPanelPreference { position: PhotoControlPosition | null; opacity: number; placement: ToolPanelPlacement }
export interface ToolPanelPreferences { panels: Record<ToolPanelKind, ToolPanelPreference>; merged: boolean }
export interface ToolPanelState {
  preferences: ToolPanelPreferences;
  setPreferences(value: ToolPanelPreferences): void;
  updatePanel(kind: ToolPanelKind, patch: Partial<ToolPanelPreference>): void;
  move(kind: ToolPanelKind, position: PhotoControlPosition | null): void;
  setOpacity(kind: ToolPanelKind, opacity: number): void;
  dock(kind: ToolPanelKind): void;
  undock(kind: ToolPanelKind, position?: PhotoControlPosition | null): void;
  merge(kind: ToolPanelKind, target: ToolPanelKind): void;
  split(kind: ToolPanelKind, position?: PhotoControlPosition | null): void;
  reset(): void;
}
export type ToolPanelPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const TOOL_PANEL_PREFERENCES_KEY = 'frame-studio.tool-panels.v1';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const otherPanel = (kind: ToolPanelKind): ToolPanelKind => kind === 'rotation' ? 'color' : 'rotation';
const copyPosition = (position: PhotoControlPosition | null) => position ? { ...position } : null;
const normalizedPosition = (value: unknown): PhotoControlPosition | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const position = value as Record<string, unknown>;
  return finite(position.x) && finite(position.y) ? { x: clamp(position.x, 0, 1), y: clamp(position.y, 0, 1) } : null;
};

export function defaultToolPanelPreferences(): ToolPanelPreferences {
  return { panels: {
    rotation: { position: null, opacity: 90, placement: 'floating' },
    color: { position: null, opacity: 100, placement: 'right' },
  }, merged: false };
}

export function normalizeToolPanelPreferences(value: unknown): ToolPanelPreferences {
  const result = defaultToolPanelPreferences();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const data = value as Record<string, unknown>;
  if (data.panels && typeof data.panels === 'object' && !Array.isArray(data.panels)) {
    const panels = data.panels as Record<string, unknown>;
    for (const kind of ['rotation', 'color'] as const) {
      if (!panels[kind] || typeof panels[kind] !== 'object' || Array.isArray(panels[kind])) continue;
      const panel = panels[kind] as Record<string, unknown>;
      result.panels[kind].position = normalizedPosition(panel.position);
      if (finite(panel.opacity)) result.panels[kind].opacity = clamp(panel.opacity, 20, 100);
      if (panel.placement === 'floating' || panel.placement === 'right') result.panels[kind].placement = panel.placement;
    }
  }
  result.merged = data.merged === true;
  if (result.merged) {
    result.panels.color.position = copyPosition(result.panels.rotation.position);
    result.panels.color.placement = result.panels.rotation.placement;
  }
  return result;
}

export function readToolPanelPreferences(storage?: ToolPanelPreferenceStorage): ToolPanelPreferences {
  try {
    const source = storage ?? globalThis.localStorage;
    const raw = source?.getItem(TOOL_PANEL_PREFERENCES_KEY);
    if (raw !== null && raw !== undefined) return normalizeToolPanelPreferences(JSON.parse(raw));
    const legacy = readPhotoControlPreferences(source);
    const migrated = defaultToolPanelPreferences();
    migrated.panels.rotation.position = copyPosition(legacy.position);
    migrated.panels.rotation.opacity = legacy.opacity;
    return migrated;
  } catch { return defaultToolPanelPreferences(); }
}

export function writeToolPanelPreferences(value: ToolPanelPreferences, storage?: ToolPanelPreferenceStorage): void {
  try { (storage ?? globalThis.localStorage)?.setItem(TOOL_PANEL_PREFERENCES_KEY, JSON.stringify(normalizeToolPanelPreferences(value))); }
  catch { /* Tool panels stay usable even when local preference storage is blocked. */ }
}

export const createToolPanelStore = (storage?: ToolPanelPreferenceStorage) => create<ToolPanelState>((set, get) => {
  const save = (value: ToolPanelPreferences) => {
    const preferences = normalizeToolPanelPreferences(value);
    set({ preferences }); writeToolPanelPreferences(preferences, storage);
  };
  const edit = (operation: (preferences: ToolPanelPreferences) => void) => {
    const preferences = structuredClone(get().preferences);
    operation(preferences); save(preferences);
  };
  const updatePanel = (kind: ToolPanelKind, patch: Partial<ToolPanelPreference>) => edit(preferences => {
    const panel = preferences.panels[kind];
    if (finite(patch.opacity)) panel.opacity = clamp(patch.opacity, 20, 100);
    const positionChanged = patch.position !== undefined;
    if (positionChanged) panel.position = normalizedPosition(patch.position);
    const placementChanged = patch.placement === 'floating' || patch.placement === 'right';
    if (placementChanged) panel.placement = patch.placement!;
    if (preferences.merged && (positionChanged || placementChanged)) {
      const other = preferences.panels[otherPanel(kind)];
      other.position = copyPosition(panel.position); other.placement = panel.placement;
    }
  });
  return {
    preferences: readToolPanelPreferences(storage),
    setPreferences: save,
    updatePanel,
    move: (kind, position) => updatePanel(kind, { position }),
    setOpacity: (kind, opacity) => updatePanel(kind, { opacity }),
    dock: kind => updatePanel(kind, { placement: 'right' }),
    undock: (kind, position) => updatePanel(kind, { placement: 'floating', ...(position !== undefined ? { position } : {}) }),
    merge: (kind, target) => {
      if (kind === target) return;
      edit(preferences => {
        const destination = preferences.panels[target];
        preferences.panels[kind].position = copyPosition(destination.position);
        preferences.panels[kind].placement = destination.placement;
        preferences.merged = true;
      });
    },
    split: (kind, position = null) => edit(preferences => {
      preferences.merged = false;
      preferences.panels[kind].placement = 'floating';
      preferences.panels[kind].position = normalizedPosition(position);
    }),
    reset: () => save(defaultToolPanelPreferences()),
  };
});

export const useToolPanelStore = createToolPanelStore();
