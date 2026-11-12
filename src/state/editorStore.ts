import { create } from 'zustand';
import type { AssetRuntime, DocumentSize, Frame, FrameRef, ImageAsset, ImageTransform, Page, PhotoAdjustments, Project, ProjectOutputSettings, Rect, TemplateDefinition } from '../core/types';
import { BUILTIN_TEMPLATES, createPage, createProject, defaultTransform, newId, type NewProjectOptions } from '../core/templates';
import { portraitCanvasFromPhoto } from '../core/photoSize';
import { ADJUSTMENT_KEYS, adjustmentLimit, defaultAdjustments } from '../core/photoAdjustments';
import { geometry } from '../core/engine';
import { normalizedFrameRect, normalizeLayoutFrames } from '../core/freeLayout';
import { useTemplateLibraryStore } from './templateLibraryStore';
import { validateAsset, validateDocument, validateProject } from './validateProject';
import { isWorkspacePageCount, type WorkspaceMode, type WorkspacePageCount } from '../core/workspaceModes';

export type { WorkspaceMode } from '../core/workspaceModes';
export interface HistoryEntry { label: string; before: Project; after: Project; beforeRevision: number; afterRevision: number }
interface Transaction { label: string; before: Project; beforeRevision: number }
export type PagePatch = Partial<Pick<Page, 'name' | 'background' | 'margin' | 'columnGap' | 'rowGap' | 'templateState'>>;
export type TransformPatch = Omit<Partial<ImageTransform>, 'adjustments'> & { adjustments?: Partial<PhotoAdjustments> };
export interface BackgroundImagePatch { opacity?: number; transform?: TransformPatch }
export interface SelectPageOptions { toggle?: boolean; range?: boolean }

type DocumentValidator = (project: Project) => void;
let documentValidator: DocumentValidator | undefined;
/** Install the shared WASM validator once the engine is ready. Gestures validate
 * only their committed document; their temporary previews stay responsive. */
export function setDocumentValidator(validator: DocumentValidator | undefined): void {
  documentValidator = validator;
}
function validatedProject(project: Project): Project {
  const result = validateProject(project);
  documentValidator?.(result);
  return result;
}

export interface EditorState {
  project: Project; revision: number; savedRevision: number; projectPath: string | null;
  activePageId: string; selectedPageIds: string[]; visiblePageIds: string[];
  workspaceMode: WorkspaceMode; previousMode: WorkspacePageCount; workspaceSelectionOnly: boolean;
  selectedFrame: FrameRef | null; editingFrame: FrameRef | null; photoTransform: FrameRef | null; frameEditing: boolean; backgroundEditing: boolean; viewZoom: 'fit' | number;
  runtimeAssets: Record<string, AssetRuntime>; history: HistoryEntry[]; future: HistoryEntry[];
  undoCount: number; redoCount: number; transaction: Transaction | null; nextRevision: number; selectionAnchor: string;
  outputSettings: ProjectOutputSettings;
  updateOutputSettings(patch: ProjectOutputSettings): void;
  newProject(options?: NewProjectOptions): void;
  loadProject(project: Project, path?: string): void;
  restoreProject(project: Project): void;
  renameProject(name: string): void;
  updateDocument(patch: Partial<Pick<DocumentSize, 'width' | 'height'>>): void;
  updateAsset(asset: ImageAsset): void;
  refreshAssets(assets: ImageAsset[], fromPaths?: Record<string, string>): void;
  setActivePage(id: string): void;
  selectPage(id: string, options?: SelectPageOptions): void;
  togglePageSelection(id: string, selected?: boolean): void;
  setSelectedPageIds(ids: string[]): void;
  setWorkspaceMode(mode: WorkspaceMode, options?: { onlySelected?: boolean }): void;
  returnToEditor(): void;
  setSelectedFrame(ref: FrameRef | null): void;
  setEditingFrame(ref: FrameRef | null): void;
  beginPhotoTransform(): boolean;
  commitPhotoTransform(): void;
  cancelPhotoTransform(): void;
  setFrameEditing(enabled: boolean): void;
  setBackgroundEditing(enabled: boolean): void;
  setBackgroundImage(pageId: string, assetId: string | null): void;
  assignBackgroundAsset(asset: ImageAsset, pageId?: string): void;
  updateBackgroundImage(pageId: string, patch: BackgroundImagePatch): void;
  setViewZoom(zoom: 'fit' | number): void;
  addPage(templateId?: string): string;
  deletePages(ids: string[]): void;
  duplicatePages(ids: string[]): string[];
  reorderPages(ids: string[]): void;
  applyTemplate(ids: string[], templateId: string): void;
  updateFrameRect(ref: FrameRef, rect: Rect): void;
  addFreeFrame(pageId?: string): FrameRef | null;
  removeFreeFrame(ref: FrameRef): void;
  reorderFrameLayer(ref: FrameRef, position: 'front' | 'back'): void;
  savePageTemplate(name: string, pageId?: string): TemplateDefinition;
  updatePage(ids: string[], patch: PagePatch): void;
  updateTransform(ref: FrameRef, patch: TransformPatch): void;
  replaceFrame(ref: FrameRef, assetId: string | null): void;
  assignAssets(assets: ImageAsset[], target?: FrameRef, pageId?: string): void;
  swapFrames(from: FrameRef, to: FrameRef): void;
  setRuntime(assetId: string, runtime: AssetRuntime): void;
  beginTransaction(label?: string): void;
  commitTransaction(): void;
  cancelTransaction(): void;
  undo(): void;
  redo(): void;
  markSaved(revision: number, path?: string, projectId?: string): void;
}

