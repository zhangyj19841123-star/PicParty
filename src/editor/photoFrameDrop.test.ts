import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cover_json, initSync, layout_json, validate_project_json } from '../../public/core-wasm/collage_wasm.js';
import { geometry } from '../core/engine';
import { BUILTIN_TEMPLATES, createPage, createProject, defaultTransform } from '../core/templates';
import type { FrameRef, GeometryEngine, ImageAsset, Project, Rect, TemplateDefinition } from '../core/types';
import { createEditorStore, setDocumentValidator } from '../state/editorStore';
import { finishPhotoFrameDrop, photoFrameDropTarget } from './photoFrameDrop';
import { workspaceFrameHit, workspaceLayout } from './workspaceLayout';

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
const refAt = (store: Editor, pageIndex: number, frameIndex = 0): FrameRef => ({ pageId: store.getState().project.pages[pageIndex].id, frameId: store.getState().project.pages[pageIndex].frames[frameIndex].id });
const frameAt = (project: Project, ref: FrameRef) => project.pages.find(page => page.id === ref.pageId)!.frames.find(frame => frame.id === ref.frameId)!;
const layouts = (project: Project) => project.pages.map(page => nativeEngine.layout(page, project.document, project.templates[page.templateId]));
const setup = () => {
  const store = createEditorStore(createProject({ canvasSizing: 'fixed' }));
  store.getState().assignAssets([asset('diptych-one'), asset('diptych-two')]);
  store.getState().addPage('three-y');
  store.getState().assignAssets([asset('triptych-one'), asset('triptych-two')]);
  store.getState().setWorkspaceMode(2);
  store.getState().updateTransform(refAt(store, 0), { zoom: 1.8, rotation: 17, focusX: 0.31, focusY: 0.62, adjustments: { exposure: 0.75, temperature: -18, contrast: 23, blacks: 9 } });
  store.getState().updateTransform(refAt(store, 1), { zoom: 1.3, rotation: -8, focusX: 0.6, adjustments: { saturation: -20, shadows: 34 } });
  return store;
};
const hitFrameCenter = (project: Project, ref: FrameRef) => {
  const viewport = { width: 1200, height: 850 };
  const screen = workspaceLayout({ document: project.document, viewport, count: project.pages.length, mode: 2 });
  const views = screen.views.map((view, index) => ({ ...view, page: project.pages[index], layout: nativeEngine.layout(project.pages[index], project.document, project.templates[project.pages[index].templateId]) }));
  const view = views.find(view => view.page.id === ref.pageId)!, frame = frameAt(project, ref);
  const rect = view.layout.frames.find(rect => rect.slotId === frame.slotId)!.rect;
  return workspaceFrameHit(views, { x: view.x + (rect.x + rect.width / 2) * view.scale, y: view.y + (rect.y + rect.height / 2) * view.scale }, viewport);
};

/** User-defined slot names and geometry intentionally do not resemble the
 * built-ins. A drop must resolve the visible frame ID, never a slot index or
 * an assumed count of pictures on a page. */
