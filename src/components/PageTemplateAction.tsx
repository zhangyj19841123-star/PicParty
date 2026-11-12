import { Save } from 'lucide-react';
import './pageActions.css';

export function PageTemplateAction({ pageId, pageNumber, onSave }: {
  pageId: string; pageNumber: number; onSave(pageId: string): void;
}) {
  return <button className="page-template-action" type="button" aria-label={`将第 ${pageNumber} 页存为新模板`}
    title={`保存第 ${pageNumber} 页的布局为新模板`}
    onPointerDown={event => event.stopPropagation()}
    onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
    onClick={event => { event.stopPropagation(); onSave(pageId); }}>
    <Save size={12} /><span>存为模板</span>
  </button>;
}
