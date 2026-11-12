import type { FrameRef, Project } from '../core/types';
import { startDragAutoScroll } from './dragAutoScroll';

export const ASSET_POINTER_DROP_EVENT = 'frame-studio:asset-pointer-drop';
export const ASSET_POINTER_HOVER_EVENT = 'frame-studio:asset-pointer-hover';
export const ASSET_DRAG_THRESHOLD = 6;
export interface AssetDragPoint { clientX: number; clientY: number }
export interface AssetPointerDropDetail extends AssetDragPoint { assetId: string; projectId: string }
export type AssetDropTarget = { kind: 'background'; pageId: string } | { kind: 'frame'; ref: FrameRef };
export interface AssetDropContext {
  project: Pick<Project, 'id' | 'assets' | 'pages'>;
  blocked: boolean;
  backgroundDropPageId?: string | null;
  backgroundEditing: boolean;
  pageAtPoint?: string | null;
  frameAtPoint?: FrameRef | null;
}

declare global {
  interface WindowEventMap {
    'frame-studio:asset-pointer-drop': CustomEvent<AssetPointerDropDetail>;
    'frame-studio:asset-pointer-hover': CustomEvent<AssetPointerDropDetail | null>;
  }
}

export function hasAssetDragStarted(start: AssetDragPoint, point: AssetDragPoint): boolean {
  if (![start.clientX, start.clientY, point.clientX, point.clientY].every(Number.isFinite)) return false;
  return Math.hypot(point.clientX - start.clientX, point.clientY - start.clientY) >= ASSET_DRAG_THRESHOLD;
}

/** Pointer coordinates are CSS pixels, unlike native Finder drop coordinates. */
export function resolveAssetDropTarget(detail: AssetPointerDropDetail, context: AssetDropContext): AssetDropTarget | null {
  const { project } = context;
  if (context.blocked || detail.projectId !== project.id || !Object.hasOwn(project.assets, detail.assetId)
    || !Number.isFinite(detail.clientX) || !Number.isFinite(detail.clientY)) return null;
  if (context.backgroundDropPageId) {
    return project.pages.some(page => page.id === context.backgroundDropPageId)
      ? { kind: 'background', pageId: context.backgroundDropPageId } : null;
  }
  if (context.backgroundEditing && context.pageAtPoint) {
    return project.pages.some(page => page.id === context.pageAtPoint)
      ? { kind: 'background', pageId: context.pageAtPoint } : null;
  }
  const ref = context.frameAtPoint;
  return ref && project.pages.some(page => page.id === ref.pageId && page.frames.some(frame => frame.id === ref.frameId))
    ? { kind: 'frame', ref } : null;
}

interface PointerDragOptions {
  assetId: string;
  projectId: string;
  label: string;
  thumbnailUrl?: string;
  isValid(): boolean;
  suppressClick(): void;
}

/**
 * Wry owns AppKit drag/drop when Finder import is enabled. Use pointer capture
 * for internal assets, keeping native file drops enabled and browser HTML DnD intact.
 */
export function startAssetPointerDrag(event: PointerEvent, element: HTMLElement, options: PointerDragOptions): () => void {
  if (event.button !== 0 || !event.isPrimary || !options.isValid()) return () => {};
  const start = { clientX: event.clientX, clientY: event.clientY };
  let moved = false, ended = false;
  let ghost: HTMLDivElement | null = null;
  let highlighted: HTMLElement | null = null;
  let lastPoint: AssetDragPoint = start;
  const pointerId = event.pointerId;
  const sendHover = () => window.dispatchEvent(new CustomEvent<AssetPointerDropDetail>(ASSET_POINTER_HOVER_EVENT, { detail: {
    assetId: options.assetId, projectId: options.projectId, clientX: lastPoint.clientX, clientY: lastPoint.clientY,
  } }));
  const autoScroll = startDragAutoScroll(() => { if (options.isValid()) sendHover(); else cancel(); });

  const cleanup = () => {
    if (ended) return;
    ended = true;
    autoScroll.stop();
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('lostpointercapture', cancel);
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', cancel);
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    highlighted?.classList.remove('asset-pointer-drop-target');
    ghost?.remove();
    document.body.classList.remove('asset-pointer-dragging');
    if (moved) window.dispatchEvent(new CustomEvent(ASSET_POINTER_HOVER_EVENT, { detail: null }));
  };
  const cancel = () => { if (!ended) { options.suppressClick(); cleanup(); } };
  const key = (keyboardEvent: KeyboardEvent) => {
    if (keyboardEvent.key !== 'Escape') return;
    keyboardEvent.preventDefault(); keyboardEvent.stopPropagation(); cancel();
  };
  const update = (point: AssetDragPoint) => {
    if (!moved && !hasAssetDragStarted(start, point)) return;
    if (!moved) {
      moved = true; options.suppressClick();
      document.body.classList.add('asset-pointer-dragging');
      ghost = document.createElement('div'); ghost.className = 'asset-pointer-drag-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      if (options.thumbnailUrl) { const image = document.createElement('img'); image.src = options.thumbnailUrl; ghost.append(image); }
      const text = document.createElement('span'); text.textContent = options.label;
      const hint = document.createElement('small'); hint.textContent = '拖到照片框或背景区域';
      ghost.append(text, hint); document.body.append(ghost);
    }
    if (ghost) {
      ghost.style.left = `${Math.max(8, Math.min(point.clientX + 16, window.innerWidth - 228))}px`;
      ghost.style.top = `${Math.max(8, Math.min(point.clientY + 16, window.innerHeight - 68))}px`;
    }
    const zone = document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>('[data-background-drop]') ?? null;
    lastPoint = { clientX: point.clientX, clientY: point.clientY };
    autoScroll.update(lastPoint);
    if (highlighted !== zone) { highlighted?.classList.remove('asset-pointer-drop-target'); zone?.classList.add('asset-pointer-drop-target'); highlighted = zone; }
    sendHover();
  };
  const move = (pointerEvent: PointerEvent) => {
    if (pointerEvent.pointerId !== pointerId || ended) return;
    if (!options.isValid()) { cancel(); return; }
    update(pointerEvent);
    if (moved) pointerEvent.preventDefault();
  };
  const finish = (pointerEvent: PointerEvent) => {
    if (pointerEvent.pointerId !== pointerId || ended) return;
    if (!options.isValid()) { cancel(); return; }
    update(pointerEvent);
    const shouldDrop = moved;
    if (shouldDrop) { pointerEvent.preventDefault(); options.suppressClick(); }
    cleanup();
    if (shouldDrop) window.dispatchEvent(new CustomEvent<AssetPointerDropDetail>(ASSET_POINTER_DROP_EVENT, { detail: {
      assetId: options.assetId, projectId: options.projectId, clientX: pointerEvent.clientX, clientY: pointerEvent.clientY,
    } }));
  };

  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('lostpointercapture', cancel);
  document.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancel);
  try { element.setPointerCapture(pointerId); } catch { cancel(); }
  return cancel;
}