const customTemplate = (id: string, slots: Array<[string, Rect]>): TemplateDefinition => ({
  id, version: 1, name: id, category: '我的模板', defaults: {},
  root: { kind: 'free', frames: slots.map(([slotId, rect]) => ({ slotId, rect })) },
  slotOrder: slots.map(([slotId]) => slotId),
});
const arbitraryProject = () => {
  const project = createProject({ canvasSizing: 'fixed' });
  const custom = [
    customTemplate('user-single-inset', [['封面/portrait', { x: .08, y: .06, width: .84, height: .88 }]]),
    customTemplate('user-four-offset', [
      ['north-west-99', { x: .04, y: .05, width: .42, height: .38 }],
      ['right detail', { x: .55, y: .1, width: .4, height: .3 }],
      ['lower-left', { x: .12, y: .51, width: .32, height: .43 }],
      ['尾图', { x: .53, y: .5, width: .43, height: .39 }],
    ]),
    customTemplate('user-three-overlap', [
      ['wide hero', { x: .05, y: .06, width: .78, height: .6 }],
      ['detail/one', { x: .25, y: .3, width: .65, height: .5 }],
      ['floating_99', { x: .55, y: .15, width: .4, height: .4 }],
    ]),
  ];
  project.templates = Object.fromEntries([...custom, BUILTIN_TEMPLATES['split-y'], BUILTIN_TEMPLATES['three-y']]
    .map(template => [template.id, structuredClone(template)]));
  project.pages = Object.keys(project.templates).map(id => createPage(id, project.templates, project.document));
  // A page can override a standard split template with completely free geometry.
  project.pages[3].frameRects = {
    a: { x: .12, y: .1, width: .65, height: .35 },
    b: { x: .3, y: .48, width: .6, height: .4 },
  };
  let index = 0;
  for (const page of project.pages) for (const frame of page.frames) {
    const photo = asset(`arbitrary-${index}`); project.assets[photo.id] = photo;
    frame.imageAssetId = photo.id;
    frame.transform = {
      ...defaultTransform(), zoom: 1.8 + index * .03, rotation: -60 + index * 11,
      focusX: .2 + index * .01, focusY: .7 - index * .02,
      adjustments: { exposure: .25, temperature: -17, tint: 8, contrast: 24, highlights: -35, brightness: 6, shadows: 43, vibrance: 18, saturation: -13, blacks: 21 },
    };
    index++;
  }
  return project;
};
const arbitraryRef = (store: Editor, page: number) => refAt(store, page, page === 2 ? 2 : 0);
const arbitraryHit = (project: Project, pageIndex: number, fraction: { x: number; y: number }) => {
  const viewport = { width: 1600, height: 900 };
  const screen = workspaceLayout({ document: project.document, viewport, count: project.pages.length, mode: 6 });
  const views = screen.views.map((view, index) => ({ ...view, page: project.pages[index], layout: nativeEngine.layout(project.pages[index], project.document, project.templates[project.pages[index].templateId]) }));
  const view = views[pageIndex];
  return workspaceFrameHit(views, { x: view.x + fraction.x * view.width, y: view.y + fraction.y * view.height }, viewport);
};
const arbitraryFrameHit = (project: Project, page: number, ref: FrameRef) => {
  const frame = frameAt(project, ref);
  const rect = layouts(project)[page].frames.find(resolved => resolved.slotId === frame.slotId)!.rect;
  return arbitraryHit(project, page, { x: (rect.x + rect.width / 2) / project.document.width, y: (rect.y + rect.height / 2) / project.document.height });
};
const arbitraryPairs = Array.from({ length: 5 }, (_, from) => Array.from({ length: 5 }, (_, to) => [from, to] as const))
  .flat().filter(([from, to]) => from !== to);

beforeAll(() => { initSync({ module: Uint8Array.from(readFileSync(new URL('../../public/core-wasm/collage_wasm_bg.wasm', import.meta.url))) }); });
beforeEach(() => {
  vi.mocked(geometry).mockReturnValue(nativeEngine);
  setDocumentValidator(project => { validate_project_json(JSON.stringify(project)); });
});
afterEach(() => setDocumentValidator(undefined));

