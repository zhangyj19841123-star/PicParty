import type { DocumentSize, FrameRef, Page, Rect, ResolvedLayout } from '../core/types';

export type WorkspacePageMode = 1 | 2 | 3 | 4 | 6 | 8 | 10;
export interface WorkspacePageBounds {
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
  bounds: Rect;
  label: Rect;
}
export interface WorkspaceLayoutOptions {
  document: Pick<DocumentSize, 'width' | 'height'>;
  viewport: { width: number; height: number };
  count: number;
  mode: WorkspacePageMode;
  zoom?: number | 'fit';
  pan?: { x: number; y: number };
}

export type WorkspaceHitView = WorkspacePageBounds & { page: Pick<Page, 'id' | 'frames'>; layout: ResolvedLayout };
type Point = { x: number; y: number };

/** Every canvas/drop coordinate is local CSS pixels; device pixel ratio is irrelevant here. */
export function workspacePointInside(rect: Rect, point: Point): boolean {
  return [point.x, point.y, rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0
    && point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

/** Use precisely the same clipping rectangle for drawing and target detection. */
export function workspaceViewClip(view: WorkspacePageBounds, count: number, viewport: { width: number; height: number }): Rect {
  return count === 1 ? { x: 0, y: 0, ...viewport } : view.bounds;
}

function visibleDocumentPoint(view: WorkspacePageBounds, point: Point, count: number, viewport: { width: number; height: number }): Point | null {
  if (!workspacePointInside({ x: 0, y: 0, ...viewport }, point)
    || !workspacePointInside(workspaceViewClip(view, count, viewport), point)) return null;
  return workspaceDocumentPoint(view, point);
}

/** Empty gutters and clipped pixels cannot accidentally resolve to a neighbouring page. */
export function workspacePageHit(views: WorkspaceHitView[], point: Point, viewport: { width: number; height: number }): string | null {
  for (const view of [...views].reverse()) if (visibleDocumentPoint(view, point, views.length, viewport)) return view.page.id;
  return null;
}

/** Resolved frame order is draw order, so overlapping frames always target the visible top layer. */
export function workspaceFrameHit(views: WorkspaceHitView[], point: Point, viewport: { width: number; height: number }): FrameRef | null {
  for (const view of [...views].reverse()) {
    const documentPoint = visibleDocumentPoint(view, point, views.length, viewport);
    if (!documentPoint) continue;
    for (const resolved of [...view.layout.frames].reverse()) {
      if (!workspacePointInside(resolved.rect, documentPoint)) continue;
      const frame = view.page.frames.find(value => value.slotId === resolved.slotId);
      if (frame) return { pageId: view.page.id, frameId: frame.id };
    }
  }
  return null;
}

const preferredColumns: Record<WorkspacePageMode, number> = { 1: 1, 2: 2, 3: 3, 4: 2, 6: 3, 8: 4, 10: 5 };

/** Map the visible, transformed page rather than its unscaled screen-grid cell. */
export function workspaceDocumentPoint(view: Pick<WorkspacePageBounds, 'x' | 'y' | 'width' | 'height' | 'scale'>, point: { x: number; y: number }): { x: number; y: number } | null {
  if (!Number.isFinite(view.scale) || view.scale <= 0
    || !workspacePointInside({ x: view.x, y: view.y, width: view.width, height: view.height }, point)) return null;
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

/** Independent page views share only their screen grid, never export geometry. */
export function workspaceLayout({ document, viewport, count, mode, zoom = 'fit', pan = { x: 0, y: 0 } }: WorkspaceLayoutOptions): { columns: number; rows: number; views: WorkspacePageBounds[] } {
  if (!Number.isInteger(count) || count < 0 || count > 10) throw new Error('同屏页面数量无效');
  if (![document.width, document.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('页面尺寸无效');
  if (count === 0 || ![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) return { columns: 0, rows: 0, views: [] };
  const single = count === 1;
  const outer = single ? 38 : viewport.width < 600 ? 16 : 22;
  const gutter = single ? 0 : viewport.width < 600 ? 18 : 26;
  const availableWidth = Math.max(1, viewport.width - outer * 2);
  const fittingColumns = Math.max(1, Math.floor((availableWidth + gutter) / (120 + gutter)));
  const columns = single ? 1 : Math.min(count, preferredColumns[mode], fittingColumns);
  const rows = Math.ceil(count / columns);
  const cellWidth = Math.max(1, (availableWidth - gutter * (columns - 1)) / columns);
  const cellHeight = Math.max(1, (viewport.height - outer * 2 - gutter * (rows - 1)) / rows);
  const views = Array.from({ length: count }, (_, index): WorkspacePageBounds => {
    const col = index % columns, row = Math.floor(index / columns);
    const headerHeight = single ? 32 : 54;
    const fit = Math.max(Number.EPSILON, Math.min(cellWidth / document.width, Math.max(0, cellHeight - headerHeight) / document.height));
    const scale = single && zoom !== 'fit' ? zoom : fit;
    const width = document.width * scale, height = document.height * scale;
    const cellX = outer + col * (cellWidth + gutter), cellY = outer + row * (cellHeight + gutter);
    const x = cellX + (cellWidth - width) / 2 + (single ? pan.x : 0);
    const y = cellY + headerHeight - 2 + (cellHeight - headerHeight - height) / 2 + (single ? pan.y : 0);
    const labelWidth = single ? Math.max(100, width) : Math.min(cellWidth, Math.max(100, width));
    return {
      x, y, scale, width, height,
      bounds: { x: cellX - 8, y: cellY - 8, width: cellWidth + 16, height: cellHeight + 16 },
      label: { x: single ? Math.max(8, x) : Math.max(cellX, Math.min(x, cellX + cellWidth - labelWidth)), y: Math.max(4, y - headerHeight + 4), width: labelWidth, height: headerHeight - 8 },
    };
  });
  return { columns, rows, views };
}
