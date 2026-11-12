import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { cover_json, initSync } from '../../public/core-wasm/collage_wasm.js';
import type { CoverResult, Rect } from '../core/types';
import { defaultTransform } from '../core/templates';
import { beginPhotoRotation, normalizePhotoRotation, photoTransformCorners, photoZoomAfterDrag, updatePhotoRotation, type PhotoPoint } from './photoTransformGesture';

const pointAt = (degrees: number, radius = 100): PhotoPoint => ({ x: Math.cos(degrees * Math.PI / 180) * radius, y: Math.sin(degrees * Math.PI / 180) * radius });
const origin = { x: 0, y: 0 };

beforeAll(() => {
  const bytes = readFileSync(new URL('../../public/core-wasm/collage_wasm_bg.wasm', import.meta.url));
  initSync({ module: Uint8Array.from(bytes) });
});

describe('on-canvas free photo transform', () => {
  it('keeps clockwise rotation continuous through the atan2 seam', () => {
    let gesture = beginPhotoRotation(origin, pointAt(170), 20);
    let next = updatePhotoRotation(gesture, pointAt(-170));
    expect(next.rotation).toBeCloseTo(40);
    expect(next.gesture.accumulated).toBeCloseTo(20);
    gesture = next.gesture;
    next = updatePhotoRotation(gesture, pointAt(-150));
    expect(next.rotation).toBeCloseTo(60);
  });

  it('keeps counterclockwise motion and several turns without reversing at ±180', () => {
    let gesture = beginPhotoRotation(origin, pointAt(-170), -170);
    for (const angle of [-190, -280, -370, -460, -550, -640, -730]) gesture = updatePhotoRotation(gesture, pointAt(angle)).gesture;
    expect(gesture.accumulated).toBeCloseTo(-560);
    expect(updatePhotoRotation(gesture, pointAt(-750)).rotation).toBeCloseTo(-30);
  });

  it('snaps the absolute intended angle to 15 degrees while preserving unsnapped motion', () => {
    let gesture = beginPhotoRotation(origin, pointAt(0), 7);
    const snapped = updatePhotoRotation(gesture, pointAt(12), true);
    expect(snapped.rotation).toBe(15);
    gesture = snapped.gesture;
    const unsnapped = updatePhotoRotation(gesture, pointAt(13));
    expect(unsnapped.rotation).toBeCloseTo(20);
    expect(updatePhotoRotation(unsnapped.gesture, pointAt(174), true).rotation).toBe(-180);
  });

  it('does not jump when the pointer crosses the rotation pivot', () => {
    const gesture = beginPhotoRotation({ x: 40, y: 30 }, { x: 140, y: 30 }, 25);
    const near = updatePhotoRotation(gesture, { x: 40.1, y: 30.1 });
    expect(near.rotation).toBe(25);
    expect(updatePhotoRotation(near.gesture, { x: 40, y: 130 }).rotation).toBe(115);
  });

  it('scales relative to the starting pointer radius and obeys photo zoom 1..100', () => {
    const center = { x: 300, y: 200 };
    expect(photoZoomAfterDrag(2, center, { x: 400, y: 200 }, { x: 500, y: 200 })).toBe(4);
    expect(photoZoomAfterDrag(2, center, { x: 400, y: 200 }, center)).toBe(1);
    expect(photoZoomAfterDrag(2, center, { x: 400, y: 200 }, { x: 10_300, y: 200 })).toBe(100);
    expect(photoZoomAfterDrag(10, center, { x: 400, y: 200 }, { x: 500, y: 200 })).toBe(20);
  });

  it('uses the actual cover corners for portrait and landscape assets after rotation and focus clamp', () => {
    const rect: Rect = { x: 120, y: 80, width: 500, height: 750 };
    for (const [width, height] of [[4672, 7008], [7008, 4672]]) {
      for (const rotation of [0, 37, 90, -125, 179]) {
        const cover: CoverResult = JSON.parse(cover_json(JSON.stringify(rect), width, height,
          JSON.stringify({ ...defaultTransform(), focusX: .1, focusY: .9, rotation, zoom: 2.4 })));
        const corners = photoTransformCorners(cover);
        const center = corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { ...origin });
        expect(center.x).toBeCloseTo(cover.centerX);
        expect(center.y).toBeCloseTo(cover.centerY);
        expect(Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y)).toBeCloseTo(cover.width);
        expect(Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y)).toBeCloseTo(cover.height);
        expect(normalizePhotoRotation(Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180 / Math.PI)).toBeCloseTo(rotation);
        // The shared cover contract still contains every crop-frame corner in
        // source axes, even when the true photo outline extends outside it.
        const radians = rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
        for (const point of [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }]) {
          const dx = point.x - center.x, dy = point.y - center.y;
          expect(Math.abs(cos * dx + sin * dy)).toBeLessThanOrEqual(cover.width / 2 + 1e-8);
          expect(Math.abs(-sin * dx + cos * dy)).toBeLessThanOrEqual(cover.height / 2 + 1e-8);
        }
      }
    }
  });

  it('rejects invalid input and normalizes finite angles for the persisted transform contract', () => {
    expect(normalizePhotoRotation(540)).toBe(-180);
    expect(normalizePhotoRotation(-725)).toBe(-5);
    expect(() => normalizePhotoRotation(NaN)).toThrow();
    expect(() => beginPhotoRotation(origin, { x: Infinity, y: 0 }, 0)).toThrow();
    expect(() => photoZoomAfterDrag(0, origin, origin, origin)).toThrow();
    expect(() => photoTransformCorners({ centerX: 0, centerY: 0, width: 0, height: 10, rotation: 0 } as CoverResult)).toThrow();
  });
});