describe('photo drops across mixed page templates', () => {
  it.each([[0, 1], [1, 0]] as const)('exchanges occupied %s → %s frames without carrying temporary panning', (from, to) => {
    const store = setup(), source = refAt(store, from), destination = refAt(store, to), before = store.getState().project;
    const sourceFrame = structuredClone(frameAt(before, source)), targetFrame = structuredClone(frameAt(before, destination)), geometryBefore = layouts(before), count = store.getState().undoCount;
    store.getState().setSelectedFrame(source); store.getState().setEditingFrame(source);
    store.getState().beginTransaction('拖动照片');
    const transaction = store.getState().transaction;
    store.getState().updateTransform(source, { focusX: 1, focusY: 0 });
    const hit = hitFrameCenter(store.getState().project, destination);
    expect(hit).toEqual(destination);
    expect(photoFrameDropTarget(source, hit, store.getState().photoTransform)).toEqual(destination);
    expect(finishPhotoFrameDrop(store.getState, { source, frame: sourceFrame, transaction }, hit)).toBe(true);
    expect(store.getState().transaction).toBe(transaction);
    expect(store.getState().undoCount).toBe(count);
    store.getState().commitTransaction();
    const after = store.getState().project;
    expect(frameAt(after, destination)).toEqual({ ...targetFrame, imageAssetId: sourceFrame.imageAssetId, transform: sourceFrame.transform });
    expect(frameAt(after, source)).toEqual({ ...sourceFrame, imageAssetId: targetFrame.imageAssetId, transform: targetFrame.transform });
    expect(layouts(after)).toEqual(geometryBefore);
    expect(after.templates).toEqual(before.templates); expect(after.document).toEqual(before.document);
    expect(after.assets).toEqual(before.assets); expect(store.getState().undoCount).toBe(count + 1);
    expect(validate_project_json(JSON.stringify(after))).toBe('true');
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
  });

  it.each([[0, 1], [1, 0]] as const)('moves %s → %s into an empty frame, preserves attributes and clears the source', (from, to) => {
    const store = setup(), source = refAt(store, from), destination = refAt(store, to, to === 1 ? 2 : 1);
    store.getState().replaceFrame(destination, null);
    const before = store.getState().project, sourceFrame = structuredClone(frameAt(before, source)), count = store.getState().undoCount;
    store.getState().setSelectedFrame(source); store.getState().setEditingFrame(source); store.getState().beginTransaction('拖动照片');
    const transaction = store.getState().transaction;
    store.getState().updateTransform(source, { focusX: 0, focusY: 1 });
    expect(finishPhotoFrameDrop(store.getState, { source, frame: sourceFrame, transaction }, hitFrameCenter(store.getState().project, destination))).toBe(true);
    store.getState().commitTransaction();
    expect(frameAt(store.getState().project, destination).transform).toEqual(sourceFrame.transform);
    expect(frameAt(store.getState().project, destination).imageAssetId).toBe(sourceFrame.imageAssetId);
    expect(frameAt(store.getState().project, source)).toMatchObject({ imageAssetId: null, transform: defaultTransform() });
    expect(layouts(store.getState().project)).toEqual(layouts(before));
    expect(store.getState().undoCount).toBe(count + 1);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
  });

  it('leaves normal panning intact when dropping within the same frame or outside the pages', () => {
    for (const outside of [false, true]) {
      const store = setup(), source = refAt(store, 0), original = structuredClone(frameAt(store.getState().project, source));
      store.getState().setEditingFrame(source); store.getState().beginTransaction('移动照片');
      const transaction = store.getState().transaction;
      store.getState().updateTransform(source, { focusX: 0.7 });
      const hit = outside ? null : source;
      expect(photoFrameDropTarget(source, hit, null)).toBeNull();
      expect(finishPhotoFrameDrop(store.getState, { source, frame: original, transaction }, hit)).toBe(false);
      store.getState().commitTransaction();
      expect(frameAt(store.getState().project, source).transform.focusX).toBe(0.7);
      expect(frameAt(store.getState().project, source).imageAssetId).toBe(original.imageAssetId);
    }
  });

  it('does not exchange photos or discard the draft while Ctrl T free transform is active', () => {
    const store = setup(), source = refAt(store, 0), destination = refAt(store, 1), original = structuredClone(frameAt(store.getState().project, source));
    store.getState().setSelectedFrame(source); store.getState().beginPhotoTransform();
    const transaction = store.getState().transaction, beforeTarget = structuredClone(frameAt(store.getState().project, destination));
    store.getState().updateTransform(source, { zoom: 2.4, rotation: 38, focusX: 0.8 });
    expect(photoFrameDropTarget(source, destination, store.getState().photoTransform)).toBeNull();
    expect(finishPhotoFrameDrop(store.getState, { source, frame: original, transaction }, destination)).toBe(false);
    expect(store.getState().transaction).toBe(transaction); expect(store.getState().photoTransform).toEqual(source);
    expect(frameAt(store.getState().project, destination)).toEqual(beforeTarget);
    expect(frameAt(store.getState().project, source).transform).toMatchObject({ zoom: 2.4, rotation: 38, focusX: 0.8 });
    store.getState().cancelPhotoTransform(); expect(frameAt(store.getState().project, source)).toEqual(original);
  });

  it('ignores a stale cancelled gesture and a source that was replaced before release', () => {
    const store = setup(), source = refAt(store, 0), destination = refAt(store, 1), original = structuredClone(frameAt(store.getState().project, source));
    store.getState().beginTransaction('拖动照片'); const stale = store.getState().transaction;
    store.getState().updateTransform(source, { focusX: 1 }); store.getState().cancelTransaction();
    const before = store.getState().project;
    expect(finishPhotoFrameDrop(store.getState, { source, frame: original, transaction: stale }, destination)).toBe(false);
    expect(store.getState().project).toBe(before);
    store.getState().beginTransaction('replacement'); const transaction = store.getState().transaction;
    store.getState().replaceFrame(source, 'triptych-two');
    const replaced = store.getState().project;
    expect(finishPhotoFrameDrop(store.getState, { source, frame: original, transaction }, destination)).toBe(false);
    expect(store.getState().project).toBe(replaced);
  });
});

