import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { normalizedColor } from '../core/backgroundColor';
import { WATERMARK_ANCHORS } from '../core/watermarkPlacement';
import {
  colorWatermarkSelection, editWatermarkText, positionWatermarkLayer, validWatermarkTextSelection,
  DEFAULT_WATERMARK_BACKGROUND, DEFAULT_WATERMARK_SHADOW, DEFAULT_WATERMARK_STROKE, WATERMARK_EFFECT_MAX_PIXELS,
  WATERMARK_MAX_POSITION, WATERMARK_STROKE_MAX_WIDTH, WATERMARK_TEXT_MAX_LENGTH,
  type LayerPlacement, type TextWatermark, type WatermarkPositionMode, type WatermarkTextSelection,
} from '../core/watermarkSettings';
import type { ImageAsset, Rect } from '../core/types';
import './WatermarkTextStyles.css';

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange(value: number): void;
}

function NumberField({ label, value, min, max, step = 1, unit, onChange }: NumberFieldProps) {
  const [editing, setEditing] = useState<string | null>(null);
  return <label className="wm-field"><span>{label}</span><span className="wm-number">
    <input type="number" value={editing ?? Number(value.toFixed(2))} min={min} max={max} step={step}
      onChange={event => {
        setEditing(event.target.value);
        const next = event.target.valueAsNumber;
        if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
      }}
      onBlur={event => {
        const next = event.target.valueAsNumber;
        if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        setEditing(null);
      }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    {unit && <span aria-hidden="true">{unit}</span>}
  </span></label>;
}

interface PositionProps {
  placement: LayerPlacement;
  photo?: ImageAsset;
  rect?: Rect;
  onChange(value: LayerPlacement): void;
}

function PositionControls({ placement, photo, rect, onChange }: PositionProps) {
  const mode = placement.positionMode ?? 'relative';
  const relative = mode === 'relative';
  const changeMode = (positionMode: WatermarkPositionMode) => {
    const next = { ...placement, positionMode };
    onChange(photo && rect ? positionWatermarkLayer(photo, rect, next) : {
      ...next, x: positionMode === 'relative' ? 0.95 : 0, y: positionMode === 'relative' ? 0.95 : 0,
    });
  };
  const setAnchor = (x: number, y: number) => {
    if (mode === 'margins') onChange({ ...placement, anchorX: x, anchorY: y, x: 0, y: 0 });
    else if (relative) onChange({ ...placement, x, y });
    else if (photo && rect) onChange(positionWatermarkLayer(photo, { ...rect, x: (photo.width - rect.width) * x, y: (photo.height - rect.height) * y }, placement));
  };
  const max = relative ? 100 : WATERMARK_MAX_POSITION, unit = relative ? '%' : 'px', multiplier = relative ? 100 : 1;
  return <section className="wm-control-group" aria-label="水印位置">
    <label className="wm-field"><span>定位方式</span><select value={mode} onChange={event => changeMode(event.target.value as WatermarkPositionMode)}>
      <option value="relative">按照片比例</option><option value="pixels">固定像素</option><option value="margins">指定边距</option>
    </select></label>
    <div className="wm-fields-pair">
      <NumberField label={mode === 'margins' ? '水平边距' : '水平位置'} value={placement.x * multiplier} min={0} max={max} step={relative ? 0.1 : 1} unit={unit} onChange={x => onChange({ ...placement, x: x / multiplier })} />
      <NumberField label={mode === 'margins' ? '垂直边距' : '垂直位置'} value={placement.y * multiplier} min={0} max={max} step={relative ? 0.1 : 1} unit={unit} onChange={y => onChange({ ...placement, y: y / multiplier })} />
    </div>
    <div className="wm-anchor-control"><span>{mode === 'margins' ? '边距起点' : '快速对齐'}</span>
      <div className="wm-anchor-grid" role="group" aria-label={mode === 'margins' ? '边距起点' : '快速对齐'}>
        {WATERMARK_ANCHORS.map(({ name, x, y }) => {
          const selected = mode === 'margins' ? x === (placement.anchorX ?? 1) && y === (placement.anchorY ?? 1) : relative && x === placement.x && y === placement.y;
          return <button key={name} type="button" disabled={mode === 'pixels' && (!photo || !rect)} title={name} aria-label={name} aria-pressed={selected} onClick={() => setAnchor(x, y)}>
            <span style={{ left: `${22 + x * 56}%`, top: `${22 + y * 56}%` }} />
          </button>;
        })}
      </div>
    </div>
  </section>;
}

function OpacityControl({ placement, onChange }: Pick<PositionProps, 'placement' | 'onChange'>) {
  return <div className="wm-opacity">
    <NumberField label="不透明度" value={placement.opacity * 100} min={0} max={100} unit="%" onChange={opacity => onChange({ ...placement, opacity: opacity / 100 })} />
    <input type="range" aria-label="水印不透明度滑块" min={0} max={100} value={placement.opacity * 100} onChange={event => onChange({ ...placement, opacity: event.target.valueAsNumber / 100 })} />
  </div>;
}

interface ImageControlsProps extends PositionProps {
  watermark?: ImageAsset;
  sourcePath: string;
  enabled: boolean;
  onEnabled(value: boolean): void;
  onChoose(): void;
}

export function ImageWatermarkControls({ watermark, sourcePath, placement, enabled, onEnabled, onChoose, onChange, photo, rect }: ImageControlsProps) {
  const tile = placement.tile;
  const fileName = watermark?.fileName ?? sourcePath.split(/[\\/]/).at(-1);
  return <>
    <label className="wm-check"><input type="checkbox" checked={enabled} onChange={event => onEnabled(event.target.checked)} />启用图片水印</label>
    <button className="quiet-button wm-mark-source" type="button" title={sourcePath || '选择透明 PNG 水印'} onClick={onChoose}>
      <ImagePlus size={16} /><span>{fileName || '选择透明 PNG 水印…'}</span>
    </button>
    <section className="wm-control-group" aria-label="图片水印变换">
      <div className="wm-fields-pair">
        <NumberField label="短边比例" value={placement.widthRatio * 100} min={1} max={200} step={0.1} unit="%" onChange={width => onChange({ ...placement, widthRatio: width / 100 })} />
        <NumberField label="旋转角度" value={placement.rotation ?? 0} min={-180} max={180} step={0.1} unit="°" onChange={rotation => onChange({ ...placement, rotation })} />
      </div>
      <OpacityControl placement={placement} onChange={onChange} />
    </section>
    <PositionControls placement={placement} photo={photo} rect={rect} onChange={onChange} />
    <details className="wm-advanced">
      <summary>平铺设置</summary>
      <label className="wm-check"><input type="checkbox" checked={!!tile} onChange={event => onChange({ ...placement, tile: event.target.checked ? { gapX: 80, gapY: 80 } : null })} />平铺图片水印</label>
      {tile && <div className="wm-fields-pair">
        <NumberField label="横向间距" value={tile.gapX} min={0} max={WATERMARK_MAX_POSITION} unit="px" onChange={gapX => onChange({ ...placement, tile: { ...tile, gapX } })} />
        <NumberField label="纵向间距" value={tile.gapY} min={0} max={WATERMARK_MAX_POSITION} unit="px" onChange={gapY => onChange({ ...placement, tile: { ...tile, gapY } })} />
      </div>}
    </details>
  </>;
}

interface TextControlsProps extends Pick<PositionProps, 'photo' | 'rect'> {
  settings: TextWatermark;
  fonts: string[];
  fontError?: string;
  fontsLoading: boolean;
  enabled: boolean;
  onEnabled(value: boolean): void;
  onChange(value: TextWatermark): void;
}
const weightLabels = ['极细', '纤细', '细体', '常规', '中等', '半粗', '粗体', '特粗', '极粗'];

interface ColorFieldProps {
  label: string;
  value: string;
  disabled?: boolean;
  mixed?: boolean;
  onChange(color: string): void;
}

function ColorField({ label, value, disabled, mixed, onChange }: ColorFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const color = draft === null ? null : normalizedColor(draft);
    if (color && (mixed || color !== value)) onChange(color);
    setDraft(null);
  };
  return <div className="wm-field"><span>{label}</span>
    <div className="wm-color-inputs">
      <input type="color" value={value} aria-label={`${label}选择器`} title={`选择${label}`}
        disabled={disabled} onChange={event => { setDraft(null); onChange(event.target.value); }} />
      <input type="text" value={draft ?? (mixed ? '' : value.toUpperCase())} aria-label={`${label}色号`} title="输入 HEX 色号"
        placeholder={mixed ? '混合' : undefined} disabled={disabled} maxLength={7} spellCheck={false} autoComplete="off"
        onChange={event => {
          const text = event.target.value;
          setDraft(text);
          if (/^#?[\da-f]{6}$/i.test(text)) {
            const color = normalizedColor(text);
            if (color && (mixed || color !== value)) onChange(color);
          }
        }}
        onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </div>
  </div>;
}

