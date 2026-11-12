import { useEffect, useState } from 'react';
import { Download, FolderOpen, CheckCircle2, LoaderCircle, XCircle } from 'lucide-react';
import { Modal } from './Modal';
import { useEditorStore } from '../state/editorStore';
import { cancelExport, chooseExportDirectory, getExportProgress, native, onExportProgress, startExport } from '../platform/desktop';
import { syncCurrentAssets } from '../images/syncAssets';
import type { CollageExportSettings, ExportProgress } from '../core/types';
import { PageExportSelection } from './PageExportSelection';
import { exportPageIds, type ExportScope } from './exportSelection';
export function ExportDialog({ onClose }: { onClose(): void }) {
  const s = useEditorStore();
  const [settings, setSettings] = useState<CollageExportSettings>(() => s.outputSettings.export ?? {
    scope: s.selectedPageIds.length === s.project.pages.length ? 'all' : 'selected',
    format: 'jpg',
    quality: 100,
  });
  const { scope, format, quality } = settings;
  const updateSettings = (patch: Partial<CollageExportSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    s.updateOutputSettings({ export: next });
  };
  const setScope = (scope: ExportScope) => updateSettings({ scope });
  const setFormat = (format: CollageExportSettings['format']) => updateSettings({ format });
  const setQuality = (quality: number) => updateSettings({ quality });
  const [directory, setDirectory] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const ids = exportPageIds(s.project, scope, s.activePageId, s.selectedPageIds);
  const hasMultiplePages = s.project.pages.length > 1;
  useEffect(() => { let cleanup: (() => void) | undefined, cancelled = false; onExportProgress(value => { setProgress(value); if (value.state !== 'running' && value.state !== 'cancelling') setBusy(false); }).then(fn => { if (cancelled) fn(); else cleanup = fn; }); return () => { cancelled = true; cleanup?.(); }; }, []);
  const run = async () => {
    setError('');
    // Freeze the requested project and pages before asynchronous file selection
    // or source synchronisation, so navigation cannot change the export target.
    const snapshot = useEditorStore.getState(), projectId = snapshot.project.id;
    const requestedIds = exportPageIds(snapshot.project, scope, snapshot.activePageId, snapshot.selectedPageIds);
    if (!requestedIds.length) { setError(snapshot.project.pages.length ? '请至少勾选一页，或选择导出全部页面。' : '项目还没有页面，请先新增页面。'); return; }
    if (!native) { setError('原图导出需要在 macOS 桌面应用中进行。浏览器预览不会用低清代理图代替原图导出。'); return; }
    setBusy(true); setProgress(null);
    try {
      const folder = directory || await chooseExportDirectory(); if (!folder) { setBusy(false); return; }
      setDirectory(folder);
      await syncCurrentAssets();
      const current = useEditorStore.getState();
      if (current.project.id !== projectId) throw new Error('项目已切换，请重新开始导出。');
      const latestProject = current.project;
      if (requestedIds.some(id => !latestProject.pages.some(page => page.id === id))) throw new Error('待导出的页面已删除，请重新选择。');
      const jobId = await startExport(latestProject, { pageIds: requestedIds, format, quality, directory: folder, prefix: latestProject.name });
      const latest = await getExportProgress(jobId);
      setProgress(current => current?.jobId === jobId && (current.completed > latest.completed || (current.state !== 'running' && current.state !== 'cancelling')) ? current : latest);
      if (latest.state !== 'running' && latest.state !== 'cancelling') setBusy(false);
    } catch (e) { setError(String(e)); setBusy(false); }
  };
  const close = () => { if (!busy) onClose(); };
  return <Modal title="导出作品" onClose={close} className="export-modal"><div className="modal-body">
    <div className="export-summary"><div className="export-icon"><Download size={24} /></div><div><b>{s.project.name}</b><p>每页 {s.project.document.width} × {s.project.document.height} px · sRGB</p></div></div>
    <fieldset disabled={busy}>{hasMultiplePages && <><label className="form-label">导出范围</label><div className="scope-options">{([['all','全部页面',s.project.pages.length],['selected','所选页面',s.selectedPageIds.length],['current','当前页面',1]] as const).map(([value,label,count]) => <button key={value} className={scope === value ? 'selected' : ''} aria-pressed={scope === value} onClick={() => setScope(value)}><span>{label}</span><b>{count} 页</b></button>)}</div>
      <section className="export-page-selection" aria-label="选择待导出的页面">
        <div className="export-page-selection-header"><b>勾选页面</b><span>已勾选 {s.selectedPageIds.length} / {s.project.pages.length} 页</span>
          <button onClick={() => { s.setSelectedPageIds(s.project.pages.map(page => page.id)); setScope('selected'); }}>全选</button>
          <button onClick={() => { s.setSelectedPageIds([]); setScope('selected'); }}>清空</button>
        </div>
        <div className="export-page-selection-list">{s.project.pages.map((page, index) => <div className="export-page-selection-row" key={page.id}>
          <PageExportSelection pageId={page.id} disabled={busy} onSelectionChange={() => setScope('selected')} />
          <span>{String(index + 1).padStart(2, '0')} · {page.name}</span>{page.id === s.activePageId && <small>当前</small>}
        </div>)}</div>
      </section>
      {scope === 'selected' && !ids.length && <p className="export-empty-selection" role="status">还未勾选页面。请在列表或同屏页头勾选要导出的页面。</p>}
      </>}
      {!s.project.pages.length && <p className="export-empty-selection" role="status">项目还没有页面，请先新增页面。</p>}
      <div className="export-format-row"><label className="form-label">文件格式<select value={format} onChange={e => setFormat(e.target.value as 'jpg'|'png')}><option value="jpg">JPG · 摄影分享</option><option value="png">PNG · 无损编码</option></select></label><label className="form-label">图像质量<select disabled={format === 'png'} value={quality} onChange={e => setQuality(+e.target.value)}>{[100,95,90,80].map(n => <option key={n} value={n}>{n}{n === 100 ? ' · 最高' : ''}</option>)}</select></label></div>
      <label className="form-label">保存位置<button className="directory-button" onClick={async () => { if (!native) { setError('请在桌面应用中选择导出位置。'); return; } const path = await chooseExportDirectory(); if (path) setDirectory(path); }}><FolderOpen size={16} /><span>{directory || '选择导出文件夹…'}</span></button></label>
    </fieldset>
    {progress && <div className={`export-progress ${progress.state}`}><div>{busy ? <LoaderCircle className="spin" size={17} /> : progress.state === 'completed' ? <CheckCircle2 size={17} /> : <XCircle size={17} />}<b>{progress.state === 'completed' ? '导出完成' : progress.state === 'cancelled' ? '导出已取消' : progress.state === 'failed' ? '导出未完成' : progress.state === 'cancelling' ? '正在取消…' : `正在导出 ${progress.completed} / ${progress.total}`}</b><span>{progress.completed} / {progress.total}</span></div><progress max={progress.total || 1} value={progress.completed} /><p>{progress.pageName}</p>{progress.errors.length > 0 && <div className="export-errors">{progress.errors.map((text,i) => <p key={i}>{text}</p>)}</div>}{progress.paths.length > 0 && <small>已保存 {progress.paths.length} 个文件</small>}</div>}
    {error && <p className="form-error">{error}</p>}<p className="form-note">从原始照片重新渲染。相同文件名自动区分，原图不会被修改。</p>
  </div><footer>{busy ? <button className="quiet-button" disabled={!progress || progress.state === 'cancelling'} onClick={async () => { if (progress) { setProgress({ ...progress, state: 'cancelling' }); await cancelExport(progress.jobId); } }}>取消导出</button> : <button className="quiet-button" onClick={close}>{progress ? '关闭' : '取消'}</button>}<button className="primary-button" disabled={busy || !ids.length} onClick={run}><Download size={15} />{busy ? '导出中…' : progress?.state === 'completed' ? '再次导出' : `导出 ${ids.length} 页`}</button></footer></Modal>;
}
