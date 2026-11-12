import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cover_json, initSync, layout_json, validate_project_json } from '../../public/core-wasm/collage_wasm.js';
import { createLongImageProject } from '../core/longImage';
import { createProject } from '../core/templates';
import { geometry } from '../core/engine';
import type { FrameRef, GeometryEngine, ImageAsset, Project } from '../core/types';
import { workspaceFrameHit, workspaceLayout } from '../editor/workspaceLayout';
import { createEditorStore, setDocumentValidator } from './editorStore';
import { useTemplateLibraryStore } from './templateLibraryStore';

vi.mock('../core/engine', () => ({ geometry: vi.fn() }));

const nativeEngine: GeometryEngine = {
  layout: (page, document, template) => JSON.parse(layout_json(JSON.stringify(page), JSON.stringify(document), JSON.stringify(template))),
  cover: (rect, width, height, transform) => JSON.parse(cover_json(JSON.stringify(rect), width, height, JSON.stringify(transform))),
};
const asset = (id: string, width = 3000, height = 4500): ImageAsset => ({
  id, originalPath: `/photos/${id}.jpg`, fileName: `${id}.jpg`, width, height,
  rawWidth: width, rawHeight: height, orientation: 1, format: 'jpeg', fingerprint: id, icc: null,
});
const longProject = (direction: 'vertical' | 'horizontal' = 'vertical') => createLongImageProject([
  asset('portrait'), asset('landscape', 6000, 4000), asset('detail', 3000, 4000),
], { direction, gap: 12 });
const frameRef = (project: Project, index = 0): FrameRef => ({ pageId: project.pages[0].id, frameId: project.pages[0].frames[index].id });
const layout = (project: Project) => nativeEngine.layout(project.pages[0], project.document, project.templates[project.pages[0].templateId]);

beforeAll(() => {
  const bytes = readFileSync(new URL('../../public/core-wasm/collage_wasm_bg.wasm', import.meta.url));
  initSync({ module: Uint8Array.from(bytes) });
});
beforeEach(() => {
  vi.mocked(geometry).mockReturnValue(nativeEngine);
  setDocumentValidator(project => { validate_project_json(JSON.stringify(project)); });
});
afterEach(() => setDocumentValidator(undefined));

