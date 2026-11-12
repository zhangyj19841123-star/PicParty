import { useEffect, useRef, useState } from 'react';
import { Check, Pipette, Plus, X } from 'lucide-react';
import { Modal } from './Modal';
import { hexToRGB, normalizedColor, readableColor, rgbToHex, type RGBColor } from '../core/backgroundColor';
import { BASIC_BACKGROUND_COLORS, useColorPaletteStore } from '../state/colorPaletteStore';
import { useEditorStore } from '../state/editorStore';
import { native, sampleScreenColor } from '../platform/desktop';

type RGBDraft = Record<keyof RGBColor, string>;
type EyeDropperConstructor = new () => { open(): Promise<{ sRGBHex: string }> };
const rgbDraft = (color: string): RGBDraft => {
  const rgb = hexToRGB(color) ?? { r: 255, g: 255, b: 255 };
  return { r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) };
};
const parseRGB = (draft: RGBDraft) => {
  if (Object.values(draft).some(value => !/^\d{1,3}$/.test(value))) return null;
  return rgbToHex({ r: Number(draft.r), g: Number(draft.g), b: Number(draft.b) });
};

/** Live preview belongs to one transaction: cancelling restores the old page. */
export function ColorPickerDialog({ pageId, onClose }: { pageId: string; onClose(): void }) {
  const current = useEditorStore.getState(), projectId = useRef(current.project.id);
  const initial = normalizedColor(current.project.pages.find(page => page.id === pageId)?.background ?? '#ffffff') ?? '#ffffff';
  const [color, setColor] = useState(initial), [hex, setHex] = useState(initial);
  const [rgb, setRGB] = useState<RGBDraft>(() => rgbDraft(initial)), [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const palette = useColorPaletteStore(), nativePicker = useRef<HTMLInputElement>(null);
  const owned = useRef<ReturnType<typeof useEditorStore.getState>['transaction']>(null);
  const active = useRef(true);
  const valid = Boolean(normalizedColor(hex) && parseRGB(rgb));

  useEffect(() => {
    active.current = true;
    const state = useEditorStore.getState();
    state.commitTransaction(); state.beginTransaction('更改背景颜色');
    owned.current = useEditorStore.getState().transaction;
    return () => {
      active.current = false;
      const state = useEditorStore.getState();
      if (owned.current && state.transaction === owned.current) state.cancelTransaction();
      owned.current = null;
    };
  }, []);

  const preview = (value: string) => {
    const next = normalizedColor(value), state = useEditorStore.getState();
    if (!next || !active.current) return;
    if (state.project.id !== projectId.current || !state.project.pages.some(page => page.id === pageId) || state.transaction !== owned.current) {
      setError('当前页面已变化，请关闭后重新选择背景颜色。'); return;
    }
    setColor(next); setError(''); state.updatePage([pageId], { background: next });
  };
  const select = (value: string) => {
    const next = normalizedColor(value);
    if (!next) return;
    setHex(next); setRGB(rgbDraft(next)); preview(next);
  };
  const finish = (save: boolean) => {
    if (picking) { setError('请在屏幕选择颜色，或按 Esc 结束系统取色。'); return; }
    const state = useEditorStore.getState();
    if (save && !valid) return;
    try {
      if (save && (!owned.current || state.transaction !== owned.current || state.project.id !== projectId.current || !state.project.pages.some(page => page.id === pageId))) {
        setError('当前页面已变化，请关闭后重新选择背景颜色。'); return;
      }
      if (owned.current && state.transaction === owned.current) {
        if (save) state.commitTransaction(); else state.cancelTransaction();
      }
      owned.current = null; active.current = false; onClose();
    } catch (e) { setError(String(e)); }
  };
  const pick = async () => {
    const EyeDropper = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (!native && typeof EyeDropper !== 'function') { nativePicker.current?.click(); return; }
    setPicking(true); setError('');
    try {
      const value = native ? await sampleScreenColor() : (await new EyeDropper!().open()).sRGBHex;
      if (active.current && value) select(value);
    }
    catch (e) { if (active.current && !(e instanceof DOMException && e.name === 'AbortError')) setError('无法打开吸管，请使用系统选色。'); }
    finally { if (active.current) setPicking(false); }
  };
  const swatch = (value: string) => <button key={value} className={`background-swatch ${color === value ? 'selected' : ''}`} style={{ backgroundColor: value }} aria-label={`选择背景颜色 ${value}`} title={value.toUpperCase()} onClick={() => select(value)}>{color === value && <Check size={13} color={readableColor(value)} />}</button>;

  return <Modal title="背景颜色" className="background-color-dialog" onClose={() => finish(false)}>
    <div className="modal-body">
      <div className="background-color-preview" style={{ backgroundColor: color }}><span style={{ color: readableColor(color) }}>{color.toUpperCase()}</span></div>
      <div className="background-rgb-fields">{(['r', 'g', 'b'] as const).map(channel => <label key={channel}><span>{channel.toUpperCase()}</span><input aria-label={`背景颜色 ${channel.toUpperCase()}`} inputMode="numeric" type="text" maxLength={3} value={rgb[channel]} onChange={event => {
        const draft = { ...rgb, [channel]: event.target.value }; setRGB(draft);
        const next = parseRGB(draft); if (next) { setHex(next); preview(next); }
      }} /></label>)}</div>
      <label className="background-hex-field"><span>HEX</span><input aria-label="背景 HEX 颜色" type="text" maxLength={7} value={hex} onChange={event => {
        setHex(event.target.value); const next = normalizedColor(event.target.value);
        if (next) { setRGB(rgbDraft(next)); preview(next); }
      }} onBlur={() => { if (valid) setHex(color); }} /></label>
      {!valid && <p className="background-input-note">RGB 为 0–255 的整数，HEX 例如 #FFFFFF。</p>}
      <div className="background-picker-actions">
        <button className="quiet-button" onClick={() => nativePicker.current?.click()}>系统选色</button>
        <button className="quiet-button" disabled={picking} onClick={() => void pick()} title={native || 'EyeDropper' in window ? '从屏幕取色' : '打开系统颜色面板，使用面板中的吸管'}><Pipette size={14} />{picking ? '正在取色…' : '吸管取色'}</button>
        <input ref={nativePicker} className="background-native-color" tabIndex={-1} type="color" aria-label="系统背景颜色选择器" value={color} onChange={event => select(event.target.value)} />
      </div>
      <div className="background-palette-heading">基础颜色</div><div className="background-swatch-row">{BASIC_BACKGROUND_COLORS.map(swatch)}</div>
      <div className="background-palette-heading"><span>我的颜色</span><button className="text-button" disabled={!valid || palette.colors.includes(color)} onClick={() => { try { palette.save(color); setError(''); } catch (e) { setError(String(e)); } }}>{palette.colors.includes(color) ? <><Check size={12} />已保存</> : <><Plus size={12} />保存颜色</>}</button></div>
      {palette.colors.length ? <div className="background-saved-colors">{palette.colors.map(value => <div key={value}>{swatch(value)}<button className="background-remove-color" aria-label={`移除保存的颜色 ${value}`} title="移除常用颜色" onClick={() => { try { palette.remove(value); setError(''); } catch (e) { setError(String(e)); } }}><X size={10} /></button></div>)}</div> : <p className="background-palette-empty">保存后，下次可在右侧快速使用。</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
    <footer><button className="quiet-button" onClick={() => finish(false)}>取消</button><button className="primary-button" disabled={!valid || picking} onClick={() => finish(true)}><Check size={14} />使用颜色</button></footer>
  </Modal>;
}
