import { describe, expect, it } from 'vitest';
import { frameControlPoints, frameEditPointerInside } from './frameInteraction';
import { createEditorStore } from '../state/editorStore';
import { createProject } from '../core/templates';

const selected = { pageId: 'page-1', frameId: 'frame-1' };
const other = { pageId: 'page-2', frameId: 'frame-2' };
const rect = { x: 100, y: 100, width: 200, height: 300 };
const clip = { x: 0, y: 0, width: 600, height: 600 };

describe('click-outside frame editing', () => {
  it('keeps the topmost selected frame body editable', () => {
    expect(frameEditPointerInside(selected, selected, rect, { x: 180, y: 200 }, clip)).toBe(true);
  });
  it('ends editing when a different frame covers the same body or belongs to another page', () => {
    expect(frameEditPointerInside(selected, { pageId: 'page-1', frameId: 'cover' }, rect, { x: 180, y: 200 }, clip)).toBe(false);
    expect(frameEditPointerInside(selected, other, rect, { x: 500, y: 200 }, clip)).toBe(false);
  });
  it('keeps all eight handles usable, including their outer half past a page edge', () => {
    const controls = frameControlPoints(rect);
    expect(new Set(controls.map(control => control.handle)).size).toBe(8);
    for (const control of controls) {
      expect(frameEditPointerInside(selected, null, rect, { x: control.x - 7.5, y: control.y - 7.5 }, clip)).toBe(true);
    }
    expect(frameEditPointerInside(selected, null, rect, { x: 91, y: 91 }, clip)).toBe(false);
  });
  it('does not treat an arbitrary outer edge or clipped control as a resize handle', () => {
    expect(frameEditPointerInside(selected, null, rect, { x: 95, y: 175 }, clip)).toBe(false);
    expect(frameEditPointerInside(selected, null, rect, { x: 95, y: 100 }, { x: 100, y: 100, width: 200, height: 300 })).toBe(false);
  });
  it('uses screen pixels for handle tolerance in a small multi-page view', () => {
    const small = { x: 40, y: 60, width: 40, height: 60 };
    expect(frameEditPointerInside(selected, null, small, { x: 33, y: 60 }, clip)).toBe(true);
    expect(frameEditPointerInside(selected, null, small, { x: 31, y: 60 }, clip)).toBe(false);
  });
  it('rejects invalid points and invalid frame bounds', () => {
    expect(frameEditPointerInside(selected, selected, rect, { x: NaN, y: 100 }, clip)).toBe(false);
    expect(frameEditPointerInside(selected, selected, { ...rect, width: 0 }, { x: 100, y: 100 }, clip)).toBe(false);
  });
  it('does not create undo entries from the two press/release pairs preceding a double click', () => {
    const store = createEditorStore(createProject());
    const page = store.getState().project.pages[0], ref = { pageId: page.id, frameId: page.frames[0].id };
    const before = structuredClone(store.getState().project);
    store.getState().setEditingFrame(ref);
    store.getState().beginTransaction('移动照片'); store.getState().commitTransaction();
    store.getState().setFrameEditing(true); store.getState().setSelectedFrame(ref);
    store.getState().beginTransaction('移动照片框'); store.getState().commitTransaction();
    store.getState().setFrameEditing(false);
    expect(store.getState()).toMatchObject({ frameEditing: false, editingFrame: null, transaction: null, undoCount: 0 });
    expect(store.getState().project).toEqual(before);
  });
  it('excludes photo editing while the selected frame is being edited and resumes it on another frame', () => {
    const store = createEditorStore(createProject());
    const page = store.getState().project.pages[0];
    const first = { pageId: page.id, frameId: page.frames[0].id }, next = { pageId: page.id, frameId: page.frames[1].id };
    store.getState().setEditingFrame(first);
    store.getState().setFrameEditing(true); store.getState().setSelectedFrame(first);
    expect(store.getState()).toMatchObject({ frameEditing: true, selectedFrame: first, editingFrame: null });
    store.getState().setFrameEditing(false); store.getState().setSelectedFrame(next); store.getState().setEditingFrame(next);
    expect(store.getState()).toMatchObject({ frameEditing: false, selectedFrame: next, editingFrame: next, undoCount: 0 });
  });
});