function TextEffects({ settings, onChange }: Pick<TextControlsProps, 'settings' | 'onChange'>) {
  const { stroke, shadow, background } = settings;
  return <section className="wm-control-group wm-text-effects" aria-label="文字样式">
    <h3>文字样式</h3>
    <div>
      <label className="wm-check"><input type="checkbox" checked={!!stroke}
        onChange={event => onChange({ ...settings, stroke: event.target.checked ? { ...DEFAULT_WATERMARK_STROKE } : undefined })} />描边</label>
      {stroke && <div className="wm-fields-pair">
        <ColorField label="描边颜色" value={stroke.color} onChange={color => onChange({ ...settings, stroke: { ...stroke, color } })} />
        <NumberField label="描边宽度" value={stroke.width} min={0} max={WATERMARK_STROKE_MAX_WIDTH} step={0.5} unit="px"
          onChange={width => onChange({ ...settings, stroke: { ...stroke, width } })} />
      </div>}
    </div>
    <div>
      <label className="wm-check"><input type="checkbox" checked={!!shadow}
        onChange={event => onChange({ ...settings, shadow: event.target.checked ? { ...DEFAULT_WATERMARK_SHADOW } : undefined })} />投影</label>
      {shadow && <div className="wm-fields-pair">
        <ColorField label="投影颜色" value={shadow.color} onChange={color => onChange({ ...settings, shadow: { ...shadow, color } })} />
        <NumberField label="投影不透明度" value={shadow.opacity * 100} min={0} max={100} unit="%"
          onChange={opacity => onChange({ ...settings, shadow: { ...shadow, opacity: opacity / 100 } })} />
        <NumberField label="投影横向偏移" value={shadow.offsetX} min={-WATERMARK_EFFECT_MAX_PIXELS} max={WATERMARK_EFFECT_MAX_PIXELS} unit="px"
          onChange={offsetX => onChange({ ...settings, shadow: { ...shadow, offsetX } })} />
        <NumberField label="投影纵向偏移" value={shadow.offsetY} min={-WATERMARK_EFFECT_MAX_PIXELS} max={WATERMARK_EFFECT_MAX_PIXELS} unit="px"
          onChange={offsetY => onChange({ ...settings, shadow: { ...shadow, offsetY } })} />
        <NumberField label="投影模糊" value={shadow.blur} min={0} max={WATERMARK_EFFECT_MAX_PIXELS} unit="px"
          onChange={blur => onChange({ ...settings, shadow: { ...shadow, blur } })} />
      </div>}
    </div>
    <div>
      <label className="wm-check"><input type="checkbox" checked={!!background}
        onChange={event => onChange({ ...settings, background: event.target.checked ? { ...DEFAULT_WATERMARK_BACKGROUND } : undefined })} />文字色块</label>
      {background && <div className="wm-fields-pair">
        <ColorField label="色块颜色" value={background.color} onChange={color => onChange({ ...settings, background: { ...background, color } })} />
        <NumberField label="色块不透明度" value={background.opacity * 100} min={0} max={100} unit="%"
          onChange={opacity => onChange({ ...settings, background: { ...background, opacity: opacity / 100 } })} />
        <NumberField label="色块内边距" value={background.padding} min={0} max={WATERMARK_EFFECT_MAX_PIXELS} unit="px"
          onChange={padding => onChange({ ...settings, background: { ...background, padding } })} />
      </div>}
    </div>
  </section>;
}

