import type { DocumentSize, FrameRef, Page, Rect, ResolvedLayout } from '../core/types';

export interface ThumbnailFrameTarget { ref: FrameRef; rect: Rect }

/** Match the visible, clipped part of each frame, in the same back-to-front order as rendering. */
export function thumbnailFrameTargets(page: Page, size: DocumentSize, layout: ResolvedLayout): ThumbnailFrameTarget[] {
  if (!(size.width > 0 && size.height > 0)) return [];
  const rects = new Map(layout.frames.map(frame => [frame.slotId, frame.rect]));
  return page.frames.flatMap(frame => {
    const rect = rects.get(frame.slotId);
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return [];
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
    const right = Math.min(size.width, rect.x + rect.width), bottom = Math.min(size.height, rect.y + rect.height);
    if (right <= x || bottom <= y) return [];
    return [{ ref: { pageId: page.id, frameId: frame.id }, rect: {
      x: x / size.width, y: y / size.height, width: (right - x) / size.width, height: (bottom - y) / size.height,
    } }];
  });
}

export function thumbnailFrameAtPoint(x: number, y: number): FrameRef | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-photo-frame-page][data-photo-frame-id]');
  if (!element?.closest('.thumbnail.photo-drop-surface')) return null;
  const pageId = element.dataset.photoFramePage, frameId = element.dataset.photoFrameId;
  return pageId && frameId ? { pageId, frameId } : null;
}

export function thumbnailPageAtPoint(x: number, y: number): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return document.elementFromPoint(x, y)?.closest<HTMLElement>('.thumbnail.photo-drop-surface')?.dataset.thumbnailPage ?? null;
}

export function setThumbnailDropTarget(target: FrameRef | null): void {
  for (const element of document.querySelectorAll<HTMLElement>('.thumbnail-frame-target')) {
    element.classList.toggle('photo-drop-target', Boolean(target && element.dataset.photoFramePage === target.pageId && element.dataset.photoFrameId === target.frameId));
  }
}
