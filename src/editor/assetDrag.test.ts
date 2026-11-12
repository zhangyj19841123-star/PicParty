import { describe, expect, it } from 'vitest';
import { createProject } from '../core/templates';
import { hasAssetDragStarted, resolveAssetDropTarget, type AssetDropContext, type AssetPointerDropDetail } from './assetDrag';

const project = createProject();
project.assets.photo = { id: 'photo', originalPath: '/photo.jpg', fileName: 'photo.jpg', width: 100, height: 100, rawWidth: 100, rawHeight: 100, orientation: 1, format: 'jpeg', fingerprint: 'photo', icc: null };
const pageId = project.pages[0].id;
const ref = { pageId, frameId: project.pages[0].frames[0].id };
const detail: AssetPointerDropDetail = { assetId: 'photo', projectId: project.id, clientX: 700, clientY: 400 };
const context: AssetDropContext = { project, blocked: false, backgroundEditing: false, frameAtPoint: ref, pageAtPoint: pageId };

describe('native asset drag intent', () => {
  it('leaves clicks and slight pointer jitter as clicks, using CSS-pixel distance', () => {
    const start = { clientX: 100, clientY: 200 };
    expect(hasAssetDragStarted(start, start)).toBe(false);
    expect(hasAssetDragStarted(start, { clientX: 103, clientY: 204 })).toBe(false);
    expect(hasAssetDragStarted(start, { clientX: 106, clientY: 200 })).toBe(true);
    expect(hasAssetDragStarted(start, { clientX: 96, clientY: 195 })).toBe(true);
    expect(hasAssetDragStarted(start, { clientX: NaN, clientY: 200 })).toBe(false);
  });
});

describe('native asset drop routing', () => {
  it('prioritizes the explicit background zone over frame or page hits', () => {
    expect(resolveAssetDropTarget(detail, { ...context, backgroundDropPageId: pageId })).toEqual({ kind: 'background', pageId });
    expect(resolveAssetDropTarget(detail, { ...context, backgroundDropPageId: 'deleted-page' })).toBeNull();
  });
  it('replaces a page background only in background editing mode', () => {
    expect(resolveAssetDropTarget(detail, { ...context, backgroundEditing: true })).toEqual({ kind: 'background', pageId });
    expect(resolveAssetDropTarget(detail, context)).toEqual({ kind: 'frame', ref });
  });
  it('does not assign the active frame when released outside a target', () => {
    expect(resolveAssetDropTarget(detail, { ...context, frameAtPoint: null, pageAtPoint: null })).toBeNull();
    expect(resolveAssetDropTarget(detail, { ...context, frameAtPoint: { ...ref, frameId: 'removed-frame' } })).toBeNull();
  });
  it('rejects a stale drag after project switches, asset removal or modal opening', () => {
    expect(resolveAssetDropTarget({ ...detail, projectId: 'previous-project' }, context)).toBeNull();
    expect(resolveAssetDropTarget({ ...detail, assetId: 'removed-asset' }, context)).toBeNull();
    expect(resolveAssetDropTarget(detail, { ...context, blocked: true })).toBeNull();
    expect(resolveAssetDropTarget({ ...detail, clientX: Infinity }, context)).toBeNull();
  });
});
