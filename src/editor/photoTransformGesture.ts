import type { CoverResult } from '../core/types';

export interface PhotoPoint { x: number; y: number }
export interface PhotoRotationGesture {
  center: PhotoPoint;
  initialRotation: number;
  lastAngle: number;
  /** Unsnapped movement is retained so pressing Shift never changes the gesture's origin. */
  accumulated: number;
}

function validPoint(point: PhotoPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Image transforms use clockwise degrees in the canvas's downward-positive Y axis. */
export function normalizePhotoRotation(angle: number): number {
  if (!Number.isFinite(angle)) throw new Error('照片旋转角度必须为有效数值');
  const normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function beginPhotoRotation(center: PhotoPoint, pointer: PhotoPoint, initialRotation: number): PhotoRotationGesture {
  if (!validPoint(center) || !validPoint(pointer) || !Number.isFinite(initialRotation)) throw new Error('照片旋转位置必须为有效数值');
  return {
    center: { ...center },
    initialRotation: normalizePhotoRotation(initialRotation),
    lastAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180 / Math.PI,
    accumulated: 0,
  };
}

/** Track successive angular deltas rather than subtracting the initial atan2:
 * that remains continuous when the pointer crosses ±180 or completes a turn. */
export function updatePhotoRotation(gesture: PhotoRotationGesture, pointer: PhotoPoint, snap = false): { gesture: PhotoRotationGesture; rotation: number } {
  if (!validPoint(pointer) || !validPoint(gesture.center)
    || ![gesture.initialRotation, gesture.lastAngle, gesture.accumulated].every(Number.isFinite)) throw new Error('照片旋转位置必须为有效数值');
  // Near the pivot atan2 becomes unstable; retain the last useful angle until
  // the pointer moves away again. Coordinates are screen pixels for UI gestures.
  const stable = Math.hypot(pointer.x - gesture.center.x, pointer.y - gesture.center.y) >= 1;
  const angle = stable ? Math.atan2(pointer.y - gesture.center.y, pointer.x - gesture.center.x) * 180 / Math.PI : gesture.lastAngle;
  const next = { ...gesture, lastAngle: angle, accumulated: gesture.accumulated + normalizePhotoRotation(angle - gesture.lastAngle) };
  const intended = next.initialRotation + next.accumulated;
  return { gesture: next, rotation: normalizePhotoRotation(snap ? Math.round(intended / 15) * 15 : intended) };
}

/** The cover renderer owns the base scale. Only store the relative zoom, with
 * the same 1..100 limits as photo transforms; background zoom is a separate tool. */
export function photoZoomAfterDrag(initialZoom: number, center: PhotoPoint, startPointer: PhotoPoint, pointer: PhotoPoint): number {
  if (!Number.isFinite(initialZoom) || initialZoom <= 0 || ![center, startPointer, pointer].every(validPoint)) throw new Error('照片缩放位置必须为有效数值');
  const initialDistance = Math.max(1, Math.hypot(startPointer.x - center.x, startPointer.y - center.y));
  const distance = Math.hypot(pointer.x - center.x, pointer.y - center.y);
  return Math.max(1, Math.min(100, initialZoom * distance / initialDistance));
}

/** Actual photo outline, before its frame clips the visible pixels. The four
 * returned corners run clockwise: source top-left, top-right, bottom-right,
 * bottom-left. They are document/world coordinates, ready for viewport mapping. */
export function photoTransformCorners(cover: CoverResult): [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint] {
  if (![cover.centerX, cover.centerY, cover.width, cover.height, cover.rotation].every(Number.isFinite)
    || cover.width <= 0 || cover.height <= 0) throw new Error('照片变换尺寸必须为有效数值');
  const radians = cover.rotation * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const corner = (x: number, y: number): PhotoPoint => ({ x: cover.centerX + cos * x - sin * y, y: cover.centerY + sin * x + cos * y });
  const w = cover.width / 2, h = cover.height / 2;
  return [corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h)];
}