describe('photo drops across arbitrary user templates and layered frames', () => {
  it.each(arbitraryPairs)('exchanges occupied pages %s → %s using visible geometry, with no shared-slot or picture-count requirement', (from, to) => {
    const store = createEditorStore(arbitraryProject()), source = arbitraryRef(store, from), destination = arbitraryRef(store, to);
    const before = store.getState().project, sourceFrame = structuredClone(frameAt(before, source)), targetFrame = structuredClone(frameAt(before, destination));
    const expected = structuredClone(before), geometryBefore = layouts(before);
    Object.assign(frameAt(expected, source), { imageAssetId: targetFrame.imageAssetId, transform: targetFrame.transform });
    Object.assign(frameAt(expected, destination), { imageAssetId: sourceFrame.imageAssetId, transform: sourceFrame.transform });
    store.getState().setWorkspaceMode(6); store.getState().setEditingFrame(source);
    store.getState().beginTransaction('拖动照片'); const transaction = store.getState().transaction;
    store.getState().updateTransform(source, { focusX: .99, focusY: .01 });
    const hit = arbitraryFrameHit(store.getState().project, to, destination);
    expect(hit).toEqual(destination);
    expect(finishPhotoFrameDrop(store.getState, { source, frame: sourceFrame, transaction }, hit)).toBe(true);
    expect(store.getState().transaction).toBe(transaction);
    expect(store.getState().undoCount).toBe(0);
    store.getState().commitTransaction();
    expect(store.getState().project).toEqual(expected);
    expect(layouts(store.getState().project)).toEqual(geometryBefore);
    expect(validate_project_json(JSON.stringify(store.getState().project))).toBe('true');
    expect(store.getState().undoCount).toBe(1);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(expected);
  });

  it.each(arbitraryPairs)('moves pages %s → %s into empty arbitrary frames while keeping crop geometry, layers and every photo adjustment', (from, to) => {
    const initial = arbitraryProject(), targetPage = initial.pages[to], empty = targetPage.frames[to === 2 ? 2 : 0];
    empty.imageAssetId = null; empty.transform = defaultTransform();
    const store = createEditorStore(initial), source = arbitraryRef(store, from), destination = arbitraryRef(store, to);
    const before = store.getState().project, sourceFrame = structuredClone(frameAt(before, source)), expected = structuredClone(before), geometryBefore = layouts(before);
    Object.assign(frameAt(expected, source), { imageAssetId: null, transform: defaultTransform() });
    Object.assign(frameAt(expected, destination), { imageAssetId: sourceFrame.imageAssetId, transform: sourceFrame.transform });
    store.getState().setWorkspaceMode(6); store.getState().setEditingFrame(source);
    store.getState().beginTransaction('拖动照片'); const transaction = store.getState().transaction;
    store.getState().updateTransform(source, { focusX: .01, focusY: .99 });
    const hit = arbitraryFrameHit(store.getState().project, to, destination);
    expect(hit).toEqual(destination);
    expect(finishPhotoFrameDrop(store.getState, { source, frame: sourceFrame, transaction }, hit)).toBe(true);
    store.getState().commitTransaction();
    expect(store.getState().project).toEqual(expected);
    expect(layouts(store.getState().project)).toEqual(geometryBefore);
    expect(validate_project_json(JSON.stringify(store.getState().project))).toBe('true');
    expect(store.getState().undoCount).toBe(1);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(expected);
  });

  it('uses the top visible frame at an overlap after layer changes, rather than root or slotOrder positions', () => {
    const store = createEditorStore(arbitraryProject()), source = arbitraryRef(store, 0), destinationPage = store.getState().project.pages[2];
    const bottom = { pageId: destinationPage.id, frameId: destinationPage.frames[0].id };
    const middle = { pageId: destinationPage.id, frameId: destinationPage.frames[1].id };
    const top = { pageId: destinationPage.id, frameId: destinationPage.frames[2].id };
    const overlap = { x: .65, y: .4 };
    expect(arbitraryHit(store.getState().project, 2, overlap)).toEqual(top);
    store.getState().reorderFrameLayer(bottom, 'front');
    expect(arbitraryHit(store.getState().project, 2, overlap)).toEqual(bottom);
    store.getState().reorderFrameLayer(bottom, 'back'); store.getState().reorderFrameLayer(top, 'back');
    expect(arbitraryHit(store.getState().project, 2, overlap)).toEqual(middle);
    const before = store.getState().project, sourceFrame = structuredClone(frameAt(before, source)), targetFrame = structuredClone(frameAt(before, middle));
    const expected = structuredClone(before), count = store.getState().undoCount;
    Object.assign(frameAt(expected, source), { imageAssetId: targetFrame.imageAssetId, transform: targetFrame.transform });
    Object.assign(frameAt(expected, middle), { imageAssetId: sourceFrame.imageAssetId, transform: sourceFrame.transform });
    store.getState().setEditingFrame(source); store.getState().beginTransaction('拖动照片'); const transaction = store.getState().transaction;
    expect(finishPhotoFrameDrop(store.getState, { source, frame: sourceFrame, transaction }, arbitraryHit(store.getState().project, 2, overlap))).toBe(true);
    store.getState().commitTransaction();
    expect(store.getState().project).toEqual(expected);
    expect(store.getState().undoCount).toBe(count + 1);
    expect(layouts(store.getState().project)).toEqual(layouts(before));
    expect(validate_project_json(JSON.stringify(store.getState().project))).toBe('true');
  });

  it('does not target a template rectangle that was replaced by page.frameRects, or the whitespace of inset custom templates', () => {
    const project = arbitraryProject();
    expect(arbitraryHit(project, 3, { x: .02, y: .2 })).toBeNull();
    expect(arbitraryHit(project, 3, { x: .4, y: .2 })).toEqual({ pageId: project.pages[3].id, frameId: project.pages[3].frames[0].id });
    expect(arbitraryHit(project, 0, { x: .02, y: .02 })).toBeNull();
    expect(arbitraryHit(project, 1, { x: .5, y: .45 })).toBeNull();
  });
});
