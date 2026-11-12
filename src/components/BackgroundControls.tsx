import { useState } from 'react';
import { Check, ChevronRight, ImagePlus, RotateCcw, Scan, Trash2 } from 'lucide-react';
import type { Page } from '../core/types';
import { defaultTransform } from '../core/templates';
import { readableColor } from '../core/backgroundColor';
import { RangeControl } from '../editor/PhotoAdjustmentControls';
import { BASIC_BACKGROUND_COLORS, useColorPaletteStore } from '../state/colorPaletteStore';
import { useEditorStore } from '../state/editorStore';
import { ColorPickerDialog } from './ColorPickerDialog';
import './background.css';

export function BackgroundControls({ page, onImportBackground, onError }: { page: Page; onImportBackground(pageId: string): void; onError(message: string): void }) {
  const state = useEditorStore(), palette = useColorPaletteStore();
  const [colorOpen, setColorOpen] = useState(false), [dropActive, setDropActive] = useState(false);
  const background = page.backgroundImage, asset = background ? state.project.assets[background.imageAssetId] : undefined;
  const colors = [...new Set([...BASIC_BACKGROUND_COLORS, ...palette.colors])];
  const changeColor = (color: string) => {
    try { state.commitTransaction(); state.updatePage([page.id], { background: color }); }
    catch (e) { onError(String(e)); }
  };
  return <section className="inspector-section background-controls">
    <div className="section-title">模板背景 <span>当前页面</span></div>
    <button className="background-current-color" aria-label="选择模板背景颜色" onClick={() => setColorOpen(true)}><i style={{ backgroundColor: page.background }} /><span>背景颜色</span><small>{page.background.toUpperCase()}</small><ChevronRight size={13} /></button>
    <div className="background-swatch-row">{colors.map(color => <button key={color} className={`background-swatch ${page.background.toLowerCase() === color ? 'selected' : ''}`} style={{ backgroundColor: color }} aria-label={`背景颜色 ${color}`} title={color.toUpperCase()} onClick={() => changeColor(color)}>{page.background.toLowerCase() === color && <Check size={11} color={readableColor(color)} />}</button>)}</div>
    <div className={`background-image-drop ${dropActive ? 'drop-active' : ''}`} data-background-drop={page.id}
      onDragEnter={event => { if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes('application/x-frame-asset')) { event.preventDefault(); setDropActive(true); } }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes('application/x-frame-asset')) event.preventDefault(); }}
      onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropActive(false); }}
      onDrop={() => setDropActive(false)}>
      <button onClick={() => onImportBackground(page.id)} aria-label={background ? '替换模板背景图片' : '选择模板背景图片'}><ImagePlus size={16} /><span>{background ? '替换背景图片' : '拖入图片作为背景'}</span></button>
      <small>{asset?.fileName ?? '也可点击选择图片'}</small>
    </div>
    {background && <div className="background-photo-settings">
      <RangeControl label="背景图片不透明度" value={Math.round(background.opacity * 100)} min={0} max={100} unit="%" onChange={value => state.updateBackgroundImage(page.id, { opacity: value / 100 })} />
      <div className="background-photo-actions"><button className={state.backgroundEditing ? 'selected' : ''} aria-pressed={state.backgroundEditing} onClick={() => state.setBackgroundEditing(!state.backgroundEditing)}><Scan size={13} />{state.backgroundEditing ? '完成背景' : '编辑背景'}</button><button title="还原背景的位置、缩放与旋转，保留不透明度" onClick={() => { state.commitTransaction(); state.updateBackgroundImage(page.id, { transform: defaultTransform() }); }}><RotateCcw size={13} />还原</button><button title="移除背景图片，保留背景颜色" aria-label="移除背景图片" onClick={() => state.setBackgroundImage(page.id, null)}><Trash2 size={13} /></button></div>
      {state.backgroundEditing && <p className="inspector-note">直接拖背景调整位置，拖四个角点缩放。</p>}
    </div>}
    {colorOpen && <ColorPickerDialog pageId={page.id} onClose={() => setColorOpen(false)} />}
  </section>;
}
