import { describe, expect, it } from 'vitest';
import { workspaceDocumentPoint, workspaceFrameHit, workspacePageHit, workspaceViewClip, workspaceLayout, type WorkspaceHitView, type WorkspacePageMode } from './workspaceLayout';
import type { Rect } from '../core/types';

const document = { width: 4672, height: 7008 };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('independent pages in the workspace', () => {
  it('uses three, four and five columns for six, eight and ten pages on a wide screen', () => {
    for (const [mode, columns] of [[6, 3], [8, 4], [10, 5]] as const) {
      const result = workspaceLayout({ document, viewport: { width: 1200, height: 750 }, count: mode, mode });
      expect(result).toMatchObject({ columns, rows: 2 });
      expect(result.views).toHaveLength(mode);
      expect(result.views[columns].y).toBeGreaterThan(result.views[0].y);
      expect(result.views[columns].x).toBeCloseTo(result.views[0].x);
    }
  });

  it('draws only selected pages when there are fewer pages than the view capacity', () => {
    for (const [mode, count] of [[6, 5], [8, 7], [10, 9]] as const) {
      const result = workspaceLayout({ document, viewport: { width: 1200, height: 750 }, count, mode });
      expect(result.views).toHaveLength(count);
      expect(result.rows).toBe(2);
      const last = result.views.at(-1)!;
      expect(last.x).toBeLessThan(1200);
      expect(last.y + last.height).toBeLessThan(750);
    }
  });

  it('reduces columns in a narrow window and keeps ten full portrait pages and their labels visible', () => {
    const viewport = { width: 480, height: 460 };
    const result = workspaceLayout({ document, viewport, count: 10, mode: 10 });
    expect(result.columns).toBeLessThan(5);
    expect(result.views).toHaveLength(10);
    for (const view of result.views) {
      expect(view.width / view.height).toBeCloseTo(2 / 3);
      expect(view.scale).toBeGreaterThan(0);
      expect(view.x).toBeGreaterThanOrEqual(0);
      expect(view.y).toBeGreaterThanOrEqual(0);
      expect(view.x + view.width).toBeLessThanOrEqual(viewport.width);
      expect(view.y + view.height).toBeLessThanOrEqual(viewport.height);
      expect(view.label.x).toBeGreaterThanOrEqual(view.bounds.x);
      expect(view.label.x + view.label.width).toBeLessThanOrEqual(view.bounds.x + view.bounds.width);
      expect(view.label.y + view.label.height).toBeLessThanOrEqual(view.y);
    }
    result.views.forEach((view, index) => result.views.slice(index + 1).forEach(other => {
      expect(overlaps(view.bounds, other.bounds)).toBe(false);
      expect(overlaps(view.label, other.label)).toBe(false);
    }));
  });

  it('keeps cell hit areas disjoint for every mode and supported page count', () => {
    for (const mode of [1, 2, 3, 4, 6, 8, 10] as WorkspacePageMode[]) {
      for (let count = 1; count <= mode; count++) {
        const result = workspaceLayout({ document, viewport: { width: 760, height: 540 }, count, mode });
        result.views.forEach((view, index) => result.views.slice(index + 1).forEach(other => expect(overlaps(view.bounds, other.bounds)).toBe(false)));
      }
    }
  });

  it('preserves document-to-screen inverse mapping for a photo on the second row', () => {
    const result = workspaceLayout({ document, viewport: { width: 1200, height: 750 }, count: 10, mode: 10 });
    const view = result.views[7];
    const photo = { x: 1234, y: 4567 };
    const screen = { x: view.x + photo.x * view.scale, y: view.y + photo.y * view.scale };
    expect((screen.x - view.x) / view.scale).toBeCloseTo(photo.x);
    expect((screen.y - view.y) / view.scale).toBeCloseTo(photo.y);
    expect(result.views.filter(other => screen.x >= other.bounds.x && screen.x <= other.bounds.x + other.bounds.width && screen.y >= other.bounds.y && screen.y <= other.bounds.y + other.bounds.height)).toEqual([view]);
    expect(document).toEqual({ width: 4672, height: 7008 });
  });

  it('accepts visible photo pixels beyond the old grid bounds after single-page zoom and pan', () => {
    const viewport = { width: 900, height: 700 };
    const zoomed = workspaceLayout({ document, viewport, count: 1, mode: 1, zoom: 0.15 }).views[0];
    const edge = { x: 400, y: 10 };
    expect(edge.y).toBeLessThan(zoomed.bounds.y);
    expect(workspaceDocumentPoint(zoomed, edge)?.x).toBeCloseTo(2002.6666666667);
    expect(workspaceDocumentPoint(zoomed, edge)?.y).toBeCloseTo(1144);
    const panned = workspaceLayout({ document, viewport, count: 1, mode: 1, pan: { x: -240, y: -100 } }).views[0];
    const pannedEdge = { x: 20, y: 10 };
    expect(pannedEdge.x).toBeLessThan(panned.bounds.x);
    const point = workspaceDocumentPoint(panned, pannedEdge)!;
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(document.width);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(document.height);
    expect(workspaceDocumentPoint(zoomed, { x: zoomed.x - 1, y: 350 })).toBeNull();
  });

  it('maps page hits to the correct row and rejects gutters and invalid coordinates', () => {
    const result = workspaceLayout({ document, viewport: { width: 1200, height: 750 }, count: 10, mode: 10 });
    const target = result.views[7];
    const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    expect(result.views.flatMap((view, index) => workspaceDocumentPoint(view, center) ? [index] : [])).toEqual([7]);
    expect(workspaceDocumentPoint(target, center)?.x).toBeCloseTo(document.width / 2);
    expect(workspaceDocumentPoint(target, center)?.y).toBeCloseTo(document.height / 2);
    expect(workspaceDocumentPoint(target, { x: target.x - 1, y: center.y })).toBeNull();
    expect(workspaceDocumentPoint(target, { x: Infinity, y: center.y })).toBeNull();
    expect(workspaceDocumentPoint(target, { x: center.x, y: NaN })).toBeNull();
  });

  it('retains single-page zoom and pan while multi-page views always fit', () => {
    const viewport = { width: 900, height: 700 };
    const fit = workspaceLayout({ document, viewport, count: 1, mode: 1 }).views[0];
    const single = workspaceLayout({ document, viewport, count: 1, mode: 1, zoom: 0.15, pan: { x: 23, y: -19 } }).views[0];
    const centered = workspaceLayout({ document, viewport, count: 1, mode: 1, zoom: 0.15 }).views[0];
    expect(single.scale).toBe(0.15);
    expect(single.x).toBeCloseTo(centered.x + 23);
    expect(single.y).toBeCloseTo(centered.y - 19);
    expect(fit.height).toBeLessThan(viewport.height);
    const multi = workspaceLayout({ document, viewport, count: 6, mode: 6, zoom: 0.15, pan: { x: 23, y: -19 } });
    const multiFit = workspaceLayout({ document, viewport, count: 6, mode: 6 });
    expect(multi).toEqual(multiFit);
  });

  it('fits the full maximum-length horizontal or vertical page in a short or narrow editing area', () => {
    for (const longDocument of [{ width: 640, height: 32768 }, { width: 32768, height: 640 }]) {
      for (const viewport of [{ width: 900, height: 260 }, { width: 260, height: 550 }]) {
        const view = workspaceLayout({ document: longDocument, viewport, count: 1, mode: 1 }).views[0];
        expect(view.scale).toBeGreaterThan(0);
        expect(view.width / view.height).toBeCloseTo(longDocument.width / longDocument.height);
        expect(view.x).toBeGreaterThanOrEqual(0); expect(view.y).toBeGreaterThanOrEqual(0);
        expect(view.x + view.width).toBeLessThanOrEqual(viewport.width);
        expect(view.y + view.height).toBeLessThanOrEqual(viewport.height);
        for (const part of [0.001, 0.5, 0.999]) {
          const screen = { x: view.x + view.width * part, y: view.y + view.height * part };
          const point = workspaceDocumentPoint(view, screen)!;
          expect(point.x).toBeCloseTo(longDocument.width * part);
          expect(point.y).toBeCloseTo(longDocument.height * part);
        }
      }
    }
  });

  it('handles empty or temporarily hidden workspaces without drawing extra pages', () => {
    expect(workspaceLayout({ document, viewport: { width: 900, height: 700 }, count: 0, mode: 10 }).views).toEqual([]);
    expect(workspaceLayout({ document, viewport: { width: 0, height: 0 }, count: 10, mode: 10 }).views).toEqual([]);
  });
});

