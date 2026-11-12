import { describe, expect, it } from 'vitest';
import { PHOTO_CONTROL_PREFERENCES_KEY } from './photoControlPreferences';
import {
  createToolPanelStore, defaultToolPanelPreferences, normalizeToolPanelPreferences, readToolPanelPreferences,
  TOOL_PANEL_PREFERENCES_KEY, type ToolPanelPreferenceStorage,
} from './toolPanelPreferences';

const memoryStorage = (): ToolPanelPreferenceStorage => {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
};

describe('independent and grouped tool panel preferences', () => {
  it('uses independent defaults and persists both tools through a new store session', () => {
    const storage = memoryStorage(), store = createToolPanelStore(storage);
    expect(store.getState().preferences).toEqual(defaultToolPanelPreferences());
    store.getState().move('rotation', { x: 0.2, y: 0.8 });
    store.getState().setOpacity('rotation', 55);
    store.getState().undock('color', { x: 0.7, y: 0.1 });
    store.getState().setOpacity('color', 78);
    expect(createToolPanelStore(storage).getState().preferences).toEqual({ panels: {
      rotation: { position: { x: 0.2, y: 0.8 }, opacity: 55, placement: 'floating' },
      color: { position: { x: 0.7, y: 0.1 }, opacity: 78, placement: 'floating' },
    }, merged: false });
  });

  it('migrates old rotation position and opacity only when the new key is absent', () => {
    const storage = memoryStorage();
    storage.setItem(PHOTO_CONTROL_PREFERENCES_KEY, JSON.stringify({ position: { x: 0.3, y: 0.6 }, opacity: 42 }));
    const migrated = readToolPanelPreferences(storage);
    expect(migrated.panels.rotation).toEqual({ position: { x: 0.3, y: 0.6 }, opacity: 42, placement: 'floating' });
    expect(migrated.panels.color).toEqual(defaultToolPanelPreferences().panels.color);
    const store = createToolPanelStore(storage); store.getState().reset();
    expect(storage.getItem(TOOL_PANEL_PREFERENCES_KEY)).not.toBeNull();
    expect(readToolPanelPreferences(storage)).toEqual(defaultToolPanelPreferences());
  });

  it('keeps a docked panel last floating position without changing the other tool', () => {
    const store = createToolPanelStore(memoryStorage());
    store.getState().move('rotation', { x: 0.4, y: 0.8 });
    store.getState().dock('rotation');
    expect(store.getState().preferences.panels.rotation).toMatchObject({ placement: 'right', position: { x: 0.4, y: 0.8 } });
    expect(store.getState().preferences.panels.color).toEqual(defaultToolPanelPreferences().panels.color);
    store.getState().undock('rotation');
    expect(store.getState().preferences.panels.rotation).toMatchObject({ placement: 'floating', position: { x: 0.4, y: 0.8 } });
  });

  it('merges at the target and synchronizes group movement and docking while keeping opacity independent', () => {
    const storage = memoryStorage(), store = createToolPanelStore(storage);
    store.getState().move('rotation', { x: 0.2, y: 0.8 });
    store.getState().setOpacity('rotation', 50);
    store.getState().setOpacity('color', 80);
    store.getState().merge('rotation', 'color');
    expect(store.getState().preferences.merged).toBe(true);
    expect(store.getState().preferences.panels.rotation).toEqual({ position: null, placement: 'right', opacity: 50 });
    store.getState().undock('color', { x: 0.7, y: 0.4 });
    expect(store.getState().preferences.panels.rotation).toMatchObject({ placement: 'floating', position: { x: 0.7, y: 0.4 }, opacity: 50 });
    store.getState().move('rotation', { x: 0.6, y: 0.3 });
    expect(store.getState().preferences.panels.color).toMatchObject({ placement: 'floating', position: { x: 0.6, y: 0.3 }, opacity: 80 });
    store.getState().dock('color');
    expect(Object.values(store.getState().preferences.panels).map(panel => panel.placement)).toEqual(['right', 'right']);
    expect(createToolPanelStore(storage).getState().preferences).toEqual(store.getState().preferences);
  });

  it('splits only the chosen tool and restores an entire saved group after a cancelled drag', () => {
    const store = createToolPanelStore(memoryStorage());
    store.getState().merge('color', 'rotation');
    store.getState().move('rotation', { x: 0.4, y: 0.7 });
    const before = structuredClone(store.getState().preferences);
    store.getState().split('color', { x: 0.8, y: 0.2 });
    expect(store.getState().preferences).toEqual({
      merged: false, panels: { rotation: before.panels.rotation, color: { ...before.panels.color, position: { x: 0.8, y: 0.2 }, placement: 'floating' } },
    });
    store.getState().setPreferences(before);
    expect(store.getState().preferences).toEqual(before);
    store.getState().split('rotation');
    expect(store.getState().preferences.panels.rotation.position).toBeNull();
    expect(store.getState().preferences.panels.color).toEqual(before.panels.color);
  });

  it('repairs invalid saved data and mismatched merged geometry without sharing mutable values', () => {
    const result = normalizeToolPanelPreferences({ merged: true, panels: {
      rotation: { position: { x: 2, y: -1 }, opacity: 2, placement: 'floating' },
      color: { position: { x: NaN, y: 0.4 }, opacity: 140, placement: 'right' },
    } });
    expect(result).toEqual({ merged: true, panels: {
      rotation: { position: { x: 1, y: 0 }, opacity: 20, placement: 'floating' },
      color: { position: { x: 1, y: 0 }, opacity: 100, placement: 'floating' },
    } });
    result.panels.rotation.position!.x = 0;
    expect(result.panels.color.position!.x).toBe(1);
    expect(normalizeToolPanelPreferences({ panels: { color: { opacity: Infinity, placement: 'unknown' } }, merged: 'yes' })).toEqual(defaultToolPanelPreferences());
  });

  it('uses defaults for corrupted storage and remains usable when writes are blocked', () => {
    const storage = memoryStorage(); storage.setItem(TOOL_PANEL_PREFERENCES_KEY, '{corrupted');
    expect(readToolPanelPreferences(storage)).toEqual(defaultToolPanelPreferences());
    const blocked: ToolPanelPreferenceStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const store = createToolPanelStore(blocked);
    expect(() => store.getState().setOpacity('rotation', 60)).not.toThrow();
    expect(store.getState().preferences.panels.rotation.opacity).toBe(60);
    store.getState().setOpacity('color', NaN);
    expect(store.getState().preferences.panels.color.opacity).toBe(100);
  });
});
