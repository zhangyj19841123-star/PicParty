import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LayoutTemplate, Images, ArrowDownToLine, Check, Save, Plus, Trash2, RotateCcw, ChevronDown } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { DESIGNED_TEMPLATE_IDS, TEMPLATE_LIST } from '../core/templates';
import { TemplateIcon } from './TemplateIcon';
import { useAssetImage } from '../images/cache';
import type { ImageAsset, TemplateDefinition } from '../core/types';
import { useTemplateLibraryStore } from '../state/templateLibraryStore';
import { getPersonalTemplates } from '../core/personalTemplates';
import { Modal } from './Modal';
import { native } from '../platform/desktop';
import { startAssetPointerDrag } from '../editor/assetDrag';
import '../editor/assetDrag.css';

function AssetTile({ asset }: { asset: ImageAsset }) {
  const element = useRef<HTMLButtonElement>(null), [visible, setVisible] = useState(false);
  const cancelDrag = useRef<(() => void) | null>(null), suppressClick = useRef(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: '120px' });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const s = useEditorStore(), { image, error } = useAssetImage(visible ? asset : undefined, 512);
  useEffect(() => () => { cancelDrag.current?.(); cancelDrag.current = null; }, [s.project.id]);
  const used = s.project.pages.some(page => page.frames.some(frame => frame.imageAssetId === asset.id));
  return <button ref={element} className="asset-tile" title={`${asset.fileName} · ${asset.width} × ${asset.height}\n点击放入选中的照片框，拖到照片框或背景区`} draggable={!native}
    onPointerDown={event => {
      cancelDrag.current?.(); suppressClick.current = false;
      if (!native) return;
      const projectId = useEditorStore.getState().project.id;
      cancelDrag.current = startAssetPointerDrag(event.nativeEvent, event.currentTarget, {
        assetId: asset.id, projectId, label: asset.fileName, thumbnailUrl: image?.src,
        isValid: () => { const current = useEditorStore.getState(); return current.project.id === projectId && Object.hasOwn(current.project.assets, asset.id) && !document.querySelector('[role="dialog"]'); },
        suppressClick: () => { suppressClick.current = true; },
      });
    }}
    onDragStart={event => {
      if (native) { event.preventDefault(); return; }
      suppressClick.current = true;
      event.dataTransfer.setData('application/x-frame-asset', asset.id); event.dataTransfer.effectAllowed = 'copy';
    }}
    onDragEnd={() => { suppressClick.current = true; }}
    onKeyDown={event => { if (event.key === 'Enter' || event.code === 'Space') suppressClick.current = false; }}
    onClick={event => {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); return; }
      if (document.querySelector('[role="dialog"]')) return;
      const current = useEditorStore.getState();
      if (current.project.id !== s.project.id || !Object.hasOwn(current.project.assets, asset.id)) return;
      if (current.selectedFrame) current.replaceFrame(current.selectedFrame, asset.id); else current.assignAssets([asset]);
    }}>
    {image ? <img src={image.src} alt={asset.fileName} draggable={false} /> : <span>{error ? '不可用' : '载入中'}</span>}{used && <i><Check size={9} /></i>}<small>{asset.fileName}</small>
  </button>;
}

