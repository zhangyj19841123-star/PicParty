import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initSync, layout_json, validate_project_json } from '../../public/core-wasm/collage_wasm.js';
import { BUILTIN_TEMPLATES, createPage, createProject, DESIGNED_TEMPLATE_IDS, TEMPLATE_LIST } from './templates';
import type { DocumentSize, Page, ResolvedLayout, TemplateDefinition } from './types';
import { validateProject } from '../state/validateProject';

const designs = TEMPLATE_LIST.filter(template => DESIGNED_TEMPLATE_IDS.has(template.id));
const documentSizes: DocumentSize[] = [
  { width: 100, height: 150, colorSpace: 'srgb' },
  { width: 4000, height: 6000, colorSpace: 'srgb' },
  { width: 4672, height: 7008, colorSpace: 'srgb' },
];
const resolve = (page: Page, document: DocumentSize, template: TemplateDefinition): ResolvedLayout =>
  JSON.parse(layout_json(JSON.stringify(page), JSON.stringify(document), JSON.stringify(template)));

beforeAll(() => {
  // Exercise the packaged Rust/WASM engine rather than another layout implementation.
  const bytes = readFileSync(new URL('../../public/core-wasm/collage_wasm_bg.wasm', import.meta.url));
  initSync({ module: Uint8Array.from(bytes) });
});

describe('photographic design templates through the shared layout engine', () => {
  it('provides distinct two-, three-, and four-photo designs while keeping the original startup layout', () => {
    expect(designs).toHaveLength(12);
    expect(new Set(TEMPLATE_LIST.map(template => template.id)).size).toBe(TEMPLATE_LIST.length);
    expect(new Set(designs.map(template => template.name)).size).toBe(designs.length);
    for (const count of [2, 3, 4]) {
      const category = designs.filter(template => template.category === `${count} 张`);
      expect(category).toHaveLength(4);
      category.forEach(template => expect(template.slotOrder).toHaveLength(count));
    }
    expect(createProject().pages[0].templateId).toBe('split-y');
  });

  it('keeps intentional background space without overlapping or hiding a photo frame', () => {
    for (const template of designs) {
      expect(template.root.kind).toBe('free');
      if (template.root.kind !== 'free') throw new Error('Design requires free frame geometry');
      const { frames } = template.root;
      expect(frames.map(frame => frame.slotId)).toEqual(template.slotOrder);
      let coverage = 0;
      frames.forEach((frame, index) => {
        const { x, y, width, height } = frame.rect;
        expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
        expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0);
        expect(x + width).toBeLessThanOrEqual(1); expect(y + height).toBeLessThanOrEqual(1);
        coverage += width * height;
        for (const other of frames.slice(index + 1)) {
          const overlapX = Math.min(x + width, other.rect.x + other.rect.width) - Math.max(x, other.rect.x);
          const overlapY = Math.min(y + height, other.rect.y + other.rect.height) - Math.max(y, other.rect.y);
          expect(overlapX <= 0 || overlapY <= 0, `${template.name}: ${frame.slotId} / ${other.slotId}`).toBe(true);
        }
      });
      expect(coverage).toBeLessThan(0.95);
    }
  });

  it('passes frontend and native project validation and scales every frame at 2:3 output sizes', () => {
    for (const document of documentSizes) {
      const project = createProject({ ...document, canvasSizing: 'fixed' });
      project.templates = Object.fromEntries(designs.map(template => [template.id, structuredClone(template)]));
      project.pages = designs.map(template => createPage(template.id, BUILTIN_TEMPLATES, document));
      expect(() => validateProject(project)).not.toThrow();
      expect(validate_project_json(JSON.stringify(project))).toBe('true');
      project.pages.forEach((page, index) => {
        const template = designs[index];
        if (template.root.kind !== 'free') throw new Error('Design requires free frame geometry');
        const layout = resolve(page, document, template);
        expect(layout.handles).toEqual([]);
        expect(layout.frames.map(frame => frame.slotId)).toEqual(template.slotOrder);
        expect(page.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(page.columnGap).toBe(0); expect(page.rowGap).toBe(0);
        const sourceFrames = template.root.frames;
        layout.frames.forEach((frame, slot) => {
          const source = sourceFrames[slot].rect;
          expect(frame.rect.x / document.width).toBeCloseTo(source.x);
          expect(frame.rect.y / document.height).toBeCloseTo(source.y);
          expect(frame.rect.width / document.width).toBeCloseTo(source.width);
          expect(frame.rect.height / document.height).toBeCloseTo(source.height);
        });
      });
    }
  });

  it('makes the requested top full-width photo larger than a centered lower photo with four-sided space', () => {
    const template = BUILTIN_TEMPLATES['design-top-full-bottom-inset'];
    const document = documentSizes[1];
    const { frames: [top, lower] } = resolve(createPage(template.id), document, template);
    expect(top.rect).toEqual({ x: 0, y: 0, width: 4000, height: 3600 });
    expect(lower.rect).toMatchObject({ x: 640, width: 2720, height: 1440 });
    expect(lower.rect.y).toBeCloseTo(4080);
    expect(lower.rect.x * 2 + lower.rect.width).toBe(document.width);
    expect(lower.rect.y).toBeGreaterThan(top.rect.y + top.rect.height);
    expect(lower.rect.y + lower.rect.height).toBeLessThan(document.height);
    expect(lower.rect.width * lower.rect.height).toBeLessThan(top.rect.width * top.rect.height);
  });

  it('lets a frame override change one design region independently and preserves it on file reload', () => {
    const template = BUILTIN_TEMPLATES['design-hero-two-details'];
    const document = documentSizes[2];
    const project = createProject({ ...document, canvasSizing: 'fixed' });
    project.templates = { [template.id]: structuredClone(template) };
    const page = createPage(template.id);
    project.pages = [page];
    const before = resolve(page, document, template);
    if (template.root.kind !== 'free') throw new Error('Design requires free frame geometry');
    page.frameRects = Object.fromEntries(template.root.frames.map(frame => [frame.slotId, structuredClone(frame.rect)]));
    page.frameRects.b = { x: 0.11, y: 0.66, width: 0.3, height: 0.24 };
    const reloaded = validateProject(JSON.parse(JSON.stringify(project)));
    expect(validate_project_json(JSON.stringify(reloaded))).toBe('true');
    const after = resolve(reloaded.pages[0], document, reloaded.templates[template.id]);
    expect(after.frames[0]).toEqual(before.frames[0]);
    expect(after.frames[2]).toEqual(before.frames[2]);
    expect(after.frames[1].rect.width).toBeCloseTo(document.width * 0.3);
    expect(after.frames[1].rect.height).toBeCloseTo(document.height * 0.24);
    expect(template.root.frames[1].rect).toEqual({ x: 0.08, y: 0.64, width: 0.39, height: 0.28 });
  });
});
