import { normalizeWatermarkPlacement, type WatermarkPlacement, type WatermarkRect, type WatermarkSize } from './watermarkPlacement';
import { normalizedColor } from './backgroundColor';

export type WatermarkPositionMode = 'relative' | 'pixels' | 'margins';
export interface LayerPlacement extends WatermarkPlacement {
  rotation?: number;
  positionMode?: WatermarkPositionMode;
  anchorX?: number;
  anchorY?: number;
  tile?: { gapX: number; gapY: number } | null;
}

/** Offsets match textarea and Core Text UTF-16 indices, with an exclusive end. */
export interface WatermarkTextColorRange { start: number; end: number; color: string }
export interface WatermarkTextSelection { text: string; start: number; end: number }
export interface WatermarkTextStroke { color: string; width: number }
export interface WatermarkTextShadow { color: string; opacity: number; offsetX: number; offsetY: number; blur: number }
export interface WatermarkTextBackground { color: string; opacity: number; padding: number }

export interface TextWatermark {
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  color: string;
  colorRanges?: WatermarkTextColorRange[];
  stroke?: WatermarkTextStroke;
  shadow?: WatermarkTextShadow;
  background?: WatermarkTextBackground;
  characterSpacing: number;
  lineSpacing: number;
  italicAngle: number;
  alignment: 'left' | 'center' | 'right';
  wrapWidth: number;
  scale: number;
  placement: LayerPlacement;
}

export interface WatermarkPresetSettings {
  watermarkPath: string;
  placement: LayerPlacement;
  imageEnabled?: boolean;
  textEnabled?: boolean;
  text?: TextWatermark;
}

export const WATERMARK_MAX_POSITION = 32768;
export const WATERMARK_TEXT_MAX_LENGTH = 2000;
export const WATERMARK_STROKE_MAX_WIDTH = 32;
export const WATERMARK_EFFECT_MAX_PIXELS = 64;
export const DEFAULT_WATERMARK_STROKE: WatermarkTextStroke = { color: '#000000', width: 2 };
export const DEFAULT_WATERMARK_SHADOW: WatermarkTextShadow = { color: '#000000', opacity: 0.6, offsetX: 3, offsetY: 4, blur: 6 };
export const DEFAULT_WATERMARK_BACKGROUND: WatermarkTextBackground = { color: '#000000', opacity: 0.35, padding: 8 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const bounded = (value: unknown, fallback: number, min: number, max: number) => (
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback
);
const object = (value: unknown): Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const colorValue = (value: unknown) => typeof value === 'string' ? normalizedColor(value) : null;
const cleanWatermarkText = (text: string) => text.slice(0, WATERMARK_TEXT_MAX_LENGTH)
  .replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f\uD800-\uDFFF]/gu, '');

function validTextBoundary(text: string, index: unknown): index is number {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > text.length) return false;
  const before = text.charCodeAt(index - 1), after = text.charCodeAt(index);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function normalizeColorRanges(source: string, text: string, value: unknown): WatermarkTextColorRange[] | undefined {
  if (!Array.isArray(value) || !value.length || !text.length) return undefined;
  const colors: (string | undefined)[] = new Array(text.length);
  for (const item of value.slice(0, WATERMARK_TEXT_MAX_LENGTH)) {
    const { start, end, color } = object(item), normalized = colorValue(color);
    if (!normalized || !validTextBoundary(source, start) || !validTextBoundary(source, end) || start >= end) continue;
    // Imported content may contain CRLF or control characters that are removed.
    const from = source === text ? start : cleanWatermarkText(source.slice(0, start)).length;
    const to = source === text ? end : cleanWatermarkText(source.slice(0, end)).length;
    if (validTextBoundary(text, from) && validTextBoundary(text, to)) colors.fill(normalized, from, to);
  }
  const ranges: WatermarkTextColorRange[] = [];
  for (let start = 0; start < colors.length;) {
    const color = colors[start];
    let end = start + 1;
    while (end < colors.length && colors[end] === color) end++;
    if (color) ranges.push({ start, end, color });
    start = end;
  }
  return ranges.length ? ranges : undefined;
}

export function validWatermarkTextSelection(text: string, selection: WatermarkTextSelection | null): selection is WatermarkTextSelection {
  return selection?.text === text && validTextBoundary(text, selection.start)
    && validTextBoundary(text, selection.end) && selection.start < selection.end;
}

export function colorWatermarkSelection(settings: TextWatermark, selection: WatermarkTextSelection, value: string | null): TextWatermark {
  if (!validWatermarkTextSelection(settings.text, selection)) return settings;
  const color = colorValue(value);
  if (value !== null && !color) return settings;
  const { start, end } = selection;
  const ranges: WatermarkTextColorRange[] = [];
  for (const range of settings.colorRanges ?? []) {
    if (range.start < start) ranges.push({ ...range, end: Math.min(range.end, start) });
    if (range.end > end) ranges.push({ ...range, start: Math.max(range.start, end) });
  }
  if (color) ranges.push({ start, end, color });
  return { ...settings, colorRanges: normalizeColorRanges(settings.text, settings.text, ranges) };
}

