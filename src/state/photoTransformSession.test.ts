import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cover_json, initSync, layout_json, validate_project_json } from '../../public/core-wasm/collage_wasm.js';
import { geometry } from '../core/engine';
import { createProject } from '../core/templates';
import type { FrameRef, GeometryEngine, ImageAsset } from '../core/types';
import { createEditorStore, setDocumentValidator } from './editorStore';

vi.mock('../core/engine', () => ({ geometry: vi.fn() }));
const nativeEngine: GeometryEngine = {
  layout: (page, document, template) => JSON.parse(layout_json(JSON.stringify(page), JSON.stringify(document), JSON.stringify(template))),
  cover: (rect, width, height, transform) => JSON.parse(cover_json(JSON.stringify(rect), width, height, JSON.stringify(transform))),
};
const asset = (id: string): ImageAsset => ({
  id, originalPath: `/photos/${id}.jpg`, fileName: `${id}.jpg`, width: 3000, height: 4500,
  rawWidth: 3000, rawHeight: 4500, orientation: 1, format: 'jpeg', fingerprint: id, icc: null,
});
type Editor = ReturnType<typeof createEditorStore>;
const refAt = (store: Editor, pageIndex = 0, frameIndex = 0): FrameRef => ({
  pageId: store.getState().project.pages[pageIndex].id, frameId: store.getState().project.pages[pageIndex].frames[frameIndex].id,
});
const setup = () => {
  const store = createEditorStore(createProject({ canvasSizing: 'fixed' }));
  store.getState().assignAssets([asset('first'), asset('second')]);
  store.getState().setSelectedFrame(refAt(store));
  return store;
};
const photo = (store: Editor, ref = refAt(store)) => store.getState().project.pages.find(page => page.id === ref.pageId)!.frames.find(frame => frame.id === ref.frameId)!;

beforeAll(() => {
  initSync({ module: Uint8Array.from(readFileSync(new URL('../../public/core-wasm/collage_wasm_bg.wasm', import.meta.url))) });
});
beforeEach(() => {
  vi.mocked(geometry).mockReturnValue(nativeEngine);
  setDocumentValidator(project => { validate_project_json(JSON.stringify(project)); });
});
afterEach(() => setDocumentValidator(undefined));

