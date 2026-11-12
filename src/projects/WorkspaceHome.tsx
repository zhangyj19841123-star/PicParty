import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FolderOpen, FolderSearch, Image as ImageIcon, MoreHorizontal, Pencil, Plus, Rows3, Search, Stamp, Trash2, X } from 'lucide-react';
import { brand } from '../brand';
import { Modal } from '../components/Modal';
import { native } from '../platform/desktop';
import { revealLibrary, type LibraryEntry } from './library';
import { loadProjectCover } from './projectCovers';
import './workspaceHome.css';

const PAGE_SIZE = 12;

function timestamp(value: number) {
  return new Date(value < 10_000_000_000 ? value * 1000 : value);
}

function relativeDate(value: number) {
  const date = timestamp(value), today = new Date(), yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`;
}

function ProjectDate({ value, label }: { value?: number | null; label: string }) {
  const date = value == null ? null : timestamp(value);
  return date ? <time dateTime={date.toISOString()} title={`${label} ${date.toLocaleString('zh-CN')}`}>{label} {relativeDate(value!)}</time> : <span>{label.replace(/于$/, '')}时间未知</span>;
}

function ProjectCover({ entry }: { entry: LibraryEntry }) {
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const key = `${entry.kind}:${entry.id}:${entry.coverRevision ?? `missing-${entry.revision}`}`;
  useEffect(() => {
    let disposed = false, objectUrl: string | undefined;
    const load = () => {
      void loadProjectCover(entry).then(blob => {
        if (disposed || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ key, url: objectUrl });
      }).catch(() => {});
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (disposed || !entries.some(entry => entry.isIntersecting)) return;
      observer?.disconnect();
      load();
    });
    if (observer && element.current) observer.observe(element.current);
    else load();
    return () => {
      disposed = true;
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key]);
  return <div ref={element} className="home-project-cover" aria-hidden="true">
    {image?.key === key ? <img src={image.url} alt="" draggable={false} onError={() => setImage(null)} /> : <ImageIcon size={26} strokeWidth={1.4} />}
  </div>;
}

interface HomeProps {
  projects: LibraryEntry[];
  draft?: LibraryEntry;
  hiddenRecentIds: string[];
  loading: boolean;
  onNew(): void;
  onLocalOpen(): void;
  onOpen(entry: LibraryEntry): Promise<void>;
  onRename(entry: LibraryEntry, name: string): Promise<void>;
  onDelete(entry: LibraryEntry): Promise<void>;
  onRemoveRecent(entry: LibraryEntry): void;
  onManage(): void;
  onWatermark(): void;
  onLongImage(): void;
  onReturn?: () => void;
  onError(message: string): void;
}

export function WorkspaceHome({ projects, draft, hiddenRecentIds, loading, onNew, onLocalOpen, onOpen, onRename, onDelete, onRemoveRecent, onManage, onWatermark, onLongImage, onReturn, onError }: HomeProps) {
  const [view, setView] = useState<'recent' | 'all'>('recent');
  const [sort, setSort] = useState<'modified' | 'created'>('modified');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState<LibraryEntry | null>(null), [name, setName] = useState('');
  const [confirm, setConfirm] = useState<LibraryEntry | null>(null);
  const disabled = busy || loading;
  const entries = useMemo(() => {
    const hidden = new Set(hiddenRecentIds);
    const query = search.trim().toLocaleLowerCase();
    return projects.filter(item => !item.deletedAt && (view === 'all' || !hidden.has(item.id)) && item.name.toLocaleLowerCase().includes(query))
      .sort((a, b) => (sort === 'created' ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : b.updatedAt - a.updatedAt) || b.updatedAt - a.updatedAt);
  }, [projects, hiddenRecentIds, view, sort, search]);

  useEffect(() => {
    if (!menu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target as HTMLElement)?.closest('.home-project-actions')) setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu]);

  async function run(operation: () => Promise<void> | void) {
    setMenu(null);
    setBusy(true);
    try { await operation(); } catch (error) { onError(String(error)); }
    finally { setBusy(false); }
  }

  return <>
    <header className="app-header home-header" data-tauri-drag-region>
      <div className="brand"><img className="brand-icon" src={brand.iconUrl} alt="" /><b>{brand.name}</b></div>
      <div className="header-spacer" />
      <nav aria-label="工作台工具">
        {onReturn && <button className="quiet-button" disabled={disabled} onClick={onReturn}>返回当前拼图 <ArrowRight size={15} /></button>}
        <button disabled={disabled} onClick={onLongImage}><Rows3 size={16} />长图拼接</button>
        <button disabled={disabled} onClick={onWatermark}><Stamp size={16} />批量水印</button>
      </nav>
    </header>
    <main className="workspace-home" aria-label="拼图工作台">
      <div className="home-content">
        <section className={`home-start${draft ? ' has-draft' : ''}`} aria-label="开始拼图">
          <div className="home-hero">
            <div className="home-hero-copy">
              <h1>{brand.tagline}</h1>
              <p>{brand.subtitle}</p>
              <div className="home-start-actions">
                <button className="primary-button home-new" disabled={disabled} onClick={onNew}><Plus size={22} strokeWidth={1.8} />新建拼图</button>
                <button className="quiet-button home-local" disabled={disabled} onClick={onLocalOpen}><FolderOpen size={16} />打开本地项目</button>
              </div>
              <small>打开画布，把照片拖进想放的位置</small>
            </div>
            <img className="home-hero-mark" src={brand.heroIconUrl} alt="" draggable={false} />
          </div>
          {draft && <aside className="home-draft" aria-label="继续上次的工作">
            <h2>继续上次的工作</h2>
            <div className="home-draft-info">
              <ProjectCover entry={draft} />
              <div><strong>{draft.name}</strong><ProjectDate value={draft.updatedAt} label="编辑于" /></div>
            </div>
            <button className="quiet-button" disabled={disabled} onClick={() => void run(() => onOpen(draft))}>恢复草稿 <ArrowRight size={14} /></button>
          </aside>}
        </section>

        <section className="home-history" aria-label="项目历史">
          <div className="home-history-bar">
            <div className="home-history-tabs" role="group" aria-label="项目范围">
              <button aria-pressed={view === 'recent'} onClick={() => { setView('recent'); setLimit(PAGE_SIZE); }}>最近项目</button>
              <button aria-pressed={view === 'all'} onClick={() => { setView('all'); setLimit(PAGE_SIZE); }}>全部项目</button>
            </div>
            <label className="home-search"><Search size={15} /><input aria-label="搜索项目名称" placeholder="搜索项目" value={search} onChange={event => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} /></label>
            <select className="home-sort" aria-label="项目排序" value={sort} onChange={event => { setSort(event.target.value === 'created' ? 'created' : 'modified'); setLimit(PAGE_SIZE); }}>
              <option value="modified">按修改时间</option>
              <option value="created">按创建时间</option>
            </select>
            <button className="quiet-button home-manage" disabled={disabled} onClick={onManage}>管理项目</button>
          </div>
          {entries.length ? <div className="home-project-grid">
            {entries.slice(0, limit).map(entry => <article className="home-project-card" key={entry.id}>
              <button className="home-project-open" disabled={disabled} onClick={() => void run(() => onOpen(entry))} title={`打开 ${entry.name}`}>
                <ProjectCover entry={entry} />
                <div className="home-project-info">
                  <strong>{entry.name}</strong>
                  <ProjectDate value={entry.updatedAt} label="修改于" />
                  <ProjectDate value={entry.createdAt} label="创建于" />
                </div>
              </button>
              <div className="home-project-actions">
                <button className="icon-button home-card-menu" disabled={disabled} aria-expanded={menu === entry.id} aria-label={`${entry.name}项目操作`} onClick={() => setMenu(menu === entry.id ? null : entry.id)}><MoreHorizontal size={17} /></button>
                {menu === entry.id && <div className="home-card-popover" aria-label={`${entry.name}项目操作`}>
                  <button onClick={() => void run(() => onOpen(entry))}><FolderOpen size={15} />打开</button>
                  <button onClick={() => { setMenu(null); setName(entry.name); setRename(entry); }}><Pencil size={15} />重命名</button>
                  {native && <button onClick={() => void run(() => revealLibrary(entry))}><FolderSearch size={15} />在 Finder 中显示</button>}
                  {!hiddenRecentIds.includes(entry.id) && <button onClick={() => void run(() => onRemoveRecent(entry))}><X size={15} />从最近记录移除</button>}
                  <button className="home-delete" onClick={() => { setMenu(null); setConfirm(entry); }}><Trash2 size={15} />删除项目…</button>
                </div>}
              </div>
            </article>)}
          </div> : <div className="home-empty">{search.trim() ? '没有找到匹配的项目' : view === 'recent' ? '暂无最近项目' : '暂无保存的项目'}</div>}
          {entries.length > limit && <button className="quiet-button home-more" onClick={() => setLimit(limit + PAGE_SIZE)}>显示更多项目</button>}
        </section>
      </div>
    </main>
    {rename && <Modal title="重命名项目" onClose={() => { if (!busy) setRename(null); }}>
      <form className="home-rename-form" onSubmit={event => { event.preventDefault(); void run(async () => { await onRename(rename, name.trim()); setRename(null); }); }}>
        <div className="modal-body"><label>项目名称<input value={name} onChange={event => setName(event.target.value)} required maxLength={120} autoFocus /></label></div>
        <footer><button type="button" className="quiet-button" disabled={busy} onClick={() => setRename(null)}>取消</button><button className="primary-button" disabled={busy || !name.trim()}>保存名称</button></footer>
      </form>
    </Modal>}
    {confirm && <Modal title="删除这个项目？" onClose={() => { if (!busy) setConfirm(null); }}>
      <div className="modal-body"><p>将「{confirm.name}」移入已删除。你可以在「管理项目 → 已删除」中恢复。</p></div>
      <footer><button className="quiet-button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="primary-button" disabled={busy} onClick={() => void run(async () => { await onDelete(confirm); setConfirm(null); })}>移入已删除</button></footer>
    </Modal>}
  </>;
}
