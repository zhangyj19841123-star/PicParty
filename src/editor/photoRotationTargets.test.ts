import { describe, expect, it } from 'vitest';
import { photoTransformCorners } from './photoTransformGesture';
import { PHOTO_RESIZE_CLEARANCE, PHOTO_ROTATION_BAND, photoRotationAt, photoRotationHitArea } from './photoRotationTargets';
import { workspaceLayout } from './workspaceLayout';
import type { CoverResult, Rect } from '../core/types';
import type { PhotoPoint } from './photoTransformGesture';

const crop: Rect = { x: 200, y: 150, width: 240, height: 180 };
const safe: Rect = { x: 12, y: 60, width: 760, height: 500 };
const roomySafe: Rect = { x: -100, y: -100, width: 1000, height: 900 };
const cover = (rotation = 0, width = 300, height = 220): CoverResult => ({ x: 170, y: 130, centerX: 320, centerY: 240, width, height, rotation, scale: 1, crop });
const local = (x: number, y: number, degrees = 0): PhotoPoint => {
  const radians = degrees * Math.PI / 180;
  return { x: 320 + x * Math.cos(radians) - y * Math.sin(radians), y: 240 + x * Math.sin(radians) + y * Math.cos(radians) };
};
const reachable = (area: ReturnType<typeof photoRotationHitArea>): PhotoPoint[] => {
  const points: PhotoPoint[] = [];
  for (let y = area.safe.y; y <= area.safe.y + area.safe.height; y += 4) {
    for (let x = area.safe.x; x <= area.safe.x + area.safe.width; x += 4) if (photoRotationAt({ x, y }, area) !== null) points.push({ x, y });
  }
  return points;
};

