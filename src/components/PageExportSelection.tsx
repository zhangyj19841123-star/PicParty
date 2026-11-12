import { useEditorStore } from '../state/editorStore';
import './pageExportSelection.css';

/** A page's export check never changes its editing target or screen position. */
export function PageExportSelection({ pageId, disabled = false, onSelectionChange }: {
  pageId: string; disabled?: boolean; onSelectionChange?(): void;
}) {
  const checked = useEditorStore(state => state.selectedPageIds.includes(pageId));
  const index = useEditorStore(state => state.project.pages.findIndex(page => page.id === pageId));
  if (index < 0) return null;
  return <label className="page-export-selection" title={`${checked ? '取消' : '勾选'}第 ${index + 1} 页用于导出`}
    onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}>
    <input type="checkbox" checked={checked} disabled={disabled} aria-label={`勾选第 ${index + 1} 页用于导出`}
      onChange={event => { useEditorStore.getState().togglePageSelection(pageId, event.target.checked); onSelectionChange?.(); }} />
    <span>导出</span>
  </label>;
}
