import type { ReactNode } from 'react';
import { RotateCcw, ImagePlus, Unlink, Link2, SlidersHorizontal, Minus, Plus, Scan, Save, Trash2 } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { defaultTransform } from '../core/templates';
import { RangeControl } from '../editor/PhotoAdjustmentControls';
import { geometry } from '../core/engine';
import type { FrameRef, Page } from '../core/types';
import { BackgroundControls } from './BackgroundControls';

export function Inspector({ onImport, onImportBackground, onRelink, onError, onSaveTemplate, toolPanels }: { onImport(ref?: FrameRef): void; onImportBackground(pageId: string): void; onRelink(id: string): void; onError(message: string): void; onSaveTemplate(): void; toolPanels?: ReactNode }) {
  const s = useEditorStore(), page = s.project.pages.find(p => p.id === s.activePageId)!;
  const frame = s.selectedFrame?.pageId === page.id ? page.frames.find(f => f.id === s.selectedFrame!.frameId) : undefined;
  const asset = frame?.imageAssetId ? s.project.assets[frame.imageAssetId] : undefined;
  const free = Boolean(page.frameRects) || s.project.templates[page.templateId].root.kind === 'free';
  const frameRect = frame ? geometry().layout(page, s.project.document, s.project.templates[page.templateId]).frames.find(item => item.slotId === frame.slotId)?.rect : undefined;
  const patch = (value: Partial<Page>) => {
    try { geometry().layout({ ...page, ...value }, s.project.document, s.project.templates[page.templateId]); s.updatePage([page.id], value); }
    catch { onError('间距或边距过大，请给照片框留出足够空间。'); }
  };
  const pageIndex = s.project.pages.findIndex(p => p.id === page.id);
  const pageSettings = <>
      <section className="inspector-section"><div className="section-title">画布 <span>所有页面统一尺寸</span></div><div className="dimension-card"><div><b>{s.project.document.width}</b><span>宽度 px</span></div><span className="dimension-times">×</span><div><b>{s.project.document.height}</b><span>高度 px</span></div></div><div className="canvas-meta"><span>{s.project.document.width / s.project.document.height < 1 ? '竖版' : s.project.document.width === s.project.document.height ? '方形' : '横版'}画布</span><span>sRGB</span></div></section>
      {free ? <section className="inspector-section"><div className="section-title">自由布局</div><p className="inspector-note">双击框内进入黄色框编辑，拖动框和八点调整位置与大小，点击框外完成。</p></section> : <section className="inspector-section"><div className="section-title">留白与间距</div><RangeControl label="外围边距" value={page.margin.top} max={Math.round(Math.min(s.project.document.width, s.project.document.height) * 0.2)} onChange={n => patch({ margin: { top: n, right: n, bottom: n, left: n } })} /><RangeControl label="列间距" value={page.columnGap} max={200} onChange={n => patch({ columnGap: n })} /><RangeControl label="行间距" value={page.rowGap} max={200} onChange={n => patch({ rowGap: n })} /></section>}
  </>;
  return <aside className="inspector">
    <div className="inspector-title"><SlidersHorizontal size={15} /><h2>{s.backgroundEditing ? '背景设置' : s.frameEditing ? '照片框布局' : frame ? '照片设置' : '页面设置'}</h2><span>{String(pageIndex + 1).padStart(2, '0')}</span></div>
    <div className="inspector-scroll">
      {s.frameEditing && <section className="inspector-section frame-layout-settings"><div className="section-title">自由调整 <button className="text-button" onClick={() => s.setFrameEditing(false)}>完成布局</button></div><p className="inspector-note">拖动框移动位置；拖四角或边点独立调整宽高。空框也可以调整。</p>
        <label className="frame-select-label">选中照片框<select aria-label="选中照片框" value={frame?.id ?? ''} onChange={event => s.setSelectedFrame(event.target.value ? { pageId: page.id, frameId: event.target.value } : null)}><option value="">点击画布上的框</option>{page.frames.map((item, index) => <option key={item.id} value={item.id}>照片框 {index + 1}{item.imageAssetId ? ` · ${s.project.assets[item.imageAssetId]?.fileName ?? '照片'}` : ' · 空框'}</option>)}</select></label>
        {frameRect && <p className="frame-size-readout">{Math.round(frameRect.width)} × {Math.round(frameRect.height)} px</p>}
        <div className="frame-layout-buttons"><button onClick={() => s.addFreeFrame()} disabled={page.frames.length >= 64}><Plus size={13} />添加照片框</button><button disabled={!frame || page.frames.length <= 1} onClick={() => { if (s.selectedFrame) s.removeFreeFrame(s.selectedFrame); }}><Trash2 size={13} />移除照片框</button><button onClick={onSaveTemplate}><Save size={13} />保存为新模板</button></div>
        <p className="inspector-note">移除框中的照片会保留在待排照片中。Command Z 可以撤回布局调整。</p>
      </section>}
      {!s.frameEditing && frame && <section className="inspector-section photo-settings" key={frame.id}><div className="section-title">照片 <button className="text-button" onClick={() => s.setSelectedFrame(null)}>取消选择</button></div>
        {asset ? <>
          <p className="asset-name" title={asset.originalPath}>{asset.fileName}</p>
          <p className="inspector-note">选中照片后，直接拖动调节框的角点放大或缩小；拖动照片调整位置。</p>
          <button className="wide-button" title="⌘T 或 Ctrl+T · 缩放与旋转，Enter 确认" onClick={() => s.beginPhotoTransform()}><Scan size={14} />自由变换照片 <kbd>⌘T</kbd></button>
          <div className="photo-actions">
            <button title="还原照片的位置、缩放、旋转与调色，可用 Command Z 撤回" onClick={() => { s.commitTransaction(); s.updateTransform(s.selectedFrame!, defaultTransform()); }}><RotateCcw size={14} />还原</button>
            <button title="替换照片" onClick={() => onImport(s.selectedFrame!)}><ImagePlus size={14} />替换</button>
            <button title="从此框移除照片" onClick={() => s.replaceFrame(s.selectedFrame!, null)}><Unlink size={14} />移除</button>
          </div>
          <details className="photo-source-details"><summary>原图信息</summary><p className="asset-meta">{asset.width} × {asset.height} px · 原图保留</p><button className="text-button relink-button" onClick={() => onRelink(asset.id)}><Link2 size={12} />重新链接原图</button></details>
        </> : <button className="wide-button" onClick={() => onImport(s.selectedFrame!)}><ImagePlus size={15} />为这个位置导入照片</button>}
      </section>}
      <BackgroundControls key={`${s.project.id}:${page.id}`} page={page} onImportBackground={onImportBackground} onError={onError} />
      {toolPanels}
      {frame || s.frameEditing ? <details className="inspector-details" key={`page-settings-${frame?.id ?? 'layout'}`}><summary>页面设置</summary>{pageSettings}</details> : pageSettings}
      {page.unplaced.length > 0 && <section className="inspector-section"><div className="section-title">待排照片 <span>{page.unplaced.length} 张</span></div><p className="inspector-note">这些照片已保留。增加模板槽位后可自动补回，也可以从「照片」面板重新放置。</p></section>}
      <section className="inspector-help"><div><Minus size={13} /><span>{s.frameEditing ? '拖边点，可单独调整宽或高' : frame ? 'Command Z 撤回构图调整' : '拖分割线，改变布局比例'}</span></div><div><Scan size={13} /><span>{s.frameEditing ? '保存模板，下次继续使用' : frame ? '还原可一次恢复初始构图' : '编辑照片框，自由调整布局'}</span></div></section>
    </div>
  </aside>;
}