export function editWatermarkText(settings: TextWatermark, value: string, caret: number, selection: WatermarkTextSelection | null): TextWatermark {
  const previous = settings.text, text = cleanWatermarkText(value);
  if (previous === text) return settings;
  if (!settings.colorRanges?.length) return { ...settings, text };
  const nextCaret = cleanWatermarkText(value.slice(0, caret)).length;
  const previousCaret = nextCaret + previous.length - text.length;
  // The caret locates the actual edit even when identical characters repeat.
  const anchored = validTextBoundary(text, nextCaret) && validTextBoundary(previous, previousCaret)
    && previous.slice(previousCaret) === text.slice(nextCaret);
  let oldEnd = anchored ? previousCaret : previous.length;
  let newEnd = anchored ? nextCaret : text.length;
  let start = 0;
  if (anchored && validWatermarkTextSelection(previous, selection) && selection.end === oldEnd
    && selection.start <= newEnd && previous.slice(0, selection.start) === text.slice(0, selection.start)) {
    start = selection.start;
  } else {
    while (start < Math.min(oldEnd, newEnd) && previous[start] === text[start]) start++;
    if (!validTextBoundary(previous, start) || !validTextBoundary(text, start)) start--;
  }
  if (!anchored) {
    while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === text[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    if (!validTextBoundary(previous, oldEnd) || !validTextBoundary(text, newEnd)) {
      oldEnd++;
      newEnd++;
    }
  }
  const shift = newEnd - oldEnd, ranges: WatermarkTextColorRange[] = [];
  for (const range of settings.colorRanges) {
    if (range.start < start) ranges.push({ ...range, end: Math.min(range.end, start) });
    if (range.end > oldEnd) ranges.push({ ...range, start: Math.max(range.start, oldEnd) + shift, end: range.end + shift });
  }
  return { ...settings, text, colorRanges: normalizeColorRanges(text, text, ranges) };
}

export function normalizeLayerPlacement(value: unknown): LayerPlacement {
  const data = object(value);
  const placement: LayerPlacement = normalizeWatermarkPlacement(data);
  const { positionMode, rotation, anchorX, anchorY, tile } = data;
  if (positionMode === 'relative' || positionMode === 'pixels' || positionMode === 'margins') {
    placement.positionMode = positionMode;
    if (positionMode !== 'relative') {
      placement.x = bounded(data.x, 0, 0, WATERMARK_MAX_POSITION);
      placement.y = bounded(data.y, 0, 0, WATERMARK_MAX_POSITION);
    }
  }
  if (typeof rotation === 'number') placement.rotation = bounded(rotation, 0, -180, 180);
  if (typeof anchorX === 'number') placement.anchorX = bounded(anchorX, 1, 0, 1);
  if (typeof anchorY === 'number') placement.anchorY = bounded(anchorY, 1, 0, 1);
  if (tile === null) placement.tile = null;
  if (tile && typeof tile === 'object' && !Array.isArray(tile)) {
    const gaps = object(tile);
    placement.tile = { gapX: bounded(gaps.gapX, 80, 0, WATERMARK_MAX_POSITION), gapY: bounded(gaps.gapY, 80, 0, WATERMARK_MAX_POSITION) };
  }
  return placement;
}

export const defaultTextWatermark = (): TextWatermark => ({
  text: '', fontFamily: '', fontWeight: 400, fontSize: 48, color: '#ffffff',
  characterSpacing: 0, lineSpacing: 6, italicAngle: 0, alignment: 'left', wrapWidth: 0,
  scale: 1, placement: { x: 0.95, y: 0.95, widthRatio: 0.2, opacity: 0.85 },
});

export function normalizeTextWatermark(value: unknown): TextWatermark {
  const data = object(value), defaults = defaultTextWatermark();
  const source = typeof data.text === 'string' ? data.text : '';
  const text = cleanWatermarkText(source);
  const colorRanges = normalizeColorRanges(source, text, data.colorRanges);
  const stroke = object(data.stroke), strokeColor = colorValue(stroke.color);
  const shadow = object(data.shadow), shadowColor = colorValue(shadow.color);
  const background = object(data.background), backgroundColor = colorValue(background.color);
  return {
    text,
    fontFamily: typeof data.fontFamily === 'string' && data.fontFamily.length <= 256 && !/[\u0000-\u001f\u007f]/.test(data.fontFamily) ? data.fontFamily : defaults.fontFamily,
    fontWeight: Math.round(bounded(data.fontWeight, defaults.fontWeight, 100, 900)),
    fontSize: bounded(data.fontSize, defaults.fontSize, 1, 512),
    color: colorValue(data.color) ?? defaults.color,
    ...(colorRanges && { colorRanges }),
    ...(strokeColor && { stroke: {
      color: strokeColor, width: bounded(stroke.width, DEFAULT_WATERMARK_STROKE.width, 0, WATERMARK_STROKE_MAX_WIDTH),
    } }),
    ...(shadowColor && { shadow: {
      color: shadowColor,
      opacity: bounded(shadow.opacity, DEFAULT_WATERMARK_SHADOW.opacity, 0, 1),
      offsetX: bounded(shadow.offsetX, DEFAULT_WATERMARK_SHADOW.offsetX, -WATERMARK_EFFECT_MAX_PIXELS, WATERMARK_EFFECT_MAX_PIXELS),
      offsetY: bounded(shadow.offsetY, DEFAULT_WATERMARK_SHADOW.offsetY, -WATERMARK_EFFECT_MAX_PIXELS, WATERMARK_EFFECT_MAX_PIXELS),
      blur: bounded(shadow.blur, DEFAULT_WATERMARK_SHADOW.blur, 0, WATERMARK_EFFECT_MAX_PIXELS),
    } }),
    ...(backgroundColor && { background: {
      color: backgroundColor,
      opacity: bounded(background.opacity, DEFAULT_WATERMARK_BACKGROUND.opacity, 0, 1),
      padding: bounded(background.padding, DEFAULT_WATERMARK_BACKGROUND.padding, 0, WATERMARK_EFFECT_MAX_PIXELS),
    } }),
    characterSpacing: bounded(data.characterSpacing, defaults.characterSpacing, -20, 200),
    lineSpacing: bounded(data.lineSpacing, defaults.lineSpacing, 0, 500),
    italicAngle: bounded(data.italicAngle, defaults.italicAngle, -45, 45),
    alignment: data.alignment === 'center' || data.alignment === 'right' ? data.alignment : defaults.alignment,
    wrapWidth: bounded(data.wrapWidth, defaults.wrapWidth, 0, 8192),
    scale: bounded(data.scale, defaults.scale, 0.1, 10),
    placement: { ...normalizeLayerPlacement(data.placement ?? defaults.placement), tile: null },
  };
}

export function normalizeWatermarkPreset(value: unknown): WatermarkPresetSettings {
  const data = object(value);
  const preset: WatermarkPresetSettings = {
    watermarkPath: typeof data.watermarkPath === 'string' && data.watermarkPath.length <= 32768 && !/[\u0000-\u001f\u007f]/.test(data.watermarkPath) ? data.watermarkPath : '',
    placement: normalizeLayerPlacement(data.placement),
  };
  if (typeof data.imageEnabled === 'boolean') preset.imageEnabled = data.imageEnabled;
  if (typeof data.textEnabled === 'boolean') preset.textEnabled = data.textEnabled;
  if (data.text !== null && typeof data.text === 'object' && !Array.isArray(data.text)) preset.text = normalizeTextWatermark(data.text);
  return preset;
}

export function hasWatermarkLayer(preset: WatermarkPresetSettings): boolean {
  return (preset.imageEnabled !== false && !!preset.watermarkPath)
    || (preset.textEnabled === true && !!preset.text?.text.trim());
}

/** Convert the visible left/top of a rotated layer into the selected position mode. */
export function positionWatermarkLayer(photo: WatermarkSize, rect: WatermarkRect, placement: LayerPlacement): LayerPlacement {
  const left = photo.width - rect.width, top = photo.height - rect.height;
  const preferredAnchorX = placement.anchorX ?? 1, preferredAnchorY = placement.anchorY ?? 1;
  const anchorX = placement.positionMode === 'margins' && preferredAnchorX === 0.5 && rect.x < left / 2 ? 0 : preferredAnchorX;
  const anchorY = placement.positionMode === 'margins' && preferredAnchorY === 0.5 && rect.y < top / 2 ? 0 : preferredAnchorY;
  const offset = (value: number, space: number, anchor: number) => {
    const safeSpace = Math.max(0, space);
    const position = clamp(value, 0, safeSpace);
    if (placement.positionMode === 'pixels') return Math.min(position, WATERMARK_MAX_POSITION);
    if (placement.positionMode === 'margins') {
      const distance = anchor === 1 ? safeSpace - position : anchor === 0.5 ? position - safeSpace / 2 : position;
      return clamp(distance, 0, WATERMARK_MAX_POSITION);
    }
    return safeSpace > 0 ? position / safeSpace : 0.5;
  };
  return { ...placement,
    ...(placement.positionMode === 'margins' ? { anchorX, anchorY } : {}),
    x: offset(rect.x, left, anchorX),
    y: offset(rect.y, top, anchorY),
  };
}

export function watermarkLayerRect(photo: WatermarkSize, layer: WatermarkSize, placement: LayerPlacement): WatermarkRect {
  const offset = (value: number, space: number, anchor: number) => {
    const safeSpace = Math.max(0, space);
    if (placement.positionMode === 'pixels') return clamp(value, 0, safeSpace);
    if (placement.positionMode === 'margins') {
      return clamp(anchor === 1 ? safeSpace - value : anchor === 0.5 ? safeSpace / 2 + value : value, 0, safeSpace);
    }
    return safeSpace * clamp(value, 0, 1);
  };
  return { width: layer.width, height: layer.height,
    x: offset(placement.x, photo.width - layer.width, placement.anchorX ?? 1),
    y: offset(placement.y, photo.height - layer.height, placement.anchorY ?? 1),
  };
}