const hitViews = (mode: WorkspacePageMode, count = mode, zoom: number | 'fit' = 'fit', pan = { x: 0, y: 0 }): WorkspaceHitView[] =>
  workspaceLayout({ document, viewport: { width: 1200, height: 750 }, count, mode, zoom, pan }).views.map((bounds, index) => ({
    ...bounds,
    page: { id: `page-${index}`, frames: ['left', 'right'].map(slotId => ({ id: `frame-${index}-${slotId}`, slotId, imageAssetId: null,
      transform: { focusX: .5, focusY: .5, zoom: 1, rotation: 0, flipX: false, flipY: false } })) },
    layout: { frames: [
      { slotId: 'left', rect: { x: 100, y: 100, width: document.width / 2 - 150, height: document.height - 200 } },
      { slotId: 'right', rect: { x: document.width / 2 + 50, y: 100, width: document.width / 2 - 150, height: document.height - 200 } },
    ], handles: [] },
  }));
const screenPoint = (view: WorkspaceHitView, point: { x: number; y: number }) => ({ x: view.x + point.x * view.scale, y: view.y + point.y * view.scale });
const viewport = { width: 1200, height: 750 };

describe('exact frame drop targeting', () => {
  it('targets only actual frame pixels and leaves the page margin, divider gap and page gutter empty', () => {
    const views = hitViews(2);
    const view = views[0];
    expect(workspaceFrameHit(views, screenPoint(view, { x: 600, y: 3000 }), viewport)).toEqual({ pageId: 'page-0', frameId: 'frame-0-left' });
    expect(workspaceFrameHit(views, screenPoint(view, { x: 3600, y: 3000 }), viewport)).toEqual({ pageId: 'page-0', frameId: 'frame-0-right' });
    for (const point of [{ x: 50, y: 3000 }, { x: document.width / 2, y: 3000 }, { x: 600, y: 50 }]) {
      const screen = screenPoint(view, point);
      expect(workspacePageHit(views, screen, viewport)).toBe('page-0');
      expect(workspaceFrameHit(views, screen, viewport)).toBeNull();
    }
    const gutter = { x: (view.x + view.width + views[1].x) / 2, y: view.y + view.height / 2 };
    expect(workspacePageHit(views, gutter, viewport)).toBeNull();
    expect(workspaceFrameHit(views, gutter, viewport)).toBeNull();
  });

  it('maps the tenth page to its own frame without choosing the active or neighbouring page', () => {
    const views = hitViews(10);
    const point = screenPoint(views[9], { x: 3400, y: 4000 });
    expect(workspacePageHit(views, point, viewport)).toBe('page-9');
    expect(workspaceFrameHit(views, point, viewport)).toEqual({ pageId: 'page-9', frameId: 'frame-9-right' });
  });

  it('uses visible top frame order for overlaps and changes the target after layer reorder', () => {
    const views = hitViews(1);
    views[0].layout.frames[1].rect = { ...views[0].layout.frames[0].rect, x: 500 };
    const point = screenPoint(views[0], { x: 1000, y: 3000 });
    expect(workspaceFrameHit(views, point, viewport)?.frameId).toBe('frame-0-right');
    views[0].layout.frames.reverse();
    expect(workspaceFrameHit(views, point, viewport)?.frameId).toBe('frame-0-left');
  });

  it('keeps scaled and panned visible pixels droppable outside the old cell bounds, but rejects pixels outside the canvas', () => {
    const views = hitViews(1, 1, .2, { x: -440, y: -200 });
    expect(workspaceViewClip(views[0], 1, viewport)).toEqual({ x: 0, y: 0, ...viewport });
    const point = { x: 100, y: 20 };
    expect(point.y).toBeLessThan(views[0].bounds.y);
    expect(workspaceFrameHit(views, point, viewport)).toEqual({ pageId: 'page-0', frameId: 'frame-0-left' });
    expect(workspaceFrameHit(views, { x: -1, y: 20 }, viewport)).toBeNull();
    expect(workspacePageHit(views, { x: 100, y: -1 }, viewport)).toBeNull();
  });

  it('uses one unambiguous side for touching frames and rejects invalid or clipped targets', () => {
    const views = hitViews(2);
    const view = views[0];
    view.layout.frames[0].rect = { x: 0, y: 0, width: document.width / 2, height: document.height };
    view.layout.frames[1].rect = { x: document.width / 2, y: 0, width: document.width / 2, height: document.height };
    expect(workspaceFrameHit(views, screenPoint(view, { x: document.width / 2, y: 3000 }), viewport)?.frameId).toBe('frame-0-right');
    expect(workspaceFrameHit(views, screenPoint(view, { x: document.width, y: 3000 }), viewport)).toBeNull();
    for (const point of [{ x: NaN, y: 50 }, { x: 50, y: Infinity }, { x: 1201, y: 50 }]) {
      expect(workspaceFrameHit(views, point, viewport)).toBeNull();
      expect(workspacePageHit(views, point, viewport)).toBeNull();
    }
    view.bounds = { x: view.x + view.width / 2, y: view.y, width: view.width / 2, height: view.height };
    expect(workspaceFrameHit(views, screenPoint(view, { x: 1000, y: 3000 }), viewport)).toBeNull();
  });
});
