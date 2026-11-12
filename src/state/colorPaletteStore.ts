import { create } from 'zustand';
import { normalizedColor } from '../core/backgroundColor';

export const COLOR_PALETTE_KEY = 'frame-studio.background-colors.v1';
export const MAX_SAVED_COLORS = 24;
export const BASIC_BACKGROUND_COLORS = ['#ffffff', '#f1eee7', '#d7d9d5', '#202723', '#000000'];
export type ColorPaletteStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface ColorPaletteState { colors: string[]; save(color: string): void; remove(color: string): void }

export function readColorPalette(storage?: ColorPaletteStorage): string[] {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(COLOR_PALETTE_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || data.length > MAX_SAVED_COLORS || data.some(value => typeof value !== 'string' || !normalizedColor(value))) return [];
    const colors = (data as string[]).map(value => normalizedColor(value)!);
    return [...new Set(colors)];
  } catch { return []; }
}

export const createColorPaletteStore = (storage?: ColorPaletteStorage) => create<ColorPaletteState>((set, get) => {
  const persist = (colors: string[]) => {
    try { (storage ?? globalThis.localStorage)?.setItem(COLOR_PALETTE_KEY, JSON.stringify(colors)); }
    catch { throw new Error('颜色保存失败：无法写入本机存储，请稍后重试。'); }
    set({ colors });
  };
  return {
    colors: readColorPalette(storage),
    save: value => {
      const color = normalizedColor(value);
      if (!color) throw new Error('颜色无效，请输入 RGB 0–255 或 HEX 颜色。');
      if (get().colors.includes(color)) return;
      if (get().colors.length >= MAX_SAVED_COLORS) throw new Error(`常用颜色最多保存 ${MAX_SAVED_COLORS} 个，请先移除不用的颜色。`);
      persist([...get().colors, color]);
    },
    remove: value => {
      const color = normalizedColor(value), colors = get().colors.filter(item => item !== color);
      if (colors.length !== get().colors.length) persist(colors);
    },
  };
});

export const useColorPaletteStore = createColorPaletteStore();
