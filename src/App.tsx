import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, ImagePlus, Download, Save, FolderOpen, Plus, Undo2, Redo2, LayoutGrid, PanelLeftClose, PanelRightClose, ChevronDown, Check, LoaderCircle, X, CircleHelp, ArrowLeft, Columns2, Columns3, Square, Grid2X2, Scan, Rows3, Stamp, MoreHorizontal, Archive, FilePlus2 } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { setDocumentValidator, useEditorStore } from './state/editorStore';
import { initializeEngine, validateProject } from './core/engine';
import type { FrameRef, Project } from './core/types';
import { native, selectPhotos, importPaths, importBrowserFiles, saveProject, chooseProject, loadProject, relinkAsset, openInPhotoshop } from './platform/desktop';
import { useAssetSync } from './images/useAssetSync';
import { Sidebar } from './components/Sidebar';
import { Inspector } from './components/Inspector';
import { ToolPanelLayout, ToolPanels } from './editor/ToolPanels';
import { Workspace, type WorkspaceBridge } from './editor/Workspace';
import { Overview } from './components/Overview';
import { PageStrip } from './components/PageStrip';
import { Modal } from './components/Modal';
import { Thumbnail } from './components/Thumbnail';
import { NewProjectDialog } from './components/NewProjectDialog';
import { ExportDialog } from './components/ExportDialog';
import { SaveTemplateDialog } from './components/SaveTemplateDialog';
import { LongImageDialog } from './components/LongImageDialog';
import { ProjectWatermarkDialog } from './projects/ProjectWatermarkDialog';
import { onWatermarkCloseBlocked } from './platform/watermark';
import { ASSET_POINTER_DROP_EVENT, ASSET_POINTER_HOVER_EVENT, resolveAssetDropTarget } from './editor/assetDrag';
import { nativeDropPoint } from './platform/dropCoordinates';
import { thumbnailFrameAtPoint, setThumbnailDropTarget } from './editor/thumbnailDrop';
import { PHOTO_POINTER_DROP_EVENT, PHOTO_POINTER_HOVER_EVENT, thumbnailPhotoDragAllowed, validPhotoPointerDrop } from './editor/photoPointerDrag';
import { workspaceModeFromCommand } from './core/workspaceModes';
import { useProjectWorkspace } from './projects/useProjectWorkspace';
import { ProjectDrawer } from './projects/ProjectDrawer';
import { ArchiveDialog } from './projects/ArchiveDialog';
import { chooseArchiveInput, chooseArchiveOutput, startArchive, startArchiveImport, type LibraryEntry } from './projects/library';
import { captureWorkspace } from './projects/workspaceState';
import { AssetReconnectPanel } from './projects/AssetReconnectPanel';
import { WorkspaceHome } from './projects/WorkspaceHome';
import { brand } from './brand';
import './projects/projects.css';
import './editor/workspaceModes.css';
import './editor/preciseDrop.css';
import './editor/interactionModes.css';

const viewModes = [{ n: 1, name: '单页', Icon: Square }, { n: 2, name: '双页', Icon: Columns2 }, { n: 3, name: '三页', Icon: Columns3 }, { n: 4, name: '四页', Icon: Grid2X2 }] as const;
type Pending = { action(): void | Promise<void>; message: string };

