import { useRef } from 'react';
import { Plus, LayoutGrid, Copy } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { Thumbnail } from './Thumbnail';
export function PageStrip() {
  const s = useEditorStore(), dragged = useRef<string | null>(null);
  return <div className="page-strip">
    <div className="strip-label"><span>页面</span><button title="总览 G" className="icon-button" onClick={() => s.setWorkspaceMode('overview')}><LayoutGrid size={15} /></button><small>{s.project.pages.length} PAGES</small><button className="strip-new-page" aria-label="新增页面" onClick={() => s.addPage(s.project.pages.find(page => page.id === s.activePageId)?.templateId)}><Plus size={12} />新增页面</button></div>
    <div className="strip-scroll">
      {s.project.pages.map((page, index) => <button key={page.id} aria-label={`第 ${index + 1} 页`} className={`strip-page ${s.activePageId === page.id ? 'active' : ''} ${s.visiblePageIds.includes(page.id) ? 'visible' : ''} ${s.selectedPageIds.includes(page.id) ? 'selected' : ''}`} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) s.selectPage(page.id, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey }); else s.setActivePage(page.id); }} onDoubleClick={() => { s.setActivePage(page.id); s.setWorkspaceMode(1); }} onDragOver={e => { if (dragged.current) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!dragged.current || dragged.current === page.id) return; const ids = s.project.pages.map(p => p.id).filter(id => id !== dragged.current); ids.splice(ids.indexOf(page.id), 0, dragged.current); s.reorderPages(ids); dragged.current = null; }}>
        <Thumbnail project={s.project} page={page} interactive /><span className="strip-page-caption" draggable onDragStart={e => { dragged.current = page.id; e.dataTransfer.setData('text/plain', page.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { dragged.current = null; }}>{String(index + 1).padStart(2, '0')}</span>
      </button>)}
      <button className="strip-add" aria-label="新增页面" onClick={() => s.addPage(s.project.pages.find(p => p.id === s.activePageId)?.templateId)}><Plus size={20} /><span>新增</span></button>
    </div>
    <button title="复制当前页" className="strip-duplicate" onClick={() => s.duplicatePages([s.activePageId])}><Copy size={16} /><span>复制页面</span></button>
  </div>;
}