const MAX_HISTORY = 80;
// Fifty-page projects still need several dozen fine composition adjustments.
// Keep a finite budget while allowing all 80 steps for ordinary asset metadata.
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const frameAt = (project: Project, ref: FrameRef) => {
  const page = project.pages.find(page => page.id === ref.pageId);
  return page?.frames.find(frame => frame.id === ref.frameId) ?? page?.unplaced.find(frame => frame.id === ref.frameId);
};
const placedFrameAt = (project: Project, ref: FrameRef) => project.pages.find(page => page.id === ref.pageId)?.frames.find(frame => frame.id === ref.frameId);
const sameProject = (a: Project, b: Project) => JSON.stringify(a) === JSON.stringify(b);
function patchTransform(transform: ImageTransform, patch: TransformPatch, maxZoom = 100): void {
  if (patch.focusX !== undefined && Number.isFinite(patch.focusX)) transform.focusX = Math.max(0, Math.min(1, patch.focusX));
  if (patch.focusY !== undefined && Number.isFinite(patch.focusY)) transform.focusY = Math.max(0, Math.min(1, patch.focusY));
  if (patch.zoom !== undefined && Number.isFinite(patch.zoom)) transform.zoom = Math.max(1, Math.min(maxZoom, patch.zoom));
  if (patch.rotation !== undefined && Number.isFinite(patch.rotation)) transform.rotation = Math.max(-180, Math.min(180, patch.rotation));
  if (patch.adjustments) {
    const adjustments = { ...defaultAdjustments(), ...transform.adjustments };
    for (const key of ADJUSTMENT_KEYS) {
      const value = patch.adjustments[key], limit = adjustmentLimit(key);
      if (value !== undefined && Number.isFinite(value)) adjustments[key] = Math.max(-limit, Math.min(limit, value));
    }
    transform.adjustments = adjustments;
  }
  // Flips are not supported by the current rendering contract.
}
function resizeDocument(project: Project, document: DocumentSize): void {
  const sx = document.width / project.document.width;
  const sy = document.height / project.document.height;
  for (const page of project.pages) {
    page.margin = { left: page.margin.left * sx, right: page.margin.right * sx, top: page.margin.top * sy, bottom: page.margin.bottom * sy };
    page.columnGap *= sx; page.rowGap *= sy;
  }
  project.document = document;
}
const historySizes = new WeakMap<HistoryEntry, number>();
function capHistory(entries: HistoryEntry[]) {
  const kept: HistoryEntry[] = [];
  let bytes = 0;
  for (let i = entries.length - 1; i >= 0 && kept.length < MAX_HISTORY; i--) {
    const entry = entries[i];
    const size = historySizes.get(entry) ?? JSON.stringify(entry).length * 2;
    historySizes.set(entry, size);
    if (kept.length > 0 && bytes + size > MAX_HISTORY_BYTES) break;
    kept.unshift(entries[i]); bytes += size;
  }
  return kept;
}

function initialSession(project: Project) {
  const first = project.pages[0].id;
  return {
    project, revision: 0, savedRevision: 0, projectPath: null, activePageId: first,
    selectedPageIds: [first], visiblePageIds: [first], workspaceMode: 1 as WorkspaceMode, previousMode: 1 as const, workspaceSelectionOnly: false,
    selectedFrame: null, editingFrame: null, photoTransform: null, frameEditing: false, backgroundEditing: false, viewZoom: 'fit' as const, runtimeAssets: {}, history: [], future: [],
    undoCount: 0, redoCount: 0, transaction: null, nextRevision: 1, selectionAnchor: first, outputSettings: {},
  };
}