describe('long-image projects in the existing photo and frame editor', () => {
  it('accepts a generated long image as an unsaved project without modifying its source or the saved original snapshot', () => {
    const store = createEditorStore(createProject({ canvasSizing: 'fixed' }));
    store.getState().assignAssets([asset('original-work')]);
    store.getState().markSaved(store.getState().revision, '/work/original.collage');
    const original = store.getState().project, originalSnapshot = structuredClone(original);
    const generated = longProject(), sourceSnapshot = structuredClone(generated);
    const library = useTemplateLibraryStore.getState().templates;
    store.getState().restoreProject(generated);
    expect(store.getState()).toMatchObject({ revision: 0, savedRevision: -1, projectPath: null, undoCount: 0, redoCount: 0 });
    expect(store.getState().project.canvasSizing).toBe('fixed');
    expect(store.getState().project.document).toEqual(generated.document);
    expect(store.getState().visiblePageIds).toEqual([generated.pages[0].id]);
    store.getState().updateTransform(frameRef(store.getState().project), { zoom: 1.2 });
    expect(generated).toEqual(sourceSnapshot);
    expect(original).toEqual(originalSnapshot);
    expect(useTemplateLibraryStore.getState().templates).toBe(library);
  });

  it('makes a photo zoom and rotation gesture one undo step while preserving long-image frame geometry', () => {
    const store = createEditorStore(longProject()), before = store.getState().project;
    const ref = frameRef(before), initialGeometry = layout(before);
    store.getState().setEditingFrame(ref);
    store.getState().beginTransaction('调整长图照片');
    store.getState().updateTransform(ref, { zoom: 1.25, rotation: 9, adjustments: { exposure: 0.5 } });
    store.getState().updateTransform(ref, { zoom: 1.75, rotation: 18, focusX: 0.43 });
    expect(store.getState().undoCount).toBe(0);
    store.getState().commitTransaction();
    const after = store.getState().project;
    expect(store.getState().undoCount).toBe(1);
    expect(layout(after)).toEqual(initialGeometry);
    expect(after.document).toEqual(before.document);
    expect(after.templates).toEqual(before.templates);
    expect(after.pages[0].frameRects).toBeUndefined();
    expect(after.pages[0].frames[0].transform).toMatchObject({ zoom: 1.75, rotation: 18, focusX: 0.43, adjustments: { exposure: 0.5 } });
    expect(after.pages[0].frames.slice(1)).toEqual(before.pages[0].frames.slice(1));
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
  });

  it('enters yellow-frame mode, changes only the selected region, and restores the complete gesture through undo and redo', () => {
    const store = createEditorStore(longProject('horizontal')), before = store.getState().project;
    const ref = frameRef(before), initialGeometry = layout(before);
    store.getState().setEditingFrame(ref);
    store.getState().setFrameEditing(true);
    expect(store.getState()).toMatchObject({ frameEditing: true, editingFrame: null, selectedFrame: ref });
    store.getState().beginTransaction('裁切长图照片框');
    store.getState().updateFrameRect(ref, { x: 0.03, y: 0.05, width: 0.2, height: 0.9 });
    store.getState().updateFrameRect(ref, { x: 0.04, y: 0.1, width: 0.18, height: 0.8 });
    store.getState().commitTransaction();
    const after = store.getState().project, resolved = layout(after);
    expect(store.getState().undoCount).toBe(1);
    expect(after.document).toEqual(before.document);
    expect(after.templates).toEqual(before.templates);
    expect(after.pages[0].frames).toEqual(before.pages[0].frames);
    expect(resolved.frames.slice(1)).toEqual(initialGeometry.frames.slice(1));
    expect(resolved.frames[0].rect.width).toBeCloseTo(before.document.width * 0.18);
    expect(resolved.frames[0].rect.height).toBeCloseTo(before.document.height * 0.8);
    store.getState().undo(); expect(store.getState().project).toEqual(before);
    store.getState().redo(); expect(store.getState().project).toEqual(after);
    store.getState().setFrameEditing(false); store.getState().setEditingFrame(ref);
    expect(store.getState()).toMatchObject({ frameEditing: false, editingFrame: ref });
  });

  it('keeps image properties attached during layer changes and makes hit testing follow native draw order', () => {
    const store = createEditorStore(longProject()), ref = frameRef(store.getState().project);
    store.getState().updateTransform(ref, { zoom: 1.4, rotation: -11, adjustments: { contrast: 27 } });
    store.getState().updateFrameRect(ref, { x: 0.05, y: 0.68, width: 0.8, height: 0.25 });
    const before = store.getState().project, beforeGeometry = layout(before);
    const viewport = { width: 1000, height: 600 };
    const hit = (project: Project) => {
      const bounds = workspaceLayout({ document: project.document, viewport, count: 1, mode: 1 }).views[0];
      const view = { ...bounds, page: project.pages[0], layout: layout(project) };
      const point = { x: view.x + project.document.width * 0.4 * view.scale, y: view.y + project.document.height * 0.75 * view.scale };
      return workspaceFrameHit([view], point, viewport);
    };
    expect(hit(before)).toEqual(frameRef(before, 2));
    const count = store.getState().undoCount;
    store.getState().reorderFrameLayer(ref, 'front');
    const after = store.getState().project, afterGeometry = layout(after);
    expect(store.getState().undoCount).toBe(count + 1);
    expect(hit(after)).toEqual(ref);
    expect(after.pages[0].frames.at(-1)).toEqual(before.pages[0].frames[0]);
    expect(Object.fromEntries(afterGeometry.frames.map(frame => [frame.slotId, frame.rect]))).toEqual(Object.fromEntries(beforeGeometry.frames.map(frame => [frame.slotId, frame.rect])));
    expect(after.pages[0].frameRects).toEqual(before.pages[0].frameRects);
    store.getState().undo(); expect(store.getState().project).toEqual(before); expect(hit(store.getState().project)).toEqual(frameRef(before, 2));
    store.getState().redo(); expect(store.getState().project).toEqual(after); expect(hit(store.getState().project)).toEqual(ref);
  });

  it('reloads adjusted long-image content with the same output dimensions and keeps later imports from recalculating the canvas', () => {
    for (const direction of ['vertical', 'horizontal'] as const) {
      const store = createEditorStore(longProject(direction)), ref = frameRef(store.getState().project);
      const document = structuredClone(store.getState().project.document);
      store.getState().updateTransform(ref, { zoom: 1.3, rotation: 7, adjustments: { saturation: -12 } });
      store.getState().updateFrameRect(ref, { x: 0.02, y: 0.03, width: 0.2, height: 0.6 });
      const saved = JSON.stringify(store.getState().project), expectedGeometry = layout(store.getState().project);
      store.getState().loadProject(JSON.parse(saved), '/work/long-image.collage');
      expect(store.getState()).toMatchObject({ projectPath: '/work/long-image.collage', undoCount: 0, redoCount: 0, revision: 0, savedRevision: 0 });
      expect(store.getState().project.document).toEqual(document);
      expect(layout(store.getState().project)).toEqual(expectedGeometry);
      expect(validate_project_json(saved)).toBe('true');
      store.getState().assignAssets([asset('later-landscape', 12000, 1000)], ref);
      expect(store.getState().project.document).toEqual(document);
      expect(layout(store.getState().project)).toEqual(expectedGeometry);
    }
  });

  it('supports gradual numerical view zoom below 10% for a long page without changing output geometry', () => {
    const photos = Array.from({ length: 64 }, (_, index) => asset(`long-${index}`, 4000, 6000));
    const store = createEditorStore(createLongImageProject(photos, { direction: 'vertical' }));
    const before = store.getState().project;
    const fit = workspaceLayout({ document: before.document, viewport: { width: 1000, height: 300 }, count: 1, mode: 1 }).views[0].scale;
    expect(fit).toBeLessThan(0.01);
    store.getState().setViewZoom(fit * 1.2);
    expect(store.getState().viewZoom).toBe(fit * 1.2);
    expect(store.getState().project).toBe(before);
    expect(store.getState().undoCount).toBe(0);
    store.getState().setViewZoom('fit'); expect(store.getState().viewZoom).toBe('fit');
  });
});