export default function App() {
  const s = useEditorStore();
  const [home, setHome] = useState(true), [hasEditor, setHasEditor] = useState(false);
  const showEditor = () => { setHasEditor(true); setHome(false); };
  const [ready, setReady] = useState(false), [engineError, setEngineError] = useState('');
  const [modal, setModal] = useState<'new'|'export'|'help'|'template'|'long'|'watermark'|null>(null), [preview, setPreview] = useState<string | null>(null);
  const [templateTarget, setTemplateTarget] = useState<{ projectId: string; pageId: string } | null>(null);
  const [templateLibraryReveal, setTemplateLibraryReveal] = useState(0);
  const [leftOpen, setLeftOpen] = useState(true), [rightOpen, setRightOpen] = useState(true);
  const [busy, setBusy] = useState(''), [toast, setToast] = useState(''), [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false), [projectMenuOpen, setProjectMenuOpen] = useState(false), [archiveJob, setArchiveJob] = useState<string | null>(null);
  const archiveBusy = useRef(false);
  const [renaming, setRenaming] = useState(false), [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null), importTarget = useRef<FrameRef | undefined>(undefined);
  const newPhotoInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null), backgroundTarget = useRef<string>('');
  const bridge = useRef<WorkspaceBridge | null>(null), toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commands = useRef<(command: string) => void>(() => {});
  const nativeDrop = useRef<(paths: string[], point: { x: number; y: number }) => void>(() => {});
  const nativeHover = useRef<(point: { x: number; y: number } | null) => void>(() => {});
  const closeRef = useRef<() => void>(() => {});
  const watermarkBusy = useRef(false);
  const notify = useCallback((message: string) => { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  useAssetSync(ready, notify);
  const workspace = useProjectWorkspace(ready, notify);
  useEffect(() => { const close = (event: PointerEvent) => { if (!(event.target as HTMLElement)?.closest('[data-project-menu]')) setProjectMenuOpen(false); }; window.addEventListener('pointerdown', close); return () => window.removeEventListener('pointerdown', close); }, []);

  const frameDropAt = (x: number, y: number): FrameRef | null => {
    const element = document.elementFromPoint(x, y);
    if (!element || element.closest('[data-floating-panel],[role="dialog"]')) return null;
    const thumbnail = thumbnailFrameAtPoint(x, y);
    if (thumbnail) return thumbnail;
    return element.closest('.canvas-workspace') ? bridge.current?.hitTest(x, y) ?? null : null;
  };
  const showDropTarget = (target: FrameRef | null) => {
    bridge.current?.setDropTarget(target); setThumbnailDropTarget(target);
  };

  useEffect(() => {
    const blocked = () => !ready || Boolean(busy) || Boolean(document.querySelector('[role="dialog"]'));
    const hover = (event: WindowEventMap[typeof ASSET_POINTER_HOVER_EVENT] | WindowEventMap[typeof PHOTO_POINTER_HOVER_EVENT]) => {
      const detail = event.detail, current = useEditorStore.getState();
      const modeBlocked = event.type === PHOTO_POINTER_HOVER_EVENT && !thumbnailPhotoDragAllowed(current);
      showDropTarget(detail && !blocked() && !modeBlocked && detail.projectId === current.project.id ? frameDropAt(detail.clientX, detail.clientY) : null);
    };
    const drop = (event: WindowEventMap[typeof ASSET_POINTER_DROP_EVENT]) => {
      const detail = event.detail, current = useEditorStore.getState();
      const element = document.elementFromPoint(detail.clientX, detail.clientY);
      const overCanvas = Boolean(element?.closest('.canvas-workspace'));
      const target = resolveAssetDropTarget(detail, {
        project: current.project, blocked: blocked(),
        backgroundDropPageId: element?.closest<HTMLElement>('[data-background-drop]')?.dataset.backgroundDrop,
        backgroundEditing: current.backgroundEditing,
        pageAtPoint: overCanvas ? bridge.current?.pageHitTest(detail.clientX, detail.clientY) : null,
        frameAtPoint: frameDropAt(detail.clientX, detail.clientY),
      });
      if (!target) return;
      try {
        current.commitTransaction();
        if (target.kind === 'background') {
          current.setActivePage(target.pageId); current.setBackgroundImage(target.pageId, detail.assetId); current.setBackgroundEditing(true);
        } else { current.setActivePage(target.ref.pageId); current.replaceFrame(target.ref, detail.assetId); }
      } catch (error) { notify(String(error)); }
    };
    const photoDrop = (event: WindowEventMap[typeof PHOTO_POINTER_DROP_EVENT]) => {
      const detail = event.detail, current = useEditorStore.getState();
      if (!validPhotoPointerDrop(detail, current.project, blocked() || !thumbnailPhotoDragAllowed(current))) return;
      const target = frameDropAt(detail.clientX, detail.clientY);
      if (!target) return;
      try { current.commitTransaction(); current.swapFrames(detail.from, target); current.setActivePage(target.pageId); current.setSelectedFrame(target); }
      catch (error) { notify(String(error)); }
    };
    window.addEventListener(ASSET_POINTER_DROP_EVENT, drop);
    window.addEventListener(ASSET_POINTER_HOVER_EVENT, hover);
    window.addEventListener(PHOTO_POINTER_HOVER_EVENT, hover);
    window.addEventListener(PHOTO_POINTER_DROP_EVENT, photoDrop);
    return () => {
      window.removeEventListener(ASSET_POINTER_DROP_EVENT, drop);
      window.removeEventListener(ASSET_POINTER_HOVER_EVENT, hover);
      window.removeEventListener(PHOTO_POINTER_HOVER_EVENT, hover);
      window.removeEventListener(PHOTO_POINTER_DROP_EVENT, photoDrop);
    };
  }, [ready, busy, notify]);

  useEffect(() => {
    let active = true;
    initializeEngine().then(() => {
      if (!active) return; setDocumentValidator(validateProject); validateProject(useEditorStore.getState().project); setReady(true);
    }).catch(error => { if (active) setEngineError(String(error)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { const state = useEditorStore.getState(); if (state.revision !== state.savedRevision) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const save = async (saveAs = false): Promise<boolean> => {
    try {
      useEditorStore.getState().commitTransaction();
      if (saveAs) {
        const current = useEditorStore.getState(); validateProject(current.project); setBusy('正在保存项目副本');
        const path = await saveProject(current.project, null, true); if (!path) return false; notify('项目文件副本已保存；当前拼图继续自动保存。');
      } else if (workspace.mode === 'project') { await workspace.flush(); notify('项目已保存'); }
      else await workspace.saveAsProject();
      return true;
    } catch (error) { notify(`保存失败：${String(error)}`); return false; }
    finally { setBusy(''); }
  };
  const guarded = (action: Pending['action'], message = '当前拼图自动保存尚未完成。') => {
    void (async () => { try { await workspace.flush(); await action(); } catch (error) { setPending({ action, message: `${message} ${String(error)}。可以重试保存，或取消并继续编辑。` }); } })();
  };
  const acceptProject = async (project: Project, path?: string, recovering = false) => {
    await workspace.loadExternal(project, path, recovering);
    showEditor();
  };
  const openEntry = async (entry: LibraryEntry) => {
    if (entry.id !== workspace.entry?.id || entry.kind !== workspace.entry?.kind) await workspace.openEntry(entry);
    else if (entry.kind === 'project') workspace.setRecentHidden(entry.id, false);
    showEditor();
  };
  const startBlank = (formal = false) => guarded(async () => { await workspace.newWorkspace(formal); showEditor(); });
  const returnHome = () => guarded(() => {
    setProjectMenuOpen(false); setHome(true);
    void workspace.refresh().catch(error => notify(`读取项目失败：${String(error)}`));
  });
  const openProjects = () => { setProjectMenuOpen(false); setProjectsOpen(true); void workspace.refresh().catch(error => notify(`读取项目失败：${String(error)}`)); };
  const importArchive = () => { setProjectsOpen(false); guarded(async () => {
    try { const path = await chooseArchiveInput(); if (!path) return; setBusy('正在准备导入归档'); archiveBusy.current = true; const id = await startArchiveImport(path); setProjectsOpen(false); setProjectMenuOpen(false); setArchiveJob(id); }
    catch (error) { archiveBusy.current = false; notify(`导入归档失败：${String(error)}`); }
    finally { setBusy(''); }
  }); };
  const exportArchive = () => guarded(async () => {
    try {
      if (workspace.mode !== 'project') { notify('请先存为项目，再打包完整归档。'); return; }
      const current = useEditorStore.getState(), path = await chooseArchiveOutput(current.project.name); if (!path) return;
      setBusy('正在准备完整归档'); archiveBusy.current = true;
      const id = await startArchive(current.project, path, captureWorkspace(current)); setProjectMenuOpen(false); setArchiveJob(id);
    } catch (error) { archiveBusy.current = false; notify(`打包归档失败：${String(error)}`); }
    finally { setBusy(''); }
  });
  const open = () => guarded(async () => {
    if (!native) { projectInput.current?.click(); return; }
    try { const path = await chooseProject(); if (!path) return; setBusy('正在打开项目'); await acceptProject(await loadProject(path), path); } catch (e) { notify(`打开失败：${String(e)}`); } finally { setBusy(''); }
  });
  const importResult = async (operation: () => ReturnType<typeof importPaths>, target?: FrameRef) => {
    const start = useEditorStore.getState(), projectId = start.project.id, pageId = target?.pageId ?? start.activePageId;
    setBusy('正在导入照片');
    try { const { assets, errors } = await operation(); const current = useEditorStore.getState(); if (current.project.id !== projectId) { notify('项目已切换，请重新导入照片。'); return; } current.assignAssets(assets, target, pageId); if (errors.length) notify(errors.join('；')); else if (assets.length) notify(`已导入 ${assets.length} 张照片`); }
    catch (e) { notify(`导入失败：${String(e)}`); } finally { setBusy(''); }
  };
  const importPhotos = async (target?: FrameRef) => {
    if (!native) { importTarget.current = target; fileInput.current?.click(); return; }
    try { const paths = await selectPhotos(); if (paths?.length) await importResult(() => importPaths(paths), target); } catch (e) { notify(String(e)); }
  };
  const startFromPhotos = (operation: () => ReturnType<typeof importPaths>) => guarded(async () => {
    await workspace.newWorkspace();
    showEditor();
    await importResult(operation);
  });
  const chooseNewPhotos = () => {
    if (!native) { newPhotoInput.current?.click(); return; }
    void selectPhotos().then(paths => { if (paths?.length) startFromPhotos(() => importPaths(paths)); }).catch(error => notify(String(error)));
  };
  const importBackgroundResult = async (operation: () => ReturnType<typeof importPaths>, pageId: string) => {
    const projectId = useEditorStore.getState().project.id;
    setBusy('正在导入背景图片');
    try {
      const { assets, errors } = await operation(), current = useEditorStore.getState();
      if (current.project.id !== projectId || !current.project.pages.some(page => page.id === pageId)) { notify('页面已切换，请重新选择背景图片。'); return; }
      if (assets[0]) current.assignBackgroundAsset(assets[0], pageId);
      if (errors.length) notify(errors.join('；'));
      else if (assets.length) notify('已设置背景图片，拖动图片或四角调整构图。');
    } catch (error) { notify(`背景导入失败：${String(error)}`); } finally { setBusy(''); }
  };
  const importBackground = async (pageId: string) => {
    if (!native) { backgroundTarget.current = pageId; backgroundInput.current?.click(); return; }
    try { const paths = await selectPhotos(); if (paths?.length) await importBackgroundResult(() => importPaths(paths.slice(0, 1)), pageId); } catch (error) { notify(String(error)); }
  };
  const backgroundDropPage = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y);
    const zone = element?.closest<HTMLElement>('[data-background-drop]');
    if (zone?.dataset.backgroundDrop) return zone.dataset.backgroundDrop;
    const current = useEditorStore.getState();
    return current.backgroundEditing && element?.closest('.canvas-workspace') ? bridge.current?.pageHitTest(x, y) ?? undefined : undefined;
  };
  nativeDrop.current = (paths, point) => {
    setDragOver(false); showDropTarget(null);
    if (!paths.length || !ready || busy || document.querySelector('[role="dialog"]')) return;
    if (home) { startFromPhotos(() => importPaths(paths)); return; }
    const normalized = nativeDropPoint(point, window.devicePixelRatio, navigator.platform);
    if (!normalized) return;
    const { x, y } = normalized;
    const element = document.elementFromPoint(x, y);
    if (element?.closest('[data-floating-panel]')) return;
    const backgroundPage = backgroundDropPage(x, y);
    if (backgroundPage) { void importBackgroundResult(() => importPaths(paths.slice(0, 1)), backgroundPage); return; }
    const target = frameDropAt(x, y);
    if (!target) { if (paths.length) notify('请将照片拖到要放入或替换的照片框内。'); return; }
    void importResult(() => importPaths(paths), target);
  };
  nativeHover.current = point => {
    setDragOver(Boolean(point));
    const normalized = point && nativeDropPoint(point, window.devicePixelRatio, navigator.platform);
    showDropTarget(normalized && ready && !busy && !document.querySelector('[role="dialog"]') ? frameDropAt(normalized.x, normalized.y) : null);
  };
  closeRef.current = () => { if (archiveBusy.current) { notify('项目归档正在处理，请先取消或等待完成后退出。'); return; } if (watermarkBusy.current) { notify('批量水印正在处理，请先取消或等待完成后退出。'); return; } guarded(async () => { if (native) await getCurrentWindow().destroy(); }); };

  commands.current = command => {
    const focused = document.activeElement as HTMLElement | null;
    const textInput = focused?.closest('input:not([type="range"]):not([type="number"]):not([data-project-control]),textarea,[contenteditable="true"]');
    if (modal === 'watermark' && (command === 'undo' || command === 'redo')) {
      if (focused?.closest('textarea,input:not([type]),input[type="text"],[contenteditable="true"]')) document.execCommand(command);
      else window.dispatchEvent(new CustomEvent('picparty-watermark-history', { detail: command }));
      return;
    }
    if ((command === 'undo' || command === 'redo') && textInput) { document.execCommand(command); return; }
    if (document.querySelector('[role="dialog"]')) return;
    if (home && !['new', 'new-formal', 'new-options', 'my-projects', 'archive-import', 'long-image', 'watermark', 'open', 'import'].includes(command)) return;
    if (['save', 'save-as', 'new', 'open', 'export', 'undo', 'redo'].includes(command)) focused?.blur();
    const current = useEditorStore.getState();
    switch (command) {
      case 'new': startBlank(); break;
      case 'new-formal': startBlank(true); break;
      case 'new-options': guarded(() => setModal('new')); break;
      case 'my-projects': openProjects(); break;
      case 'archive-export': exportArchive(); break;
      case 'archive-import': importArchive(); break;
      case 'long-image': current.commitTransaction(); guarded(() => setModal('long')); break;
      case 'watermark': current.commitTransaction(); setModal('watermark'); break;
      case 'add-page': {
        try { current.commitTransaction(); current.addPage(current.project.pages.find(page => page.id === current.activePageId)?.templateId); }
        catch (error) { notify(`新增页面失败：${String(error)}`); }
        break;
      }
      case 'open': open(); break;
      case 'save': void save(); break;
      case 'save-as': void save(true); break;
      case 'import': if (home) chooseNewPhotos(); else void importPhotos(); break;
      case 'export': current.commitTransaction(); setModal('export'); break;
      case 'edit-frames': if (current.workspaceMode !== 'overview') current.setFrameEditing(true); break;
      case 'free-transform': {
        if (current.workspaceMode !== 'overview' && !textInput && !current.beginPhotoTransform()) notify('请先选中一张照片，再按 ⌘T 或 Ctrl+T。');
        break;
      }
      case 'edit-photos': {
        if (current.workspaceMode === 'overview') break;
        current.setFrameEditing(false);
        const ref = current.selectedFrame;
        const frame = current.project.pages.find(page => page.id === ref?.pageId)?.frames.find(frame => frame.id === ref?.frameId);
        if (ref && frame?.imageAssetId) current.setEditingFrame(ref);
        break;
      }
      case 'undo': current.undo(); break;
      case 'redo': current.redo(); break;
      case 'overview': current.commitTransaction(); current.workspaceMode === 'overview' ? current.returnToEditor() : current.setWorkspaceMode('overview'); break;
      default: {
        const mode = workspaceModeFromCommand(command);
        if (mode !== null) { current.commitTransaction(); current.setWorkspaceMode(mode); }
      }
    }
  };
  useEffect(() => {
    const cleanups: (() => void)[] = []; let ended = false;
    const attach = (promise: Promise<() => void>) => promise.then(fn => { if (ended) fn(); else cleanups.push(fn); }).catch(error => notify(String(error)));
    if (native) {
      attach(listen<string>('menu-action', e => commands.current(e.payload)));
      attach(onWatermarkCloseBlocked(() => notify('批量水印正在处理，请先取消或等待完成后退出。')));
      attach(listen('archive-close-blocked', () => notify('项目归档正在处理，请先取消或等待完成后退出。')));
      attach(getCurrentWebview().onDragDropEvent(event => { if (event.payload.type === 'drop') nativeDrop.current(event.payload.paths, event.payload.position); else nativeHover.current(event.payload.type === 'enter' || event.payload.type === 'over' ? event.payload.position : null); }));
      attach(getCurrentWindow().onCloseRequested(event => { event.preventDefault(); closeRef.current(); }));
    }
    return () => { ended = true; cleanups.forEach(fn => fn()); };
  }, [notify]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || document.querySelector('[role="dialog"]')) return;
      const input = (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]');
      if (input) {
        if (!native && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && (input as HTMLInputElement).matches('input[type="range"],input[type="number"],[data-project-control]')) { event.preventDefault(); commands.current(event.shiftKey ? 'redo' : 'undo'); }
        return;
      }
      const current = useEditorStore.getState(), mod = event.metaKey || event.ctrlKey;
      if (home) {
        if (!native && mod) {
          const action = ({ n: 'new', o: 'open', i: 'import' } as Record<string, string>)[event.key.toLowerCase()];
          if (action && !event.shiftKey) { event.preventDefault(); commands.current(action); }
        }
        return;
      }
      if (mod) {
        if (event.key.toLowerCase() === 't') { event.preventDefault(); commands.current('free-transform'); return; }
        const action = ({ n: event.shiftKey ? 'add-page' : 'new', o: 'open', s: event.shiftKey ? 'save-as' : 'save', e: 'export', z: event.shiftKey ? 'redo' : 'undo', i: 'import', '1': 'view-1', '2': 'view-2', '3': 'view-3', '4': 'view-4', '6': 'view-6', '8': 'view-8', '0': 'view-10' } as Record<string, string>)[event.key.toLowerCase()];
        if (action) { if (!native || action === 'add-page') { event.preventDefault(); commands.current(action); } return; }
        if (event.key.toLowerCase() === 'a' && current.workspaceMode === 'overview') { event.preventDefault(); const ids = current.project.pages.map(page => page.id); current.selectPage(ids[0]); current.selectPage(ids.at(-1)!, { range: true }); }
      } else if (event.key.toLowerCase() === 'g') { event.preventDefault(); commands.current('overview'); }
      else if (!event.altKey && (event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'v')) { event.preventDefault(); commands.current(event.key.toLowerCase() === 'f' ? 'edit-frames' : 'edit-photos'); }
      else if (event.key === 'Escape') { if (current.photoTransform) { event.preventDefault(); current.cancelPhotoTransform(); } else if (current.transaction) current.cancelTransaction(); else if (current.backgroundEditing) current.setBackgroundEditing(false); else if (current.frameEditing) current.setFrameEditing(false); else if (current.editingFrame) current.setSelectedFrame(null); else if (current.workspaceMode === 'overview') current.returnToEditor(); else current.setSelectedFrame(null); }
      else if (event.code === 'Space' && current.workspaceMode === 'overview') { event.preventDefault(); setPreview(current.activePageId); }
      else if (event.key === 'Enter' && current.photoTransform) { event.preventDefault(); current.commitPhotoTransform(); }
      else if (event.key === 'Enter' && current.workspaceMode === 'overview') current.setWorkspaceMode(1);
      else if ((event.key === 'Backspace' || event.key === 'Delete') && current.backgroundEditing) { event.preventDefault(); current.setBackgroundImage(current.activePageId, null); }
      else if ((event.key === 'Backspace' || event.key === 'Delete') && current.selectedFrame) { event.preventDefault(); if (current.frameEditing) { const page = current.project.pages.find(page => page.id === current.selectedFrame!.pageId); if (page && page.frames.length > 1) current.removeFreeFrame(current.selectedFrame); else notify("每页至少保留一个照片框。"); } else current.replaceFrame(current.selectedFrame, null); }
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { if (current.editingFrame) return; const index = current.project.pages.findIndex(page => page.id === current.activePageId); const page = current.project.pages[index + (event.key === 'ArrowRight' ? 1 : -1)]; if (page) { event.preventDefault(); current.selectPage(page.id, { range: event.shiftKey }); } }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [home]);
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault(); setDragOver(false); showDropTarget(null);
    if (!ready || busy || document.querySelector('[role="dialog"]')) return;
    if (home) {
      const files = Array.from(event.dataTransfer.files);
      if (!native && files.length) startFromPhotos(() => importBrowserFiles(files));
      return;
    }
    const target = frameDropAt(event.clientX, event.clientY);
    const assetId = event.dataTransfer.getData('application/x-frame-asset');
    const backgroundPage = backgroundDropPage(event.clientX, event.clientY);
    if (backgroundPage) {
      if (assetId) { s.setActivePage(backgroundPage); s.setBackgroundImage(backgroundPage, assetId); s.setBackgroundEditing(true); }
      else if (!native && event.dataTransfer.files.length) void importBackgroundResult(() => importBrowserFiles(Array.from(event.dataTransfer.files).slice(0, 1)), backgroundPage);
      return;
    }
    if (assetId) { if (target) { s.commitTransaction(); s.setActivePage(target.pageId); s.replaceFrame(target, assetId); } return; }
    if (!native && event.dataTransfer.files.length) {
      if (target) void importResult(() => importBrowserFiles(Array.from(event.dataTransfer.files)), target);
      else notify('请将照片拖到要放入或替换的照片框内。');
    }
  };
  const currentPage = s.project.pages.find(p => p.id === s.activePageId)!;
  const previewPage = preview ? s.project.pages.find(page => page.id === preview) : undefined;
  const openSaveTemplate = useCallback((pageId?: string) => {
    const current = useEditorStore.getState();
    const targetId = pageId ?? current.activePageId;
    if (!current.project.pages.some(page => page.id === targetId)) { notify('这页已不存在，请选择要保存的页面。'); return; }
    current.commitTransaction();
    setTemplateTarget({ projectId: current.project.id, pageId: targetId });
    setModal('template');
  }, [notify]);
  const closeModal = useCallback(() => { setModal(null); setTemplateTarget(null); }, []), closePreview = useCallback(() => setPreview(null), []);
  if (!ready) return <div className="boot-screen"><img className="brand-icon" src={brand.iconUrl} alt="" /><h1>{brand.name}</h1>{engineError ? <><p>编辑引擎未能加载</p><small>{engineError}</small><button className="primary-button" onClick={() => window.location.reload()}>重新加载</button></> : <><LoaderCircle size={22} className="spin" /><p>正在准备你的摄影工作台</p></>}</div>;
  return <div className={`app ${native ? 'native' : ''}`} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!native && !busy) setDragOver(true); } else if (event.dataTransfer.types.includes('application/x-frame-asset')) event.preventDefault(); showDropTarget(!busy && !document.querySelector('[role="dialog"]') ? frameDropAt(event.clientX, event.clientY) : null); }} onDragLeave={event => { if (!event.relatedTarget) { setDragOver(false); showDropTarget(null); } }} onDrop={onDrop}>
    {home ? <WorkspaceHome
      projects={workspace.projects}
      draft={workspace.drafts.filter(item => !item.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt)[0]}
      hiddenRecentIds={workspace.hiddenRecentIds}
      loading={workspace.loading || Boolean(busy)}
      onNew={() => startBlank()}
      onLocalOpen={open}
      onOpen={openEntry}
      onRename={workspace.rename}
      onDelete={entry => workspace.setDeleted(entry, true)}
      onRemoveRecent={entry => { workspace.setRecentHidden(entry.id, true); notify('已从最近记录移除，可在全部项目中打开。'); }}
      onManage={openProjects}
      onWatermark={() => commands.current('watermark')}
      onLongImage={() => commands.current('long-image')}
      onReturn={hasEditor ? showEditor : undefined}
      onError={notify}
    /> : <>
    <header className="app-header" data-tauri-drag-region><button className="brand" title="返回工作台" onClick={returnHome}><img className="brand-icon" src={brand.iconUrl} alt="" /><b>{brand.name}</b></button><div className="header-divider" /><div className="project-title">{renaming ? <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => { s.renameProject(name); setRenaming(false); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false); }} /> : <button title="重命名项目" onClick={() => { setName(s.project.name); setRenaming(true); }}>{workspace.mode !== 'project' && s.project.name === '未命名项目' ? '临时拼图' : s.project.name}<ChevronDown size={12} /></button>}<small><button className={`project-save-state ${workspace.phase === 'error' ? 'is-error' : ''}`} title={workspace.error || '约 1 秒自动保存；点击立即重试'} onClick={() => void workspace.flush().catch(error => notify(String(error)))}>{workspace.status}</button></small></div><div className="header-spacer" /><div className="feature-tools"><button title="长图拼接" onClick={() => commands.current('long-image')}><Rows3 size={16} /><span>长图拼接</span></button><button title="批量水印" onClick={() => commands.current('watermark')}><Stamp size={16} /><span>批量水印</span></button></div><div className="header-divider" /><button className="icon-button" title="新建拼图 ⌘N" onClick={() => commands.current('new')}><Plus size={18} /></button><div className="project-header-tools" data-project-menu><button className="project-library-button" title="我的项目" onClick={openProjects}><FolderOpen size={16}/><span>我的项目</span></button>{workspace.mode !== 'project' && <button className="project-library-button" title="存为项目 ⌘S" onClick={() => void save()}><Save size={15}/><span>存为项目</span></button>}<button className="icon-button" title="项目操作" aria-expanded={projectMenuOpen} onClick={() => setProjectMenuOpen(!projectMenuOpen)}><MoreHorizontal size={18}/></button>{projectMenuOpen && <div className="project-menu" role="menu"><button role="menuitem" onClick={() => { setProjectMenuOpen(false); commands.current('new-formal'); }}><FilePlus2 size={14}/>新建正式项目</button><button role="menuitem" onClick={() => { setProjectMenuOpen(false); commands.current('new'); }}>新建临时拼图</button><button role="menuitem" onClick={() => { setProjectMenuOpen(false); commands.current('new-options'); }}>按尺寸或照片新建…</button><hr/><button role="menuitem" onClick={() => { setProjectMenuOpen(false); commands.current('open'); }}><FolderOpen size={14}/>打开项目文件…</button><button role="menuitem" onClick={() => { setProjectMenuOpen(false); commands.current('save-as'); }}>另存项目文件…</button><button role="menuitem" onClick={() => { setProjectMenuOpen(false); void save(); }}><Save size={14}/>{workspace.mode==='project'?'立即保存':'存为项目'}</button><hr/><button role="menuitem" onClick={() => commands.current('archive-export')}><Archive size={14}/>打包完整归档…</button><button role="menuitem" onClick={() => commands.current('archive-import')}><Archive size={14}/>导入归档…</button></div>}</div><div className="header-divider" /><button className="import-button" onClick={() => void importPhotos()}><ImagePlus size={16} /><span>导入照片</span></button><button className="primary-button export-button" onClick={() => commands.current('export')}><Download size={15} />导出</button></header>
    <div className="editor-toolbar"><div className="toolbar-left"><button className="icon-button" title="显示或隐藏模板面板" aria-pressed={leftOpen} onClick={() => setLeftOpen(!leftOpen)}><PanelLeftClose size={16} /></button><div className="toolbar-divider" /><button title="撤销 ⌘Z" className="icon-button" disabled={!s.undoCount} onClick={() => s.undo()}><Undo2 size={16} /></button><button title="重做 ⇧⌘Z" className="icon-button" disabled={!s.redoCount} onClick={() => s.redo()}><Redo2 size={16} /></button><div className="interaction-modes" role="group" aria-label="画布操作模式"><button aria-pressed={!s.frameEditing && !s.backgroundEditing} disabled={s.workspaceMode === "overview"} title="调整照片 V · 拖照片调整位置，拖四角缩放照片" onClick={() => commands.current("edit-photos")}><ImageIcon size={14} /><span>调整照片</span><kbd>V</kbd></button><button aria-pressed={s.frameEditing} disabled={s.workspaceMode === "overview"} title="编辑照片框 F · 拖框移动，拖八个控制点调整框的宽高" onClick={() => commands.current("edit-frames")}><Scan size={14} /><span>编辑照片框</span><kbd>F</kbd></button></div></div><div className="workspace-switch"><span>同屏</span><div className="segmented">{viewModes.map(({ n, name, Icon }) => <button title={`${name}同屏 ⌘${n}`} key={n} className={s.workspaceMode === n ? 'selected' : ''} onClick={() => s.setWorkspaceMode(n)}><Icon size={14} /><span>{name}</span></button>)}<div className={`workspace-more ${typeof s.workspaceMode === "number" && s.workspaceMode > 4 ? "selected" : ""}`}><select aria-label="更多同屏页数" title="六页 ⌘6 · 八页 ⌘8 · 十页 ⌘0" value={typeof s.workspaceMode === "number" && s.workspaceMode > 4 ? String(s.workspaceMode) : ""} onChange={event => { const mode = workspaceModeFromCommand(`view-${event.target.value}`); if (mode) s.setWorkspaceMode(mode); }}><option value="" disabled>更多</option><option value="6">6 页</option><option value="8">8 页</option><option value="10">10 页</option></select><ChevronDown size={12} /></div></div><button className={`overview-toggle ${s.workspaceMode === 'overview' ? 'selected' : ''}`} onClick={() => commands.current('overview')}><LayoutGrid size={14} />总览<kbd>G</kbd></button></div><div className="toolbar-right"><button className="quiet-button add-page-button" title="新增页面 ⇧⌘N" onClick={() => commands.current('add-page')}><Plus size={15} />新增页面</button><button className="icon-button" title="快捷键与使用帮助" onClick={() => setModal('help')}><CircleHelp size={16} /></button><button className="icon-button" title="显示或隐藏页面属性" aria-pressed={rightOpen} onClick={() => setRightOpen(!rightOpen)}><PanelRightClose size={16} /></button></div></div>
    <AssetReconnectPanel notify={notify}/>
    <ToolPanelLayout rightOpen={rightOpen} onShowRight={() => setRightOpen(true)}>{leftOpen && <Sidebar revealTemplateLibrary={templateLibraryReveal} onImport={() => void importPhotos()} onSaveTemplate={() => openSaveTemplate()} onNotify={notify} />}<main className="editor-main">{s.workspaceMode === 'overview' ? <Overview bridge={bridge} onPreview={setPreview} onSaveTemplate={openSaveTemplate} /> : <Workspace bridge={bridge} onSaveTemplate={openSaveTemplate} onImport={ref => void importPhotos(ref)} onEditExternal={async ref => { const current = useEditorStore.getState(); const frame = current.project.pages.find(page => page.id === ref.pageId)?.frames.find(frame => frame.id === ref.frameId); if (!frame?.imageAssetId) return; current.commitTransaction(); try { await openInPhotoshop(current.project.assets[frame.imageAssetId]); notify('在 Photoshop 保存回原路径后，照片会自动同步。'); } catch (error) { notify(String(error)); } }} />}{s.workspaceMode !== 'overview' && <div className="canvas-status"><span><span className="status-dot" />第 {s.project.pages.findIndex(p => p.id === s.activePageId) + 1} 页 · {currentPage.frameRects ? "自定义布局" : s.project.templates[currentPage.templateId]?.name}</span><span className="canvas-hint">{s.photoTransform ? '自由变换 · 拖角缩放 · 移至框外拖动旋转 · Enter 确认 · Esc 取消' : s.backgroundEditing ? '背景调整中 · 拖动图片与四角缩放 · Esc 完成' : s.frameEditing ? '黄色框编辑 · 拖动框或八点调整 · 点框外完成' : s.editingFrame ? '照片调整中 · 双击编辑照片框 · Esc 完成' : s.visiblePageIds.length > 1 ? '拖照片到另一页的框内，直接交换' : '单击调整照片 · 双击编辑照片框'}</span><select aria-label="视图缩放" disabled={s.workspaceMode !== 1} value={s.viewZoom} onChange={e => s.setViewZoom(e.target.value === 'fit' ? 'fit' : +e.target.value)}><option value="fit">适合窗口</option>{[0.25,0.5,0.75,1,1.5,2].map(n => <option key={n} value={n}>{n * 100}%</option>)}</select></div>}</main>{rightOpen && <Inspector onImportBackground={pageId => void importBackground(pageId)} onSaveTemplate={() => openSaveTemplate()} toolPanels={<ToolPanels placement="right" />} onImport={ref => void importPhotos(ref)} onError={notify} onRelink={async id => { if (!native) { notify('浏览器预览请重新导入照片；桌面应用可重新链接原图。'); return; } try { const asset = await relinkAsset(id); if (asset) { s.updateAsset(asset); notify('原图已重新链接'); } } catch (e) { notify(String(e)); } }} />}</ToolPanelLayout>
    {s.workspaceMode !== 'overview' && <PageStrip />}
    </>}
    {home && <input ref={newPhotoInput} className="hidden-input" type="file" accept=".jpg,.jpeg,.png" multiple onChange={event => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (files.length) startFromPhotos(() => importBrowserFiles(files));
    }} />}
    <input ref={backgroundInput} className="hidden-input" type="file" accept=".jpg,.jpeg,.png" onChange={e => { const files = Array.from(e.target.files ?? []).slice(0, 1), pageId = backgroundTarget.current; e.target.value = ''; if (files.length) void importBackgroundResult(() => importBrowserFiles(files), pageId); }} />
    {!home && <input ref={fileInput} className="hidden-input" type="file" accept=".jpg,.jpeg,.png" multiple onChange={e => { const files = Array.from(e.target.files ?? []), target = importTarget.current; e.target.value = ''; void importResult(() => importBrowserFiles(files), target); }} />}<input ref={projectInput} className="hidden-input" type="file" accept=".collage" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) { try { await acceptProject(JSON.parse(await file.text()), file.name); } catch (error) { notify(`打开失败：${String(error)}`); } } }} />
    {dragOver && <div className="precise-drop-hint"><ImagePlus size={17} /><span>{home ? '松开照片，开始新拼图' : '拖到高亮的照片框，松开放入或替换'}</span></div>}
    {(toast || busy) && <div className="toast" role="status">{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}<span>{busy || toast}</span>{!busy && <button title="关闭提示" onClick={() => setToast('')}><X size={13} /></button>}</div>}
    {modal === 'new' && <NewProjectDialog onClose={closeModal} onCreate={options => { void workspace.newWorkspace(false, options).then(() => { closeModal(); showEditor(); }).catch(error => notify(String(error))); }} />}
    {modal === 'long' && <LongImageDialog onClose={closeModal} onCreate={async project => { await acceptProject(project, undefined, true); closeModal(); notify(`已生成长图：${project.document.width} × ${project.document.height} px，可继续调整照片和黄色框。`); }} />}
    {modal === 'watermark' && <ProjectWatermarkDialog bindToProject={!home} onClose={closeModal} onNotify={notify} onBusyChange={value => { watermarkBusy.current = value; }} />}
    {modal === 'export' && <ExportDialog onClose={closeModal} />}
    {modal === 'template' && templateTarget && <SaveTemplateDialog pageId={templateTarget.pageId} projectId={templateTarget.projectId} onClose={closeModal} onSaved={name => { closeModal(); setLeftOpen(true); setTemplateLibraryReveal(value => value + 1); notify(`已保存模板「${name}」，可在左侧我的模板中使用。`); }} />}
    {modal === 'help' && <Modal title="让操作跟上你的想法" onClose={closeModal}><div className="modal-body help-body"><p>顶部「同屏」控制同时编辑几页；左侧「页内模板」控制每页照片如何排列。</p><div className="shortcut-list">{[['长图拼接','选择照片与横/竖方向，生成可自由编辑的单页长图'],['批量水印','以参考图定位图片和文字水印，批量应用到文件夹照片'],['背景颜色','点击右侧颜色块设置 RGB、吸管及保存常用颜色'],['背景图片','拖到右侧背景区，编辑背景后拖动或拖四角缩放'],['双击框内 / F','进入黄色照片框编辑，拖动框或八点调整宽高'],['单击照片 / V','拖照片移图、拖四角缩放，照片框保持不动'],['点击框外','确定照片框编辑，返回照片模式'],['多页页头勾选','勾选要导出的页面；单页不显示勾选'],['页头存为模板','单页、同屏或总览中，直接保存指定页的布局'],['G','总览 / 返回编辑'],['⌘1 — ⌘4','单页、双页、三页、四页同屏'],['⌘6 / ⌘8 / ⌘0','六页、八页、十页同屏'],['总览同屏编辑','最多选择 10 页，只显示选中的页面'],['⌘ 点击 / Shift 点击','多选页面 / 连续选择'],['点选照片','直接移图、拖四角缩放'],['拖角点 / 滚轮','缩放选中的照片'],['⌘T / Ctrl+T','自由变换：拖四角缩放、移至框外拖动旋转；Shift 吸附 15°'],['Enter / Esc','确认自由变换 / 取消本次变换'],['拖动调色标题','浮动或停靠到右侧'],['调色面板设置','调透明度和位置'],['缩略图拖动照片','在总览和底部页面中，拖到具体照片框交换'],['新增页面 ⇧⌘N','保持当前模板，新建独立空白页'],['右键照片框','置于最上层或最下层'],['拖到其他照片框','跨页移动或交换，可使用不同模板'],['右键照片','在 Photoshop 编辑，保存后自动同步'],['空格 + 拖动','平移页面视图'],['空格（总览中）','快速预览当前页'],['⌘Z / ⇧⌘Z','撤销 / 重做'],['⌘S / ⇧⌘S','保存 / 另存为'],['⌘E','从原图导出 JPG / PNG']].map(([key,label]) => <div key={key}><kbd>{key}</kbd><span>{label}</span></div>)}</div><p className="form-note">页面尺寸独立于屏幕显示。照片始终等比裁切，原图不会被修改。</p></div></Modal>}
    {previewPage && <Modal title={`第 ${s.project.pages.findIndex(p => p.id === previewPage.id) + 1} 页`} className="quick-preview" closeOnSpace onClose={closePreview}><div className="quick-preview-image"><Thumbnail project={s.project} page={previewPage} /></div><footer><button className="quiet-button" onClick={closePreview}><ArrowLeft size={14} />返回总览</button><button className="primary-button" onClick={() => { s.setActivePage(previewPage.id); s.setWorkspaceMode(1); setPreview(null); }}>编辑这一页</button></footer></Modal>}
    {pending && <Modal title="保存当前作品？" onClose={() => setPending(null)}><div className="modal-body"><p>{pending.message}</p></div><footer><button className="quiet-button" onClick={() => setPending(null)}>取消</button><button className="quiet-button" onClick={() => { const action = pending.action; setPending(null); void workspace.withoutSaving(action).catch(error => notify(String(error))); }}>不保存</button><button className="primary-button" onClick={async () => { const action = pending.action; if (await save()) { setPending(null); await action(); } }}>保存并继续</button></footer></Modal>}
    {workspace.loading && !projectsOpen && !archiveJob && <Modal title="正在准备作品" onClose={() => {}}><div className="modal-body archive-status"><LoaderCircle size={20} className="spin"/><span>正在保存并切换，请稍候…</span></div></Modal>}
    {projectsOpen && <ProjectDrawer projects={workspace.projects} drafts={workspace.drafts} root={workspace.root} loading={workspace.loading} currentId={workspace.entry?.id} onClose={() => setProjectsOpen(false)} onOpen={openEntry} onNew={async () => { await workspace.newWorkspace(true); showEditor(); }} onDuplicate={workspace.duplicate} onRename={workspace.rename} onDelete={workspace.setDeleted} onImport={importArchive} onError={notify}/>}
    {archiveJob && <ArchiveDialog jobId={archiveJob} onBusyChange={value => { archiveBusy.current = value; }} onClose={() => { archiveBusy.current = false; setArchiveJob(null); }} onComplete={async progress => { if (progress.kind === 'import' && progress.result) { await workspace.activateImported(progress.result); showEditor(); notify('归档已导入，可继续编辑和导出。'); } else if (progress.kind === 'export') notify('完整归档已生成，原项目引用保持不变。'); }}/>}
  </div>;
}
