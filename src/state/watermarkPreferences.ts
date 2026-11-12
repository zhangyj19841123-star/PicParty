import { create } from 'zustand';
import { defaultWatermarkPlacement } from '../core/watermarkPlacement';
import { hasWatermarkLayer, normalizeWatermarkPreset, type WatermarkPresetSettings } from '../core/watermarkSettings';

export const WATERMARK_PREFERENCES_KEY = 'frame-studio.watermarks.v1';
export const MAX_WATERMARK_PROFILES = 64;
export type WatermarkPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface WatermarkProfile extends WatermarkPresetSettings { id: string; name: string }
export interface WatermarkLastSettings extends WatermarkPresetSettings {
  referencePath: string; inputDirectory: string; outputDirectory: string;
  format: 'jpg' | 'png';
}
export interface WatermarkPreferences { last: WatermarkLastSettings; profiles: WatermarkProfile[] }
export interface WatermarkPreferenceState extends WatermarkPreferences {
  remember(patch: Partial<WatermarkLastSettings>): void;
  saveProfile(name: string): WatermarkProfile;
  useProfile(id: string): WatermarkProfile;
  renameProfile(id: string, name: string): WatermarkProfile;
  deleteProfile(id: string): void;
}

export const defaultWatermarkSettings = (): WatermarkLastSettings => ({ watermarkPath: '', referencePath: '', inputDirectory: '', outputDirectory: '', format: 'jpg', placement: defaultWatermarkPlacement() });
const LEGACY_FIXTURE_ROOT = '/artifacts/picparty/验收';
const LEGACY_FIXTURE_MARK = `${LEGACY_FIXTURE_ROOT}/透明水印.png`;
const LEGACY_FIXTURE_TEXT = 'PicParty 验收\n摄影作品';
const LEGACY_FIXTURE_PROFILES = new Set(['PicParty 合成验收', 'PicParty 双层水印验收']);
const fixturePath = (path: string, ending: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').endsWith(ending);

/** Clear the exact fixtures the previous release's acceptance test saved locally. */
export function clearLegacyWatermarkFixture(preset: WatermarkPresetSettings, hasFixtureReference = false): WatermarkPresetSettings {
  const removeImage = fixturePath(preset.watermarkPath, LEGACY_FIXTURE_MARK);
  const removeText = (removeImage || hasFixtureReference) && preset.text?.text === LEGACY_FIXTURE_TEXT;
  if (!removeImage && !removeText) return preset;
  return {
    ...preset,
    ...(removeImage ? { watermarkPath: '', imageEnabled: false, placement: defaultWatermarkPlacement() } : {}),
    ...(removeText ? { text: undefined, textEnabled: false } : {}),
  };
}

function clearLegacyFixtures(preferences: WatermarkPreferences): WatermarkPreferences {
  const { last, profiles } = preferences;
  const removeReference = ['01-竖图.png', '02-横图.png'].some(name => fixturePath(last.referencePath, `${LEGACY_FIXTURE_ROOT}/输入/${name}`));
  const removeInput = fixturePath(last.inputDirectory, `${LEGACY_FIXTURE_ROOT}/输入`);
  const removeOutput = fixturePath(last.outputDirectory, `${LEGACY_FIXTURE_ROOT}/水印输出`);
  const updatedLast = {
    ...last,
    ...clearLegacyWatermarkFixture(last, removeReference || removeInput || removeOutput),
    referencePath: removeReference ? '' : last.referencePath,
    inputDirectory: removeInput ? '' : last.inputDirectory,
    outputDirectory: removeOutput ? '' : last.outputDirectory,
  };
  const updatedProfiles = profiles.filter(profile => !(LEGACY_FIXTURE_PROFILES.has(profile.name)
    && fixturePath(profile.watermarkPath, LEGACY_FIXTURE_MARK) && profile.text?.text === LEGACY_FIXTURE_TEXT));
  return { last: normalizeLast(updatedLast), profiles: updatedProfiles };
}

const serializePreferences = (preferences: WatermarkPreferences) => JSON.stringify({ ...preferences, fixtureCleanupDone: true });
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const validText = (value: unknown, max: number, allowEmpty = false): value is string => typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
const normalizeLast = (value: unknown): WatermarkLastSettings => {
  const result = defaultWatermarkSettings(), data = object(value);
  if (!data) return result;
  for (const key of ['watermarkPath', 'referencePath', 'inputDirectory', 'outputDirectory'] as const) if (validText(data[key], 32768, true)) result[key] = data[key];
  if (data.format === 'jpg' || data.format === 'png') result.format = data.format;
  return { ...result, ...normalizeWatermarkPreset(data) };
};

export function readWatermarkPreferences(storage?: WatermarkPreferenceStorage): WatermarkPreferences {
  const empty = (): WatermarkPreferences => ({ last: defaultWatermarkSettings(), profiles: [] });
  try {
    const preferenceStorage = storage ?? globalThis.localStorage;
    const raw = preferenceStorage?.getItem(WATERMARK_PREFERENCES_KEY);
    if (!raw) return empty();
    const data = object(JSON.parse(raw));
    if (!data || !Array.isArray(data.profiles) || data.profiles.length > MAX_WATERMARK_PROFILES) return empty();
    const profiles: WatermarkProfile[] = data.profiles.map(value => {
      const profile = object(value);
      if (!profile || !validText(profile.id, 256) || !validText(profile.name, 80) || !validText(profile.watermarkPath, 32768, true)
        || ['__proto__', 'prototype', 'constructor'].includes(profile.id)) throw new Error('水印模板无效');
      const preset = normalizeWatermarkPreset(profile);
      if (!hasWatermarkLayer(preset)) throw new Error('水印模板无有效图层');
      return { id: profile.id, name: profile.name.trim(), ...preset };
    });
    if (new Set(profiles.map(profile => profile.id)).size !== profiles.length || new Set(profiles.map(profile => profile.name)).size !== profiles.length) return empty();
    const preferences = { last: normalizeLast(data.last), profiles };
    if (data.fixtureCleanupDone === true) return preferences;
    const cleaned = clearLegacyFixtures(preferences);
    if (JSON.stringify(cleaned) !== JSON.stringify(preferences)) {
      try { preferenceStorage?.setItem(WATERMARK_PREFERENCES_KEY, serializePreferences(cleaned)); }
      catch { /* Use the cleaned preferences for this session even when local storage is read-only. */ }
    }
    return cleaned;
  } catch { return empty(); }
}

/** Presets store normalized editable settings and source paths, without image bytes. */
export const createWatermarkPreferenceStore = (storage?: WatermarkPreferenceStorage) => create<WatermarkPreferenceState>((set, get) => {
  const persist = (preferences: WatermarkPreferences) => {
    try { (storage ?? globalThis.localStorage)?.setItem(WATERMARK_PREFERENCES_KEY, serializePreferences(preferences)); }
    catch { throw new Error('水印设置保存失败：无法写入本机存储，请稍后重试。'); }
    set(preferences);
  };
  return {
    ...readWatermarkPreferences(storage),
    remember: patch => {
      const state = get();
      const last = normalizeLast({ ...state.last, ...patch });
      if (JSON.stringify(last) !== JSON.stringify(state.last)) persist({ last, profiles: state.profiles });
    },
    saveProfile: value => {
      const name = value.trim();
      if (!validText(name, 80)) throw new Error('水印模板名称须为 1～80 个字符');
      const { last, profiles } = get();
      const preset = normalizeWatermarkPreset(last);
      if (!hasWatermarkLayer(preset)) throw new Error('请先选择透明 PNG 或输入并启用文字水印');
      const existing = profiles.find(profile => profile.name === name);
      if (!existing && profiles.length >= MAX_WATERMARK_PROFILES) throw new Error('最多保存 64 个水印模板，可使用相同名称更新已有模板');
      const profile: WatermarkProfile = { id: existing?.id ?? `watermark_${crypto.randomUUID()}`, name, ...preset };
      persist({ last, profiles: existing ? profiles.map(item => item.id === existing.id ? profile : item) : [...profiles, profile] });
      return structuredClone(profile);
    },
    useProfile: id => {
      const state = get(), profile = state.profiles.find(item => item.id === id);
      if (!profile) throw new Error('找不到这个水印模板');
      const { watermarkPath, placement, imageEnabled, textEnabled, text } = normalizeWatermarkPreset(profile);
      const last = normalizeLast({ ...state.last, watermarkPath, placement, imageEnabled, textEnabled, text });
      persist({ last, profiles: state.profiles });
      return structuredClone(profile);
    },
    renameProfile: (id, value) => {
      const name = value.trim();
      if (!validText(name, 80)) throw new Error('水印模板名称须为 1～80 个字符');
      const { last, profiles } = get();
      const profile = profiles.find(item => item.id === id);
      if (!profile) throw new Error('找不到这个水印模板');
      if (profiles.some(item => item.id !== id && item.name === name)) throw new Error('已有同名水印模板');
      const updated = { ...profile, name };
      if (name !== profile.name) persist({ last, profiles: profiles.map(item => item.id === id ? updated : item) });
      return structuredClone(updated);
    },
    deleteProfile: id => {
      const { last, profiles } = get();
      if (!profiles.some(item => item.id === id)) throw new Error('找不到这个水印模板');
      persist({ last, profiles: profiles.filter(item => item.id !== id) });
    },
  };
});

export const useWatermarkPreferences = createWatermarkPreferenceStore();
