import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { cover_json, initSync, layout_json, validate_project_json } from '../../public/core-wasm/collage_wasm.js';
import { createLongImageProject, LONG_IMAGE_MAX_PHOTOS, planLongImageLayout } from './longImage';
import type { LongImageDirection } from './longImage';
import type { CoverResult, ImageAsset, Project, ResolvedLayout } from './types';
import { validateProject } from '../state/validateProject';

const asset = (id: string, width = 3000, height = 4500, orientation = 1): ImageAsset => ({
  id, originalPath: `/photos/${id}.jpg`, fileName: `${id}.jpg`, width, height,
  rawWidth: orientation >= 5 ? height : width, rawHeight: orientation >= 5 ? width : height,
  orientation, format: 'jpeg', fingerprint: id, icc: null,
});
const resolve = (project: Project): ResolvedLayout => {
  const page = project.pages[0];
  return JSON.parse(layout_json(JSON.stringify(page), JSON.stringify(project.document), JSON.stringify(project.templates[page.templateId])));
};
const verifyOriginalPhotos = (project: Project) => {
  expect(validate_project_json(JSON.stringify(project))).toBe('true');
  const layout = resolve(project);
  expect(layout.handles).toEqual([]);
  layout.frames.forEach((resolved, index) => {
    const frame = project.pages[0].frames[index], original = project.assets[frame.imageAssetId!];
    expect(resolved.slotId).toBe(frame.slotId);
    const cover: CoverResult = JSON.parse(cover_json(JSON.stringify(resolved.rect), original.width, original.height, JSON.stringify(frame.transform)));
    expect(cover.crop.x).toBeCloseTo(0, 4); expect(cover.crop.y).toBeCloseTo(0, 4);
    expect(cover.crop.width).toBeCloseTo(original.width, 4);
    expect(cover.crop.height).toBeCloseTo(original.height, 4);
  });
};

beforeAll(() => {
  const bytes = readFileSync(new URL('../../public/core-wasm/collage_wasm_bg.wasm', import.meta.url));
  initSync({ module: Uint8Array.from(bytes) });
});