describe('photo free-transform session', () => {
  it('requires a selected placed photo and exits yellow-frame mode when entering', () => {
    const store = createEditorStore(createProject({ canvasSizing: 'fixed' }));
    expect(store.getState().beginPhotoTransform()).toBe(false);
    store.getState().setSelectedFrame(refAt(store));
    expect(store.getState().beginPhotoTransform()).toBe(false);
    store.getState().assignAssets([asset('first'), asset('second'), asset('unplaced')]);
    const page = store.getState().project.pages[0];
    store.getState().setSelectedFrame({ pageId: page.id, frameId: page.unplaced[0].id });
    expect(store.getState().beginPhotoTransform()).toBe(false);
    const ref = refAt(store);
    store.getState().setSelectedFrame(ref);
    store.getState().setFrameEditing(true);
    expect(store.getState().beginPhotoTransform()).toBe(true);
    expect(store.getState()).toMatchObject({ photoTransform: ref, selectedFrame: ref, editingFrame: ref, frameEditing: false, backgroundEditing: false });
  });

  it('keeps several zoom, move and rotate gestures in one undo until confirmation', () => {
    const store = setup(), before = store.getState().project, count = store.getState().undoCount, ref = refAt(store);
    store.getState().beginPhotoTransform();
    const transaction = store.getState().transaction;
    store.getState().updateTransform(ref, { zoom: 1.7 });
    store.getState().beginTransaction('next pointer gesture');
    store.getState().updateTransform(ref, { rotation: 32, focusX: 0.42, focusY: 0.6 });
    expect(store.getState().beginPhotoTransform()).toBe(true);
    expect(store.getState().transaction).toBe(transaction);
    expect(store.getState().undoCount).toBe(count);
    store.getState().commitPhotoTransform();
    const after = store.getState().project;
    expect(store.getState()).toMatchObject({ photoTransform: null, transaction: null, undoCount: count + 1 });
    expect(store.getState().history.at(-1)?.label).toBe('自由变换照片');
    expect(photo(store).transform).toMatchObject({ zoom: 1.7, rotation: 32, focusX: 0.42, focusY: 0.6 });
    expect(before.pages[0].frames[0].transform.zoom).toBe(1);
    expect(after.pages[0].frames.map(frame => frame.slotId)).toEqual(before.pages[0].frames.map(frame => frame.slotId));
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
  });

  it('cancels the whole session without consuming history or losing the redo branch', () => {
    const store = setup(), ref = refAt(store);
    store.getState().updateTransform(ref, { zoom: 2 });
    store.getState().undo();
    const before = store.getState().project, revision = store.getState().revision, history = store.getState().history, future = store.getState().future;
    store.getState().beginPhotoTransform();
    store.getState().updateTransform(ref, { zoom: 3, rotation: -45 });
    store.getState().updateTransform(ref, { focusX: 0.1 });
    store.getState().cancelPhotoTransform();
    expect(store.getState()).toMatchObject({ photoTransform: null, transaction: null, revision });
    expect(store.getState().project).toBe(before);
    expect(store.getState().history).toBe(history);
    expect(store.getState().future).toBe(future);
    store.getState().redo(); expect(photo(store).transform.zoom).toBe(2);
  });

  it('does not add an undo entry or clear redo when the transform returns to its initial state', () => {
    const store = setup(), ref = refAt(store);
    store.getState().updateTransform(ref, { rotation: 9 }); store.getState().undo();
    const count = store.getState().undoCount, revision = store.getState().revision;
    store.getState().beginPhotoTransform();
    store.getState().updateTransform(ref, { rotation: 13 });
    store.getState().updateTransform(ref, { rotation: 0 });
    store.getState().commitPhotoTransform();
    expect(store.getState()).toMatchObject({ revision, undoCount: count, redoCount: 1, photoTransform: null, transaction: null });
  });

  it('keeps the session when reselecting its photo and confirms it before selecting another', () => {
    const store = setup(), ref = refAt(store), count = store.getState().undoCount;
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { rotation: 15 });
    const transaction = store.getState().transaction;
    store.getState().setSelectedFrame({ ...ref }); store.getState().setEditingFrame({ ...ref });
    expect(store.getState().transaction).toBe(transaction);
    expect(store.getState().photoTransform).toEqual(ref);
    store.getState().setSelectedFrame(refAt(store, 0, 1));
    expect(store.getState()).toMatchObject({ photoTransform: null, transaction: null, undoCount: count + 1, selectedFrame: refAt(store, 0, 1) });
    store.getState().undo(); expect(photo(store).transform.rotation).toBe(0);
  });

  it.each(['active-page', 'page-selection', 'overview', 'yellow-frame', 'deselect'] as const)('confirms before leaving through %s', exit => {
    const store = setup(), page = store.getState().addPage('three-y'), ref = refAt(store);
    store.getState().setSelectedFrame(ref);
    const count = store.getState().undoCount;
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { zoom: 1.4 });
    if (exit === 'active-page') store.getState().setActivePage(page);
    if (exit === 'page-selection') store.getState().selectPage(page);
    if (exit === 'overview') store.getState().setWorkspaceMode('overview');
    if (exit === 'yellow-frame') store.getState().setFrameEditing(true);
    if (exit === 'deselect') store.getState().setSelectedFrame(null);
    expect(store.getState()).toMatchObject({ photoTransform: null, transaction: null, undoCount: count + 1 });
    expect(photo(store, ref).transform.zoom).toBe(1.4);
  });

  it('confirms before unrelated frame edits so replacement and crop each remain separately undoable', () => {
    const store = setup(), ref = refAt(store);
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { zoom: 2 });
    const count = store.getState().undoCount;
    store.getState().replaceFrame(ref, 'second');
    expect(store.getState()).toMatchObject({ photoTransform: null, transaction: null, undoCount: count + 2 });
    expect(photo(store).imageAssetId).toBe('second'); expect(photo(store).transform.zoom).toBe(1);
    store.getState().undo(); expect(photo(store).imageAssetId).toBe('first'); expect(photo(store).transform.zoom).toBe(2);
    store.getState().undo(); expect(photo(store).transform.zoom).toBe(1);
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { rotation: 8 });
    store.getState().updateFrameRect(ref, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(store.getState().photoTransform).toBeNull();
    store.getState().undo(); expect(store.getState().project.pages[0].frameRects).toBeUndefined(); expect(photo(store).transform.rotation).toBe(8);
  });

  it('commits before undo and saving, keeping saved documents free of session state', () => {
    const store = setup(), ref = refAt(store), before = store.getState().project;
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { rotation: 11 });
    store.getState().undo();
    expect(store.getState().project).toEqual(before); expect(store.getState().photoTransform).toBeNull();
    store.getState().redo(); expect(photo(store).transform.rotation).toBe(11);
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { zoom: 1.5 });
    store.getState().commitTransaction();
    store.getState().markSaved(store.getState().revision, '/saved.collage', store.getState().project.id);
    const saved = JSON.parse(JSON.stringify(store.getState().project));
    expect(validate_project_json(JSON.stringify(saved))).toBe('true');
    expect(saved.photoTransform).toBeUndefined(); expect(saved.transaction).toBeUndefined();
    store.getState().loadProject(saved, '/saved.collage');
    expect(store.getState()).toMatchObject({ photoTransform: null, transaction: null, undoCount: 0, revision: 0, savedRevision: 0 });
    expect(photo(store).transform).toMatchObject({ zoom: 1.5, rotation: 11 });
  });

  it('retains externally refreshed photo metadata when cancelling a transform', () => {
    const store = setup(), ref = refAt(store);
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { zoom: 1.9, rotation: -14 });
    const transaction = store.getState().transaction;
    store.getState().refreshAssets([{ ...asset('first'), fingerprint: 'photoshop-updated', width: 2000, rawWidth: 2000 }]);
    expect(store.getState().transaction).toBe(transaction); expect(store.getState().photoTransform).toEqual(ref);
    store.getState().cancelPhotoTransform();
    expect(photo(store).transform).toMatchObject({ zoom: 1, rotation: 0 });
    expect(store.getState().project.assets.first).toMatchObject({ fingerprint: 'photoshop-updated', width: 2000 });
    expect(validate_project_json(JSON.stringify(store.getState().project))).toBe('true');
  });

  it('clears session references when loading or creating a different document', () => {
    const store = setup(), ref = refAt(store);
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { rotation: 19 });
    const loaded = createProject({ canvasSizing: 'fixed', name: 'Different document' });
    store.getState().loadProject(loaded, '/different.collage');
    expect(store.getState()).toMatchObject({ photoTransform: null, transaction: null, selectedFrame: null, editingFrame: null, undoCount: 0 });
    expect(store.getState().project).toEqual(loaded);
    store.getState().assignAssets([asset('new-photo')]); store.getState().setSelectedFrame(refAt(store));
    store.getState().beginPhotoTransform(); store.getState().updateTransform(refAt(store), { zoom: 2 });
    store.getState().newProject();
    expect(store.getState()).toMatchObject({ photoTransform: null, transaction: null, selectedFrame: null, editingFrame: null, undoCount: 0 });
  });

  it('preserves a pending transform if a different document fails validation', () => {
    const store = setup(), ref = refAt(store);
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { rotation: 19 });
    const project = store.getState().project, transaction = store.getState().transaction;
    setDocumentValidator(() => { throw new Error('Rejected document'); });
    expect(() => store.getState().loadProject(createProject())).toThrow('Rejected document');
    expect(store.getState().project).toBe(project); expect(store.getState().transaction).toBe(transaction);
    expect(store.getState().photoTransform).toEqual(ref);
    store.getState().cancelPhotoTransform(); expect(photo(store).transform.rotation).toBe(0);
  });

  it('rolls back a rejected final document and preserves redo with no stale session', () => {
    const store = setup(), ref = refAt(store);
    store.getState().updateTransform(ref, { zoom: 2 }); store.getState().undo();
    const before = store.getState().project;
    store.getState().beginPhotoTransform(); store.getState().updateTransform(ref, { zoom: 4 });
    setDocumentValidator(() => { throw new Error('Rejected transform'); });
    expect(() => store.getState().commitPhotoTransform()).toThrow('Rejected transform');
    expect(store.getState().project).toBe(before);
    expect(store.getState()).toMatchObject({ photoTransform: null, transaction: null, redoCount: 1 });
  });
});
