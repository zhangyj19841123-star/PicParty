import { useRef, useState } from 'react';
import { ArrowRight, Check, ImagePlus, LoaderCircle } from 'lucide-react';
import { Modal } from './Modal';
import { native, selectPhotos, importPaths, importBrowserFiles } from '../platform/desktop';
import { matchPhotoSize, portraitCanvasFromPhoto } from '../core/photoSize';
import type { ImageAsset } from '../core/types';
const ratios = [{ label: '2:3', name: '标准摄影竖版', w: 4000, h: 6000 }, { label: '3:4', name: '经典画幅', w: 3000, h: 4000 }, { label: '4:5', name: '社交分享', w: 3200, h: 4000 }, { label: '9:16', name: '全屏竖版', w: 2160, h: 3840 }, { label: '1:1', name: '正方形', w: 3000, h: 3000 }];
export function NewProjectDialog({ onClose, onCreate }: { onClose(): void; onCreate(options: { name: string; width: number; height: number; canvasSizing: 'first-photo' | 'fixed'; asset?: ImageAsset }): void }) {
  const [name, setName] = useState('我的摄影集');
  const [width, setWidth] = useState(4000), [height, setHeight] = useState(6000);
  const [canvasSizing, setCanvasSizing] = useState<'first-photo' | 'fixed'>('first-photo');
  const sizingRef = useRef(canvasSizing); sizingRef.current = canvasSizing;
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [photo, setPhoto] = useState<ImageAsset>();
  const file = useRef<HTMLInputElement>(null);
  const valid = Number.isInteger(width) && Number.isInteger(height) && width >= 100 && height >= 100 && width <= 16000 && height <= 16000 && width * height <= 100_000_000;
  const accept = async (operation: () => ReturnType<typeof importPaths>) => {
    setLoading(true); setError('');
    try { const { assets, errors } = await operation(); if (!assets.length) throw new Error(errors.join('；') || '无法读取照片'); const asset = assets[0]; setPhoto(asset); if (sizingRef.current === 'first-photo') { const size = portraitCanvasFromPhoto(asset.width, asset.height); setWidth(size.width); setHeight(size.height); } }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  };
  const fromPhoto = async () => {
    if (!native) { file.current?.click(); return; }
    try { const paths = await selectPhotos(); if (paths?.length) await accept(() => importPaths([paths[0]])); } catch (e) { setError(String(e)); }
  };
  const match = photo ? matchPhotoSize(photo.width, photo.height) : null;
  return <Modal title="开始一组新作品" onClose={onClose}>
    <div className="modal-body">
      <p className="modal-intro">默认参考首张照片，推算 2:3 竖版；整组页面统一尺寸。</p>
      <label className="form-label">项目名称<input value={name} onChange={e => setName(e.target.value)} placeholder="为这组作品取个名字" /></label>
      <div className="form-label">画布比例</div>
      <div className="ratio-grid">{ratios.map(r => <button key={r.label} className={Math.abs(width / height - r.w / r.h) < 0.002 ? 'selected' : ''} onClick={() => { setCanvasSizing('fixed'); setWidth(r.w); setHeight(r.h); }}><span className="ratio-symbol" style={{ aspectRatio: `${r.w}/${r.h}` }} /><b>{r.label}</b><small>{r.name}</small></button>)}</div>
      <div className="photo-size-row"><button className="quiet-button" disabled={loading} onClick={() => void fromPhoto()}>{loading ? <LoaderCircle className="spin" size={14} /> : <ImagePlus size={14} />}按照片创建</button>{photo && <span title={photo.fileName}>{photo.width} × {photo.height} · {match?.label}</span>}</div>
      <div className="resolution-mode"><button aria-pressed={canvasSizing === 'first-photo'} onClick={() => { setCanvasSizing('first-photo'); const size = photo ? portraitCanvasFromPhoto(photo.width, photo.height) : { width: 4000, height: 6000 }; setWidth(size.width); setHeight(size.height); }}>参考首张照片</button><button aria-pressed={canvasSizing === 'fixed'} onClick={() => setCanvasSizing('fixed')}>固定尺寸</button></div>
      <div className="form-label">每页输出尺寸</div>
      <div className="size-inputs"><label><input aria-label="画布宽度" type="number" min="100" max="16000" disabled={canvasSizing === 'first-photo'} value={width} onChange={e => setWidth(+e.target.value)} /><span>宽 / px</span></label><b>×</b><label><input aria-label="画布高度" type="number" min="100" max="16000" disabled={canvasSizing === 'first-photo'} value={height} onChange={e => setHeight(+e.target.value)} /><span>高 / px</span></label><button className="quiet-button" onClick={() => { setCanvasSizing('fixed'); setWidth(4000); setHeight(6000); }}>标准尺寸</button></div>
      <p className="form-note"><Check size={13} />{canvasSizing === 'first-photo' ? photo ? '已参考首张照片，所有页按此竖版尺寸导出。' : '首次导入后自动确定尺寸；目前以 4000 × 6000 预览。' : '所有页面使用此尺寸，屏幕同屏布局不影响导出。'}</p>{(!valid || error) && <p className="form-error">{error || '尺寸需为 100–16000 px，且总像素不超过 1 亿。'}</p>}
      <input ref={file} className="hidden-input" type="file" accept=".jpg,.jpeg,.png" onChange={e => { const photoFile = e.target.files?.[0]; e.target.value = ''; if (photoFile) void accept(() => importBrowserFiles([photoFile])); }} />
    </div>
    <footer><button className="quiet-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!valid || loading} onClick={() => { try { onCreate({ name: name.trim() || '未命名项目', width, height, canvasSizing, asset: photo }); } catch (e) { setError(String(e)); } }}>创建项目 <ArrowRight size={15} /></button></footer>
  </Modal>;
}