function visiblePages(project: Project, desired: number, preferred: string[], activeId: string, fill = true): string[] {
  const all = project.pages.map(page => page.id);
  const selected = [...new Set(preferred)].filter(id => all.includes(id));
  const result = selected.slice(0, desired);
  if (!fill) return result.length ? result : [all.includes(activeId) ? activeId : all[0]];
  const start = Math.max(0, all.indexOf(activeId));
  for (const id of [...all.slice(start), ...all.slice(0, start)]) {
    if (result.length >= desired) break;
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

/** Keeps ephemeral references valid after deletion, template changes, undo and redo. */
function reconcile(state: EditorState, project: Project): Partial<EditorState> {
  const all = project.pages.map(page => page.id);
  let activePageId = all.includes(state.activePageId) ? state.activePageId : all[0];
  // Export selection is independent of the active/visible page. In particular,
  // undo, deletion and ordinary edits must not silently recheck an empty set.
  const selectedPageIds = state.selectedPageIds.filter(id => all.includes(id));
  const mode = state.workspaceMode === 'overview' ? state.previousMode : state.workspaceMode;
  const visiblePageIds = visiblePages(project, mode, state.visiblePageIds.filter(id => all.includes(id)), activePageId, !state.workspaceSelectionOnly);
  if (state.workspaceMode !== 'overview' && !visiblePageIds.includes(activePageId)) activePageId = visiblePageIds[0];
  return {
    activePageId, selectedPageIds, visiblePageIds,
    runtimeAssets: Object.fromEntries(Object.entries(state.runtimeAssets).filter(([id]) =>
      project.assets[id] && JSON.stringify(project.assets[id]) === JSON.stringify(state.project.assets[id]))),
    selectedFrame: state.selectedFrame && (state.frameEditing ? placedFrameAt(project, state.selectedFrame) : frameAt(project, state.selectedFrame)) ? state.selectedFrame : null,
    editingFrame: !state.frameEditing && state.editingFrame && frameAt(project, state.editingFrame) ? state.editingFrame : null,
    photoTransform: state.photoTransform && placedFrameAt(project, state.photoTransform)?.imageAssetId ? state.photoTransform : null,
    backgroundEditing: state.backgroundEditing && activePageId === state.activePageId && Boolean(project.pages.find(page => page.id === activePageId)?.backgroundImage),
    selectionAnchor: all.includes(state.selectionAnchor) ? state.selectionAnchor : activePageId,
  };
}

export const createEditorStore = (initialProject: Project = createProject()) => create<EditorState>((set, get) => {
  const mutate = (label: string, operation: (draft: Project) => void, photoTransformRef?: FrameRef) => {
    const session = get().photoTransform;
    // A free transform owns one transaction across multiple pointer gestures.
    // Unrelated document edits must not accidentally become part of that undo.
    if (session && (!photoTransformRef || session.pageId !== photoTransformRef.pageId || session.frameId !== photoTransformRef.frameId)) get().commitPhotoTransform();
    const state = get();
    const draft = structuredClone(state.project);
    operation(draft);
    if (sameProject(state.project, draft)) return;
    if (!state.transaction) documentValidator?.(draft);
    const revision = state.nextRevision;
    const entry: HistoryEntry = { label, before: state.project, after: draft, beforeRevision: state.revision, afterRevision: revision };
    const history = state.transaction ? state.history : capHistory([...state.history, entry]);
    const future = state.transaction ? state.future : [];
    set({ project: draft, revision, nextRevision: revision + 1, history, future, undoCount: history.length, redoCount: future.length, ...reconcile(state, draft) });
  };
  const validRef = (ref: FrameRef | null) => ref !== null && Boolean(get().frameEditing ? placedFrameAt(get().project, ref) : frameAt(get().project, ref));
  const templateById = (templateId: string) => get().project.templates[templateId] ?? BUILTIN_TEMPLATES[templateId]
    ?? useTemplateLibraryStore.getState().templates.find(template => template.id === templateId);
  const pageLayout = (project: Project, page: Page) => {
    const resolved = new Map(geometry().layout(page, project.document, project.templates[page.templateId]).frames.map(frame => [frame.slotId, frame]));
    // Template geometry is identified by slot, while placements carry the
    // persistent bottom-to-top layer order. Keep that order in saved recipes.
    return normalizeLayoutFrames(page.frames.map(frame => resolved.get(frame.slotId)!), project.document);
  };
  const installFreeLayout = (project: Project, page: Page, frames: ReturnType<typeof pageLayout>) => {
    const oldTemplateId = page.templateId, id = newId('page-free');
    project.templates[id] = { id, version: 1, name: '自由布局', category: '自由布局', root: { kind: 'free', frames }, defaults: {}, slotOrder: frames.map(frame => frame.slotId) };
    page.templateId = id; page.templateState = {}; delete page.frameRects;
    // Duplicated pages may still reference the previous private recipe.
    if (oldTemplateId.startsWith('page-free_') && !project.pages.some(other => other.templateId === oldTemplateId)) delete project.templates[oldTemplateId];
  };
  return {
    ...initialSession(validatedProject(initialProject)),
    updateOutputSettings: patch => {
      const previous = get().outputSettings;
      const next = { ...previous, ...patch };
      if (JSON.stringify(next) !== JSON.stringify(previous)) set({ outputSettings: next });
    },
    newProject: options => set(initialSession(validatedProject(createProject(options)))),
    loadProject: (project, path) => set({ ...initialSession(validatedProject(project)), savedRevision: 0, projectPath: path ?? null }),
    restoreProject: project => set({ ...initialSession(validatedProject(project)), savedRevision: -1 }),
    renameProject: name => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 4096) throw new Error('项目名称须为 1～4096 个字符');
      mutate('重命名项目', project => { project.name = trimmed; });
    },
    updateDocument: patch => {
      const document = { ...get().project.document, ...patch };
      validateDocument(document);
      mutate('调整页面尺寸', project => {
        resizeDocument(project, document);
        project.canvasSizing = 'fixed';
      });
    },
    updateAsset: asset => {
      validateAsset(asset);
      if (!get().project.assets[asset.id]) throw new Error('找不到待重新链接的照片');
      mutate('重新链接照片', project => { project.assets[asset.id] = structuredClone(asset); });
    },
    refreshAssets: (assets, fromPaths) => {
      assets.forEach(validateAsset);
      const state = get();
      const changes = new Map(assets.filter(asset => {
        const current = state.project.assets[asset.id];
        return current?.originalPath === (fromPaths?.[asset.id] ?? asset.originalPath) && JSON.stringify(current) !== JSON.stringify(asset);
      }).map(asset => [asset.id, structuredClone(asset)]));
      if (!changes.size) return;
      const refresh = (project: Project): Project => {
        let updated = project;
        for (const [id, asset] of changes) {
          if (project.assets[id]?.originalPath !== (fromPaths?.[id] ?? asset.originalPath)) continue;
          if (updated === project) updated = { ...project, assets: { ...project.assets } };
          updated.assets[id] = asset;
        }
        return updated;
      };
      // External edits are not undoable. Update asset versions throughout history,
      // while leaving unrelated paths (including a relink's prior path) intact.
      // New revision identities prevent old saved/in-flight revisions from making
      // a refreshed undo/redo snapshot appear clean when its fingerprint changed.
      const revisions = new Set([state.revision]);
      for (const entry of [...state.history, ...state.future]) { revisions.add(entry.beforeRevision); revisions.add(entry.afterRevision); }
      if (state.transaction) revisions.add(state.transaction.beforeRevision);
      const replacementRevisions = new Map([...revisions].sort((a, b) => a - b).map((revision, index) => [revision, state.nextRevision + index]));
      const revisionOf = (revision: number) => replacementRevisions.get(revision)!;
      const updateEntry = (entry: HistoryEntry): HistoryEntry => ({
        ...entry, before: refresh(entry.before), after: refresh(entry.after),
        beforeRevision: revisionOf(entry.beforeRevision), afterRevision: revisionOf(entry.afterRevision),
      });
      const project = refresh(state.project);
      // Gesture controls use transaction identity to decide who may commit it.
      // Keep that ephemeral identity while refreshing its immutable document.
      const transaction = state.transaction;
      if (transaction) {
        transaction.before = refresh(transaction.before);
        transaction.beforeRevision = revisionOf(transaction.beforeRevision);
      }
      set({
        project, revision: revisionOf(state.revision), nextRevision: state.nextRevision + replacementRevisions.size,
        history: state.history.map(updateEntry), future: state.future.map(updateEntry),
        transaction,
        ...reconcile(state, project),
      });
    },
    setActivePage: id => {
      if (!get().project.pages.some(page => page.id === id)) return;
      get().commitPhotoTransform();
      const state = get();
      const mode = state.workspaceMode === 'overview' ? state.previousMode : state.workspaceMode;
      const alreadyVisible = state.visiblePageIds.includes(id);
      const visiblePageIds = alreadyVisible ? state.visiblePageIds : visiblePages(state.project, mode, [id], id);
      set({ activePageId: id, visiblePageIds, workspaceSelectionOnly: alreadyVisible && state.workspaceSelectionOnly, editingFrame: null, selectedFrame: null, backgroundEditing: false });
    },
    selectPage: (id, options = {}) => {
      if (!get().project.pages.some(page => page.id === id)) return;
      get().commitPhotoTransform();
      const state = get();
      const ids = state.project.pages.map(page => page.id);
      if (!ids.includes(id)) return;
      let selectedPageIds = [id];
      if (options.range) {
        const start = Math.max(0, ids.indexOf(state.selectionAnchor));
        const end = ids.indexOf(id);
        const range = ids.slice(Math.min(start, end), Math.max(start, end) + 1);
        selectedPageIds = options.toggle ? ids.filter(value => state.selectedPageIds.includes(value) || range.includes(value)) : range;
      } else if (options.toggle) {
        selectedPageIds = state.selectedPageIds.includes(id) ? state.selectedPageIds.filter(value => value !== id) : ids.filter(value => value === id || state.selectedPageIds.includes(value));
      }
      set({ activePageId: id, selectedPageIds, selectionAnchor: options.range ? state.selectionAnchor : id, selectedFrame: null, editingFrame: null, backgroundEditing: false });
      if (state.workspaceMode !== 'overview' && !state.visiblePageIds.includes(id)) get().setActivePage(id);
    },
    togglePageSelection: (id, selected) => {
      const state = get();
      if (!state.project.pages.some(page => page.id === id)) return;
      const wanted = new Set(state.selectedPageIds);
      const checked = selected ?? !wanted.has(id);
      if (checked === wanted.has(id)) return;
      if (checked) wanted.add(id); else wanted.delete(id);
      set({ selectedPageIds: state.project.pages.filter(page => wanted.has(page.id)).map(page => page.id) });
    },
    setSelectedPageIds: ids => {
      const state = get(), wanted = new Set(ids);
      const selectedPageIds = state.project.pages.filter(page => wanted.has(page.id)).map(page => page.id);
      if (selectedPageIds.length === state.selectedPageIds.length && selectedPageIds.every((id, index) => id === state.selectedPageIds[index])) return;
      set({ selectedPageIds });
    },
    setWorkspaceMode: (mode, options = {}) => {
      if (mode !== 'overview' && !isWorkspacePageCount(mode)) return;
      get().commitPhotoTransform();
      const state = get();
      if (mode === 'overview') {
        set({ previousMode: state.workspaceMode === 'overview' ? state.previousMode : state.workspaceMode, workspaceMode: 'overview', editingFrame: null, backgroundEditing: false });
        return;
      }
      if (!isWorkspacePageCount(mode)) return;
      const workspaceSelectionOnly = Boolean(options.onlySelected);
      const preferred = workspaceSelectionOnly || mode > 1 && state.selectedPageIds.length > 1 ? state.selectedPageIds : [state.activePageId];
      const visiblePageIds = visiblePages(state.project, mode, preferred, state.activePageId, !workspaceSelectionOnly);
      set({ workspaceMode: mode, previousMode: mode, visiblePageIds, workspaceSelectionOnly, activePageId: visiblePageIds.includes(state.activePageId) ? state.activePageId : visiblePageIds[0], editingFrame: null, backgroundEditing: false, viewZoom: 'fit' });
    },
    returnToEditor: () => {
      get().commitPhotoTransform();
      const state = get();
      const alreadyVisible = state.visiblePageIds.includes(state.activePageId);
      const visiblePageIds = alreadyVisible
        ? state.visiblePageIds : visiblePages(state.project, state.previousMode, [state.activePageId], state.activePageId);
      set({ workspaceMode: state.previousMode, visiblePageIds, workspaceSelectionOnly: alreadyVisible && state.workspaceSelectionOnly, editingFrame: null });
    },
    setSelectedFrame: ref => {
      if (ref === null) { get().commitPhotoTransform(); set({ selectedFrame: null, editingFrame: null, backgroundEditing: false }); return; }
      if (validRef(ref)) {
        const session = get().photoTransform;
        if (session && (session.pageId !== ref.pageId || session.frameId !== ref.frameId)) get().commitPhotoTransform();
        const editing = get().editingFrame;
        const editingFrame = !get().frameEditing && editing?.pageId === ref.pageId && editing.frameId === ref.frameId ? editing : null;
        set({ selectedFrame: ref, activePageId: ref.pageId, editingFrame, backgroundEditing: false });
      }
    },
    setEditingFrame: ref => {
      if (ref === null) { get().commitPhotoTransform(); set({ editingFrame: null, backgroundEditing: false }); return; }
      if (get().frameEditing) return;
      if (validRef(ref)) {
        const session = get().photoTransform;
        if (session && (session.pageId !== ref.pageId || session.frameId !== ref.frameId)) get().commitPhotoTransform();
        set({ editingFrame: ref, selectedFrame: ref, activePageId: ref.pageId, backgroundEditing: false });
      }
    },
    beginPhotoTransform: () => {
      const state = get(), ref = state.selectedFrame;
      if (!ref || !placedFrameAt(state.project, ref)?.imageAssetId) return false;
      if (state.photoTransform?.pageId === ref.pageId && state.photoTransform.frameId === ref.frameId) return true;
      get().commitTransaction();
      const current = get();
      set({ photoTransform: { ...ref }, selectedFrame: ref, editingFrame: ref, frameEditing: false, backgroundEditing: false,
        transaction: { label: '自由变换照片', before: current.project, beforeRevision: current.revision } });
      return true;
    },
    commitPhotoTransform: () => { if (get().photoTransform) get().commitTransaction(); },
    cancelPhotoTransform: () => { if (get().photoTransform) get().cancelTransaction(); },
    setFrameEditing: enabled => {
      get().commitTransaction();
      const state = get();
      set({ frameEditing: enabled, editingFrame: null, backgroundEditing: false,
        selectedFrame: enabled && state.selectedFrame && !placedFrameAt(state.project, state.selectedFrame) ? null : state.selectedFrame });
    },
    setBackgroundEditing: enabled => {
      get().commitTransaction();
      const state = get();
      const backgroundEditing = enabled && Boolean(state.project.pages.find(page => page.id === state.activePageId)?.backgroundImage);
      set({ backgroundEditing, ...(backgroundEditing ? { selectedFrame: null, editingFrame: null, frameEditing: false } : {}) });
    },
    setBackgroundImage: (pageId, assetId) => {
      get().commitTransaction();
      mutate(assetId === null ? '移除背景图片' : '更换背景图片', project => {
        const page = project.pages.find(page => page.id === pageId);
        if (!page || (assetId !== null && !project.assets[assetId])) return;
        if (assetId === null) delete page.backgroundImage;
        else page.backgroundImage = { imageAssetId: assetId, opacity: 1, transform: defaultTransform() };
      });
    },
    assignBackgroundAsset: (asset, pageId) => {
      validateAsset(asset);
      get().commitTransaction();
      const target = pageId ?? get().activePageId;
      mutate('导入背景图片', project => {
        const page = project.pages.find(page => page.id === target);
        if (!page) return;
        if (project.canvasSizing === 'first-photo' && Object.keys(project.assets).length === 0) {
          resizeDocument(project, { ...project.document, ...portraitCanvasFromPhoto(asset.width, asset.height) });
        }
        project.assets[asset.id] = structuredClone(asset);
        page.backgroundImage = { imageAssetId: asset.id, opacity: 1, transform: defaultTransform() };
      });
      // Import decoding is asynchronous. Keep its original page target without
      // pulling the user back from another page they selected in the meantime.
      const current = get();
      if (current.activePageId === target && current.project.pages.find(page => page.id === target)?.backgroundImage?.imageAssetId === asset.id) {
        set({ selectedFrame: null, editingFrame: null, frameEditing: false, backgroundEditing: true });
      }
    },
    updateBackgroundImage: (pageId, patch) => mutate('调整背景图片', project => {
      const background = project.pages.find(page => page.id === pageId)?.backgroundImage;
      if (!background) return;
      if (patch.opacity !== undefined && Number.isFinite(patch.opacity)) background.opacity = Math.max(0, Math.min(1, patch.opacity));
      if (patch.transform) patchTransform(background.transform, patch.transform, 8);
    }),
    setViewZoom: zoom => { if (zoom === 'fit' || (Number.isFinite(zoom) && zoom >= 0.001 && zoom <= 4)) set({ viewZoom: zoom }); },
    addPage: (templateId = 'split-y') => {
      const state = get();
      const template = templateById(templateId);
      if (!template) throw new Error(`找不到模板：${templateId}`);
      const page = createPage(templateId, { [templateId]: template }, state.project.document);
      page.name = `页面 ${String(state.project.pages.length + 1).padStart(2, '0')}`;
      mutate('添加页面', project => { project.templates[templateId] ??= structuredClone(template); project.pages.push(page); });
      // A newly created page becomes the editing target without discarding or
      // adding to the pages the user already checked for export.
      get().setActivePage(page.id);
      return page.id;
    },
    deletePages: ids => {
      const removed = new Set(ids);
      mutate('删除页面', project => {
        project.pages = project.pages.filter(page => !removed.has(page.id));
        if (!project.pages.length) {
          const page = createPage('split-y', { ...BUILTIN_TEMPLATES, ...project.templates }, project.document); page.name = '页面 01'; project.pages.push(page);
          project.templates['split-y'] ??= structuredClone(BUILTIN_TEMPLATES['split-y']);
        }
      });
    },
    duplicatePages: ids => {
      const wanted = new Set(ids);
      const duplicates: string[] = [];
      mutate('复制页面', project => {
        project.pages = project.pages.flatMap(page => {
          if (!wanted.has(page.id)) return [page];
          const copy = structuredClone(page);
          copy.id = newId('page'); copy.name = `${page.name} 副本`;
          [...copy.frames, ...copy.unplaced].forEach(frame => { frame.id = newId('frame'); });
          duplicates.push(copy.id); return [page, copy];
        });
      });
      if (duplicates.length) {
        set({ selectedPageIds: duplicates, selectionAnchor: duplicates[0] }); get().setActivePage(duplicates[0]);
      }
      return duplicates;
    },
    reorderPages: ids => {
      const current = get().project.pages;
      if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some(id => !current.some(page => page.id === id))) return;
      mutate('调整页面顺序', project => { const pages = new Map(project.pages.map(page => [page.id, page])); project.pages = ids.map(id => pages.get(id)!); });
    },
    applyTemplate: (ids, templateId) => {
      const template = templateById(templateId);
      if (!template) throw new Error(`找不到模板：${templateId}`);
      const wanted = new Set(ids);
      mutate('更换页面模板', project => {
        const pages = project.pages.filter(page => wanted.has(page.id) && (page.templateId !== templateId || page.frameRects !== undefined));
        if (!pages.length) return;
        project.templates[templateId] ??= structuredClone(template);
        for (const page of pages) {
          const used = new Set<string>();
          const bySlot = new Map(page.frames.map(frame => [frame.slotId, frame]));
          const mapped = template.slotOrder.map(slotId => {
            const old = bySlot.get(slotId);
            if (old) used.add(old.id);
            return old ? { ...old, slotId } : null;
          });
          const remaining = [...page.frames, ...page.unplaced].filter(frame => !used.has(frame.id) && frame.imageAssetId !== null);
          page.frames = mapped.map((frame, index) => {
            if (frame?.imageAssetId) return frame;
            const candidate = remaining.shift();
            if (candidate) return { ...candidate, slotId: template.slotOrder[index] };
            return frame ?? { id: newId('frame'), slotId: template.slotOrder[index], imageAssetId: null, transform: defaultTransform() };
          });
          page.unplaced = remaining;
          page.templateId = templateId; page.templateState = structuredClone(template.defaults);
          delete page.frameRects;
        }
      });
    },
    updateFrameRect: (ref, rect) => {
      const normalized = normalizedFrameRect(rect);
      mutate('调整照片框', project => {
        const page = project.pages.find(page => page.id === ref.pageId);
        const frame = page?.frames.find(frame => frame.id === ref.frameId);
        if (!page || !frame) return;
        page.frameRects ??= Object.fromEntries(pageLayout(project, page).map(({ slotId, rect }) => [slotId, rect]));
        page.frameRects[frame.slotId] = normalized;
      });
    },
    addFreeFrame: pageId => {
      get().commitTransaction();
      const target = pageId ?? get().activePageId;
      let ref: FrameRef | null = null;
      mutate('添加照片框', project => {
        const page = project.pages.find(page => page.id === target);
        if (!page) return;
        if (page.frames.length >= 64) throw new Error('每页最多添加 64 个照片框');
        const frames = pageLayout(project, page), slotId = newId('slot');
        frames.push({ slotId, rect: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } });
        installFreeLayout(project, page, frames);
        const frame: Frame = { id: newId('frame'), slotId, imageAssetId: null, transform: defaultTransform() };
        page.frames.push(frame); ref = { pageId: page.id, frameId: frame.id };
      });
      if (ref) set({ selectedFrame: ref, activePageId: target, frameEditing: true, editingFrame: null, backgroundEditing: false });
      return ref;
    },
    removeFreeFrame: ref => {
      get().commitTransaction();
      mutate('移除照片框', project => {
        const page = project.pages.find(page => page.id === ref.pageId);
        const frame = page?.frames.find(frame => frame.id === ref.frameId);
        if (!page || !frame) return;
        if (page.frames.length <= 1) throw new Error('每页至少保留一个照片框');
        const frames = pageLayout(project, page).filter(value => value.slotId !== frame.slotId);
        page.frames = page.frames.filter(value => value.id !== ref.frameId);
        if (frame.imageAssetId) page.unplaced.push(frame);
        installFreeLayout(project, page, frames);
      });
    },
    reorderFrameLayer: (ref, position) => {
      if (position !== 'front' && position !== 'back') return;
      const page = get().project.pages.find(page => page.id === ref.pageId);
      const index = page?.frames.findIndex(frame => frame.id === ref.frameId) ?? -1;
      if (!page || index < 0 || (position === 'front' ? index === page.frames.length - 1 : index === 0)) return;
      get().commitTransaction();
      mutate(position === 'front' ? '照片框置于顶层' : '照片框置于底层', project => {
        const page = project.pages.find(page => page.id === ref.pageId)!;
        const index = page.frames.findIndex(frame => frame.id === ref.frameId);
        const [frame] = page.frames.splice(index, 1);
        if (position === 'front') page.frames.push(frame);
        else page.frames.unshift(frame);
      });
    },
    savePageTemplate: (name, pageId) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 200 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error('模板名称须为 1～200 个字符');
      const state = get(), page = state.project.pages.find(page => page.id === (pageId ?? state.activePageId));
      if (!page) throw new Error('要保存的页面已不存在，请重新选择页面。');
      const frames = pageLayout(state.project, page), id = newId('user');
      const template: TemplateDefinition = { id, version: 1, name: trimmed, category: '自定义', root: { kind: 'free', frames }, defaults: {}, slotOrder: frames.map(frame => frame.slotId) };
      useTemplateLibraryStore.getState().save(template);
      return template;
    },
    updatePage: (ids, patch) => {
      const wanted = new Set(ids);
      mutate('调整页面', project => {
        for (const page of project.pages) {
          if (!wanted.has(page.id)) continue;
          if (patch.name !== undefined && patch.name.length <= 4096) page.name = patch.name;
          if (patch.background !== undefined && /^#[\da-fA-F]{6}$/.test(patch.background)) page.background = patch.background;
          if (patch.margin && Object.values(patch.margin).every(value => Number.isFinite(value) && value >= 0)
            && patch.margin.left + patch.margin.right < project.document.width
            && patch.margin.top + patch.margin.bottom < project.document.height) page.margin = { ...patch.margin };
          if (patch.columnGap !== undefined && Number.isFinite(patch.columnGap) && patch.columnGap >= 0 && patch.columnGap <= 32768) page.columnGap = patch.columnGap;
          if (patch.rowGap !== undefined && Number.isFinite(patch.rowGap) && patch.rowGap >= 0 && patch.rowGap <= 32768) page.rowGap = patch.rowGap;
          if (patch.templateState) {
            for (const [key, weights] of Object.entries(patch.templateState)) {
              const defaults = project.templates[page.templateId].defaults[key];
              if (defaults && weights.length === defaults.length && weights.every(value => Number.isFinite(value) && value > 0)) {
                const sum = weights.reduce((a, b) => a + b, 0);
                if (Number.isFinite(sum)) page.templateState[key] = weights.map(value => value / sum);
              }
            }
          }
        }
      });
    },
    updateTransform: (ref, patch) => mutate('调整照片构图', project => {
      const frame = frameAt(project, ref);
      if (!frame) return;
      patchTransform(frame.transform, patch);
    }, ref),
    replaceFrame: (ref, assetId) => mutate(assetId ? '替换照片' : '移除照片', project => {
      const frame = frameAt(project, ref);
      if (!frame || (assetId !== null && !project.assets[assetId])) return;
      frame.imageAssetId = assetId; frame.transform = defaultTransform();
    }),
    assignAssets: (assets, target, importedPageId) => {
      if (!assets.length) return;
      assets.forEach(validateAsset);
      const state = get();
      const pageId = target?.pageId ?? importedPageId ?? state.activePageId;
      mutate('导入照片', project => {
        const page = project.pages.find(value => value.id === pageId);
        if (!page) return;
        let targets: Frame[];
        if (target) {
          const index = page.frames.findIndex(frame => frame.id === target.frameId);
          if (index < 0) return;
          targets = page.frames.slice(index);
        } else {
          const empty = page.frames.filter(frame => frame.imageAssetId === null);
          targets = empty.length ? empty : page.frames;
        }
        if (project.canvasSizing === 'first-photo' && Object.keys(project.assets).length === 0) {
          const size = portraitCanvasFromPhoto(assets[0].width, assets[0].height);
          resizeDocument(project, { ...project.document, ...size });
        }
        for (const asset of assets) project.assets[asset.id] = structuredClone(asset);
        assets.forEach((asset, index) => {
          const frame = targets[index];
          if (frame) { frame.imageAssetId = asset.id; frame.transform = defaultTransform(); }
          else page.unplaced.push({ id: newId('frame'), slotId: `unplaced-${newId('slot')}`, imageAssetId: asset.id, transform: defaultTransform() });
        });
      });
    },
    swapFrames: (from, to) => {
      if (from.pageId === to.pageId && from.frameId === to.frameId) return;
      mutate('交换照片', project => {
        const source = frameAt(project, from); const destination = frameAt(project, to);
        if (!source || !destination || source.imageAssetId === null) return;
        const asset = source.imageAssetId; const transform = source.transform;
        source.imageAssetId = destination.imageAssetId;
        source.transform = destination.imageAssetId ? destination.transform : defaultTransform();
        destination.imageAssetId = asset; destination.transform = transform;
        for (const page of project.pages) {
          if (page.id === from.pageId || page.id === to.pageId) page.unplaced = page.unplaced.filter(frame => frame.imageAssetId !== null);
        }
      });
    },
    setRuntime: (assetId, runtime) => set(state => ({ runtimeAssets: { ...state.runtimeAssets, [assetId]: runtime } })),
    beginTransaction: (label = '调整构图') => {
      const state = get();
      if (!state.transaction) set({ transaction: { label, before: state.project, beforeRevision: state.revision } });
    },
    commitTransaction: () => {
      const state = get(); const transaction = state.transaction;
      if (!transaction) { if (state.photoTransform) set({ photoTransform: null }); return; }
      if (sameProject(transaction.before, state.project)) { set({ transaction: null, photoTransform: null, revision: transaction.beforeRevision }); return; }
      try {
        documentValidator?.(state.project);
      } catch (error) {
        get().cancelTransaction();
        throw error;
      }
      const history = capHistory([...state.history, { label: transaction.label, before: transaction.before, after: state.project, beforeRevision: transaction.beforeRevision, afterRevision: state.revision }]);
      set({ history, future: [], undoCount: history.length, redoCount: 0, transaction: null, photoTransform: null });
    },
    cancelTransaction: () => {
      const state = get(); const transaction = state.transaction;
      if (transaction) set({ project: transaction.before, revision: transaction.beforeRevision, transaction: null, ...reconcile(state, transaction.before), photoTransform: null });
      else if (state.photoTransform) set({ photoTransform: null });
    },
    undo: () => {
      get().commitTransaction();
      const state = get(); const entry = state.history.at(-1);
      if (!entry) return;
      const history = state.history.slice(0, -1); const future = [...state.future, entry];
      set({ project: entry.before, revision: entry.beforeRevision, history, future, undoCount: history.length, redoCount: future.length, ...reconcile(state, entry.before) });
    },
    redo: () => {
      get().commitTransaction();
      const state = get(); const entry = state.future.at(-1);
      if (!entry) return;
      const history = capHistory([...state.history, entry]); const future = state.future.slice(0, -1);
      set({ project: entry.after, revision: entry.afterRevision, history, future, undoCount: history.length, redoCount: future.length, ...reconcile(state, entry.after) });
    },
    markSaved: (revision, path, projectId) => {
      const state = get();
      if (projectId !== undefined && state.project.id !== projectId) return;
      if (!Number.isInteger(revision) || revision < 0 || revision >= state.nextRevision) return;
      set({ savedRevision: revision, projectPath: path ?? state.projectPath });
    },
  };
});

export const useEditorStore = createEditorStore(createProject({ name: '临时拼图' }));
