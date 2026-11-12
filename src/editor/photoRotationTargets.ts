import type { Rect } from '../core/types';
import type { PhotoPoint } from './photoTransformGesture';

/** Screen pixels keep rotation reachable at every page zoom; resize handles
 * retain priority within their own clearance. */
export const PHOTO_ROTATION_BAND = 40;
export const PHOTO_RESIZE_CLEARANCE = 14;
export interface PhotoRotationRegion { outer: PhotoPoint[]; inner: PhotoPoint[]; fallback: boolean }
export interface PhotoRotationHitArea {
  regions: PhotoRotationRegion[];
  safe: Rect;
  /** Already expanded: crop by 2 px, page controls by 4 px. */
  exclusions: Rect[];
  resizeCorners: PhotoPoint[];
}

const EPSILON = 1e-8;
const finitePoint = (p: PhotoPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);
const validRect = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
const expandRect = (r: Rect, padding: number): Rect => ({ x: r.x - padding, y: r.y - padding, width: r.width + padding * 2, height: r.height + padding * 2 });
const rectCorners = (r: Rect): PhotoPoint[] => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
const insideRect = (p: PhotoPoint, r: Rect) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
const cross = (a: PhotoPoint, b: PhotoPoint, p: PhotoPoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

function polygonOrientation(points: readonly PhotoPoint[]): number {
  if (points.length !== 4 || !points.every(finitePoint)) return 0;
  const area = points.reduce((value, p, i) => {
    const q = points[(i + 1) % points.length];
    return value + p.x * q.y - q.x * p.y;
  }, 0);
  if (!Number.isFinite(area) || Math.abs(area) <= EPSILON) return 0;
  const direction = Math.sign(area);
  return points.every((p, i) => direction * cross(p, points[(i + 1) % points.length], points[(i + 2) % points.length]) > EPSILON) ? direction : 0;
}

/** Parallel offset makes a square-cornered ring around the actual rotated
 * image rectangle, instead of four isolated circular targets. */
function offsetPolygon(points: readonly PhotoPoint[], amount: number, direction: number): PhotoPoint[] {
  const normals = points.map((p, i) => {
    const q = points[(i + 1) % points.length], length = Math.hypot(q.x - p.x, q.y - p.y);
    return { x: direction * (q.y - p.y) / length, y: direction * (p.x - q.x) / length };
  });
  return points.map((p, i) => {
    const previous = normals[(i + points.length - 1) % points.length], next = normals[i];
    const scale = amount / (1 + previous.x * next.x + previous.y * next.y);
    return { x: p.x + (previous.x + next.x) * scale, y: p.y + (previous.y + next.y) * scale };
  });
}

function insidePolygon(point: PhotoPoint, polygon: readonly PhotoPoint[]): boolean {
  const direction = polygonOrientation(polygon);
  return direction !== 0 && polygon.every((p, i) => direction * cross(p, polygon[(i + 1) % polygon.length], point) >= -EPSILON);
}

/** Shared geometry for the transparent canvas hit path and cursor lookup.
 * Clip each ring by its inner polygon, then by each exclusion and resize-circle
 * separately: one combined evenodd path would XOR overlapping holes. */
export function photoRotationHitArea(corners: readonly PhotoPoint[], crop: Rect, safe: Rect, exclusions: readonly Rect[] = []): PhotoRotationHitArea {
  const result: PhotoRotationHitArea = { regions: [], safe: { ...safe }, exclusions: [], resizeCorners: [] };
  const direction = polygonOrientation(corners);
  if (!direction || !validRect(crop) || !validRect(safe)) return result;
  result.exclusions = [expandRect(crop, 2), ...exclusions.filter(validRect).map(r => expandRect(r, 4))];
  result.resizeCorners = corners.map(p => ({ ...p }));
  if (result.exclusions.some(r => rectCorners(safe).every(p => insideRect(p, r)))) return result;
  const region = (points: readonly PhotoPoint[], sign: number, fallback: boolean): PhotoRotationRegion => ({
    outer: offsetPolygon(points, PHOTO_ROTATION_BAND, sign), inner: offsetPolygon(points, 2, sign), fallback,
  });
  const actual = region(corners, direction, false);
  if (![...actual.outer, ...actual.inner].every(finitePoint)) return result;
  result.regions.push(actual);
  // A zoomed/panned photo can have its real outline offscreen. Also expose the
  // crop perimeter then, without replacing reachable portions of the real ring.
  if (actual.outer.some(p => !insideRect(p, safe))) result.regions.push(region(rectCorners(crop), 1, true));
  return result;
}

/** Returns source-corner orientation TL/TR/BR/BL. Exclusions and resize circles
 * own their boundaries; the safe rectangle and the outer ring include theirs. */
export function photoRotationAt(point: PhotoPoint, area: PhotoRotationHitArea): number | null {
  if (!finitePoint(point) || !validRect(area.safe) || !insideRect(point, area.safe)
    || area.exclusions.some(r => insideRect(point, r))
    || area.resizeCorners.some(p => Math.hypot(point.x - p.x, point.y - p.y) <= PHOTO_RESIZE_CLEARANCE)) return null;
  for (const region of area.regions) {
    if (!insidePolygon(point, region.outer) || insidePolygon(point, region.inner)) continue;
    let nearest = 0, distance = Number.POSITIVE_INFINITY;
    region.inner.forEach((corner, index) => {
      const current = Math.hypot(point.x - corner.x, point.y - corner.y);
      if (current < distance) { nearest = index; distance = current; }
    });
    return nearest;
  }
  return null;
}
