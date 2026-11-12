import { useState } from 'react';
import { Save } from 'lucide-react';
import { Modal } from './Modal';
import { Thumbnail } from './Thumbnail';
import { useEditorStore } from '../state/editorStore';
import './SaveTemplateDialog.css';

export function SaveTemplateDialog({ projectId, pageId, onClose, onSaved }: { projectId: string; pageId: string; onClose(): void; onSaved(name: string): void }) {
  const state = useEditorStore();
  const projectMatches = state.project.id === projectId;
  const pageIndex = projectMatches ? state.project.pages.findIndex(page => page.id === pageId) : -1;
  const page = pageIndex >= 0 ? state.project.pages[pageIndex] : undefined;
  const [name, setName] = useState(`${page ? state.project.templates[page.templateId]?.name ?? '自由布局' : '自由布局'} · 自定义`);
  const [error, setError] = useState('');
  const targetError = !projectMatches ? '原项目已切换，请关闭窗口后重新选择页面。' : !page ? '此页已被删除，请关闭窗口后重新选择页面。' : '';
  const valid = Boolean(page) && name.trim().length > 0 && name.trim().length <= 40;
  const submit = () => {
    if (!valid) return;
    const current = useEditorStore.getState();
    if (current.project.id !== projectId) { setError('原项目已切换，请关闭窗口后重新选择页面。'); return; }
    if (!current.project.pages.some(page => page.id === pageId)) { setError('此页已被删除，请关闭窗口后重新选择页面。'); return; }
    try { const template = current.savePageTemplate(name.trim(), pageId); onSaved(template.name); }
    catch (e) { setError(String(e)); }
  };
  return <Modal title="保存为新模板" onClose={onClose}>
    <div className="modal-body">
      {page && <div className="save-template-source"><Thumbnail project={state.project} page={page} /><div><b>第 {pageIndex + 1} 页 · {page.name}</b><p>保留这一页的照片框位置、大小与层序，<br />下次可以直接使用。</p></div></div>}
      <label className="form-label">模板名称<input aria-label="模板名称" maxLength={40} value={name} onChange={event => { setName(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} placeholder="例如：左右留白双拼" /></label>
      <p className="form-note">模板保存布局，不包含照片或调色设置。会显示在左侧「我的模板」。</p>
      {(targetError || error) && <p className="form-error" role="alert">{targetError || error}</p>}
    </div>
    <footer><button className="quiet-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!valid} onClick={submit}><Save size={14} />保存模板</button></footer>
  </Modal>;
}
