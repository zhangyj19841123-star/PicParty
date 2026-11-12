import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, createPage, createProject, TEMPLATE_LIST } from './templates';
import { validateProject } from '../state/validateProject';

describe('template snapshots and file validation', () => {
  it('creates independent, valid pages for every builtin template', () => {
    const project = createProject();
    project.templates = structuredClone(BUILTIN_TEMPLATES);
    project.pages = TEMPLATE_LIST.map(template => createPage(template.id));
    expect(() => validateProject(project)).not.toThrow();
    const copy = createPage(); copy.templateState.rows[0] = 0.1;
    expect(BUILTIN_TEMPLATES['split-y'].defaults.rows).toEqual([0.5, 0.5]);
  });

  it('starts every builtin page with zero margins and gaps at any supported document size', () => {
    for (const document of [{ width: 100, height: 150, colorSpace: 'srgb' as const }, { width: 4672, height: 7008, colorSpace: 'srgb' as const }]) {
      for (const template of TEMPLATE_LIST) {
        const page = createPage(template.id, BUILTIN_TEMPLATES, document);
        expect(page.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(page.columnGap).toBe(0); expect(page.rowGap).toBe(0);
      }
    }
  });

  it('keeps zero defaults valid for tiny documents and rejects excessive dimensions', () => {
    const small = createProject({ width: 100, height: 150 });
    expect(() => validateProject(small)).not.toThrow();
    expect(small.pages[0].margin.top).toBe(0);
    expect(() => createProject({ width: 32768, height: 32768 })).toThrow();
    expect(() => createProject({ width: 1.5 })).toThrow();
  });

  it('rejects unknown versions, broken references, and unsupported flips', () => {
    const future = createProject(); future.engineVersion = 2;
    expect(() => validateProject(future)).toThrow(/版本/);
    const missing = createProject(); missing.pages[0].frames[0].imageAssetId = 'missing';
    expect(() => validateProject(missing)).toThrow(/素材不存在/);
    const flipped = createProject(); flipped.pages[0].frames[0].transform.flipX = true;
    expect(() => validateProject(flipped)).toThrow(/翻转/);
  });

  it('loads finite rotations and rejects invalid angles before rendering', () => {
    const project = createProject();
    for (const angle of [-180, -45.2, 0, 90, 180]) {
      project.pages[0].frames[0].transform.rotation = angle;
      expect(validateProject(project).pages[0].frames[0].transform.rotation).toBe(angle);
    }
    for (const angle of [NaN, Infinity, -Infinity, -180.1, 180.1]) {
      project.pages[0].frames[0].transform.rotation = angle;
      expect(() => validateProject(project)).toThrow(/旋转/);
    }
  });

  it('rejects duplicate placement identities and inconsistent shared template parameters', () => {
    const duplicate = createProject(); duplicate.pages[0].frames[1].id = duplicate.pages[0].frames[0].id;
    expect(() => validateProject(duplicate)).toThrow(/唯一/);
    const grid = createProject(); grid.templates = structuredClone(BUILTIN_TEMPLATES);
    grid.pages = [createPage('grid-4')]; grid.pages[0].templateState.columns = [1, 2, 3];
    expect(() => validateProject(grid)).toThrow(/数量/);
  });

  it('rejects malformed input and duplicate template slots before renderer initialization', () => {
    expect(() => validateProject(null)).toThrow(/项目/);
    const project = createProject(); project.templates['split-y'].slotOrder = ['a', 'a'];
    expect(() => validateProject(project)).toThrow(/照片框顺序/);
  });
});
