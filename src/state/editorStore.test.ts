import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore, setDocumentValidator, type WorkspaceMode } from './editorStore';
import { BUILTIN_TEMPLATES, createPage, createProject, defaultTransform } from '../core/templates';
import { defaultAdjustments } from '../core/photoAdjustments';
import { geometry } from '../core/engine';
import { useTemplateLibraryStore } from './templateLibraryStore';
import { validateProject } from './validateProject';
import type { DocumentSize, FrameRef, ImageAsset, Page, PhotoAdjustments, TemplateDefinition } from '../core/types';

vi.mock('../core/engine', () => ({ geometry: vi.fn() }));

const asset = (id: string): ImageAsset => ({ id, originalPath: `/photos/${id}.jpg`, fileName: `${id}.jpg`, width: 3000, height: 4500, rawWidth: 3000, rawHeight: 4500, orientation: 1, format: 'jpeg', fingerprint: id, icc: null });
const setup = () => createEditorStore(createProject({ canvasSizing: 'fixed' }));
const colorA: PhotoAdjustments = { exposure: 1.35, temperature: 28, tint: -21, contrast: 33, highlights: -44, brightness: 17, shadows: 29, vibrance: 53, saturation: -26, blacks: 13 };
const colorB: PhotoAdjustments = { exposure: -0.8, temperature: -12, tint: 14, contrast: -19, highlights: 31, brightness: -22, shadows: -34, vibrance: -43, saturation: 47, blacks: -16 };
afterEach(() => setDocumentValidator(undefined));
const firstRef = (store: ReturnType<typeof setup>, index = 0, slot = 0): FrameRef => {
  const page = store.getState().project.pages[index]; return { pageId: page.id, frameId: page.frames[slot].id };
};

const sizedAsset = (id: string, width: number, height: number, orientation = 1): ImageAsset => ({
  ...asset(id), width, height, orientation,
  rawWidth: orientation >= 5 ? height : width, rawHeight: orientation >= 5 ? width : height,
});

describe('first-photo project dimensions', () => {
  it('sizes from the first effective portrait or landscape photo while keeping a 2:3 portrait canvas', () => {
    for (const [width, height, orientation] of [[4672, 7008, 1], [7008, 4672, 1], [4672, 7008, 6]]) {
      const store = createEditorStore(createProject({ canvasSizing: 'first-photo' }));
      store.getState().assignAssets([sizedAsset('first', width, height, orientation)]);
      expect(store.getState().project.document).toMatchObject({ width: 4672, height: 7008 });
      expect(store.getState().project.pages[0].frames[0].imageAssetId).toBe('first');
    }
  });

  it('uses only the first photo in a batch and freezes that size for later imports and new pages', () => {
    const store = createEditorStore(createProject({ canvasSizing: 'first-photo' }));
    store.getState().assignAssets([sizedAsset('first', 4672, 7008), sizedAsset('second', 3000, 4500)]);
    const size = store.getState().project.document;
    store.getState().addPage('grid-4');
    store.getState().assignAssets([sizedAsset('later', 8000, 12000)]);
    expect(store.getState().project.document).toEqual(size);
    expect(store.getState().project.document).toMatchObject({ width: 4672, height: 7008 });
    expect(store.getState().project.pages).toHaveLength(2);
    store.getState().replaceFrame(firstRef(store), null);
    store.getState().assignAssets([sizedAsset('replacement', 1000, 1500)], firstRef(store));
    expect(store.getState().project.document).toEqual(size);
  });

  it('resizes existing blank-page spacing and undoes the first import and canvas size together', () => {
    const store = createEditorStore(createProject({ canvasSizing: 'first-photo' }));
    store.getState().addPage('grid-4');
    store.getState().updatePage(store.getState().project.pages.map(page => page.id), { margin: { top: 24, right: 32, bottom: 40, left: 48 }, columnGap: 12, rowGap: 20 });
    const before = store.getState().project, count = store.getState().undoCount;
    store.getState().assignAssets([sizedAsset('first', 7008, 4672)]);
    const after = store.getState().project;
    expect(store.getState().undoCount).toBe(count + 1);
    after.pages.forEach((page, index) => {
      expect(page.margin.left).toBeCloseTo(before.pages[index].margin.left * 4672 / before.document.width);
      expect(page.margin.top).toBeCloseTo(before.pages[index].margin.top * 7008 / before.document.height);
      expect(page.columnGap).toBeCloseTo(before.pages[index].columnGap * 4672 / before.document.width);
      expect(page.rowGap).toBeCloseTo(before.pages[index].rowGap * 7008 / before.document.height);
    });
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    expect(Object.keys(store.getState().project.assets)).toHaveLength(0);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
  });

  it('does not resize a new project for an import whose target is no longer valid', () => {
    const store = createEditorStore(createProject({ canvasSizing: 'first-photo' }));
    const before = store.getState().project;
    store.getState().assignAssets([sizedAsset('first', 4672, 7008)], { pageId: before.pages[0].id, frameId: 'deleted' });
    expect(store.getState().project).toBe(before);
    expect(store.getState().undoCount).toBe(0);
  });

  it('preserves explicit manual dimensions even when no photos have been imported yet', () => {
    const store = createEditorStore(createProject({ canvasSizing: 'first-photo' }));
    store.getState().updateDocument({ width: 2400, height: 3600 });
    expect(store.getState().project.canvasSizing).toBe('fixed');
    store.getState().assignAssets([sizedAsset('first', 4672, 7008)]);
    expect(store.getState().project.document).toMatchObject({ width: 2400, height: 3600 });
  });

  it('loads older projects without a sizing policy as fixed and preserves their saved output dimensions', () => {
    const oldProject = createProject({ width: 1600, height: 2400, canvasSizing: 'fixed' });
    delete oldProject.canvasSizing;
    const store = createEditorStore(oldProject);
    expect(store.getState().project.canvasSizing).toBe('fixed');
    expect(oldProject.canvasSizing).toBeUndefined();
    store.getState().assignAssets([sizedAsset('first', 4672, 7008)]);
    expect(store.getState().project.document).toMatchObject({ width: 1600, height: 2400 });
    expect(() => createEditorStore({ ...oldProject, canvasSizing: 'future' } as unknown as typeof oldProject)).toThrow(/策略/);
  });
});

