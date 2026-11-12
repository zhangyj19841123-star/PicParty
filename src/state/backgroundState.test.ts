import { afterEach, describe, expect, it } from 'vitest';
import { createEditorStore, setDocumentValidator } from './editorStore';
import { createProject, defaultTransform } from '../core/templates';
import { validateProject } from './validateProject';
import type { ImageAsset, Project } from '../core/types';

const asset = (id: string, width = 3000, height = 4500): ImageAsset => ({
  id, originalPath: `/photos/${id}.jpg`, fileName: `${id}.jpg`, width, height,
  rawWidth: width, rawHeight: height, orientation: 1, format: 'jpeg', fingerprint: id, icc: null,
});
const setup = () => createEditorStore(createProject({ canvasSizing: 'fixed' }));
afterEach(() => setDocumentValidator(undefined));

describe('independent page backgrounds', () => {
  it('sizes a blank project from its first original background and freezes that size for later photos', () => {
    const store = createEditorStore(createProject()), before = store.getState().project;
    const pageId = before.pages[0].id;
    store.getState().assignBackgroundAsset(asset('landscape', 7008, 4672));
    const imported = store.getState().project;
    expect(imported.document).toMatchObject({ width: 4672, height: 7008 });
    expect(imported.pages[0].backgroundImage).toEqual({ imageAssetId: 'landscape', opacity: 1, transform: defaultTransform() });
    expect(imported.pages[0].frames).toEqual(before.pages[0].frames);
    expect(imported.pages[0].margin.left).toBeCloseTo(before.pages[0].margin.left * 4672 / 4000);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    expect(store.getState().backgroundEditing).toBe(false);
    store.getState().redo(); expect(store.getState().project).toEqual(imported);
    store.getState().updateBackgroundImage(pageId, { transform: { zoom: 3, rotation: 17 } });
    store.getState().assignBackgroundAsset(asset('replacement', 9000, 6000));
    store.getState().assignAssets([asset('foreground', 2000, 3000)]);
    expect(store.getState().project.document).toEqual(imported.document);
    expect(store.getState().project.pages[0].frames[0].imageAssetId).toBe('foreground');
  });

  it('respects fixed dimensions and ignores imports for pages that disappeared', () => {
    const store = setup(), before = store.getState().project;
    store.getState().assignBackgroundAsset(asset('stale', 7008, 4672), 'deleted-page');
    expect(store.getState().project).toBe(before);
    expect(store.getState().undoCount).toBe(0);
    store.getState().assignBackgroundAsset(asset('fixed', 7008, 4672));
    expect(store.getState().project.document).toEqual(before.document);
    const withBackground = store.getState().project;
    store.getState().setBackgroundImage(before.pages[0].id, 'missing');
    expect(store.getState().project).toBe(withBackground);
  });

  it('finishes a pending import on its original page without changing a newer page selection', () => {
    const store = setup(), originalPageId = store.getState().activePageId;
    const nextPageId = store.getState().addPage();
    const ref = { pageId: nextPageId, frameId: store.getState().project.pages[1].frames[0].id };
    store.getState().setEditingFrame(ref);
    const selected = store.getState();
    store.getState().assignBackgroundAsset(asset('pending'), originalPageId);
    expect(store.getState().project.pages[0].backgroundImage?.imageAssetId).toBe('pending');
    expect(store.getState().project.pages[1].backgroundImage).toBeUndefined();
    expect(store.getState()).toMatchObject({ activePageId: nextPageId, visiblePageIds: selected.visiblePageIds,
      selectedPageIds: selected.selectedPageIds, selectedFrame: ref, editingFrame: ref, backgroundEditing: false });
  });

  it('adjusts and replaces a background independently from a foreground using the same original', () => {
    const store = setup(), pageId = store.getState().activePageId;
    const ref = { pageId, frameId: store.getState().project.pages[0].frames[0].id };
    store.getState().assignAssets([asset('shared')], ref);
    store.getState().updateTransform(ref, { zoom: 1.7, rotation: 31, adjustments: { exposure: 1.2, tint: 24 } });
    const foreground = store.getState().project.pages[0].frames;
    store.getState().setBackgroundImage(pageId, 'shared');
    store.getState().updateBackgroundImage(pageId, { opacity: 0.35, transform: { zoom: 2.5, focusX: 0.2, focusY: 0.7, rotation: -18 } });
    const adjusted = store.getState().project;
    expect(adjusted.pages[0].frames).toEqual(foreground);
    expect(adjusted.assets.shared).toEqual(asset('shared'));
    store.getState().setBackgroundImage(pageId, 'shared');
    expect(store.getState().project.pages[0].backgroundImage).toEqual({ imageAssetId: 'shared', opacity: 1, transform: defaultTransform() });
    expect(store.getState().project.pages[0].frames).toEqual(foreground);
    store.getState().undo(); expect(store.getState().project).toEqual(adjusted);
    store.getState().assignBackgroundAsset(asset('another'));
    expect(store.getState().project.pages[0].backgroundImage).toEqual({ imageAssetId: 'another', opacity: 1, transform: defaultTransform() });
    expect(store.getState().project.pages[0].frames).toEqual(foreground);
  });

  it('records a continuous background drag and opacity change as one reversible operation', () => {
    const store = setup(), pageId = store.getState().activePageId;
    store.getState().assignBackgroundAsset(asset('background'));
    const before = store.getState().project, count = store.getState().undoCount;
    store.getState().beginTransaction('调整背景');
    for (let step = 1; step <= 20; step++) {
      store.getState().updateBackgroundImage(pageId, { opacity: 1 - step / 40, transform: { focusX: step / 40, zoom: 1 + step / 10 } });
    }
    expect(store.getState().undoCount).toBe(count);
    store.getState().commitTransaction();
    const after = store.getState().project;
    expect(store.getState().undoCount).toBe(count + 1);
    expect(after.pages[0].backgroundImage).toMatchObject({ opacity: 0.5, transform: { focusX: 0.5, zoom: 3 } });
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
    store.getState().beginTransaction('取消缩放');
    store.getState().updateBackgroundImage(pageId, { transform: { zoom: 7 } });
    store.getState().cancelTransaction(); expect(store.getState().project).toEqual(after);
  });

  it('round-trips background composition and clones it independently when duplicating a page', () => {
    const store = setup(), pageId = store.getState().activePageId;
    store.getState().assignBackgroundAsset(asset('background'));
    store.getState().updateBackgroundImage(pageId, { opacity: 0.42, transform: { zoom: 3.1, focusY: 0.8, rotation: 4 } });
    store.getState().updatePage([pageId], { background: '#123456' });
    const saved = JSON.parse(JSON.stringify(store.getState().project)) as Project;
    expect(validateProject(saved)).toEqual(saved);
    const restored = createEditorStore(saved);
    expect(restored.getState().backgroundEditing).toBe(false);
    const [copyId] = restored.getState().duplicatePages([pageId]);
    expect(restored.getState().project.pages[1].backgroundImage).toEqual(saved.pages[0].backgroundImage);
    restored.getState().updateBackgroundImage(copyId, { opacity: 0.8, transform: { zoom: 1.2 } });
    expect(restored.getState().project.pages[0]).toEqual(saved.pages[0]);
    restored.getState().applyTemplate([copyId], 'grid-4');
    expect(restored.getState().project.pages[1].backgroundImage).toMatchObject({ opacity: 0.8, transform: { zoom: 1.2 } });
  });

  it('keeps background selection exclusive and clears it on removal, page changes, and load', () => {
    const store = setup(), pageId = store.getState().activePageId;
    const ref = { pageId, frameId: store.getState().project.pages[0].frames[0].id };
    store.getState().setFrameEditing(true); store.getState().setSelectedFrame(ref);
    store.getState().assignBackgroundAsset(asset('background'));
    expect(store.getState()).toMatchObject({ backgroundEditing: true, frameEditing: false, selectedFrame: null, editingFrame: null });
    store.getState().setEditingFrame(ref); expect(store.getState().backgroundEditing).toBe(false);
    store.getState().setBackgroundEditing(true); expect(store.getState().editingFrame).toBeNull();
    store.getState().setSelectedFrame(ref); expect(store.getState().backgroundEditing).toBe(false);
    store.getState().setBackgroundEditing(true); store.getState().setFrameEditing(true);
    expect(store.getState().backgroundEditing).toBe(false);
    store.getState().setBackgroundEditing(true); store.getState().setBackgroundImage(pageId, null);
    expect(store.getState().backgroundEditing).toBe(false);
    expect(store.getState().project.pages[0].backgroundImage).toBeUndefined();
    store.getState().undo(); store.getState().setBackgroundEditing(true);
    store.getState().addPage(); expect(store.getState().backgroundEditing).toBe(false);
    store.getState().setActivePage(pageId); store.getState().setBackgroundEditing(true);
    const saved = store.getState().project;
    store.getState().loadProject(saved); expect(store.getState().backgroundEditing).toBe(false);
    store.getState().setBackgroundEditing(true); store.getState().deletePages([pageId]);
    expect(store.getState().backgroundEditing).toBe(false);
    expect('backgroundEditing' in store.getState().project).toBe(false);
  });

  it('clamps finite background controls and ignores non-finite changes without polluting history', () => {
    const store = setup(), pageId = store.getState().activePageId;
    store.getState().assignBackgroundAsset(asset('background'));
    const before = store.getState().project, count = store.getState().undoCount;
    store.getState().updateBackgroundImage(pageId, { opacity: NaN, transform: { zoom: Infinity, focusY: -Infinity, rotation: NaN } });
    expect(store.getState().project).toBe(before); expect(store.getState().undoCount).toBe(count);
    store.getState().updateBackgroundImage(pageId, { opacity: 4, transform: { zoom: 200, focusX: -2, focusY: 4, rotation: 720 } });
    expect(store.getState().project.pages[0].backgroundImage).toMatchObject({ opacity: 1, transform: { zoom: 8, focusX: 0, focusY: 1, rotation: 180 } });
    store.getState().updateBackgroundImage(pageId, { opacity: -4, transform: { zoom: -10 } });
    expect(store.getState().project.pages[0].backgroundImage).toMatchObject({ opacity: 0, transform: { zoom: 1 } });
  });

  it('rejects broken background references and invalid saved values while keeping older projects compatible', () => {
    const store = setup(), pageId = store.getState().activePageId;
    const older = store.getState().project;
    expect(validateProject(older)).toEqual(older);
    store.getState().assignBackgroundAsset(asset('background'));
    const valid = store.getState().project;
    for (const [key, value] of [['imageAssetId', 'missing'], ['opacity', NaN], ['opacity', -0.01], ['opacity', 1.01]]) {
      const invalid = structuredClone(valid);
      Object.assign(invalid.pages[0].backgroundImage!, { [key]: value });
      expect(() => store.getState().loadProject(invalid)).toThrow();
      expect(store.getState().project).toBe(valid);
    }
    const invalidTransform = structuredClone(valid);
    invalidTransform.pages[0].backgroundImage!.transform.zoom = 8.1;
    expect(() => validateProject(invalidTransform)).toThrow(/缩放/);
    const oldBackground = structuredClone(valid);
    delete oldBackground.pages[0].backgroundImage!.transform.adjustments;
    expect(validateProject(oldBackground).pages[0].backgroundImage!.transform).toEqual(defaultTransform());
    expect(oldBackground.pages[0].backgroundImage!.transform.adjustments).toBeUndefined();
    store.getState().updateBackgroundImage(pageId, { opacity: 0.6 });
    expect(store.getState().project.pages[0].backgroundImage!.imageAssetId).toBe('background');
  });

  it('refreshes an externally edited background throughout history without changing its composition', () => {
    const store = setup(), pageId = store.getState().activePageId;
    store.getState().assignBackgroundAsset(asset('background'));
    store.getState().updateBackgroundImage(pageId, { opacity: 0.55, transform: { zoom: 2.2, focusX: 0.3 } });
    const composition = store.getState().project.pages[0].backgroundImage;
    store.getState().refreshAssets([{ ...asset('background', 6000, 9000), fingerprint: 'external-v2' }]);
    expect(store.getState().project.pages[0].backgroundImage).toEqual(composition);
    store.getState().undo(); expect(store.getState().project.assets.background.fingerprint).toBe('external-v2');
    store.getState().redo(); expect(store.getState().project.pages[0].backgroundImage).toEqual(composition);
    expect(store.getState().project.assets.background.width).toBe(6000);
  });
});
