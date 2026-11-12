import type { FrameRef, Project } from '../core/types';
import { hasAssetDragStarted, type AssetDragPoint } from './assetDrag';
import { startDragAutoScroll } from './dragAutoScroll';
import type { WorkspaceMode } from '../core/workspaceModes';

export const PHOTO_POINTER_DROP_EVENT = 'frame-studio:photo-pointer-drop';
export const PHOTO_POINTER_HOVER_EVENT = 'frame-studio:photo-pointer-hover';
export interface PhotoPointerDropDetail extends AssetDragPoint { projectId: string; from: FrameRef; assetId: string }

/** Layout/background tools and a pending free transform must not move a photo through an editor thumbnail. */
export function thumbnailPhotoDragAllowed(state: { workspaceMode: WorkspaceMode; frameEditing: boolean; backgroundEditing: boolean; photoTransform?: FrameRef | null }): boolean {
  return !state.photoTransform && (state.workspaceMode === 'overview' || !state.frameEditing && !state.backgroundEditing);
}

declare global {
  interface WindowEventMap {
    'frame-studio:photo-pointer-drop': CustomEvent<PhotoPointerDropDetail>;
    'frame-studio:photo-pointer-hover': CustomEvent<PhotoPointerDropDetail | null>;
  }
}

export function validPhotoPointerDrop(detail: PhotoPointerDropDetail, project: Project, blocked = false): boolean {
  if (blocked || detail.projectId !== project.id || !Number.isFinite(detail.clientX) || !Number.isFinite(detail.clientY)) return false;
  return Boolean(project.assets[detail.assetId] && project.pages.find(page => page.id === detail.from.pageId)?.frames.find(frame => frame.id === detail.from.frameId)?.imageAssetId === detail.assetId);
}

interface PhotoPointerDragOptions {
  projectId: string;
  from: FrameRef;
  assetId: string;
  label: string;
  isValid(): boolean;
  suppressClick(): void;
}

/** Internal thumbnail photos use Pointer Events in both browsers and WKWebView. */
export function startPhotoPointerDrag(event: PointerEvent, element: HTMLElement, options: PhotoPointerDragOptions): () => void {
  if (event.button !== 0 || !event.isPrimary || !options.isValid()) return () => {};
  const start = { clientX: event.clientX, clientY: event.clientY }, pointerId = event.pointerId;
  let moved = false, ended = false, ghost: HTMLDivElement | null = null;
  let lastPoint: AssetDragPoint = start;
  const detail = (point: AssetDragPoint): PhotoPointerDropDetail => ({ clientX: point.clientX, clientY: point.clientY, projectId: options.projectId, from: options.from, assetId: options.assetId });
  const autoScroll = startDragAutoScroll(() => {
    if (!options.isValid()) { cancel(); return; }
    window.dispatchEvent(new CustomEvent<PhotoPointerDropDetail | null>(PHOTO_POINTER_HOVER_EVENT, { detail: detail(lastPoint) }));
  });
  const cleanup = () => {
    if (ended) return;
    ended = true;
    autoScroll.stop();
    element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', cancel); element.removeEventListener('lostpointercapture', cancel);
    document.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel);
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    ghost?.remove(); document.body.classList.remove('photo-pointer-dragging');
    window.dispatchEvent(new CustomEvent<PhotoPointerDropDetail | null>(PHOTO_POINTER_HOVER_EVENT, { detail: null }));
  };
  const cancel = () => { if (!ended) { if (moved) options.suppressClick(); cleanup(); } };
  const key = (keyboardEvent: KeyboardEvent) => {
    if (keyboardEvent.key !== 'Escape') return;
    keyboardEvent.preventDefault(); keyboardEvent.stopPropagation(); cancel();
  };
  const update = (point: AssetDragPoint) => {
    if (!moved && !hasAssetDragStarted(start, point)) return;
    if (!moved) {
      moved = true; options.suppressClick(); document.body.classList.add('photo-pointer-dragging');
      ghost = document.createElement('div'); ghost.className = 'asset-pointer-drag-ghost'; ghost.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = options.label;
      const hint = document.createElement('small'); hint.textContent = '拖入空框移动 · 拖到已有照片的框交换';
      ghost.append(label, hint); document.body.append(ghost);
    }
    if (ghost) {
      ghost.style.left = `${Math.max(8, Math.min(point.clientX + 16, window.innerWidth - 228))}px`;
      ghost.style.top = `${Math.max(8, Math.min(point.clientY + 16, window.innerHeight - 68))}px`;
    }
    lastPoint = { clientX: point.clientX, clientY: point.clientY }; autoScroll.update(lastPoint);
    window.dispatchEvent(new CustomEvent<PhotoPointerDropDetail | null>(PHOTO_POINTER_HOVER_EVENT, { detail: detail(point) }));
  };
  const move = (pointerEvent: PointerEvent) => {
    if (pointerEvent.pointerId !== pointerId || ended) return;
    if (!options.isValid()) { cancel(); return; }
    update(pointerEvent); if (moved) pointerEvent.preventDefault();
  };
  const finish = (pointerEvent: PointerEvent) => {
    if (pointerEvent.pointerId !== pointerId || ended) return;
    if (!options.isValid()) { cancel(); return; }
    update(pointerEvent); const shouldDrop = moved;
    if (shouldDrop) { pointerEvent.preventDefault(); options.suppressClick(); }
    cleanup();
    if (shouldDrop) window.dispatchEvent(new CustomEvent<PhotoPointerDropDetail>(PHOTO_POINTER_DROP_EVENT, { detail: detail(pointerEvent) }));
  };
  element.addEventListener('pointermove', move); element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', cancel); element.addEventListener('lostpointercapture', cancel);
  document.addEventListener('keydown', key, true); window.addEventListener('blur', cancel);
  try { element.setPointerCapture(pointerId); } catch { cancel(); }
  return cancel;
}
