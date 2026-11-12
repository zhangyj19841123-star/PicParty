import { describe, expect, it } from 'vitest';
import { COLOR_PALETTE_KEY, createColorPaletteStore, MAX_SAVED_COLORS, readColorPalette, type ColorPaletteStorage } from './colorPaletteStore';

const storage = (raw?: string): ColorPaletteStorage => {
  const values = new Map<string, string>(raw ? [[COLOR_PALETTE_KEY, raw]] : []);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
};

describe('saved background colors', () => {
  it('restores canonical colors in another app session, without duplicate swatches', () => {
    const source = storage(), store = createColorPaletteStore(source);
    store.getState().save('#AB0000'); store.getState().save('ab0000'); store.getState().save('#fff');
    expect(createColorPaletteStore(source).getState().colors).toEqual(['#ab0000', '#ffffff']);
    store.getState().remove('ab0000');
    expect(readColorPalette(source)).toEqual(['#ffffff']);
  });
  it('falls back safely for corrupt or oversized persisted palettes', () => {
    for (const raw of ['oops', '{}', '["red"]', '[null]', JSON.stringify(Array(MAX_SAVED_COLORS + 1).fill('#ffffff'))]) expect(readColorPalette(storage(raw))).toEqual([]);
    expect(readColorPalette(storage('["#Ab0000","ab0000"]'))).toEqual(['#ab0000']);
  });
  it('keeps the previous palette when writing fails and rejects invalid input', () => {
    let blocked = false;
    const source = storage(), guarded = { getItem: source.getItem, setItem: (key: string, value: string) => { if (blocked) throw new Error('blocked'); source.setItem(key, value); } };
    const store = createColorPaletteStore(guarded); store.getState().save('#ffffff'); blocked = true;
    const previous = store.getState().colors;
    expect(() => store.getState().save('#000000')).toThrow(/颜色保存失败/);
    expect(() => store.getState().remove('#ffffff')).toThrow(/颜色保存失败/);
    expect(() => store.getState().save('invalid')).toThrow(/颜色无效/);
    expect(store.getState().colors).toBe(previous);
    expect(readColorPalette(source)).toEqual(['#ffffff']);
  });
  it('enforces the palette limit while permitting an already saved color', () => {
    const source = storage(), store = createColorPaletteStore(source);
    for (let index = 0; index < MAX_SAVED_COLORS; index++) store.getState().save(`#${index.toString(16).padStart(6, '0')}`);
    expect(() => store.getState().save('#ffffff')).toThrow(/最多保存/);
    expect(() => store.getState().save('#000000')).not.toThrow();
    expect(readColorPalette(source)).toHaveLength(MAX_SAVED_COLORS);
  });
});
