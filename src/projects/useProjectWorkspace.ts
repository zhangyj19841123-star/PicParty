import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageAsset, Project } from '../core/types';
import type { NewProjectOptions } from '../core/templates';
import { useEditorStore } from '../state/editorStore';
import { validateProject } from '../core/engine';
import { registerProject } from '../platform/desktop';
import { listLibrary, openLibrary, saveLibrary, duplicateLibrary, renameLibrary, setLibraryDeleted, type LibraryDocument, type LibraryEntry, type LibraryKind } from './library';
import { captureWorkspace, restoredWorkspace } from './workspaceState';
import { ProjectSaveQueue, type SaveTarget } from './saveQueue';
import { thumbnailKey } from '../images/thumbnails';
import { queueProjectCover } from './projectCovers';

const LEGACY_RECOVERY_KEY = 'frame-studio-recovery-v1';
const RECENT_HIDDEN_KEY = 'picparty-hidden-recent-projects';
type WorkspaceTarget = SaveTarget & { mode: LibraryKind | 'external'; signature: string | null; lastProject: Project | null; lastView: string | null; coverKey: string | null };
const targetFor = (project: Project, mode: WorkspaceTarget['mode'], document: LibraryDocument | null = null): WorkspaceTarget => ({ projectId: project.id, mode, kind: mode === 'project' ? 'project' : 'draft', libraryId: document?.entry.id ?? null, revision: document?.entry.revision ?? null, document, signature: null, lastProject: null, lastView: null, coverKey: document?.entry.coverRevision != null && project.pages[0] ? thumbnailKey(project, project.pages[0]) : null });
const contentSignature = (project: Project, editorState: Record<string, unknown>) => JSON.stringify([project, editorState]);
function hiddenRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_HIDDEN_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export function useProjectWorkspace(ready: boolean, notify: (message: string) => void) {
  const editor = useEditorStore();
  const target = useRef<WorkspaceTarget>(targetFor(editor.project, 'draft'));
  const bypassFlush = useRef(false);
  const queue = useRef<ProjectSaveQueue | null>(null); if (!queue.current) queue.current = new ProjectSaveQueue(saveLibrary);
  const [mode, setMode] = useState<WorkspaceTarget['mode']>('draft'), [entry, setEntry] = useState<LibraryEntry | null>(null);
  const [phase, setPhase] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle'), [error, setError] = useState('');
  const [projects, setProjects] = useState<LibraryEntry[]>([]), [drafts, setDrafts] = useState<LibraryEntry[]>([]), [root, setRoot] = useState('');
  const [hiddenRecentIds, setHiddenRecentIds] = useState(hiddenRecent);
  const [loading, setLoading] = useState(false);
  const persistRef = useRef<(force?: boolean) => Promise<LibraryDocument | null>>(async () => null);
  const setRecentHidden = useCallback((id: string, hidden: boolean) => {
    const current = hiddenRecent();
    if (current.includes(id) === hidden) return;
    const next = hidden ? [...current, id] : current.filter(item => item !== id);
    localStorage.setItem(RECENT_HIDDEN_KEY, JSON.stringify(next));
    setHiddenRecentIds(next);
  }, []);
  const trackEntry = useCallback((value: LibraryEntry) => {
    const setList = value.kind === 'project' ? setProjects : setDrafts;
    setList(items => {
      const previous = items.find(item => item.id === value.id);
      if (previous && previous.revision > value.revision) return items;
      return [...items.filter(item => item.id !== value.id), value];
    });
  }, []);
  const cacheCover = useCallback((document: LibraryDocument, session?: WorkspaceTarget) => {
    const page = document.project.pages[0];
    if (!page) return;
    const key = thumbnailKey(document.project, page);
    if (session?.coverKey === key) return;
    if (session) session.coverKey = key;
    const { id, kind } = document.entry;
    void queueProjectCover(document).then(revision => {
      if (revision === null) return;
      const update = (item: LibraryEntry) => item.id === id && item.revision >= revision && (item.coverRevision ?? 0) < revision ? { ...item, coverRevision: revision } : item;
      const setList = kind === 'project' ? setProjects : setDrafts;
      setList(items => items.map(update));
      setEntry(item => item ? update(item) : null);
    }).catch(() => { if (session?.coverKey === key) session.coverKey = null; });
  }, []);
  const refresh = useCallback(async () => {
    const [formal, temporary] = await Promise.all([listLibrary('project'), listLibrary('draft')]);
    setProjects(formal.entries); setDrafts(temporary.entries); setRoot(formal.root);
    const errors = [...formal.errors, ...temporary.errors]; if (errors.length) notify(`部分项目记录需要恢复：${errors.length} 项，请在项目列表检查。`);
  }, [notify]);
  const persist = useCallback(async (force = false): Promise<LibraryDocument | null> => {
    const state = useEditorStore.getState(), current = target.current;
    if (state.project.id !== current.projectId) throw new Error('作品已切换，请重试保存');
    const view = captureWorkspace(state), signature = contentSignature(state.project, view);
    if (!force && current.signature === signature) return current.document;
    if (!force && !current.document && current.mode !== 'project' && state.revision === 0 && Object.keys(state.project.assets).length === 0 && state.project.pages.length === 1) return null;
    validateProject(state.project); setPhase('saving'); setError('');
    try {
      const document = await queue.current!.save(current, { project: state.project, editorRevision: state.revision, editorState: view });
      current.signature = signature; current.lastProject = state.project; current.lastView = JSON.stringify(view);
      trackEntry(document.entry); cacheCover(document, current);
      if (target.current === current && useEditorStore.getState().project.id === current.projectId) {
        // Library recovery paths never replace the user's chosen .collage path.
        useEditorStore.getState().markSaved(state.revision, undefined, current.projectId);
        setEntry(document.entry);
        const now = useEditorStore.getState(); setPhase(contentSignature(now.project, captureWorkspace(now)) === signature ? 'saved' : 'pending');
      }
      return document;
    } catch (reason) { if (target.current === current) { setError(String(reason)); setPhase('error'); } throw reason; }
  }, [cacheCover, trackEntry]);
  persistRef.current = persist;
  const flush = useCallback(async (commit = true) => {
    if (bypassFlush.current) return;
    if (commit) useEditorStore.getState().commitTransaction();
    const destination = target.current;
    // Saving may finish after another edit. A switch/quit must wait for that
    // newer snapshot too, rather than silently leaving its last seconds behind.
    while (true) {
      const before = useEditorStore.getState(), view = JSON.stringify(captureWorkspace(before));
      await persistRef.current(); await queue.current!.flush();
      const after = useEditorStore.getState();
      if (target.current !== destination || after.project.id !== destination.projectId) throw new Error('作品已切换，请重试操作');
      if (after.project === before.project && JSON.stringify(captureWorkspace(after)) === view) return;
    }
  }, []);
  const activate = useCallback(async (document: LibraryDocument, nextMode: WorkspaceTarget['mode']) => {
    validateProject(document.project); const registered = await registerProject(document.project);
    const next = targetFor(document.project, nextMode, document);
    target.current = next; setMode(nextMode); setEntry(document.entry);
    if (nextMode === 'project') { try { setRecentHidden(document.entry.id, false); } catch { /* Recent history is separate from project loading. */ } }
    useEditorStore.getState().loadProject(document.project);
    useEditorStore.setState(restoredWorkspace(useEditorStore.getState(), document.editorState));
    next.signature = contentSignature(useEditorStore.getState().project, captureWorkspace(useEditorStore.getState())); next.lastProject = useEditorStore.getState().project; next.lastView = JSON.stringify(captureWorkspace(useEditorStore.getState())); setPhase('saved'); setError('');
    if (registered.missing.length) notify(`${registered.missing.length} 张原图未连接，布局已恢复，可定位素材文件夹。`);
    else if (document.recovered) notify('已从上一份成功保存的版本恢复项目。');
    trackEntry(document.entry); cacheCover(document, next);
  }, [cacheCover, notify, setRecentHidden, trackEntry]);
  const openEntry = useCallback(async (item: LibraryEntry) => {
    setLoading(true);
    try { await flush(); await activate(await openLibrary(item.id, item.kind), item.kind); await refresh(); }
    finally { setLoading(false); }
  }, [activate, flush, refresh]);
  const newWorkspace = useCallback(async (formal = false, options?: NewProjectOptions & { asset?: ImageAsset }) => {
    setLoading(true); try {
    await flush();
    useEditorStore.getState().newProject({ name: formal ? '未命名拼图' : '临时拼图', ...options });
    const current = useEditorStore.getState();
    if (options?.asset) { current.applyTemplate([current.activePageId], 'single'); current.assignAssets([options.asset]); }
    target.current = targetFor(useEditorStore.getState().project, formal ? 'project' : 'draft'); setMode(formal ? 'project' : 'draft'); setEntry(null); setPhase('idle'); setError('');
    if (formal) { await persistRef.current(true); await refresh(); }
    } finally { setLoading(false); }
  }, [flush, refresh]);
  const saveAsProject = useCallback(async () => {
    setLoading(true); try {
    useEditorStore.getState().commitTransaction(); await persistRef.current();
    const state = useEditorStore.getState();
    if (target.current.mode !== 'project') {
      // A formal project gets its own identity; future temporary edits can never write into it.
      const project = structuredClone(state.project); project.id = crypto.randomUUID();
      if (!project.name.trim() || project.name === '临时拼图' || project.name === '未命名项目') project.name = '未命名拼图';
      const document = await saveLibrary({ project, kind: 'project', editorState: captureWorkspace(state) });
      await activate(document, 'project');
    } else await persistRef.current(true);
    await refresh(); notify('已存为项目，后续编辑会自动保存。');
    } finally { setLoading(false); }
  }, [activate, notify, refresh]);
  const loadExternal = useCallback(async (project: Project, path?: string, recovering = false) => {
    setLoading(true); try {
    project = { ...structuredClone(project), id: crypto.randomUUID() };
    validateProject(project); const registered = await registerProject(project);
    // Older portable files are left untouched. Edits get a separate draft recovery until explicitly saved.
    target.current = targetFor(project, recovering ? 'draft' : 'external'); setMode(recovering ? 'draft' : 'external'); setEntry(null); setError(''); setPhase('idle');
    if (recovering) useEditorStore.getState().restoreProject(project); else useEditorStore.getState().loadProject(project, path);
    await persistRef.current(true); await refresh();
    notify(registered.missing.length ? `${registered.missing.length} 张原图未连接，布局已恢复。` : recovering ? '已恢复临时拼图。' : '项目已打开，自动恢复副本会保留，原文件不会被自动覆盖。');
    } finally { setLoading(false); }
  }, [notify, refresh]);
  const duplicate = useCallback(async (item: LibraryEntry) => {
    await flush();
    const document = await duplicateLibrary(item.id, item.kind);
    await refresh();
    void registerProject(document.project).then(() => cacheCover(document)).catch(() => {});
    notify('已创建独立副本。');
  }, [cacheCover, flush, notify, refresh]);
  const rename = useCallback(async (item: LibraryEntry, name: string) => {
    if (item.id === target.current.libraryId && item.kind === target.current.kind) { useEditorStore.getState().renameProject(name); await persistRef.current(true); }
    else await renameLibrary(item.id, item.kind, name);
    await refresh();
  }, [refresh]);
  const setDeleted = useCallback(async (item: LibraryEntry, deleted: boolean) => {
    await flush(); await setLibraryDeleted(item.id, item.kind, deleted);
    if (deleted && item.id === target.current.libraryId && item.kind === target.current.kind) {
      useEditorStore.getState().newProject({ name: '临时拼图' }); target.current = targetFor(useEditorStore.getState().project, 'draft'); setMode('draft'); setEntry(null); setPhase('idle');
    }
    await refresh(); notify(deleted ? '已移入已删除，可随时恢复。' : '项目已恢复。');
  }, [flush, notify, refresh]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const boot = async () => {
      // Preserve the old key and an additional immutable backup before any migration.
      const legacy = localStorage.getItem(LEGACY_RECOVERY_KEY);
      if (legacy) {
        try {
          const project = JSON.parse(legacy) as Project; validateProject(project);
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacy)))).map(v=>v.toString(16).padStart(2,'0')).join('');
          const marker = `frame-studio-legacy-recovery-migrated-v2:${digest}`;
          if (!localStorage.getItem(marker)) {
            const backup = 'frame-studio-recovery-v1-before-v2'; if (!localStorage.getItem(backup)) localStorage.setItem(backup, legacy);
            await saveLibrary({ project, kind: 'draft' }); localStorage.setItem(marker, '1');
          }
        } catch (reason) { if (alive) notify(`旧草稿已保留，迁移未完成：${String(reason)}`); }
      }
      if (alive) await refresh();
    };
    void boot().catch(reason => { if (alive) notify(`读取我的项目失败：${String(reason)}`); });
    return () => { alive = false; };
  }, [ready, notify, refresh]);
  const viewSignature = JSON.stringify(captureWorkspace(editor));
  useEffect(() => {
    if (!ready) return;
    if (target.current.projectId !== editor.project.id) {
      target.current = targetFor(editor.project, 'draft'); setMode('draft'); setEntry(null); setError(''); setPhase('idle');
    }
    const current = target.current;
    if (current.lastProject === editor.project && current.lastView === viewSignature) return;
    if (!current.document && current.mode !== 'project' && editor.revision === 0 && !Object.keys(editor.project.assets).length && editor.project.pages.length === 1) return;
    setPhase('pending');
    const timer = setTimeout(() => { void persistRef.current().catch(reason => notify(`自动保存失败，修改仍保留在当前窗口：${String(reason)}`)); }, 1000);
    return () => clearTimeout(timer);
  }, [ready, editor.project, editor.revision, viewSignature, notify]);
  useEffect(() => {
    if (!ready) return;
    const background = () => { if (document.hidden) void persistRef.current().catch(() => {}); };
    document.addEventListener('visibilitychange', background); return () => document.removeEventListener('visibilitychange', background);
  }, [ready]);
  const status = phase === 'error' ? '自动保存失败 · 点此重试' : phase === 'saving' ? '正在自动保存…' : phase === 'pending' ? '等待自动保存…' : phase === 'saved' ? mode === 'project' ? '已自动保存到我的项目' : '临时拼图已自动保存' : mode === 'project' ? '我的项目' : '临时拼图 · 自动保存';
  return { mode, entry, phase, error, status, projects, drafts, root, loading, hiddenRecentIds, setRecentHidden, refresh, flush, save: persist, openEntry, newWorkspace, saveAsProject, loadExternal, activateImported: async (document: LibraryDocument) => { await flush(); await activate(document, 'project'); await refresh(); }, duplicate, rename, setDeleted, withoutSaving: async (operation: () => void | Promise<void>) => { bypassFlush.current = true; try { await operation(); } finally { bypassFlush.current = false; } } };
}