export function Sidebar({ onImport, onSaveTemplate, onNotify, revealTemplateLibrary = 0 }: { onImport(): void; onSaveTemplate(): void; onNotify(message: string): void; revealTemplateLibrary?: number }) {
  const s = useEditorStore();
  const library = useTemplateLibraryStore();
  const [tab, setTab] = useState<'templates' | 'assets'>('templates');
  const [category, setCategory] = useState('全部');
  const [bulk, setBulk] = useState(false);
  const [source, setSource] = useState<'basic' | 'mine'>('basic');
  const [pendingDelete, setPendingDelete] = useState<TemplateDefinition | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const previousCount = useRef(library.templates.length);
  useEffect(() => { if (revealTemplateLibrary > 0) { setTab('templates'); setSource('mine'); } }, [revealTemplateLibrary]);
  useEffect(() => { if (library.templates.length > previousCount.current) { setTab('templates'); setSource('mine'); } previousCount.current = library.templates.length; }, [library.templates.length]);
  const page = s.project.pages.find(page => page.id === s.activePageId)!;
  const freeLayout = Boolean(page.frameRects) || s.project.templates[page.templateId]?.root.kind === 'free';
  const personal = getPersonalTemplates(s.project.templates, library.templates, library.removedTemplates);
  const templates = source === 'mine' ? personal : TEMPLATE_LIST.filter(template => category === '全部' || (category === '设计' ? DESIGNED_TEMPLATE_IDS.has(template.id) : template.category === category));
  return <aside className="sidebar">
    <div className="sidebar-tabs"><button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}><LayoutTemplate size={15} />页内模板</button><button className={tab === 'assets' ? 'active' : ''} onClick={() => setTab('assets')}><Images size={15} />照片</button></div>
    {tab === 'templates' ? <>
      <div className="sidebar-heading"><h2>从一个好布局开始</h2><p>调整分栏或照片框，保存你的布局。</p></div>
      <div className="template-layout-actions"><button onClick={() => { s.commitTransaction(); onSaveTemplate(); }}><Save size={13} />保存为新模板</button>{s.frameEditing && <button onClick={() => s.addFreeFrame()} disabled={page.frames.length >= 64}><Plus size={13} />添加照片框</button>}</div>
      <div className="template-source-tabs"><button className={source === 'basic' ? 'active' : ''} onClick={() => setSource('basic')}>基础模板</button><button className={source === 'mine' ? 'active' : ''} onClick={() => setSource('mine')}>我的模板{personal.length > 0 && <span>{personal.length}</span>}</button></div>
      {source === 'basic' && <div className="category-tabs">{['全部', '2 张', '3 张', '4 张', '设计'].map(value => <button key={value} className={category === value ? 'active' : ''} onClick={() => setCategory(value)}>{value}</button>)}</div>}
      {s.selectedPageIds.length > 1 && <label className="batch-toggle"><input type="checkbox" checked={bulk} onChange={e => setBulk(e.target.checked)} />应用到所选 {s.selectedPageIds.length} 页</label>}
      <div className="template-scroll"><div className="template-grid">{templates.map(template => {
        const selected = page.templateId === template.id && !page.frameRects;
        return <div className="template-item" key={template.id}><button className={`template-card ${selected ? 'selected' : ''}`} title={`应用${template.name}模板`} aria-pressed={selected} onClick={() => s.applyTemplate(bulk && s.selectedPageIds.length > 1 ? s.selectedPageIds : [s.activePageId], template.id)}>
          <div className="template-preview" style={{ background: selected ? '#fff' : '#fafbfb', borderColor: selected ? '#a4abb0' : '#e1e5e7', boxShadow: selected ? '0 0 0 1px #737c8414' : 'none' }}><TemplateIcon template={template} selected={selected} /></div>
          <span style={{ color: selected ? '#464f56' : '#747e85' }}>{template.name}</span>{selected && <i><Check size={10} /></i>}
        </button>{source === 'mine' && <button className="template-delete" aria-label={`删除模板「${template.name}」`} title={`删除模板「${template.name}」`} onClick={() => { setDeleteError(''); setPendingDelete(template); }}><Trash2 size={11} />删除</button>}</div>;
      })}</div>{source === 'mine' && templates.length === 0 && <div className="my-templates-empty"><LayoutTemplate size={24} /><p>还没有保存的模板</p><small>调整布局后，点击<br />「保存为新模板」。</small></div>}
      {source === 'mine' && library.removedTemplates.length > 0 && <section className="deleted-templates"><button className="deleted-templates-toggle" aria-expanded={showDeleted} onClick={() => setShowDeleted(!showDeleted)}><Trash2 size={12} />已删除 · {library.removedTemplates.length}<ChevronDown size={12} className={showDeleted ? 'expanded' : ''} /></button>{showDeleted && <div className="deleted-templates-list">{library.removedTemplates.map(template => <div key={template.id}><span title={template.name}>{template.name}</span><button aria-label={`恢复模板「${template.name}」`} onClick={() => { try { library.restore(template.id); onNotify(`已恢复模板「${template.name}」`); } catch (error) { onNotify(error instanceof Error ? error.message : String(error)); } }}><RotateCcw size={11} />恢复</button></div>)}</div>}</section>}
      </div>
      <div className="sidebar-tip"><span className="tip-mark">↔</span><p>{s.frameEditing ? <>拖动照片框移动位置。<br />拖四角或边点调整宽高，<br />点击框外完成，可保存模板。</> : <>{freeLayout ? '双击照片框，自由调整布局。' : '拖分割线调整分栏。'}<br />双击框内进入黄色框编辑，<br />自由调整框的位置和大小。</>}</p></div>
    </> : <>
      <div className="sidebar-heading"><h2>项目照片 <span>{Object.keys(s.project.assets).length}</span></h2><p>点击照片，放入选中的照片框。</p></div>
      <button className="import-wide" onClick={onImport}><ImagePlus size={16} />导入照片</button>
      <div className="asset-scroll">{Object.keys(s.project.assets).length ? <div className="asset-grid">{Object.values(s.project.assets).map(asset => <AssetTile key={asset.id + asset.fingerprint} asset={asset} />)}</div> : <div className="asset-empty"><ArrowDownToLine size={28} /><p>把你的照片带进来</p><small>支持 JPG、PNG<br />原始照片始终保留</small></div>}</div>
    </>}
    {pendingDelete && <Modal title="删除这个模板？" className="delete-template-dialog" onClose={() => setPendingDelete(null)}><div className="modal-body"><div className="delete-template-preview"><TemplateIcon template={pendingDelete} /><strong>{pendingDelete.name}</strong></div><p>从「我的模板」移除，已使用这个布局的页面和照片会保留。</p><p className="form-note">误删后，可以在「已删除」中恢复。</p>{deleteError && <p className="form-error" role="alert">{deleteError}</p>}</div><footer><button className="quiet-button" onClick={() => setPendingDelete(null)}>取消</button><button className="primary-button" onClick={() => { try { library.remove(pendingDelete.id, pendingDelete); onNotify(`已删除模板「${pendingDelete.name}」，可在「已删除」中恢复。`); setPendingDelete(null); } catch (error) { setDeleteError(error instanceof Error ? error.message : String(error)); } }}>删除模板</button></footer></Modal>}
  </aside>;
}
