import { describe, expect, it } from 'vitest';
import { defaultWatermarkPlacement } from '../core/watermarkPlacement';
import { defaultTextWatermark } from '../core/watermarkSettings';
import { createWatermarkPreferenceStore, defaultWatermarkSettings, readWatermarkPreferences, WATERMARK_PREFERENCES_KEY, type WatermarkPreferenceStorage } from './watermarkPreferences';

const storage = (): WatermarkPreferenceStorage => {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
};
describe('independent watermark preferences and named presets', () => {
  it('persists the last placement, paths and format without image bytes or collage state', () => {
    const source = storage(), store = createWatermarkPreferenceStore(source);
    expect(store.getState().last).toEqual(defaultWatermarkSettings());
    const placement = { x: 0.24, y: 0.83, widthRatio: 0.31, opacity: 0.46 };
    store.getState().remember({ placement, watermarkPath: '/logos/署名.png', referencePath: '/photos/参考.jpg', inputDirectory: '/photos/input', outputDirectory: '/photos/output', format: 'png' });
    placement.x = 1;
    expect(createWatermarkPreferenceStore(source).getState().last).toEqual({ placement: { x: 0.24, y: 0.83, widthRatio: 0.31, opacity: 0.46 }, watermarkPath: '/logos/署名.png', referencePath: '/photos/参考.jpg', inputDirectory: '/photos/input', outputDirectory: '/photos/output', format: 'png' });
    expect(source.getItem(WATERMARK_PREFERENCES_KEY)).not.toMatch(/base64|imageAssetId|frames|assets|history|project/);
  });
  it('saves named templates and restores one while retaining the current folders and reference photo', () => {
    const source = storage(), store = createWatermarkPreferenceStore(source);
    store.getState().remember({ watermarkPath: '/logos/署名.png', placement: { x: 0.1, y: 0.9, widthRatio: 0.16, opacity: 0.6 } });
    const profile = store.getState().saveProfile('  摄影署名  ');
    store.getState().remember({ watermarkPath: '/logos/其他.png', placement: defaultWatermarkPlacement(), inputDirectory: '/input', outputDirectory: '/output', referencePath: '/sample.jpg', format: 'png' });
    const applied = store.getState().useProfile(profile.id);
    applied.placement.x = 0.8;
    expect(store.getState().last).toMatchObject({ watermarkPath: '/logos/署名.png', placement: { x: 0.1, y: 0.9, widthRatio: 0.16, opacity: 0.6 }, inputDirectory: '/input', outputDirectory: '/output', referencePath: '/sample.jpg', format: 'png' });
    expect(createWatermarkPreferenceStore(source).getState().profiles).toEqual([{ ...profile, name: '摄影署名' }]);
  });
  it('updates a template with the same trimmed name and keeps distinct presets independent', () => {
    const source = storage(), store = createWatermarkPreferenceStore(source);
    store.getState().remember({ watermarkPath: '/logos/a.png' });
    const first = store.getState().saveProfile('署名');
    store.getState().saveProfile('工作室');
    store.getState().remember({ watermarkPath: '/logos/b.png', placement: { x: 0, y: 0, widthRatio: 0.45, opacity: 1 } });
    const updated = store.getState().saveProfile(' 署名 ');
    expect(updated.id).toBe(first.id);
    expect(store.getState().profiles).toHaveLength(2);
    expect(store.getState().profiles[1]).toMatchObject({ name: '工作室', watermarkPath: '/logos/a.png', placement: defaultWatermarkPlacement() });
    expect(createWatermarkPreferenceStore(source).getState().profiles[0]).toMatchObject({ watermarkPath: '/logos/b.png', placement: { x: 0, y: 0, widthRatio: 0.45, opacity: 1 } });
  });
  it('fails an explicit save atomically when local storage is unavailable', () => {
    const source = storage();
    createWatermarkPreferenceStore(source).getState().remember({ watermarkPath: '/logos/a.png' });
    const blocked = createWatermarkPreferenceStore({ getItem: source.getItem, setItem: () => { throw new Error('disk full'); } });
    const before = blocked.getState();
    expect(() => blocked.getState().saveProfile('署名')).toThrow(/本机存储/);
    expect(() => blocked.getState().remember({ format: 'png' })).toThrow(/本机存储/);
    expect(blocked.getState()).toBe(before);
    expect(readWatermarkPreferences(source).profiles).toEqual([]);
  });
  it('rejects invalid names, missing watermarks and unknown profiles without writes', () => {
    const source = storage(), store = createWatermarkPreferenceStore(source);
    expect(() => store.getState().saveProfile('署名')).toThrow(/先选择/);
    store.getState().remember({ watermarkPath: '/logos/a.png' });
    const before = source.getItem(WATERMARK_PREFERENCES_KEY);
    for (const name of ['', '  ', 'x'.repeat(81), 'bad\u0000name']) expect(() => store.getState().saveProfile(name)).toThrow(/名称/);
    expect(() => store.getState().useProfile('missing')).toThrow(/找不到/);
    expect(source.getItem(WATERMARK_PREFERENCES_KEY)).toBe(before);
  });
  it('repairs out-of-range placement and falls back safely for corrupt or duplicate preset data', () => {
    const source = storage();
    source.setItem(WATERMARK_PREFERENCES_KEY, JSON.stringify({ last: { watermarkPath: 12, placement: { x: -1, y: 3, widthRatio: 8, opacity: 2 } }, profiles: [] }));
    expect(readWatermarkPreferences(source).last).toMatchObject({ watermarkPath: '', placement: { x: 0, y: 1, widthRatio: 2, opacity: 1 } });
    const valid = { id: 'mark_a', name: '署名', watermarkPath: '/a.png', placement: defaultWatermarkPlacement() };
    for (const raw of ['not json', '{}', JSON.stringify({ profiles: [valid, valid] }), JSON.stringify({ profiles: [{ ...valid, id: '__proto__' }] }), JSON.stringify({ profiles: [{ ...valid, watermarkPath: '' }] })]) {
      source.setItem(WATERMARK_PREFERENCES_KEY, raw);
      expect(readWatermarkPreferences(source)).toEqual({ last: defaultWatermarkSettings(), profiles: [] });
    }
    expect(readWatermarkPreferences({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toEqual({ last: defaultWatermarkSettings(), profiles: [] });
  });
  it('caps named presets while permitting intentional updates at capacity', () => {
    const store = createWatermarkPreferenceStore(storage());
    store.getState().remember({ watermarkPath: '/a.png' });
    for (let index = 0; index < 64; index++) store.getState().saveProfile(`署名 ${index}`);
    expect(() => store.getState().saveProfile('额外模板')).toThrow(/64/);
    store.getState().remember({ watermarkPath: '/b.png' });
    store.getState().saveProfile('署名 0');
    expect(store.getState().profiles).toHaveLength(64);
    expect(store.getState().profiles[0].watermarkPath).toBe('/b.png');
  });
  it('keeps text-only and two-layer presets independent through rename, load and deletion', () => {
    const source = storage(), store = createWatermarkPreferenceStore(source);
    const text = { ...defaultTextWatermark(), text: '摄影署名\nStudio', fontFamily: 'PingFang SC', fontSize: 96,
      fontWeight: 600, characterSpacing: 3, lineSpacing: 9, italicAngle: 12, wrapWidth: 700, scale: 1.3,
      color: '#285a3c', placement: { ...defaultWatermarkPlacement(), rotation: -35, positionMode: 'pixels' as const, x: 20, y: 40 } };
    store.getState().remember({ imageEnabled: false, textEnabled: true, text });
    const caption = store.getState().saveProfile('文字署名');
    const imagePlacement = { ...defaultWatermarkPlacement(), positionMode: 'margins' as const, x: 80, y: 50, rotation: 22, tile: { gapX: 64, gapY: 70 } };
    store.getState().remember({ watermarkPath: '/logos/品牌.png', imageEnabled: true, placement: imagePlacement });
    const duo = store.getState().saveProfile('品牌与署名');
    const reopened = createWatermarkPreferenceStore(source);
    reopened.getState().renameProfile(caption.id, '多行署名');
    expect(reopened.getState().useProfile(caption.id)).toMatchObject({ name: '多行署名', watermarkPath: '', imageEnabled: false, textEnabled: true, text });
    expect(reopened.getState().useProfile(duo.id)).toMatchObject({ watermarkPath: '/logos/品牌.png', imageEnabled: true, placement: imagePlacement, text });
    reopened.getState().deleteProfile(caption.id);
    expect(readWatermarkPreferences(source).profiles.map(item => item.id)).toEqual([duo.id]);
  });
  it('clears the old release fixture without discarding user watermarks, references or presets', () => {
    const source = storage();
    const fixture = '/repo/artifacts/picparty/验收';
    const placement = defaultWatermarkPlacement();
    const text = { ...defaultTextWatermark(), text: 'PicParty 验收\n摄影作品' };
    const last = {
      watermarkPath: `${fixture}/透明水印.png`, imageEnabled: true, text, textEnabled: true,
      placement, referencePath: `${fixture}/输入/02-横图.png`, inputDirectory: `${fixture}/输入`, outputDirectory: '/user/exports', format: 'png',
    };
    source.setItem(WATERMARK_PREFERENCES_KEY, JSON.stringify({ last, profiles: [
      { id: 'qa', name: 'PicParty 双层水印验收', ...last },
      { id: 'user', name: '工作室', watermarkPath: '/user/透明水印.png', placement },
      { id: 'name-only', name: 'PicParty 合成验收', watermarkPath: '/user/other.png', placement },
    ] }));
    const migrated = readWatermarkPreferences(source);
    expect(migrated.last).toMatchObject({
      watermarkPath: '', imageEnabled: false, textEnabled: false, referencePath: '', inputDirectory: '', outputDirectory: '/user/exports', format: 'png',
    });
    expect(migrated.last.text).toBeUndefined();
    expect(migrated.profiles.map(profile => profile.id)).toEqual(['user', 'name-only']);
    expect(readWatermarkPreferences(source)).toEqual(migrated);

    const customized = { ...last, watermarkPath: '/user/透明水印.png', referencePath: '/user/02-横图.png', inputDirectory: '/user', text: { ...text, text: '摄影作品 · 我的署名' } };
    source.setItem(WATERMARK_PREFERENCES_KEY, JSON.stringify({ last: customized, profiles: [] }));
    expect(readWatermarkPreferences(source).last).toMatchObject(customized);
  });
  it('does not restore cleared image, text or reference paths when reopened', () => {
    const source = storage(), store = createWatermarkPreferenceStore(source);
    store.getState().remember({
      watermarkPath: '/my/logo.png', imageEnabled: true, text: { ...defaultTextWatermark(), text: '摄影工作室' }, textEnabled: true,
      referencePath: '/my/cover.jpg',
    });
    store.getState().remember({ watermarkPath: '', imageEnabled: false, text: undefined, textEnabled: false, referencePath: '' });
    const reopened = createWatermarkPreferenceStore(source).getState().last;
    expect(reopened).toMatchObject({ watermarkPath: '', imageEnabled: false, textEnabled: false, referencePath: '' });
    expect(reopened.text).toBeUndefined();
  });
});
