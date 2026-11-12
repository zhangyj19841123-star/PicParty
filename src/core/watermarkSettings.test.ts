import { describe, expect, it } from 'vitest';
import {
  colorWatermarkSelection, defaultTextWatermark, editWatermarkText, normalizeLayerPlacement,
  normalizeTextWatermark, normalizeWatermarkPreset, positionWatermarkLayer, watermarkLayerRect,
} from './watermarkSettings';

describe('watermark positioning in original photo pixels', () => {
  const photo = { width: 900, height: 650 };
  const mark = { width: 190, height: 60, x: 330, y: 240 };
  const base = { x: 0.95, y: 0.95, opacity: 0.7, widthRatio: 0.2 };

  it('round-trips visible placement when switching all three coordinate modes', () => {
    for (const positionMode of ['relative', 'pixels', 'margins'] as const) {
      const placement = positionWatermarkLayer(photo, mark, { ...base, positionMode });
      const resolved = watermarkLayerRect(photo, mark, placement);
      expect(resolved.x).toBeCloseTo(mark.x, 8);
      expect(resolved.y).toBeCloseTo(mark.y, 8);
    }
  });

  it('can drag a centered margin placement left or upward without snapping back', () => {
    const centered = { ...base, positionMode: 'margins' as const, anchorX: 0.5, anchorY: 0.5, x: 0, y: 0 };
    const placement = positionWatermarkLayer(photo, mark, centered);
    expect(placement).toMatchObject({ anchorX: 0, anchorY: 0, x: 330, y: 240 });
    expect(watermarkLayerRect(photo, mark, placement)).toEqual(mark);
  });

  it('normalizes pixel offsets without clamping them into the legacy fractional range', () => {
    expect(normalizeLayerPlacement({ ...base, positionMode: 'pixels', x: 270, y: -8, rotation: 200, tile: { gapX: 62, gapY: 48 } }))
      .toEqual({ ...base, positionMode: 'pixels', x: 270, y: 0, rotation: 180, tile: { gapX: 62, gapY: 48 } });
  });
});

describe('watermark text style and selection', () => {
  it('stores style colors as RGB hex and preserves Unicode offsets when loading a preset', () => {
    const text = {
      ...defaultTextWatermark(), text: 'A💡\r\n摄影', color: '#FEDCBA',
      colorRanges: [
        { start: 1, end: 3, color: '#FA0' },
        { start: 2, end: 3, color: '#ffffff' }, // Splits the emoji and is ignored.
        { start: 5, end: 7, color: '123456' },
        { start: 7, end: 8, color: '#ffffff' },
      ],
      stroke: { color: '#456', width: 90 },
      shadow: { color: '#FF5500', opacity: 2, offsetX: -80, offsetY: 9, blur: 90 },
      background: { color: '#FC9', opacity: 0.45, padding: 80 },
    };
    const result = normalizeWatermarkPreset(JSON.parse(JSON.stringify({ textEnabled: true, text }))).text;
    expect(result).toMatchObject({
      text: 'A💡\n摄影', color: '#fedcba',
      colorRanges: [{ start: 1, end: 3, color: '#ffaa00' }, { start: 4, end: 6, color: '#123456' }],
      stroke: { color: '#445566', width: 32 },
      shadow: { color: '#ff5500', opacity: 1, offsetX: -64, offsetY: 9, blur: 64 },
      background: { color: '#ffcc99', opacity: 0.45, padding: 64 },
    });
    expect(normalizeTextWatermark(result)).toEqual(result);
    expect(normalizeTextWatermark(defaultTextWatermark())).not.toHaveProperty('stroke');
  });

  it('replaces and clears only the selected portion of a colored range', () => {
    const base = { ...defaultTextWatermark(), text: '甲乙丙丁' };
    const initial = colorWatermarkSelection(base, { text: base.text, start: 0, end: 4 }, '#ff0000');
    const middle = colorWatermarkSelection(initial, { text: base.text, start: 1, end: 3 }, '#0000ff');
    const cleared = colorWatermarkSelection(middle, { text: base.text, start: 2, end: 3 }, null);
    expect(cleared.colorRanges).toEqual([
      { start: 0, end: 1, color: '#ff0000' },
      { start: 1, end: 2, color: '#0000ff' },
      { start: 3, end: 4, color: '#ff0000' },
    ]);
    expect(normalizeTextWatermark({ ...cleared, color: '#00ff00' }).colorRanges).toEqual(cleared.colorRanges);
  });

  it('does not apply a color from an open picker to a later text value', () => {
    const settings = { ...defaultTextWatermark(), text: '新文字' };
    expect(colorWatermarkSelection(settings, { text: '旧文字', start: 1, end: 3 }, '#ff0000')).toBe(settings);
  });

  it('shifts styles with their original characters when repeated text is inserted or removed', () => {
    const settings = { ...defaultTextWatermark(), text: 'AAA', colorRanges: [{ start: 0, end: 1, color: '#ff0000' }] };
    const inserted = editWatermarkText(settings, 'AAAA', 1, null);
    expect(inserted.colorRanges).toEqual([{ start: 1, end: 2, color: '#ff0000' }]);
    const removed = editWatermarkText(inserted, 'AAA', 1, null);
    expect(removed.colorRanges).toBeUndefined();
  });

  it('removes formatting from replacement text while keeping neighboring glyphs formatted', () => {
    const settings = { ...defaultTextWatermark(), text: '甲甲甲✨', colorRanges: [{ start: 0, end: 4, color: '#ff0000' }] };
    const changed = editWatermarkText(settings, '甲甲✨', 1, { text: settings.text, start: 0, end: 2 });
    expect(changed.colorRanges).toEqual([{ start: 1, end: 3, color: '#ff0000' }]);
  });
});