describe('editable long-photo stitching', () => {
  it('stitches vertically in the selected order at the first photo width without initial cropping', () => {
    const photos = [asset('portrait'), asset('landscape', 6000, 4000)];
    const plan = planLongImageLayout(photos, { direction: 'vertical' });
    const project = createLongImageProject(photos, { direction: 'vertical' });
    expect(plan.document).toEqual({ width: 3000, height: 6500, colorSpace: 'srgb' });
    expect(plan.scale).toBe(1); expect(plan.gap).toBe(0);
    expect(project.document).toEqual(plan.document);
    expect(project.canvasSizing).toBe('fixed'); expect(project.pages).toHaveLength(1);
    expect(project.pages[0].frames.map(frame => frame.imageAssetId)).toEqual(['portrait', 'landscape']);
    expect(project.templates[project.pages[0].templateId]).toMatchObject({ category: '长图', root: { kind: 'free', frames: plan.frames } });
    expect(resolve(project).frames.map(frame => frame.rect)).toEqual([
      { x: 0, y: 0, width: 3000, height: 4500 },
      { x: 0, y: 4500, width: 3000, height: 2000 },
    ]);
    verifyOriginalPhotos(project);
  });

  it('stitches horizontally at the first photo height and uses effective image widths', () => {
    const project = createLongImageProject([asset('first'), asset('second', 6000, 4000)], { direction: 'horizontal' });
    expect(project.document).toEqual({ width: 9750, height: 4500, colorSpace: 'srgb' });
    expect(resolve(project).frames.map(frame => frame.rect)).toEqual([
      { x: 0, y: 0, width: 3000, height: 4500 },
      { x: 3000, y: 0, width: 6750, height: 4500 },
    ]);
    verifyOriginalPhotos(project);
  });

  it('supports an explicit cross size and inserts background gap only between adjacent photos', () => {
    const photos = [asset('a', 4000, 6000), asset('b', 3000, 2000), asset('c', 5000, 3500)];
    const options = { direction: 'vertical' as const, crossSize: 1200, gap: 24, name: '  旅行长图  ' };
    const project = createLongImageProject(photos, options), plan = planLongImageLayout(photos, options);
    expect(project.name).toBe('旅行长图'); expect(project.pages[0].name).toBe('旅行长图');
    expect(plan.document).toMatchObject({ width: 1200, height: 3488 });
    const [a, b, c] = resolve(project).frames;
    expect(a.rect.y).toBe(0);
    expect(b.rect.y - a.rect.y - a.rect.height).toBeCloseTo(24);
    expect(c.rect.y - b.rect.y - b.rect.height).toBeCloseTo(24);
    expect(c.rect.y + c.rect.height).toBeCloseTo(project.document.height);
    expect(project.pages[0]).toMatchObject({ columnGap: 0, rowGap: 0, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    verifyOriginalPhotos(project);
  });

  it('uses EXIF-oriented dimensions instead of the raw landscape sensor dimensions', () => {
    const photos = [asset('rotated-camera', 4672, 7008, 6), asset('normal-camera', 4672, 7008)];
    for (const direction of ['vertical', 'horizontal'] as const) {
      const plan = planLongImageLayout(photos, { direction });
      expect(plan.requestedCrossSize).toBe(direction === 'vertical' ? 4672 : 7008);
      const project = createLongImageProject(photos, { direction });
      expect(project.assets[photos[0].id]).toEqual(photos[0]);
      verifyOriginalPhotos(project);
    }
  });

  it('retains fractional photo sizes so mixed aspect ratios do not introduce cumulative integer crops', () => {
    const photos = [asset('a', 3, 5), asset('b', 7, 13), asset('c', 9, 16)];
    const plan = planLongImageLayout(photos, { direction: 'vertical', crossSize: 1000 });
    const project = createLongImageProject(photos, { direction: 'vertical', crossSize: 1000 });
    const resolved = resolve(project), last = resolved.frames.at(-1)!.rect;
    expect(project.document.width).toBe(1000);
    expect(Number.isInteger(project.document.height)).toBe(true);
    expect(resolved.frames[0].rect.height).toBeCloseTo(1000 * 5 / 3);
    expect(project.document.height - last.y - last.height).toBeGreaterThanOrEqual(-1e-9);
    expect(project.document.height - last.y - last.height).toBeLessThan(1);
    expect(plan.scale).toBe(1);
    verifyOriginalPhotos(project);
  });

  it('automatically reduces 64 photos and their gaps together without losing or reordering frames', () => {
    const photos = Array.from({ length: LONG_IMAGE_MAX_PHOTOS }, (_, index) => asset(`photo-${index}`, 4000, 6000));
    for (const direction of ['vertical', 'horizontal'] as const) {
      const options = { direction, gap: 128 };
      const plan = planLongImageLayout(photos, options), project = createLongImageProject(photos, options);
      expect(plan.scale).toBeLessThan(1); expect(plan.gap).toBeCloseTo(128 * plan.scale);
      expect(project.document.width).toBeLessThanOrEqual(32768); expect(project.document.height).toBeLessThanOrEqual(32768);
      expect(project.document.width * project.document.height).toBeLessThanOrEqual(268435456);
      expect(project.pages[0].frames).toHaveLength(64);
      expect(project.pages[0].frames.map(frame => frame.imageAssetId)).toEqual(photos.map(photo => photo.id));
      const [first, second] = resolve(project).frames;
      const actualGap = direction === 'vertical' ? second.rect.y - first.rect.y - first.rect.height : second.rect.x - first.rect.x - first.rect.width;
      expect(actualGap).toBeCloseTo(plan.gap);
      verifyOriginalPhotos(project);
    }
  });

  it('keeps pixel-rounded output within the total-pixel cap when both sides individually fit', () => {
    const photos = [asset('a', 100000, 30000), asset('b', 100000, 30000)];
    for (const direction of ['vertical', 'horizontal'] as const) {
      const options = { direction, crossSize: 100000 };
      const plan = planLongImageLayout(photos, options), project = createLongImageProject(photos, options);
      expect(plan.scale).toBeLessThan(1);
      expect(plan.document.width).toBeLessThanOrEqual(32768); expect(plan.document.height).toBeLessThanOrEqual(32768);
      expect(Number.isInteger(plan.document.width)).toBe(true); expect(Number.isInteger(plan.document.height)).toBe(true);
      expect(plan.document.width * plan.document.height).toBeLessThanOrEqual(268435456);
      verifyOriginalPhotos(project);
    }
  });

  it('handles extreme narrow images with positive subpixel geometry instead of zero-sized photo frames', () => {
    const photos = Array.from({ length: 64 }, (_, index) => asset(`narrow-${index}`, 1, 100000));
    const project = createLongImageProject(photos, { direction: 'vertical' });
    expect(project.document).toMatchObject({ width: 1, height: 32768 });
    resolve(project).frames.forEach(frame => {
      expect(frame.rect.width).toBeGreaterThan(0); expect(frame.rect.height).toBeGreaterThan(0);
      expect(frame.rect.x).toBeGreaterThanOrEqual(0);
      expect(frame.rect.x + frame.rect.width).toBeLessThanOrEqual(1);
    });
    verifyOriginalPhotos(project);
  });

  it('allows reusing one original while creating independent editable placements and preserving input metadata', () => {
    const original = asset('repeat'), before = structuredClone(original);
    const project = createLongImageProject([original, structuredClone(original)], { direction: 'vertical' });
    expect(Object.keys(project.assets)).toEqual(['repeat']);
    expect(new Set(project.pages[0].frames.map(frame => frame.id)).size).toBe(2);
    project.pages[0].frames[0].transform.zoom = 1.5;
    project.pages[0].frames[0].transform.adjustments!.exposure = 1;
    expect(project.pages[0].frames[1].transform).toMatchObject({ zoom: 1, adjustments: { exposure: 0 } });
    project.assets.repeat.fileName = 'project-only.jpg';
    expect(original).toEqual(before);
    expect(() => createLongImageProject([original, asset('repeat', 6000, 9000)], { direction: 'vertical' })).toThrow(/同一照片/);
  });

  it('reopens the embedded free layout and supports independent frame edits without changing another photo', () => {
    const project = createLongImageProject([asset('a'), asset('b', 6000, 4000)], { direction: 'horizontal' });
    const before = resolve(project), page = project.pages[0], template = project.templates[page.templateId];
    if (template.root.kind !== 'free') throw new Error('Long images must retain independent free frames');
    page.frameRects = Object.fromEntries(template.root.frames.map(frame => [frame.slotId, structuredClone(frame.rect)]));
    page.frameRects[page.frames[0].slotId] = { x: 0.01, y: 0.05, width: 0.25, height: 0.9 };
    const reopened = validateProject(JSON.parse(JSON.stringify(project)));
    expect(reopened.canvasSizing).toBe('fixed'); expect(reopened.document).toEqual(project.document);
    expect(validate_project_json(JSON.stringify(reopened))).toBe('true');
    expect(resolve(reopened).frames[1]).toEqual(before.frames[1]);
    expect(resolve(reopened).frames[0].rect.x).toBeCloseTo(reopened.document.width * 0.01);
  });

  it('rejects invalid selections, dimensions, unsupported direction, and conflicting raw metadata', () => {
    for (const photos of [[], [asset('one')], Array.from({ length: 65 }, (_, index) => asset(`extra-${index}`))]) {
      expect(() => planLongImageLayout(photos, { direction: 'vertical' })).toThrow(/2 到 64/);
    }
    const photos = [asset('a'), asset('b')];
    for (const crossSize of [0, -1, 1.5, NaN, Infinity, 100001]) {
      expect(() => planLongImageLayout(photos, { direction: 'vertical', crossSize })).toThrow(/统一宽度/);
    }
    for (const gap of [-1, 0.5, NaN, Infinity, 32769]) {
      expect(() => planLongImageLayout(photos, { direction: 'horizontal', gap })).toThrow(/间距/);
    }
    expect(() => planLongImageLayout(photos, { direction: 'diagonal' as LongImageDirection })).toThrow(/竖向或横向/);
    expect(() => planLongImageLayout([{ ...photos[0], width: NaN }, photos[1]], { direction: 'vertical' })).toThrow(/宽度/);
    expect(() => planLongImageLayout([{ ...photos[0], rawWidth: 1 }, photos[1]], { direction: 'vertical' })).toThrow(/EXIF/);
    expect(() => planLongImageLayout([{ ...photos[0], originalPath: '' }, photos[1]], { direction: 'vertical' })).toThrow(/路径/);
    expect(() => createLongImageProject(photos, { direction: 'vertical', name: 'x'.repeat(4097) })).toThrow(/名称/);
  });
});
