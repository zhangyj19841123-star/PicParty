import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../core/templates';
import type { ResolvedLayout } from '../core/types';
import { thumbnailFrameAtPoint, thumbnailFrameTargets, thumbnailPageAtPoint } from './thumbnailDrop';

const project = createProject({ width: 1200, height: 1800 });
const page = project.pages[0];
const layout: ResolvedLayout = { frames: [
  { slotId: 'a', rect: { x: 120, y: 180, width: 400, height: 600 } },
  { slotId: 'b', rect: { x: 680, y: 920, width: 400, height: 700 } },
], handles: [] };

afterEach(() => vi.unstubAllGlobals());

describe('thumbnail drop areas', () => {
  it('maps document frames within the actual thumbnail without including margins or gutters', () => {
    const targets = thumbnailFrameTargets(page, project.document, layout);
    expect(targets[0]).toMatchObject({ ref: { pageId: page.id, frameId: page.frames[0].id }, rect: { x: .1, y: .1 } });
    expect(targets[0].rect.width).toBeCloseTo(1 / 3);
    expect(targets[0].rect.height).toBeCloseTo(1 / 3);
    expect(targets[1].rect.x).toBeCloseTo(680 / 1200);
    expect(targets[1].rect.y).toBeCloseTo(920 / 1800);
    expect(targets[0].rect.x + targets[0].rect.width).toBeLessThan(targets[1].rect.x);
  });
  it('clips frames at every page edge so invisible overflow cannot receive a photo', () => {
    const clipped: ResolvedLayout = { frames: [
      { slotId: 'a', rect: { x: -100, y: -100, width: 400, height: 700 } },
      { slotId: 'b', rect: { x: 900, y: 1400, width: 600, height: 800 } },
    ], handles: [] };
    const targets = thumbnailFrameTargets(page, project.document, clipped);
    expect(targets[0].rect).toEqual({ x: 0, y: 0, width: .25, height: 1 / 3 });
    expect(targets[1].rect.x + targets[1].rect.width).toBe(1);
    expect(targets[1].rect.y + targets[1].rect.height).toBe(1);
  });
  it('follows the frame layer order rather than the old template slot order', () => {
    const reordered = { ...page, frames: [...page.frames].reverse() };
    expect(thumbnailFrameTargets(reordered, project.document, layout).map(target => target.ref.frameId)).toEqual(reordered.frames.map(frame => frame.id));
  });
  it('omits fully hidden, missing and invalid layout rectangles', () => {
    expect(thumbnailFrameTargets(page, project.document, { frames: [
      { slotId: 'a', rect: { x: 1300, y: 0, width: 500, height: 500 } },
      { slotId: 'b', rect: { x: 0, y: NaN, width: 500, height: 500 } },
    ], handles: [] })).toEqual([]);
    expect(thumbnailFrameTargets(page, project.document, { frames: [], handles: [] })).toEqual([]);
  });
  it('uses CSS coordinates directly and accepts only a visible interactive frame element', () => {
    const closest = vi.fn(selector => selector === '[data-photo-frame-page][data-photo-frame-id]' ? frameElement : null);
    const frameElement = { dataset: { photoFramePage: page.id, photoFrameId: page.frames[0].id }, closest: () => ({}) };
    const elementFromPoint = vi.fn(() => ({ closest }));
    vi.stubGlobal('document', { elementFromPoint });
    expect(thumbnailFrameAtPoint(700, 400)).toEqual({ pageId: page.id, frameId: page.frames[0].id });
    expect(elementFromPoint).toHaveBeenCalledWith(700, 400);
    expect(thumbnailFrameAtPoint(Infinity, 400)).toBeNull();
  });
  it('rejects background, captions, floating controls and preview-only thumbnails', () => {
    vi.stubGlobal('document', { elementFromPoint: () => ({ closest: () => null }) });
    expect(thumbnailFrameAtPoint(700, 400)).toBeNull();
    expect(thumbnailPageAtPoint(700, 400)).toBeNull();
    vi.stubGlobal('document', { elementFromPoint: () => ({ closest: () => ({ dataset: { photoFramePage: page.id, photoFrameId: page.frames[0].id }, closest: () => null }) }) });
    expect(thumbnailFrameAtPoint(700, 400)).toBeNull();
  });
});
