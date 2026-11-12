import { describe, expect, it } from 'vitest';
import { getPersonalTemplates } from './personalTemplates';
import { BUILTIN_TEMPLATES } from './templates';
import type { TemplateDefinition } from './types';

const custom = (id: string, name = id): TemplateDefinition => ({
  id, name, version: 1, category: '自定义', defaults: {}, slotOrder: ['a'],
  root: { kind: 'free', frames: [{ slotId: 'a', rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }] },
});

describe('personal template visibility', () => {
  it('merges project layouts with saved layouts, preferring the saved copy of each ID', () => {
    const embedded = custom('user_a', '作品内的名称'), library = custom('user_a', '保存后的名称');
    const projectOnly = custom('user_b'), libraryOnly = custom('user_c');
    expect(getPersonalTemplates({ user_a: embedded, user_b: projectOnly }, [library, libraryOnly], [])).toEqual([library, projectOnly, libraryOnly]);
  });

  it('hides deleted IDs from both sources without modifying their geometry', () => {
    const definition = custom('user_a'), active = custom('user_b');
    const project = { user_a: definition, user_b: active }, library = [definition], deleted = [definition];
    const before = JSON.stringify({ project, library, deleted });
    expect(getPersonalTemplates(project, library, deleted)).toEqual([active]);
    expect(JSON.stringify({ project, library, deleted })).toBe(before);
    expect(getPersonalTemplates(project, library, [])).toEqual([definition, active]);
  });

  it('never shows built-in templates or a custom-looking collision with a built-in ID', () => {
    expect(getPersonalTemplates(BUILTIN_TEMPLATES, [BUILTIN_TEMPLATES.single, custom('single')], [])).toEqual([]);
    expect(getPersonalTemplates({ single: { ...BUILTIN_TEMPLATES.single, category: '自定义' } }, [], [])).toEqual([]);
  });
});
