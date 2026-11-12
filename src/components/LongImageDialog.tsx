import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, LoaderCircle, MoveHorizontal, MoveVertical, X } from 'lucide-react';
import type { ImageAsset, Project } from '../core/types';
import { createLongImageProject, LONG_IMAGE_MAX_PHOTOS, planLongImageLayout, type LongImageDirection, type LongImagePlan } from '../core/longImage';
import { native, importBrowserFiles, importPaths, selectPhotos } from '../platform/desktop';
import { useAssetImage } from '../images/cache';
import { Thumbnail } from './Thumbnail';
import { Modal } from './Modal';
import './LongImageDialog.css';

function LongPhoto({ asset }: { asset: ImageAsset }) {
  const { image, error } = useAssetImage(asset, 256);
  return image ? <img src={image.src} alt={asset.fileName} draggable={false} /> : <span>{error ? '不可用' : '载入中'}</span>;
}

type LongImageResult = { kind: 'ready'; plan: LongImagePlan; project: Project } | { kind: 'error'; error: string } | null;

export function LongImageDialog({ onClose, onCreate }: { onClose(): void; onCreate(project: Project): Promise<void> }) {
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [direction, setDirection] = useState<LongImageDirection>('vertical');
  const [name, setName] = useState('我的长图');
  const [crossSize, setCrossSize] = useState('');
  const [gap, setGap] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const options = { direction, name, gap, ...(crossSize ? { crossSize: Number(crossSize) } : {}) };
  const result = useMemo<LongImageResult>(() => {
    if (assets.length < 2) return null;
    try { return { kind: 'ready', plan: planLongImageLayout(assets, options), project: createLongImageProject(assets, options) }; }
    catch (value) { return { kind: 'error', error: value instanceof Error ? value.message : String(value) }; }
  }, [assets, direction, name, gap, crossSize]);
  const canCreate = result?.kind === 'ready' && !loading;
  const importSelection = async (operation: () => ReturnType<typeof importPaths>) => {
    setLoading(true); setError('');
    try {
      const imported = await operation();
      if (assets.length + imported.assets.length > LONG_IMAGE_MAX_PHOTOS) throw new Error(`一张长图最多拼接 ${LONG_IMAGE_MAX_PHOTOS} 张照片，请减少所选数量。`);
      setAssets(previous => [...previous, ...imported.assets]);
      if (imported.errors.length) setError(imported.errors.join('；'));
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  };
  const choose = async () => {
    if (!native) { files.current?.click(); return; }
    try { const paths = await selectPhotos(); if (paths?.length) await importSelection(() => importPaths(paths)); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
  };
  const move = (index: number, offset: number) => setAssets(previous => {
    const next = [...previous]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next;
  });
  const create = async () => {
    if (result?.kind !== 'ready' || loading) return;
    setLoading(true); setError('');
    try { await onCreate(result.project); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); setLoading(false); }
  };
  return <Modal title="长图拼接" className="long-image-dialog" onClose={() => { if (!loading) onClose(); }}>
    <div className="modal-body long-image-body">
      <p className="modal-intro">选照片、排顺序，生成一张可以继续自由编辑的长图。</p>
      <div className="long-image-settings">
        <label className="form-label">作品名称<input aria-label="长图名称" value={name} maxLength={200} disabled={loading} onChange={e => setName(e.target.value)} /></label>
        <div className="long-direction" role="group" aria-label="拼接方向"><button aria-pressed={direction === 'vertical'} disabled={loading} onClick={() => { setDirection('vertical'); setCrossSize(''); }}><MoveVertical size={15} />竖向拼接</button><button aria-pressed={direction === 'horizontal'} disabled={loading} onClick={() => { setDirection('horizontal'); setCrossSize(''); }}><MoveHorizontal size={15} />横向拼接</button></div>
        <div className="long-size-settings"><label className="form-label">{direction === 'vertical' ? '统一宽度' : '统一高度'} · px<input aria-label={direction === 'vertical' ? '长图统一宽度' : '长图统一高度'} type="number" min="1" max="100000" placeholder={assets[0] ? String(direction === 'vertical' ? assets[0].width : assets[0].height) : '参考第一张照片'} value={crossSize} disabled={loading} onChange={e => setCrossSize(e.target.value)} /></label><label className="form-label">图片间距 · px<input aria-label="长图图片间距" type="number" min="0" max="32768" value={gap} disabled={loading} onChange={e => setGap(Number(e.target.value))} /></label></div>
      </div>
      <div className="long-image-content">
        <section className="long-photo-selection"><div className="long-photo-heading"><span>照片顺序 · {assets.length} / {LONG_IMAGE_MAX_PHOTOS}</span><button className="quiet-button" disabled={loading || assets.length >= LONG_IMAGE_MAX_PHOTOS} onClick={() => void choose()}><ImagePlus size={13} />{assets.length ? '添加照片' : '选择照片'}</button></div>
          {assets.length ? <ol className="long-photo-list">{assets.map((asset, index) => <li key={`${asset.id}-${index}`}><span className="long-photo-number">{String(index + 1).padStart(2, '0')}</span><div className="long-photo-thumb"><LongPhoto asset={asset} /></div><span className="long-photo-name" title={asset.fileName}>{asset.fileName}<small>{asset.width} × {asset.height}</small></span><div className="long-photo-order"><button aria-label={`将第 ${index + 1} 张照片前移`} title="前移" disabled={loading || index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></button><button aria-label={`将第 ${index + 1} 张照片后移`} title="后移" disabled={loading || index === assets.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></button><button aria-label={`移除第 ${index + 1} 张照片`} title="移除" disabled={loading} onClick={() => setAssets(previous => previous.filter((_, at) => at !== index))}><X size={12} /></button></div></li>)}</ol> : <button className="long-photo-empty" disabled={loading} onClick={() => void choose()}><ImagePlus size={28} /><span>选择 2～64 张照片</span><small>支持 JPG、PNG，可调整拼接顺序</small></button>}
        </section>
        <section className="long-image-preview" aria-label="长图预览">{result?.kind === 'ready' ? <><div className={`long-preview-scroll ${direction}`}><Thumbnail project={result.project} page={result.project.pages[0]} /></div><p>{result.plan.document.width} × {result.plan.document.height} px</p>{result.plan.scale < 1 && <small>尺寸较长，已整体等比缩小至安全输出尺寸。</small>}</> : <div className="long-preview-empty"><MoveVertical size={26} /><p>按原图比例自动排列</p><small>选择两张照片后显示预览</small></div>}</section>
      </div>
      <p className="form-note">生成后：单击调照片大小与旋转；双击黄色框移动或裁切；右键调整上下层。Command Z 可撤销。</p>
      {(error || result?.kind === 'error') && <p className="form-error" role="alert">{error || (result?.kind === 'error' ? result.error : '')}</p>}
      <input ref={files} className="hidden-input" type="file" accept=".jpg,.jpeg,.png" multiple onChange={event => { const chosen = Array.from(event.target.files ?? []); event.target.value = ''; if (chosen.length) void importSelection(() => importBrowserFiles(chosen)); }} />
    </div>
    <footer><button className="quiet-button" disabled={loading} onClick={onClose}>取消</button><button className="primary-button" disabled={!canCreate} onClick={() => void create()}>{loading ? <LoaderCircle size={14} className="spin" /> : null}{loading ? '正在准备…' : '生成并开始编辑'}</button></footer>
  </Modal>;
}
