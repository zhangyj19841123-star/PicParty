import { useEffect, useRef, useState, type RefObject } from 'react';
import { Copy, Maximize2, Plus, Trash2, ArrowRight, Rows3, Columns3 } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { Thumbnail } from './Thumbnail';
import { PageExportSelection } from './PageExportSelection';
import { PageTemplateAction } from './PageTemplateAction';
import { workspaceModeForSelection } from '../core/workspaceModes';
import type { WorkspaceBridge } from '../editor/Workspace';
import { setThumbnailDropTarget, thumbnailFrameAtPoint, thumbnailPageAtPoint } from '../editor/thumbnailDrop';

export function Overview({ onPreview, bridge, onSaveTemplate }: { onPreview(id: string): void; bridge: RefObject<WorkspaceBridge | null>; onSaveTemplate(pageId: string): void }) {
  const s = useEditorStore();
  const [onlySelected, setOnlySelected] = useState(false);
  const [thumbSize, setThumbSize] = useState(210);
  const dragged = useRef<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const pages = onlySelected ? s.project.pages.filter(page => s.selectedPageIds.includes(page.id)) : s.project.pages;
  const editMode = workspaceModeForSelection(s.selectedPageIds.length);
  useEffect(() => {
    const instance: WorkspaceBridge = { hitTest: thumbnailFrameAtPoint, pageHitTest: thumbnailPageAtPoint, setDropTarget: setThumbnailDropTarget };
    bridge.current = instance;
    return () => { if (bridge.current === instance) bridge.current = null; setThumbnailDropTarget(null); };
  }, [bridge]);
  const movePage = (targetId: string) => {
    if (!dragged.current || targetId === dragged.current) return;
    const ids = s.project.pages.map(page => page.id).filter(id => id !== dragged.current);
    ids.splice(ids.indexOf(targetId), 0, dragged.current); s.reorderPages(ids);
    dragged.current = null; setDropId(null);
  };
  return <div className="overview">
    <div className="overview-toolbar"><div><h1>项目总览 <span>{s.project.pages.length} 页</span></h1><p>拖照片到任意页的照片框，直接移动或交换。</p></div>
      <div className="overview-actions"><button className="overview-add-button" onClick={() => s.addPage(s.project.pages.find(page => page.id === s.activePageId)?.templateId)}><Plus size={14} />新增页面</button><button className={`quiet-button ${onlySelected ? 'is-active' : ''}`} onClick={() => setOnlySelected(!onlySelected)}>只看所选</button><Rows3 size={15} /><input aria-label="缩略图大小" type="range" min="90" max="320" value={thumbSize} onChange={e => setThumbSize(+e.target.value)} /><Columns3 size={15} /></div>
    </div>
    <div className="overview-scroll" style={{ '--thumb-size': `${thumbSize}px` } as React.CSSProperties}>
      <div className="overview-grid">
        {pages.map(page => { const selected = s.selectedPageIds.includes(page.id); const index = s.project.pages.findIndex(p => p.id === page.id); return <article key={page.id} className={`overview-card ${selected ? 'selected' : ''} ${dropId === page.id ? 'drop-before' : ''}`} onDragOver={e => { if (dragged.current) { e.preventDefault(); setDropId(page.id); } }} onDrop={e => { e.preventDefault(); movePage(page.id); }}>
          <button className="overview-page" aria-label={`查看第 ${index + 1} 页`} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) s.selectPage(page.id, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey }); else s.setActivePage(page.id); }} onDoubleClick={() => { s.setActivePage(page.id); s.setWorkspaceMode(1); }}>
            <Thumbnail project={s.project} page={page} interactive />
            {page.unplaced.length > 0 && <span className="unplaced-badge">{page.unplaced.length} 张待排</span>}
          </button>
          <div className="overview-caption">
            <div className="overview-page-heading"><span draggable onDragStart={e => { dragged.current = page.id; e.dataTransfer.setData('text/plain', page.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { dragged.current = null; setDropId(null); }}><b>{String(index + 1).padStart(2, '0')}</b> {page.name.replace(/^页面 \d+$/, '页面')}</span><button className="icon-button" title="快速预览" onClick={() => onPreview(page.id)}><Maximize2 size={13} /></button></div>
            <div className="overview-page-actions"><PageTemplateAction pageId={page.id} pageNumber={index + 1} onSave={onSaveTemplate} />{s.project.pages.length > 1 && <PageExportSelection pageId={page.id} />}</div>
          </div>
        </article>; })}
        {!onlySelected && <button className="overview-add" onClick={() => s.addPage()} style={{ aspectRatio: `${s.project.document.width}/${s.project.document.height}` }}><Plus size={25} /><span>新增页面</span></button>}
      </div>
    </div>
    <div className="overview-selection"><span><b>{s.selectedPageIds.length}</b> 页已选</span><div className="divider" /><button disabled={!s.selectedPageIds.length} onClick={() => s.duplicatePages(s.selectedPageIds)}><Copy size={15} />复制</button><button disabled={!s.selectedPageIds.length} onClick={() => s.deletePages(s.selectedPageIds)}><Trash2 size={15} />删除</button><div className="selection-spacer" /><small>{s.selectedPageIds.length > 10 ? '同屏编辑最多选择 10 页' : '⌘ 多选 · Shift 连选 · 最多 10 页同屏'}</small><button className="primary-button" disabled={editMode === null} onClick={() => { if (editMode) s.setWorkspaceMode(editMode, { onlySelected: true }); }}>同屏编辑 <ArrowRight size={15} /></button></div>
  </div>;
}