export function TextWatermarkControls({ settings, fonts, fontError, fontsLoading, enabled, onEnabled, onChange, photo, rect }: TextControlsProps) {
  const [selection, setSelection] = useState<WatermarkTextSelection | null>(null);
  const selected = validWatermarkTextSelection(settings.text, selection) ? selection : null;
  const selectedColor = selected && settings.colorRanges?.find(range => range.start <= selected.start && range.end >= selected.end)?.color;
  const hasSelectedColor = selected && settings.colorRanges?.some(range => range.start < selected.end && range.end > selected.start);
  const selectedText = selected ? settings.text.slice(selected.start, selected.end).replace(/\s+/g, ' ') : '';
  const update = (patch: Partial<TextWatermark>) => onChange({ ...settings, ...patch });
  const setPlacement = (placement: LayerPlacement) => update({ placement });
  const knownFamily = !settings.fontFamily || fonts.includes(settings.fontFamily);
  const weights = Array.from({ length: 9 }, (_, index) => (index + 1) * 100);
  return <>
    <label className="wm-check"><input type="checkbox" checked={enabled} onChange={event => onEnabled(event.target.checked)} />启用文字水印</label>
    <label className="wm-field"><span>水印文字</span><textarea value={settings.text} rows={3} maxLength={WATERMARK_TEXT_MAX_LENGTH} placeholder="输入署名或版权声明"
      onSelect={event => {
        const { value: text, selectionStart: start, selectionEnd: end } = event.currentTarget;
        setSelection(start < end ? { text, start, end } : null);
      }}
      onChange={event => {
        onChange(editWatermarkText(settings, event.currentTarget.value, event.currentTarget.selectionStart, selected));
        setSelection(null);
      }} /></label>
    <div className="wm-fields-pair">
      <ColorField label="文字颜色" value={settings.color} onChange={color => update({ color })} />
      <ColorField key={selected ? `${selected.start}:${selected.end}:${selected.text}` : 'no-selection'} label="选中文字颜色"
        value={selectedColor || settings.color} disabled={!selected} mixed={!!hasSelectedColor && !selectedColor}
        onChange={color => { if (selected) onChange(colorWatermarkSelection(settings, selected, color)); }} />
    </div>
    <div className="wm-selection-color-status">
      <p className="wm-field-note" title={selectedText}>{selected ? `已选「${selectedText}」` : '在文字框中选中文字后可单独改色'}</p>
      {settings.colorRanges?.length ? <button className="quiet-button" type="button" disabled={!!selected && !hasSelectedColor}
        onClick={() => selected ? onChange(colorWatermarkSelection(settings, selected, null)) : update({ colorRanges: undefined })}>
        {selected ? '清除选区颜色' : '清除局部颜色'}
      </button> : null}
    </div>
    <label className="wm-field"><span>本机字体</span><select value={settings.fontFamily} onChange={event => update({ fontFamily: event.target.value })}>
      <option value="">系统默认</option>
      {!knownFamily && <option value={settings.fontFamily}>{settings.fontFamily}{fontsLoading ? '' : '（未找到）'}</option>}
      {fonts.map(font => <option key={font}>{font}</option>)}
    </select></label>
    {fontsLoading && <p className="wm-field-note">正在读取本机字体…</p>}
    {fontError && <p className="wm-field-note" role="status">{fontError}</p>}
    <div className="wm-fields-pair">
      <label className="wm-field"><span>粗细</span><select value={settings.fontWeight} onChange={event => update({ fontWeight: Number(event.target.value) })}>
        {!weights.includes(settings.fontWeight) && <option>{settings.fontWeight}</option>}
        {weights.map((weight, index) => <option key={weight} value={weight}>{weightLabels[index]}</option>)}
      </select></label>
      <NumberField label="字号" value={settings.fontSize} min={1} max={512} unit="px" onChange={fontSize => update({ fontSize })} />
    </div>
    <label className="wm-field"><span>文字对齐</span><select value={settings.alignment} onChange={event => update({ alignment: event.target.value as TextWatermark['alignment'] })}>
      <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
    </select></label>
    <TextEffects settings={settings} onChange={onChange} />
    <section className="wm-control-group" aria-label="文字水印变换">
      <div className="wm-fields-pair">
        <NumberField label="整体缩放" value={settings.scale * 100} min={10} max={1000} unit="%" onChange={scale => update({ scale: scale / 100 })} />
        <NumberField label="旋转角度" value={settings.placement.rotation ?? 0} min={-180} max={180} step={0.1} unit="°" onChange={rotation => setPlacement({ ...settings.placement, rotation })} />
      </div>
      <OpacityControl placement={settings.placement} onChange={setPlacement} />
    </section>
    <PositionControls placement={settings.placement} photo={photo} rect={rect} onChange={setPlacement} />
    <details className="wm-advanced">
      <summary>高级文字排版</summary>
      <div className="wm-fields-pair">
        <NumberField label="字符间距" value={settings.characterSpacing} min={-20} max={200} step={0.1} unit="px" onChange={characterSpacing => update({ characterSpacing })} />
        <NumberField label="行间距" value={settings.lineSpacing} min={0} max={500} step={0.1} unit="px" onChange={lineSpacing => update({ lineSpacing })} />
        <NumberField label="文字倾斜" value={settings.italicAngle} min={-45} max={45} step={0.1} unit="°" onChange={italicAngle => update({ italicAngle })} />
        <NumberField label="自动换行宽度" value={settings.wrapWidth} min={0} max={8192} unit="px" onChange={wrapWidth => update({ wrapWidth })} />
      </div>
      <p className="wm-field-note">换行宽度为 0 时按输入的换行符分行。</p>
    </details>
  </>;
}