describe('independent free frames and reusable layouts', () => {
  beforeEach(() => {
    useTemplateLibraryStore.setState({ templates: [] });
    vi.mocked(geometry).mockReturnValue({
      layout: vi.fn((page: Page, document: DocumentSize, template: TemplateDefinition) => {
        if (page.frameRects || template.root.kind === 'free') {
          const frames = page.frameRects ? template.slotOrder.map(slotId => ({ slotId, rect: page.frameRects![slotId] })) : template.root.kind === 'free' ? template.root.frames : [];
          return { frames: frames.map(({ slotId, rect }) => ({ slotId, rect: { x: rect.x * document.width, y: rect.y * document.height, width: rect.width * document.width, height: rect.height * document.height } })), handles: [] };
        }
        const weights = page.templateState.rows ?? template.slotOrder.map(() => 1);
        const total = weights.reduce((sum, value) => sum + value, 0);
        const availableHeight = document.height - page.margin.top - page.margin.bottom - page.rowGap * (template.slotOrder.length - 1);
        let y = page.margin.top;
        return { frames: template.slotOrder.map((slotId, index) => {
          const height = availableHeight * weights[index] / total;
          const rect = { x: page.margin.left, y, width: document.width - page.margin.left - page.margin.right, height };
          y += height + page.rowGap; return { slotId, rect };
        }), handles: [] };
      }),
      cover: () => { throw new Error('Not used by layout state tests'); },
    });
  });

  it('captures every current slot once and changes only the selected rectangle', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().assignAssets([asset('a')], ref);
    store.getState().updateTransform(ref, { zoom: 1.7, rotation: 21, focusX: 0.3, adjustments: { exposure: 1 } });
    const before = structuredClone(store.getState().project), page = before.pages[0];
    const expected = geometry().layout(page, before.document, before.templates[page.templateId]).frames[1].rect;
    const replacement = { x: 0.1, y: 0.15, width: 0.3, height: 0.5 };
    store.getState().updateFrameRect(ref, replacement);
    let updated = store.getState().project.pages[0];
    expect(updated.frameRects).toEqual({ a: replacement, b: { x: expected.x / 4000, y: expected.y / 6000, width: expected.width / 4000, height: expected.height / 6000 } });
    expect(updated.frames).toEqual(page.frames);
    expect(store.getState().project.document).toEqual(before.document);
    const count = vi.mocked(geometry().layout).mock.calls.length;
    store.getState().updateFrameRect(ref, { ...replacement, x: 0.2 });
    updated = store.getState().project.pages[0];
    expect(updated.frameRects?.b).toEqual({ x: expected.x / 4000, y: expected.y / 6000, width: expected.width / 4000, height: expected.height / 6000 });
    expect(vi.mocked(geometry().layout).mock.calls).toHaveLength(count);
  });

  it('makes a complete move/resize gesture one undo step and restores override absence', () => {
    const store = setup(), ref = firstRef(store), before = store.getState().project;
    store.getState().beginTransaction('移动照片框');
    store.getState().updateFrameRect(ref, { x: 0.1, y: 0.2, width: 0.6, height: 0.3 });
    store.getState().updateFrameRect(ref, { x: 0.2, y: 0.3, width: 0.5, height: 0.2 });
    expect(store.getState().undoCount).toBe(0);
    store.getState().commitTransaction();
    const after = store.getState().project;
    expect(store.getState().undoCount).toBe(1);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
  });

  it('rejects invalid rectangles and ignores stale or unplaced frame references', () => {
    const store = setup(); store.getState().assignAssets(['a', 'b', 'c'].map(asset));
    const before = store.getState().project, page = before.pages[0];
    expect(() => store.getState().updateFrameRect(firstRef(store), { x: NaN, y: 0, width: 0.5, height: 0.5 })).toThrow();
    store.getState().updateFrameRect({ pageId: page.id, frameId: 'gone' }, { x: 0, y: 0, width: 1, height: 1 });
    store.getState().updateFrameRect({ pageId: page.id, frameId: page.unplaced[0].id }, { x: 0, y: 0, width: 1, height: 1 });
    expect(store.getState().project).toBe(before);
  });

  it('keeps frame-editing mode ephemeral and excludes simultaneous photo editing', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().setEditingFrame(ref);
    store.getState().beginTransaction('缩放照片'); store.getState().updateTransform(ref, { zoom: 1.2 });
    store.getState().setFrameEditing(true);
    expect(store.getState()).toMatchObject({ frameEditing: true, selectedFrame: ref, editingFrame: null, transaction: null, undoCount: 1 });
    store.getState().setEditingFrame(ref); expect(store.getState().editingFrame).toBeNull();
    store.getState().undo(); expect(store.getState().frameEditing).toBe(true);
    store.getState().addPage(); expect(store.getState().frameEditing).toBe(true);
    store.getState().newProject(); expect(store.getState().frameEditing).toBe(false);
    expect('frameEditing' in store.getState().project).toBe(false);
  });

  it('adds an empty frame without changing existing frames and restores it through undo', () => {
    const store = setup(); store.getState().assignAssets([asset('a')]);
    const before = store.getState().project, page = before.pages[0], count = store.getState().undoCount;
    const ref = store.getState().addFreeFrame();
    const after = store.getState().project, updated = after.pages[0];
    expect(updated.frames.slice(0, 2)).toEqual(page.frames);
    expect(updated.frames[2]).toMatchObject({ id: ref?.frameId, imageAssetId: null, transform: defaultTransform() });
    expect(after.templates[updated.templateId]).toMatchObject({ category: '自由布局', root: { kind: 'free' }, slotOrder: updated.frames.map(frame => frame.slotId) });
    expect(store.getState()).toMatchObject({ selectedFrame: ref, frameEditing: true, editingFrame: null, undoCount: count + 1 });
    expect(validateProject(after)).toEqual(after);
    store.getState().undo(); expect(store.getState().project).toEqual(before); expect(store.getState().selectedFrame).toBeNull();
    store.getState().redo(); expect(store.getState().project).toEqual(after);
  });

  it('removes an occupied frame into the pending tray, preserving its photo and composition', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().assignAssets([asset('a')], ref); store.getState().updateTransform(ref, { zoom: 2, rotation: 33 });
    store.getState().setFrameEditing(true); store.getState().setSelectedFrame(ref);
    const before = store.getState().project;
    store.getState().removeFreeFrame(ref);
    const page = store.getState().project.pages[0];
    expect(page.frames).toHaveLength(1); expect(page.unplaced).toEqual([before.pages[0].frames[0]]);
    expect(store.getState().project.assets).toEqual(before.assets); expect(store.getState().selectedFrame).toBeNull();
    expect(() => store.getState().removeFreeFrame(firstRef(store))).toThrow(/至少/);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
  });

  it('restores a removed photo from the pending tray when a compatible template is applied', () => {
    const store = setup(), ref = firstRef(store), pageId = ref.pageId;
    store.getState().assignAssets(['a', 'b'].map(asset)); store.getState().updateTransform(ref, { rotation: -12, zoom: 1.4 });
    const original = store.getState().project.pages[0].frames;
    store.getState().removeFreeFrame(ref);
    store.getState().applyTemplate([pageId], 'split-y');
    expect(store.getState().project.pages[0].frames).toEqual(original);
    expect(store.getState().project.pages[0].unplaced).toHaveLength(0);
  });

  it('keeps duplicated free recipes independent when adding a frame to only one page', () => {
    const store = setup(); store.getState().addFreeFrame();
    const original = store.getState().project.pages[0], privateId = original.templateId;
    store.getState().duplicatePages([original.id]);
    const copyBefore = structuredClone(store.getState().project.pages[1]);
    store.getState().addFreeFrame(original.id);
    expect(store.getState().project.pages[0].frames).toHaveLength(4);
    expect(store.getState().project.pages[1]).toEqual(copyBefore);
    expect(store.getState().project.templates[privateId].slotOrder).toHaveLength(3);
    expect(store.getState().project.pages[0].templateId).not.toBe(privateId);
  });

  it('creates empty independent pages from embedded private and named templates without an external registry', () => {
    const store = setup();
    const free = store.getState().addFreeFrame()!;
    store.getState().assignAssets([asset('photo')], free);
    store.getState().updateFrameRect(free, { x: 0.12, y: 0.23, width: 0.4, height: 0.5 });
    const named = store.getState().savePageTemplate('独立新页面');
    store.getState().applyTemplate([free.pageId], named.id);
    store.getState().addFreeFrame();
    const privateId = store.getState().project.pages[0].templateId;
    expect(privateId).toMatch(/^page-free_/);
    const saved = structuredClone(store.getState().project);
    useTemplateLibraryStore.setState({ templates: [] });
    const reloaded = createEditorStore(saved);
    for (const templateId of [privateId, named.id]) {
      const before = reloaded.getState().project;
      const newPageId = reloaded.getState().addPage(templateId);
      const created = reloaded.getState().project.pages.find(page => page.id === newPageId)!;
      expect(created.id).not.toBe(saved.pages[0].id);
      expect(created.templateId).toBe(templateId);
      expect(created.frames.map(frame => frame.slotId)).toEqual(saved.templates[templateId].slotOrder);
      expect(created.frames.every(frame => !saved.pages[0].frames.some(existing => existing.id === frame.id))).toBe(true);
      expect(created.frames.every(frame => frame.imageAssetId === null)).toBe(true);
      expect(created.frames.every(frame => JSON.stringify(frame.transform) === JSON.stringify(defaultTransform()))).toBe(true);
      expect(created.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
      expect(created.columnGap).toBe(0); expect(created.rowGap).toBe(0);
      expect(reloaded.getState().project.templates[templateId]).toEqual(saved.templates[templateId]);
      reloaded.getState().undo(); expect(reloaded.getState().project).toEqual(before);
      reloaded.getState().redo(); expect(reloaded.getState().project.pages.some(page => page.id === newPageId)).toBe(true);
    }
  });

  it('changes overlapping frame layers without changing geometry, photos or editing state and undoes each action', () => {
    const store = setup(), first = firstRef(store), last = firstRef(store, 0, 1);
    store.getState().assignAssets(['a', 'b'].map(asset));
    store.getState().updateTransform(first, { zoom: 1.7, rotation: 22, adjustments: colorA });
    store.getState().updateFrameRect(first, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    store.getState().updateFrameRect(last, { x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
    store.getState().setEditingFrame(first);
    const before = store.getState().project, count = store.getState().undoCount;
    store.getState().reorderFrameLayer(first, 'front');
    const front = store.getState().project;
    expect(front.pages[0].frames).toEqual([...before.pages[0].frames].reverse());
    expect(front.pages[0].frameRects).toEqual(before.pages[0].frameRects);
    expect(front.templates).toEqual(before.templates);
    expect(store.getState().undoCount).toBe(count + 1);
    expect(store.getState().editingFrame).toEqual(first);
    expect(createEditorStore(JSON.parse(JSON.stringify(front))).getState().project).toEqual(front);
    const copy = store.getState().duplicatePages([first.pageId])[0];
    expect(store.getState().project.pages.find(page => page.id === copy)?.frames.map(frame => frame.slotId)).toEqual(['b', 'a']);
    store.getState().undo();
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(front);
    store.getState().reorderFrameLayer(first, 'back');
    expect(store.getState().project).toEqual(before);
    store.getState().undo(); expect(store.getState().project).toEqual(front);
  });

  it('keeps unchanged and invalid layer actions out of history and commits a prior gesture separately', () => {
    const store = setup(), first = firstRef(store), last = firstRef(store, 0, 1);
    store.getState().reorderFrameLayer(first, 'back');
    store.getState().reorderFrameLayer(last, 'front');
    store.getState().reorderFrameLayer({ ...first, frameId: 'removed' }, 'front');
    expect(store.getState().undoCount).toBe(0);
    store.getState().beginTransaction('拖动照片框');
    store.getState().updateFrameRect(first, { x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
    const gesture = store.getState().project;
    store.getState().reorderFrameLayer(first, 'front');
    expect(store.getState().transaction).toBeNull();
    expect(store.getState().undoCount).toBe(2);
    store.getState().undo(); expect(store.getState().project).toEqual(gesture);
    store.getState().undo(); expect(store.getState().project.pages[0].frameRects).toBeUndefined();
    store.getState().applyTemplate([first.pageId], 'single');
    const single = store.getState().project, count = store.getState().undoCount;
    store.getState().reorderFrameLayer(firstRef(store), 'front');
    expect(store.getState().project).toBe(single); expect(store.getState().undoCount).toBe(count);
  });

  it('saves layer order with geometry in named templates and reuses it for blank and populated pages', () => {
    const source = setup(), first = firstRef(source), last = firstRef(source, 0, 1);
    source.getState().updateFrameRect(first, { x: 0, y: 0, width: 1, height: 1 });
    source.getState().updateFrameRect(last, { x: 0.25, y: 0.2, width: 0.5, height: 0.4 });
    source.getState().reorderFrameLayer(first, 'front');
    const template = source.getState().savePageTemplate('叠层模板');
    expect(template.slotOrder).toEqual(['b', 'a']);
    expect(template.root).toEqual({ kind: 'free', frames: [
      { slotId: 'b', rect: { x: 0.25, y: 0.2, width: 0.5, height: 0.4 } },
      { slotId: 'a', rect: { x: 0, y: 0, width: 1, height: 1 } },
    ] });
    const target = setup(), pageId = target.getState().activePageId;
    target.getState().assignAssets(['a', 'b'].map(asset));
    target.getState().applyTemplate([pageId], template.id);
    expect(target.getState().project.pages[0].frames.map(frame => [frame.slotId, frame.imageAssetId])).toEqual([['b', 'b'], ['a', 'a']]);
    const blank = target.getState().addPage(template.id);
    expect(target.getState().project.pages.find(page => page.id === blank)?.frames.map(frame => frame.slotId)).toEqual(['b', 'a']);
  });

  it('limits free pages to 64 frames without accumulating superseded private templates', () => {
    const store = setup();
    for (let count = 2; count < 64; count++) store.getState().addFreeFrame();
    const project = store.getState().project;
    expect(project.pages[0].frames).toHaveLength(64);
    expect(Object.keys(project.templates)).toHaveLength(2);
    expect(() => store.getState().addFreeFrame()).toThrow(/64/);
    expect(store.getState().project).toBe(project);
    expect(validateProject(project)).toEqual(project);
  });

  it('saves adjusted split weights as geometry only without modifying the project or history', () => {
    const store = setup(), id = store.getState().activePageId;
    store.getState().assignAssets(['a', 'b'].map(asset));
    store.getState().updatePage([id], { templateState: { rows: [0.7, 0.3] }, background: '#112233' });
    const before = store.getState().project, count = store.getState().undoCount;
    const template = store.getState().savePageTemplate('  留白双图  ');
    expect(template).toMatchObject({ id: expect.stringMatching(/^user_/), name: '留白双图', category: '自定义', defaults: {}, root: { kind: 'free' } });
    if (template.root.kind !== 'free') throw new Error('Expected a free template');
    expect(template.root.frames[0].rect.height).toBeCloseTo(0.7);
    expect(JSON.stringify(template)).not.toMatch(/originalPath|imageAssetId|transform|background/);
    expect(store.getState().project).toBe(before); expect(store.getState().undoCount).toBe(count);
    expect(useTemplateLibraryStore.getState().templates).toEqual([template]);
  });

  it('saves an explicit nonactive page with its geometry and layers while preserving the complete editor session', () => {
    const store = setup(), activePageId = store.getState().activePageId;
    const targetId = store.getState().addPage('split-y'), target = firstRef(store, 1), targetLast = firstRef(store, 1, 1);
    store.getState().assignAssets(['a', 'b'].map(asset), target);
    store.getState().updateTransform(target, { zoom: 1.7, rotation: 22, adjustments: colorA });
    store.getState().updateFrameRect(target, { x: 0.1, y: 0.15, width: 0.65, height: 0.4 });
    store.getState().updateFrameRect(targetLast, { x: 0.3, y: 0.45, width: 0.5, height: 0.4 });
    store.getState().reorderFrameLayer(target, 'front');
    store.getState().setActivePage(activePageId);
    store.getState().setSelectedPageIds([targetId]);
    store.getState().setWorkspaceMode(2);
    store.getState().setFrameEditing(true);
    store.getState().setSelectedFrame(firstRef(store));
    const before = store.getState();
    const template = before.savePageTemplate('第二页布局', targetId);
    expect(template.root).toEqual({ kind: 'free', frames: [
      { slotId: 'b', rect: { x: 0.3, y: 0.45, width: 0.5, height: 0.4 } },
      { slotId: 'a', rect: { x: 0.1, y: 0.15, width: 0.65, height: 0.4 } },
    ] });
    expect(template.slotOrder).toEqual(['b', 'a']);
    expect(JSON.stringify(template)).not.toMatch(/originalPath|imageAssetId|transform|background/);
    expect(store.getState()).toBe(before);
    expect(useTemplateLibraryStore.getState().templates).toEqual([template]);
  });

  it('captures an in-progress page layout without committing or changing its gesture and rejects deleted targets without fallback', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().beginTransaction('拖动照片框');
    store.getState().updateFrameRect(ref, { x: 0.2, y: 0.25, width: 0.5, height: 0.4 });
    const before = store.getState();
    expect(() => before.savePageTemplate('失效页布局', 'deleted-page')).toThrow(/页面已不存在/);
    expect(useTemplateLibraryStore.getState().templates).toEqual([]);
    expect(store.getState()).toBe(before);
    const template = before.savePageTemplate('当前布局', ref.pageId);
    expect(template.root).toMatchObject({ kind: 'free', frames: [{ slotId: 'a', rect: { x: 0.2, y: 0.25, width: 0.5, height: 0.4 } }, {}] });
    expect(store.getState()).toBe(before);
    store.getState().cancelTransaction();
    expect(store.getState().project.pages[0].frameRects).toBeUndefined();
    expect(useTemplateLibraryStore.getState().templates).toEqual([template]);
  });

  it('applies a library template across document sizes and preserves photos and constructs', () => {
    const source = setup(), rect = { x: 0.12, y: 0.2, width: 0.4, height: 0.35 };
    source.getState().updateFrameRect(firstRef(source), rect);
    const template = source.getState().savePageTemplate('可复用');
    const target = createEditorStore(createProject({ width: 2000, height: 3000, canvasSizing: 'fixed' })), id = target.getState().activePageId;
    target.getState().assignAssets(['a', 'b'].map(asset)); target.getState().updateTransform(firstRef(target), { rotation: 40, zoom: 1.3 });
    const before = target.getState().project.pages[0].frames;
    target.getState().applyTemplate([id], template.id);
    const project = target.getState().project, page = project.pages[0];
    expect(page.frames).toEqual(before); expect(page.frameRects).toBeUndefined();
    expect(geometry().layout(page, project.document, project.templates[template.id]).frames[0].rect).toEqual({ x: 240, y: 600, width: 800, height: 1050 });
    expect(createEditorStore(project).getState().project).toEqual(project);
    const newPageId = target.getState().addPage(template.id);
    expect(target.getState().project.pages.find(page => page.id === newPageId)?.templateId).toBe(template.id);
  });

  it('reapplies the same template to discard rectangle overrides without losing photos', () => {
    const store = setup(), id = store.getState().activePageId;
    store.getState().assignAssets([asset('a')]); store.getState().updateTransform(firstRef(store), { focusX: 0.2 });
    const placements = store.getState().project.pages[0].frames;
    store.getState().updateFrameRect(firstRef(store), { x: 0.1, y: 0.1, width: 0.8, height: 0.4 });
    const before = store.getState().project;
    store.getState().applyTemplate([id], 'split-y');
    expect(store.getState().project.pages[0].frameRects).toBeUndefined();
    expect(store.getState().project.pages[0].frames).toEqual(placements);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
  });

  it('preserves normalized rectangles through output resizing and rejects incomplete saved overrides', () => {
    const store = setup(); store.getState().updateFrameRect(firstRef(store), { x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    const rectangles = store.getState().project.pages[0].frameRects;
    store.getState().updateDocument({ width: 1000, height: 1500 });
    expect(store.getState().project.pages[0].frameRects).toEqual(rectangles);
    const malformed = structuredClone(store.getState().project); delete malformed.pages[0].frameRects?.b;
    expect(() => createEditorStore(malformed)).toThrow(/所有框/);
    const nested = structuredClone(store.getState().project);
    nested.templates['split-y'].root = { kind: 'split', axis: 'y', parameter: 'rows', children: [{ kind: 'free', frames: [{ slotId: 'a', rect: { x: 0, y: 0, width: 1, height: 1 } }] }, { kind: 'leaf', slotId: 'b' }] };
    expect(() => createEditorStore(nested)).toThrow(/根节点/);
  });
});

 describe('document edits and cross-page workflow', () => {
  it('preserves saved spacing in old pages while every newly added page starts at zero', () => {
    const saved = createProject({ canvasSizing: 'fixed' });
    saved.pages[0].margin = { top: 36, right: 52, bottom: 76, left: 24 };
    saved.pages[0].columnGap = 18; saved.pages[0].rowGap = 31;
    const store = createEditorStore(saved), before = store.getState().project.pages[0];
    store.getState().addPage('grid-4');
    expect(store.getState().project.pages[0]).toEqual(before);
    expect(store.getState().project.pages[1]).toMatchObject({ margin: { top: 0, right: 0, bottom: 0, left: 0 }, columnGap: 0, rowGap: 0 });
    const roundtrip = createEditorStore(JSON.parse(JSON.stringify(store.getState().project))).getState().project;
    expect(roundtrip.pages[0]).toEqual(before);
    store.getState().newProject();
    expect(store.getState().project.pages[0]).toMatchObject({ margin: { top: 0, right: 0, bottom: 0, left: 0 }, columnGap: 0, rowGap: 0 });
  });
  it('refreshes an externally edited photo without changing compositions, canvas size or undo count', () => {
    const store = createEditorStore(createProject({ canvasSizing: 'first-photo' })), ref = firstRef(store);
    store.getState().assignAssets([sizedAsset('photo', 4672, 7008)], ref);
    store.getState().updateTransform(ref, { focusX: 0.3, zoom: 2, rotation: 16, adjustments: { exposure: 0.4, saturation: 30 } });
    store.getState().duplicatePages([store.getState().activePageId]);
    const before = store.getState().project, count = store.getState().undoCount, revision = store.getState().revision;
    store.getState().markSaved(revision);
    store.getState().setRuntime('photo', { status: 'ready', url: 'old-proxy' });
    const refreshed = { ...sizedAsset('photo', 2000, 3000), fingerprint: 'external-v2' };
    store.getState().refreshAssets([refreshed]);
    const after = store.getState();
    expect(after.project.document).toEqual(before.document);
    expect(after.project.canvasSizing).toBe(before.canvasSizing);
    expect(after.project.pages).toEqual(before.pages);
    expect(after.project.assets.photo).toEqual(refreshed);
    expect(before.assets.photo.fingerprint).toBe('photo');
    expect(after.undoCount).toBe(count);
    expect(after.revision).toBeGreaterThan(revision);
    expect(after.revision).not.toBe(after.savedRevision);
    expect(after.runtimeAssets.photo).toBeUndefined();
  });

  it('keeps refreshed same-path metadata through undo and redo, including an existing redo branch', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().assignAssets([asset('photo')], ref);
    store.getState().updateTransform(ref, { zoom: 2 });
    store.getState().updateTransform(ref, { adjustments: { saturation: 40 } });
    const savedRevision = store.getState().revision;
    store.getState().markSaved(savedRevision);
    store.getState().undo();
    const count = store.getState().undoCount, redoCount = store.getState().redoCount;
    const refreshed = { ...asset('photo'), fingerprint: 'external-v2' };
    store.getState().refreshAssets([refreshed]);
    expect(store.getState().undoCount).toBe(count);
    expect(store.getState().redoCount).toBe(redoCount);
    store.getState().undo();
    expect(store.getState().project.pages[0].frames[0].transform.zoom).toBe(1);
    expect(store.getState().project.assets.photo.fingerprint).toBe('external-v2');
    store.getState().redo(); store.getState().redo();
    expect(store.getState().project.pages[0].frames[0].transform.adjustments?.saturation).toBe(40);
    expect(store.getState().project.assets.photo.fingerprint).toBe('external-v2');
    expect(store.getState().revision).not.toBe(store.getState().savedRevision);
    store.getState().markSaved(savedRevision); // A save started before the external edit finished late.
    expect(store.getState().revision).not.toBe(store.getState().savedRevision);
    const currentRevision = store.getState().revision;
    store.getState().markSaved(currentRevision);
    store.getState().undo(); expect(store.getState().revision).not.toBe(store.getState().savedRevision);
    store.getState().redo(); expect(store.getState().revision).toBe(store.getState().savedRevision);
  });

  it('preserves a relink history original at its different path while refreshing the live path', () => {
    const store = setup(); store.getState().assignAssets([asset('photo')]);
    const relinked = { ...asset('photo'), originalPath: '/edited/photo.jpg', fingerprint: 'relinked' };
    store.getState().updateAsset(relinked);
    const refreshed = { ...relinked, fingerprint: 'external-v2' };
    store.getState().refreshAssets([refreshed]);
    store.getState().undo();
    expect(store.getState().project.assets.photo).toEqual(asset('photo'));
    store.getState().redo();
    expect(store.getState().project.assets.photo).toEqual(refreshed);
  });

  it('keeps the active gesture transaction identity and cancellation uses refreshed metadata', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().assignAssets([asset('photo')], ref);
    store.getState().beginTransaction('移动照片');
    const owner = store.getState().transaction;
    store.getState().updateTransform(ref, { zoom: 2 });
    store.getState().refreshAssets([{ ...asset('photo'), fingerprint: 'external-v2' }]);
    expect(store.getState().transaction).toBe(owner);
    store.getState().cancelTransaction();
    expect(store.getState().project.pages[0].frames[0].transform.zoom).toBe(1);
    expect(store.getState().project.assets.photo.fingerprint).toBe('external-v2');
    expect(store.getState().undoCount).toBe(1);
    store.getState().beginTransaction('曝光照片');
    store.getState().updateTransform(ref, { adjustments: { exposure: 1 } });
    store.getState().refreshAssets([{ ...asset('photo'), fingerprint: 'external-v3' }]);
    store.getState().commitTransaction();
    expect(store.getState().undoCount).toBe(2);
    store.getState().undo();
    expect(store.getState().project.pages[0].frames[0].transform.adjustments?.exposure).toBe(0);
    expect(store.getState().project.assets.photo.fingerprint).toBe('external-v3');
  });

  it('ignores unchanged, unknown or different-path refreshes without introducing an edit', () => {
    const store = setup(); store.getState().assignAssets([asset('photo')]);
    const before = store.getState().project, revision = store.getState().revision;
    store.getState().refreshAssets([asset('photo'), asset('unknown'), { ...asset('photo'), originalPath: '/unrelated/photo.jpg', fingerprint: 'other' }]);
    expect(store.getState().project).toBe(before);
    expect(store.getState().revision).toBe(revision);
  });

  it('swaps photos with all ten color settings and compositions across pages in one undo entry', () => {
    const store = setup(); const first = firstRef(store);
    store.getState().assignAssets([asset('a')], first);
    store.getState().updateTransform(first, { focusX: 0.23, zoom: 1.7, rotation: 38, adjustments: colorA });
    store.getState().addPage('grid-4'); const second = firstRef(store, 1, 3);
    store.getState().assignAssets([asset('b')], second);
    store.getState().updateTransform(second, { focusY: 0.8, zoom: 2, rotation: -12, adjustments: colorB });
    const before = structuredClone(store.getState().project), count = store.getState().undoCount;
    store.getState().swapFrames(first, second);
    const after = store.getState().project;
    expect(after.pages[0].frames[0].imageAssetId).toBe('b');
    expect(after.pages[0].frames[0].transform).toEqual(before.pages[1].frames[3].transform);
    expect(after.pages[0].frames[0].transform.adjustments).toEqual(colorB);
    expect(after.pages[1].frames[3].imageAssetId).toBe('a');
    expect(after.pages[1].frames[3].transform).toEqual(before.pages[0].frames[0].transform);
    expect(after.pages[1].frames[3].transform.adjustments).toEqual(colorA);
    expect(after.pages.map(p => p.templateId)).toEqual(before.pages.map(p => p.templateId));
    expect(store.getState().undoCount).toBe(count + 1);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
  });

  it('keeps all ten color settings and composition through chained cross-page moves into empty frames', () => {
    const store = setup(), from = firstRef(store);
    store.getState().assignAssets([asset('a')], from);
    store.getState().updateTransform(from, { focusX: 0.1, focusY: 0.72, zoom: 3, rotation: -31, adjustments: colorA });
    store.getState().addPage('single'); const to = firstRef(store, 1);
    const before = store.getState().project, count = store.getState().undoCount;
    store.getState().swapFrames(from, to);
    const firstMove = store.getState().project;
    expect(firstMove.pages[0].frames[0]).toMatchObject({ imageAssetId: null, transform: defaultTransform() });
    expect(firstMove.pages[1].frames[0]).toMatchObject({ imageAssetId: 'a', transform: before.pages[0].frames[0].transform });
    expect(firstMove.pages[1].frames[0].transform.adjustments).toEqual(colorA);
    expect(store.getState().undoCount).toBe(count + 1);
    const next = firstRef(store, 0, 1);
    store.getState().swapFrames(to, next);
    const secondMove = store.getState().project;
    expect(secondMove.pages[1].frames[0]).toMatchObject({ imageAssetId: null, transform: defaultTransform() });
    expect(secondMove.pages[0].frames[1]).toMatchObject({ imageAssetId: 'a', transform: before.pages[0].frames[0].transform });
    expect(store.getState().undoCount).toBe(count + 2);
    store.getState().undo(); expect(store.getState().project).toEqual(firstMove);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); store.getState().redo(); expect(store.getState().project).toEqual(secondMove);
  });

  it('resets composition and all ten colors when the same asset is placed over its existing photo', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().assignAssets([asset('a')], ref);
    store.getState().updateTransform(ref, { focusX: 0.21, focusY: 0.7, zoom: 2.7, rotation: -26, adjustments: colorA });
    const before = store.getState().project, count = store.getState().undoCount;
    store.getState().replaceFrame(ref, 'a');
    const after = store.getState().project;
    expect(after.pages[0].frames[0]).toMatchObject({ imageAssetId: 'a', transform: defaultTransform() });
    expect(after.assets).toEqual(before.assets); expect(after.document).toEqual(before.document);
    expect(store.getState().undoCount).toBe(count + 1);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
    store.getState().replaceFrame(ref, 'a');
    expect(store.getState().project).toBe(after); expect(store.getState().undoCount).toBe(count + 1);
  });

  it('resets all composition and colors when removing a photo or replacing it with another asset', () => {
    for (const replacement of [null, 'b']) {
      const store = setup(), ref = firstRef(store);
      store.getState().assignAssets(['a', 'b'].map(asset));
      store.getState().updateTransform(ref, { focusX: 0.15, zoom: 1.8, rotation: 24, adjustments: colorB });
      const before = store.getState().project;
      store.getState().replaceFrame(ref, replacement);
      expect(store.getState().project.pages[0].frames[0]).toMatchObject({ imageAssetId: replacement, transform: defaultTransform() });
      expect(store.getState().project.assets).toEqual(before.assets);
      expect(store.getState().project.document).toEqual(before.document);
      store.getState().undo(); expect(store.getState().project).toEqual(before);
    }
  });

  it('preserves every occupied placement and transform when reducing and expanding slots', () => {
    const store = setup(), id = store.getState().activePageId;
    store.getState().applyTemplate([id], 'grid-4');
    store.getState().assignAssets(['a', 'b', 'c', 'd'].map(asset));
    store.getState().updateTransform(firstRef(store, 0, 3), { focusX: 0.17, zoom: 1.8 });
    const before = structuredClone(store.getState().project.pages[0].frames);
    store.getState().applyTemplate([id], 'single');
    expect(store.getState().project.pages[0].unplaced.map(f => f.imageAssetId)).toEqual(['b', 'c', 'd']);
    store.getState().applyTemplate([id], 'grid-4');
    expect(store.getState().project.pages[0].frames).toEqual(before);
    expect(store.getState().project.pages[0].unplaced).toHaveLength(0);
  });

  it('fills empty slots first and preserves overflow in the pending tray', () => {
    const store = setup();
    store.getState().assignAssets([asset('existing')], firstRef(store));
    store.getState().assignAssets(['a', 'b', 'c'].map(asset));
    const page = store.getState().project.pages[0];
    expect(page.frames.map(f => f.imageAssetId)).toEqual(['existing', 'a']);
    expect(page.unplaced.map(f => f.imageAssetId)).toEqual(['b', 'c']);
  });

  it('moves an overflow photo into an empty frame without leaving an empty tray item', () => {
    const store = setup(); store.getState().assignAssets(['a', 'b', 'c'].map(asset));
    const page = store.getState().project.pages[0], target = firstRef(store);
    store.getState().replaceFrame(target, null);
    const before = store.getState().project;
    store.getState().swapFrames({ pageId: page.id, frameId: page.unplaced[0].id }, target);
    expect(store.getState().project.pages[0].frames[0].imageAssetId).toBe('c');
    expect(store.getState().project.pages[0].unplaced).toHaveLength(0);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
  });

  it('ignores a stale import target without registering unused photos', () => {
    const store = setup(), original = store.getState().project;
    store.getState().assignAssets([asset('a')], { pageId: original.pages[0].id, frameId: 'removed-frame' });
    expect(store.getState().project).toBe(original);
    expect(store.getState().undoCount).toBe(0);
  });

  it('uses the page captured before async import even when the active page changes', () => {
    const store = setup(), capturedPageId = store.getState().activePageId;
    store.getState().addPage();
    store.getState().assignAssets([asset('a')], undefined, capturedPageId);
    expect(store.getState().project.pages[0].frames[0].imageAssetId).toBe('a');
    expect(store.getState().project.pages[1].frames.every(f => f.imageAssetId === null)).toBe(true);
    store.getState().assignAssets([asset('b')], firstRef(store, 1), capturedPageId);
    expect(store.getState().project.pages[1].frames[0].imageAssetId).toBe('b');
  });

  it('does not redirect pending imports when the captured page was deleted', () => {
    const store = setup(), capturedPageId = store.getState().activePageId;
    store.getState().addPage(); store.getState().deletePages([capturedPageId]);
    const before = store.getState().project;
    store.getState().assignAssets([asset('a')], undefined, capturedPageId);
    expect(store.getState().project).toBe(before);
    expect(store.getState().project.assets.a).toBeUndefined();
  });

  it('duplicates placements independently while sharing immutable asset references', () => {
    const store = setup(); store.getState().assignAssets([asset('a')]);
    store.getState().duplicatePages([store.getState().activePageId]);
    const [first, second] = store.getState().project.pages;
    expect(first.frames[0].id).not.toBe(second.frames[0].id);
    expect(first.frames[0].imageAssetId).toBe(second.frames[0].imageAssetId);
    store.getState().updateTransform(firstRef(store, 1), { focusY: 0.1 });
    expect(store.getState().project.pages[0].frames[0].transform.focusY).toBe(0.5);
  });

  it('deletes the last page into a valid blank project and can restore it', () => {
    const store = setup(); store.getState().applyTemplate([store.getState().activePageId], 'grid-4');
    const previous = store.getState().project;
    store.getState().deletePages([previous.pages[0].id]);
    expect(store.getState().project.pages).toHaveLength(1);
    expect(store.getState().project.pages[0].id).not.toBe(previous.pages[0].id);
    store.getState().undo(); expect(store.getState().project).toEqual(previous);
  });

  it('reorders the complete page list atomically and rejects incomplete orders', () => {
    const store = setup(); store.getState().addPage(); store.getState().addPage();
    const ids = store.getState().project.pages.map(p => p.id), before = store.getState().project;
    store.getState().reorderPages(ids.slice(1)); expect(store.getState().project).toBe(before);
    store.getState().reorderPages([...ids].reverse());
    expect(store.getState().project.pages.map(p => p.id)).toEqual([...ids].reverse());
    store.getState().undo(); expect(store.getState().project).toEqual(before);
  });

  it('relinks one shared asset, preserving placement compositions and invalidating runtime previews', () => {
    const store = setup(); store.getState().assignAssets([asset('a')]);
    store.getState().duplicatePages([store.getState().activePageId]);
    store.getState().setRuntime('a', { status: 'ready', url: 'old-cache' });
    const frames = store.getState().project.pages.map(p => p.frames);
    store.getState().updateAsset({ ...asset('a'), originalPath: '/new/a.jpg', fingerprint: 'new' });
    expect(store.getState().project.assets.a.originalPath).toBe('/new/a.jpg');
    expect(store.getState().project.pages.map(p => p.frames)).toEqual(frames);
    expect(store.getState().runtimeAssets.a).toBeUndefined();
    store.getState().undo(); expect(store.getState().project.assets.a.originalPath).toBe('/photos/a.jpg');
  });

  it('changes document resolution without changing normalized photo focus', () => {
    const store = createEditorStore(createProject({ width: 3000, height: 4500 })); store.getState().assignAssets([asset('a')]);
    store.getState().updateTransform(firstRef(store), { focusX: 0.31, zoom: 1.3 });
    store.getState().updatePage([store.getState().activePageId], { margin: { top: 48, right: 48, bottom: 48, left: 48 }, columnGap: 24, rowGap: 24 });
    const before = store.getState().project;
    store.getState().updateDocument({ width: 4000, height: 6000 });
    const next = store.getState().project;
    expect(next.pages[0].frames).toEqual(before.pages[0].frames);
    expect(next.pages[0].margin.left).toBe(64);
    expect(next.pages[0].rowGap).toBe(32);
    expect(() => store.getState().updateDocument({ width: 0 })).toThrow();
    store.getState().undo(); expect(store.getState().project).toEqual(before);
  });
 });

describe('page export checks', () => {
  it('toggles an export check without changing the active page, visible workspace, gesture or photo selection', () => {
    const store = setup(); for (let index = 1; index < 4; index++) store.getState().addPage();
    const ids = store.getState().project.pages.map(page => page.id), ref = firstRef(store, 2);
    store.getState().setSelectedPageIds([ids[0], ids[1]]);
    store.getState().setWorkspaceMode(4);
    store.getState().setEditingFrame(ref);
    store.getState().beginTransaction('拖动照片');
    const before = store.getState();
    store.getState().togglePageSelection(ids[3]);
    const after = store.getState();
    expect(after.selectedPageIds).toEqual([ids[0], ids[1], ids[3]]);
    for (const key of ['project', 'revision', 'savedRevision', 'activePageId', 'visiblePageIds', 'selectedFrame', 'editingFrame', 'frameEditing', 'workspaceMode', 'workspaceSelectionOnly', 'selectionAnchor', 'transaction', 'history', 'future'] as const) {
      expect(after[key]).toBe(before[key]);
    }
    store.getState().togglePageSelection(ids[3], false);
    expect(store.getState().selectedPageIds).toEqual([ids[0], ids[1]]);
  });

  it('allows zero checked pages and never silently rechecks through edits, undo, redo or navigation', () => {
    const store = setup(); const first = store.getState().activePageId;
    expect(store.getState().selectedPageIds).toEqual([first]);
    store.getState().togglePageSelection(first, false);
    store.getState().updatePage([first], { background: '#808080' });
    expect(store.getState().selectedPageIds).toEqual([]);
    store.getState().undo(); store.getState().redo();
    expect(store.getState().selectedPageIds).toEqual([]);
    const added = store.getState().addPage();
    expect(store.getState().selectedPageIds).toEqual([]);
    store.getState().setActivePage(first);
    expect(store.getState().selectedPageIds).toEqual([]);
    store.getState().deletePages([added]); store.getState().undo();
    expect(store.getState().selectedPageIds).toEqual([]);
  });

  it('normalizes checks to existing pages in document order without editing history', () => {
    const store = setup(); for (let index = 1; index < 4; index++) store.getState().addPage();
    const before = store.getState(), ids = before.project.pages.map(page => page.id);
    store.getState().setSelectedPageIds([ids[3], 'missing', ids[0], ids[3], ids[1]]);
    expect(store.getState().selectedPageIds).toEqual([ids[0], ids[1], ids[3]]);
    expect(store.getState().project).toBe(before.project);
    expect(store.getState().history).toBe(before.history);
    const normalized = store.getState();
    store.getState().togglePageSelection('missing');
    store.getState().togglePageSelection(ids[3], true);
    store.getState().setSelectedPageIds([ids[0], ids[1], ids[3]]);
    expect(store.getState()).toBe(normalized);
  });

  it('holds a chosen screen subset steady after checks change, including last-page uncheck and document undo', () => {
    const store = setup(); for (let index = 1; index < 7; index++) store.getState().addPage();
    const ids = store.getState().project.pages.map(page => page.id), visible = [ids[1], ids[4], ids[6]];
    store.getState().setSelectedPageIds(visible);
    store.getState().setWorkspaceMode(4, { onlySelected: true });
    store.getState().setSelectedPageIds([ids[0]]);
    store.getState().updatePage([visible[0]], { background: '#808080' });
    expect(store.getState().visiblePageIds).toEqual(visible);
    store.getState().undo(); store.getState().redo();
    expect(store.getState().visiblePageIds).toEqual(visible);
    expect(store.getState().selectedPageIds).toEqual([ids[0]]);
    store.getState().setSelectedPageIds([]);
    store.getState().setWorkspaceMode('overview'); store.getState().returnToEditor();
    expect(store.getState().visiblePageIds).toEqual(visible);
    store.getState().updatePage([visible[1]], { background: '#202020' });
    expect(store.getState().visiblePageIds).toEqual(visible);
    expect(store.getState().selectedPageIds).toEqual([]);
  });

  it('removes deleted checks without checking another page or restoring unrelated checks on undo', () => {
    const store = setup(); for (let index = 1; index < 4; index++) store.getState().addPage();
    const ids = store.getState().project.pages.map(page => page.id);
    store.getState().setSelectedPageIds([ids[1], ids[3]]);
    store.getState().deletePages([ids[1]]);
    expect(store.getState().selectedPageIds).toEqual([ids[3]]);
    store.getState().togglePageSelection(ids[0], true);
    store.getState().undo();
    expect(store.getState().selectedPageIds).toEqual([ids[0], ids[3]]);
    store.getState().deletePages(ids);
    expect(store.getState().selectedPageIds).toEqual([]);
  });

  it('does not discard export checks when a new page becomes active', () => {
    const store = setup(), first = store.getState().activePageId;
    const added = store.getState().addPage();
    expect(store.getState().activePageId).toBe(added);
    expect(store.getState().selectedPageIds).toEqual([first]);
  });
});

 describe('workspace selection', () => {
  it('shows six, eight and ten independent pages without editing document or adding undo history', () => {
    const store = setup(); for (let index = 1; index < 12; index++) store.getState().addPage();
    const project = store.getState().project, ids = project.pages.map(page => page.id), undo = store.getState().undoCount;
    store.getState().selectPage(ids[9]);
    for (const mode of [6, 8, 10] as const) {
      store.getState().setWorkspaceMode(mode);
      expect(store.getState().visiblePageIds).toEqual([...ids.slice(9), ...ids.slice(0, mode - 3)]);
      expect(store.getState().project).toBe(project);
      expect(store.getState().undoCount).toBe(undo);
      store.getState().setWorkspaceMode('overview'); store.getState().returnToEditor();
      expect(store.getState().workspaceMode).toBe(mode);
      expect(store.getState().visiblePageIds).toHaveLength(mode);
    }
    expect(JSON.stringify(project)).not.toMatch(/workspaceMode|workspaceSelectionOnly|visiblePageIds/);
  });

  it('keeps exactly five, seven or nine selected pages through edits, swaps and overview return', () => {
    for (const [count, mode] of [[5, 6], [7, 8], [9, 10]] as const) {
      const store = setup(); for (let index = 1; index < 12; index++) store.getState().addPage();
      const ids = store.getState().project.pages.map(page => page.id), selected = ids.slice(1, count + 1);
      const first = firstRef(store, 1), last = firstRef(store, count);
      store.getState().assignAssets([asset('source')], first);
      store.getState().assignAssets([asset('destination')], last);
      store.getState().setWorkspaceMode('overview'); store.getState().selectPage(selected[0]);
      for (const id of selected.slice(1)) store.getState().selectPage(id, { toggle: true });
      store.getState().setWorkspaceMode(mode, { onlySelected: true });
      expect(store.getState().visiblePageIds).toEqual(selected);
      store.getState().swapFrames(first, last);
      expect(store.getState().visiblePageIds).toEqual(selected);
      store.getState().undo(); store.getState().redo();
      expect(store.getState().visiblePageIds).toEqual(selected);
      store.getState().updatePage([selected[0]], { background: '#808080' });
      expect(store.getState().visiblePageIds).toEqual(selected);
      store.getState().setWorkspaceMode('overview'); store.getState().returnToEditor();
      expect(store.getState().workspaceMode).toBe(mode);
      expect(store.getState().visiblePageIds).toEqual(selected);
      store.getState().setWorkspaceMode(mode);
      expect(store.getState().visiblePageIds).toHaveLength(mode);
      expect(store.getState().workspaceSelectionOnly).toBe(false);
    }
  });

  it('preserves the exact selected subset after deletion and undo without adding unrelated pages', () => {
    const store = setup(); for (let index = 1; index < 12; index++) store.getState().addPage();
    const ids = store.getState().project.pages.map(page => page.id), selected = ids.slice(2, 7);
    store.getState().selectPage(selected[0]); store.getState().selectPage(selected[4], { range: true });
    store.getState().setWorkspaceMode(6, { onlySelected: true });
    store.getState().deletePages([selected[4]]);
    expect(store.getState().visiblePageIds).toEqual(selected.slice(0, 4));
    expect(store.getState().visiblePageIds).toContain(store.getState().activePageId);
    store.getState().undo();
    expect(store.getState().visiblePageIds.every(id => selected.includes(id))).toBe(true);
    expect(store.getState().visiblePageIds).not.toContain(ids[0]);
  });

  it('fills only existing pages for large capacities and ignores unsupported runtime modes', () => {
    const store = setup(); store.getState().addPage();
    const project = store.getState().project, ids = project.pages.map(page => page.id);
    for (const mode of [6, 8, 10] as const) {
      store.getState().setWorkspaceMode(mode);
      expect(store.getState().visiblePageIds).toHaveLength(2);
      expect(new Set(store.getState().visiblePageIds)).toEqual(new Set(ids));
      expect(store.getState().project).toBe(project);
    }
    const previous = store.getState();
    store.getState().setWorkspaceMode(5 as WorkspaceMode);
    expect(store.getState()).toBe(previous);
  });

  it('keeps four-page screen positions stable during cross-page swaps, split drags and undo', () => {
    const store = setup();
    for (let i = 1; i < 4; i++) store.getState().addPage();
    const ids = store.getState().project.pages.map(page => page.id);
    const first = firstRef(store), fourth = firstRef(store, 3);
    store.getState().assignAssets([asset('a')], first);
    store.getState().assignAssets([asset('b')], fourth);
    store.getState().selectPage(ids[3]);
    store.getState().setWorkspaceMode(4);
    const positions = [ids[3], ids[0], ids[1], ids[2]];
    expect(store.getState().visiblePageIds).toEqual(positions);

    store.getState().swapFrames(fourth, first);
    expect(store.getState().project.pages[0].frames[0].imageAssetId).toBe('b');
    expect(store.getState().visiblePageIds).toEqual(positions);
    store.getState().undo();
    expect(store.getState().project.pages[0].frames[0].imageAssetId).toBe('a');
    expect(store.getState().visiblePageIds).toEqual(positions);
    store.getState().redo();
    expect(store.getState().visiblePageIds).toEqual(positions);

    store.getState().beginTransaction('调整分割线');
    for (const ratio of [0.55, 0.6, 0.65]) {
      store.getState().updatePage([ids[3]], { templateState: { rows: [ratio, 1 - ratio] } });
      expect(store.getState().visiblePageIds).toEqual(positions);
    }
    store.getState().commitTransaction();
    store.getState().undo();
    expect(store.getState().project.pages[3].templateState.rows).toEqual([0.5, 0.5]);
    expect(store.getState().visiblePageIds).toEqual(positions);
  });

  it('ends photo adjustment when selecting another frame or clearing selection', () => {
    const store = setup(), first = firstRef(store), second = firstRef(store, 0, 1);
    store.getState().setEditingFrame(first);
    store.getState().setSelectedFrame({ ...first });
    expect(store.getState().editingFrame).toEqual(first);
    store.getState().setSelectedFrame(second);
    expect(store.getState().selectedFrame).toEqual(second);
    expect(store.getState().editingFrame).toBeNull();
    store.getState().setEditingFrame(second);
    store.getState().setSelectedFrame(null);
    expect(store.getState().selectedFrame).toBeNull();
    expect(store.getState().editingFrame).toBeNull();
  });

  it('shows selected independent pages in a four-page view without changing their templates', () => {
    const store = setup(); for (let i = 1; i < 8; i++) store.getState().addPage();
    const original = store.getState().project;
    const ids = original.pages.map(page => page.id);
    store.getState().setWorkspaceMode('overview');
    store.getState().selectPage(ids[1]);
    store.getState().selectPage(ids[4], { toggle: true });
    store.getState().selectPage(ids[7], { toggle: true });
    store.getState().setWorkspaceMode(3);
    expect(store.getState().visiblePageIds).toEqual([ids[1], ids[4], ids[7]]);
    expect(store.getState().project).toBe(original);
    store.getState().setWorkspaceMode('overview'); store.getState().returnToEditor();
    expect(store.getState().workspaceMode).toBe(3);
    expect(store.getState().visiblePageIds).toEqual([ids[1], ids[4], ids[7]]);
    store.getState().setWorkspaceMode(1);
    expect(store.getState().visiblePageIds).toEqual([ids[7]]);
  });

  it('never creates pages to fill a workspace and keeps selection separate from photo selection', () => {
    const store = setup(); store.getState().addPage();
    const ids = store.getState().project.pages.map(page => page.id);
    store.getState().selectPage(ids[0]); store.getState().selectPage(ids[1], { toggle: true });
    store.getState().setWorkspaceMode(4);
    expect(store.getState().visiblePageIds).toEqual(ids);
    store.getState().setSelectedFrame(firstRef(store));
    expect(store.getState().selectedPageIds).toEqual(ids);
    expect(store.getState().project.pages).toHaveLength(2);
  });

  it('supports anchored range selection and clears references to deleted frames', () => {
    const store = setup(); for (let i = 0; i < 4; i++) store.getState().addPage();
    const ids = store.getState().project.pages.map(page => page.id);
    store.getState().selectPage(ids[1]); store.getState().selectPage(ids[4], { range: true });
    expect(store.getState().selectedPageIds).toEqual(ids.slice(1));
    store.getState().setEditingFrame(firstRef(store, 2));
    store.getState().deletePages([ids[2]]);
    expect(store.getState().editingFrame).toBeNull();
    expect(store.getState().selectedFrame).toBeNull();
    expect(store.getState().selectedPageIds).not.toContain(ids[2]);
  });

  it('returns from overview with an active page visible after navigating to another page', () => {
    const store = setup(); for (let i = 0; i < 5; i++) store.getState().addPage();
    const ids = store.getState().project.pages.map(page => page.id);
    store.getState().selectPage(ids[0]); store.getState().setWorkspaceMode(2);
    store.getState().setWorkspaceMode('overview'); store.getState().selectPage(ids[4]);
    store.getState().returnToEditor();
    expect(store.getState().visiblePageIds).toContain(ids[4]);
    expect(store.getState().workspaceMode).toBe(2);
  });
 });

 describe('history, persistence and transactions', () => {
  it('merges individual photo adjustments without touching another placement of the same original', () => {
    const store = setup(), first = firstRef(store);
    store.getState().assignAssets([asset('photo')], first);
    store.getState().duplicatePages([store.getState().activePageId]);
    const originalMetadata = store.getState().project.assets.photo;
    store.getState().updateTransform(first, { adjustments: { exposure: 1.25, temperature: 24, blacks: -8 } });
    store.getState().updateTransform(first, { adjustments: { contrast: 30 } });
    expect(store.getState().project.pages[0].frames[0].transform.adjustments).toEqual({
      ...defaultAdjustments(), exposure: 1.25, temperature: 24, blacks: -8, contrast: 30,
    });
    expect(store.getState().project.pages[1].frames[0].transform.adjustments).toEqual(defaultAdjustments());
    expect(store.getState().project.assets.photo).toEqual(originalMetadata);
  });

  it('clamps finite photo settings and does not record NaN or infinite edits', () => {
    const store = setup(), ref = firstRef(store), initial = store.getState().project;
    store.getState().updateTransform(ref, { adjustments: { exposure: NaN, shadows: Infinity, blacks: -Infinity } });
    expect(store.getState().project).toBe(initial);
    expect(store.getState().undoCount).toBe(0);
    store.getState().updateTransform(ref, { adjustments: { exposure: 7, brightness: -500, saturation: 500, tint: 300 } });
    expect(store.getState().project.pages[0].frames[0].transform.adjustments).toMatchObject({
      exposure: 3, brightness: -100, saturation: 100, tint: 100,
    });
  });

  it('merges a continuous color adjustment into one undo and restores it on redo', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().assignAssets([asset('photo')], ref);
    const before = store.getState().project, count = store.getState().undoCount;
    store.getState().beginTransaction('调整照片曝光');
    for (let i = 1; i <= 40; i++) store.getState().updateTransform(ref, { adjustments: { exposure: i / 20, highlights: -i, vibrance: i } });
    expect(store.getState().undoCount).toBe(count);
    store.getState().commitTransaction();
    const after = store.getState().project;
    expect(store.getState().undoCount).toBe(count + 1);
    expect(after.pages[0].frames[0].transform.adjustments).toMatchObject({ exposure: 2, highlights: -40, vibrance: 40 });
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
  });

  it('loads older photos as neutral and rejects invalid explicit photo adjustments', () => {
    const old = createProject({ canvasSizing: 'fixed' });
    delete old.pages[0].frames[0].transform.adjustments;
    const store = createEditorStore(old);
    expect(store.getState().project.pages[0].frames[0].transform.adjustments).toEqual(defaultAdjustments());
    expect(old.pages[0].frames[0].transform.adjustments).toBeUndefined();
    const invalid = structuredClone(store.getState().project);
    invalid.pages[0].frames[0].transform.adjustments!.exposure = 3.1;
    expect(() => store.getState().loadProject(invalid)).toThrow(/调整/);
    expect(store.getState().project.pages[0].frames[0].transform.adjustments).toEqual(defaultAdjustments());
  });

  it('clamps finite rotation edits and ignores non-finite or unsupported transform values', () => {
    const store = setup(), ref = firstRef(store), initial = store.getState().project;
    store.getState().updateTransform(ref, { rotation: NaN, zoom: Infinity, focusX: -Infinity, flipX: true });
    expect(store.getState().project).toBe(initial);
    expect(store.getState().undoCount).toBe(0);
    store.getState().updateTransform(ref, { rotation: 720 });
    expect(store.getState().project.pages[0].frames[0].transform.rotation).toBe(180);
    store.getState().updateTransform(ref, { rotation: -720 });
    expect(store.getState().project.pages[0].frames[0].transform.rotation).toBe(-180);
    expect(store.getState().project.pages[0].frames[0].transform.flipX).toBe(false);
    store.getState().undo();
    expect(store.getState().project.pages[0].frames[0].transform.rotation).toBe(180);
  });

  it('treats one rotation and scaling gesture as one reversible composition edit', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().assignAssets([asset('photo')], ref);
    const before = store.getState().project, count = store.getState().undoCount;
    store.getState().beginTransaction('旋转照片');
    for (let i = 1; i <= 40; i++) store.getState().updateTransform(ref, { rotation: i * 2, zoom: 1 + i / 20 });
    expect(store.getState().undoCount).toBe(count);
    store.getState().commitTransaction();
    const after = store.getState().project;
    expect(after.pages[0].frames[0].transform).toMatchObject({ rotation: 80, zoom: 3 });
    expect(store.getState().undoCount).toBe(count + 1);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
  });

  it('restores the original photo composition in one undo step without changing its placement', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().assignAssets([asset('photo')], ref);
    store.getState().updateTransform(ref, { focusX: 0.2, focusY: 0.8, zoom: 2.3, rotation: -37.5, adjustments: { exposure: 1.3, shadows: 42, saturation: -18, blacks: -9 } });
    const before = store.getState().project, count = store.getState().undoCount;
    store.getState().updateTransform(ref, defaultTransform());
    const reset = store.getState().project.pages[0].frames[0];
    expect(reset.transform).toEqual(defaultTransform());
    expect(reset.imageAssetId).toBe('photo');
    expect(store.getState().undoCount).toBe(count + 1);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project.pages[0].frames[0].transform).toEqual(defaultTransform());
  });

  it('retains 80 composition steps for an ordinary 50-page, 200-photo document', () => {
    const project = createProject();
    project.templates = structuredClone(BUILTIN_TEMPLATES);
    project.pages = Array.from({ length: 50 }, () => createPage('grid-4'));
    project.pages.forEach((page, index) => page.frames.forEach((frame, slot) => {
      const id = `asset_${index}_${slot}`;
      project.assets[id] = {
        ...asset(id), originalPath: `/Users/photographer/Pictures/Wedding/Originals/${id}.jpg`,
        fingerprint: id.padEnd(64, 'a'), icc: 'RGB ICC · 3144 bytes',
      };
      frame.imageAssetId = id;
    }));
    const store = createEditorStore(project), ref = firstRef(store);
    for (let i = 1; i <= 80; i++) store.getState().updateTransform(ref, { rotation: i });
    expect(store.getState().undoCount).toBe(80);
    for (let i = 0; i < 80; i++) store.getState().undo();
    expect(store.getState().project.pages[0].frames[0].transform.rotation).toBe(0);
    expect(store.getState().redoCount).toBe(80);
    for (let i = 0; i < 80; i++) store.getState().redo();
    expect(store.getState().project.pages[0].frames[0].transform.rotation).toBe(80);
    expect(store.getState().undoCount).toBe(80);
  });

  it('starts blank projects clean but keeps an undo to the initial state dirty after saving an edit', () => {
    const store = setup();
    expect(store.getState().revision).toBe(store.getState().savedRevision);
    store.getState().assignAssets([asset('a')]);
    const edited = store.getState();
    store.getState().markSaved(edited.revision, '/test.collage', edited.project.id);
    expect(store.getState().revision).toBe(store.getState().savedRevision);
    store.getState().undo();
    expect(store.getState().revision).toBe(0);
    expect(store.getState().revision).not.toBe(store.getState().savedRevision);
    store.getState().redo();
    expect(store.getState().revision).toBe(store.getState().savedRevision);
  });

  it('restores a recovery document as unsaved with a fresh session until it is explicitly saved', () => {
    const store = setup();
    store.getState().assignAssets([asset('recovered')]);
    const recovered = structuredClone(store.getState().project);
    store.getState().markSaved(store.getState().revision, '/old.collage');
    store.getState().setEditingFrame(firstRef(store));
    store.getState().beginTransaction();
    store.getState().restoreProject(recovered);
    const restored = store.getState();
    expect(restored.project).toEqual(recovered);
    expect(restored.projectPath).toBeNull();
    expect(restored.revision).toBe(0);
    expect(restored.savedRevision).toBe(-1);
    expect(restored.undoCount).toBe(0);
    expect(restored.transaction).toBeNull();
    expect(restored.editingFrame).toBeNull();
    recovered.name = 'outside change';
    expect(store.getState().project.name).not.toBe(recovered.name);
    store.getState().markSaved(restored.revision, '/recovered.collage', restored.project.id);
    expect(store.getState().revision).toBe(store.getState().savedRevision);
    expect(store.getState().projectPath).toBe('/recovered.collage');
  });

  it('validates ordinary edits before committing state and preserves the document on rejection', () => {
    const store = setup(), before = store.getState().project;
    const validator = vi.fn(() => { throw new Error('layout impossible'); }); setDocumentValidator(validator);
    expect(() => store.getState().renameProject('new')).toThrow('layout impossible');
    expect(validator).toHaveBeenCalledOnce();
    expect(store.getState().project).toBe(before); expect(store.getState().undoCount).toBe(0);
    expect(store.getState().revision).toBe(0);
  });

  it('validates a gesture once on commit and rolls back invalid drafts without losing redo', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().updateTransform(ref, { zoom: 2 }); store.getState().undo();
    const before = store.getState().project;
    const validator = vi.fn(() => { throw new Error('layout impossible'); }); setDocumentValidator(validator);
    store.getState().beginTransaction();
    for (let i = 1; i <= 30; i++) store.getState().updateTransform(ref, { zoom: 1 + i / 10 });
    expect(validator).not.toHaveBeenCalled();
    expect(() => store.getState().commitTransaction()).toThrow('layout impossible');
    expect(validator).toHaveBeenCalledOnce();
    expect(store.getState().project).toBe(before);
    expect(store.getState().transaction).toBeNull(); expect(store.getState().revision).toBe(0);
    expect(store.getState().redoCount).toBe(1);
    setDocumentValidator(undefined); store.getState().redo();
    expect(store.getState().project.pages[0].frames[0].transform.zoom).toBe(2);
  });

  it('validates new/load/recovery before replacing the current document', () => {
    const store = setup(), before = store.getState().project;
    const validator = vi.fn(() => { throw new Error('unsupported geometry'); }); setDocumentValidator(validator);
    expect(() => store.getState().newProject()).toThrow('unsupported geometry');
    expect(() => store.getState().loadProject(createProject(), '/new.collage')).toThrow('unsupported geometry');
    expect(() => store.getState().restoreProject(createProject())).toThrow('unsupported geometry');
    expect(store.getState().project).toBe(before); expect(store.getState().projectPath).toBeNull();
    expect(validator).toHaveBeenCalledTimes(3);
  });
  it('merges a long gesture into one undo while keeping previous snapshots immutable', () => {
    const store = setup(), ref = firstRef(store), before = store.getState().project;
    store.getState().beginTransaction('拖动照片');
    for (let i = 0; i < 40; i++) store.getState().updateTransform(ref, { zoom: 1 + i / 10 });
    expect(store.getState().undoCount).toBe(0);
    expect(before.pages[0].frames[0].transform.zoom).toBe(1);
    store.getState().commitTransaction(); expect(store.getState().undoCount).toBe(1);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project.pages[0].frames[0].transform.zoom).toBe(4.9);
  });

  it('restores redo after cancelling a gesture or committing an unchanged gesture', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().updateTransform(ref, { zoom: 2 }); store.getState().undo();
    store.getState().beginTransaction(); store.getState().updateTransform(ref, { zoom: 3 }); store.getState().cancelTransaction();
    expect(store.getState().redoCount).toBe(1);
    store.getState().beginTransaction(); store.getState().updateTransform(ref, { zoom: 4 }); store.getState().updateTransform(ref, { zoom: 1 }); store.getState().commitTransaction();
    expect(store.getState().revision).toBe(0); expect(store.getState().redoCount).toBe(1);
    store.getState().redo(); expect(store.getState().project.pages[0].frames[0].transform.zoom).toBe(2);
  });

  it('drops the redo branch only when a new gesture is committed', () => {
    const store = setup(), ref = firstRef(store);
    store.getState().updateTransform(ref, { zoom: 2 }); store.getState().undo();
    store.getState().beginTransaction(); store.getState().updateTransform(ref, { zoom: 3 }); store.getState().commitTransaction();
    expect(store.getState().redoCount).toBe(0);
    expect(store.getState().revision).toBeGreaterThan(1);
  });

  it('does not mark newer edits as saved when an earlier snapshot finishes saving', () => {
    const store = setup(); store.getState().renameProject('旅行');
    const savedSnapshot = store.getState();
    store.getState().renameProject('旅行第二版');
    store.getState().markSaved(savedSnapshot.revision, '/test.collage', savedSnapshot.project.id);
    expect(store.getState().savedRevision).not.toBe(store.getState().revision);
    store.getState().undo(); expect(store.getState().savedRevision).toBe(store.getState().revision);
    store.getState().newProject();
    store.getState().markSaved(savedSnapshot.revision, '/old.collage', savedSnapshot.project.id);
    expect(store.getState().projectPath).toBeNull(); expect(store.getState().savedRevision).toBe(0);
  });

  it('starts loaded documents clean, clones input, and bounds edit history', () => {
    const store = setup(), project = createProject(); store.getState().loadProject(project, '/test.collage');
    expect(store.getState().revision).toBe(store.getState().savedRevision);
    project.name = 'changed outside the store'; expect(store.getState().project.name).not.toBe(project.name);
    for (let i = 0; i < 100; i++) store.getState().renameProject(`名字 ${i}`);
    expect(store.getState().undoCount).toBe(80);
    store.getState().newProject(); expect(store.getState().undoCount).toBe(0); expect(store.getState().projectPath).toBeNull();
  });
 });