describe('wide outer photo rotation regions', () => {
  it.each([0, 37, 90, -145])('follows the real rotated image outline at %s degrees', angle => {
    const corners = photoTransformCorners(cover(angle)), area = photoRotationHitArea(corners, crop, roomySafe);
    expect(area.regions.length).toBeGreaterThan(0);
    const actual = area.regions[0];
    expect(actual.fallback).toBe(false);
    for (let i = 0; i < 4; i++) {
      const localX = i === 0 || i === 3 ? -150 - PHOTO_ROTATION_BAND : 150 + PHOTO_ROTATION_BAND;
      const localY = i < 2 ? -110 - PHOTO_ROTATION_BAND : 110 + PHOTO_ROTATION_BAND;
      expect(actual.outer[i].x).toBeCloseTo(local(localX, localY, angle).x);
      expect(actual.outer[i].y).toBeCloseTo(local(localX, localY, angle).y);
    }
    // This midpoint is far from any corner hotspot and still rotates.
    expect(photoRotationAt(local(170, 0, angle), area)).not.toBeNull();
    expect(photoRotationAt(local(191, 0, angle), area)).toBeNull();
    expect(photoRotationAt(local(151, 0, angle), area)).toBeNull();
  });

  it('recognizes a broad exterior band instead of four small circles', () => {
    const area = photoRotationHitArea(photoTransformCorners(cover()), crop, safe);
    for (const x of [-189, -170, -153]) for (const y of [-90, -45, 0, 45, 90]) expect(photoRotationAt(local(x, y), area)).not.toBeNull();
    expect(photoRotationAt(local(-190, 0), area)).not.toBeNull();
    expect(photoRotationAt(local(-190.01, 0), area)).toBeNull();
    expect(photoRotationAt(local(-152, 0), area)).toBeNull();
  });

  it('returns source corner orientation for all four outside corners', () => {
    for (const angle of [0, 37, 90, -145]) {
      const area = photoRotationHitArea(photoTransformCorners(cover(angle)), { x: 315, y: 235, width: 10, height: 10 }, roomySafe);
      [[-175, -135], [175, -135], [175, 135], [-175, 135]].forEach(([x, y], index) => expect(photoRotationAt(local(x, y, angle), area)).toBe(index));
    }
  });

  it('gives resize corners their full 14 px clearance and keeps the crop unclickable', () => {
    const corners = photoTransformCorners(cover()), area = photoRotationHitArea(corners, crop, safe);
    expect(PHOTO_RESIZE_CLEARANCE).toBe(14);
    expect(photoRotationAt({ x: corners[0].x - 14, y: corners[0].y }, area)).toBeNull();
    expect(photoRotationAt({ x: corners[0].x - 14.01, y: corners[0].y }, area)).toBe(0);
    for (const p of [{ x: 200, y: 150 }, { x: 320, y: 240 }, { x: 440, y: 330 }]) expect(photoRotationAt(p, area)).toBeNull();
    expect(area.exclusions[0]).toEqual({ x: 198, y: 148, width: 244, height: 184 });
  });

  it('excludes page headers with padding even where their holes overlap the inner image or crop', () => {
    const header = { x: 130, y: 80, width: 250, height: 85 }, area = photoRotationHitArea(photoTransformCorners(cover()), crop, safe, [header]);
    expect(area.exclusions[1]).toEqual({ x: 126, y: 76, width: 258, height: 93 });
    expect(photoRotationAt({ x: 160, y: 140 }, area)).toBeNull();
    expect(photoRotationAt({ x: 200, y: 150 }, area)).toBeNull();
    expect(photoRotationAt({ x: 160, y: 170 }, area)).not.toBeNull();
  });

  it('keeps the actual ring and a crop fallback when zoom puts real corners offscreen', () => {
    const area = photoRotationHitArea(photoTransformCorners(cover(20, 4000, 6000)), crop, safe);
    expect(area.regions.map(r => r.fallback)).toEqual([false, true]);
    expect(photoRotationAt({ x: crop.x + crop.width / 2, y: crop.y - 20 }, area)).not.toBeNull();
    expect(photoRotationAt({ x: crop.x + crop.width + 20, y: crop.y + crop.height / 2 }, area)).not.toBeNull();
    expect(photoRotationAt({ x: crop.x + 1, y: crop.y + 1 }, area)).toBeNull();
  });

  it('keeps both a reachable real edge and a reachable fallback edge after partial clipping', () => {
    const area = photoRotationHitArea(photoTransformCorners(cover(0, 700, 220)), crop, safe);
    expect(area.regions.map(r => r.fallback)).toEqual([false, true]);
    expect(photoRotationAt({ x: 690, y: 240 }, area)).not.toBeNull();
    expect(photoRotationAt({ x: 460, y: 240 }, area)).not.toBeNull();
  });

  it.each([{ count: 6 as const, width: 1000, height: 650 }, { count: 4 as const, width: 500, height: 500 }])('keeps broad rotation regions reachable in a real $count-page workspace at $width × $height', ({ count, width, height }) => {
    const views = workspaceLayout({ document: { width: 1200, height: 800 }, viewport: { width, height }, count, mode: count }).views;
    const view = views[count - 1], screenCrop = { x: view.x, y: view.y, width: view.width, height: view.height };
    const screenSafe = { x: 12, y: 60, width: width - 24, height: height - 72 };
    const corners = photoTransformCorners({ ...cover(20, 4000, 6000), centerX: view.x + view.width / 2, centerY: view.y + view.height / 2 });
    const area = photoRotationHitArea(corners, screenCrop, screenSafe, views.map(value => value.label)), points = reachable(area);
    expect(points.length).toBeGreaterThan(50);
    expect(area.regions.some(r => r.fallback)).toBe(true);
    for (const p of points) for (const r of area.exclusions) expect(p.x < r.x || p.x > r.x + r.width || p.y < r.y || p.y > r.y + r.height).toBe(true);
  });

  it('keeps top and bottom bands reachable with both original crop corners horizontally offscreen', () => {
    const pannedCrop = { x: -100, y: 100, width: 1000, height: 300 }, viewport = { x: 12, y: 60, width: 776, height: 528 };
    const corners = photoTransformCorners({ ...cover(20, 4000, 6000), centerX: 400, centerY: 250 }), area = photoRotationHitArea(corners, pannedCrop, viewport);
    expect(photoRotationAt({ x: 400, y: 80 }, area)).not.toBeNull();
    expect(photoRotationAt({ x: 400, y: 420 }, area)).not.toBeNull();
    expect(photoRotationAt({ x: 400, y: 250 }, area)).toBeNull();
    expect(photoRotationAt({ x: viewport.x - 0.01, y: 80 }, area)).toBeNull();
  });

  it('returns no regions when the crop or excluded controls cover every safe pixel', () => {
    const corners = photoTransformCorners(cover());
    expect(photoRotationHitArea(corners, crop, crop).regions).toEqual([]);
    expect(photoRotationHitArea(corners, crop, safe, [safe]).regions).toEqual([]);
    expect(photoRotationAt({ x: 150, y: 240 }, photoRotationHitArea(corners, crop, crop))).toBeNull();
  });

  it('rejects non-finite, degenerate, or concave geometry and ignores invalid optional exclusions', () => {
    const corners = photoTransformCorners(cover());
    for (const invalid of [[], corners.slice(0, 3), corners.map(p => ({ ...p, x: Number.NaN })), [corners[0], corners[1], corners[0], corners[3]], [corners[0], corners[1], { x: 320, y: 240 }, corners[3]]]) expect(photoRotationHitArea(invalid, crop, safe).regions).toEqual([]);
    for (const r of [{ ...safe, x: Infinity }, { ...safe, width: 0 }, { ...safe, height: -1 }]) expect(photoRotationHitArea(corners, crop, r).regions).toEqual([]);
    expect(photoRotationHitArea(corners, { ...crop, height: NaN }, safe).regions).toEqual([]);
    const area = photoRotationHitArea(corners, crop, safe, [{ ...safe, x: NaN }, { ...safe, width: -1 }]);
    expect(area.exclusions).toHaveLength(1);
    expect(photoRotationAt({ x: NaN, y: 240 }, area)).toBeNull();
    expect(photoRotationAt({ x: 150, y: Infinity }, area)).toBeNull();
  });
});
