import { describe, expect, it } from 'vitest';
import { createTemplateLibraryStore, readTemplateLibrary, TEMPLATE_LIBRARY_KEY, type TemplateLibraryStorage } from './templateLibraryStore';
import type { TemplateDefinition } from '../core/types';
import { getPersonalTemplates } from '../core/personalTemplates';
import { BUILTIN_TEMPLATES, createProject } from '../core/templates';

const template = (id = 'user_example'): TemplateDefinition => ({ id, version: 1, name: '留白双图', category: '自定义', defaults: {},
  root: { kind: 'free', frames: [{ slotId: 'a', rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.35 } }, { slotId: 'b', rect: { x: 0.2, y: 0.55, width: 0.6, height: 0.35 } }] }, slotOrder: ['a', 'b'] });
const storage = (raw?: string): TemplateLibraryStorage => {
  const values = new Map<string, string>(raw ? [[TEMPLATE_LIBRARY_KEY, raw]] : []);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
};

describe('reusable layout template library', () => {
  it('persists independent geometry and restores it in a new app session', () => {
    const source = storage(), store = createTemplateLibraryStore(source), definition = template();
    store.getState().save(definition);
    definition.name = 'later'; definition.slotOrder.reverse();
    expect(createTemplateLibraryStore(source).getState().templates).toEqual([template()]);
    expect(source.getItem(TEMPLATE_LIBRARY_KEY)).not.toMatch(/originalPath|imageAssetId|transform|background/);
  });

  it('updates a saved name by ID and removes only that template', () => {
    const source = storage(), store = createTemplateLibraryStore(source);
    store.getState().save(template()); store.getState().save(template('user_other'));
    store.getState().save({ ...template(), name: '新名称' });
    expect(store.getState().templates).toHaveLength(2);
    store.getState().remove('user_other');
    expect(readTemplateLibrary(source)).toEqual([{ ...template(), name: '新名称' }]);
    expect(store.getState().removedTemplates).toEqual([template('user_other')]);
    store.getState().restore('user_other');
    expect(createTemplateLibraryStore(source).getState().templates).toEqual([{ ...template(), name: '新名称' }, template('user_other')]);
    expect(createTemplateLibraryStore(source).getState().removedTemplates).toEqual([]);
  });

  it('reads the legacy array and upgrades it atomically without losing layouts', () => {
    const source = storage(JSON.stringify([template(), template('user_other')]));
    const store = createTemplateLibraryStore(source);
    expect(store.getState().templates).toEqual([template(), template('user_other')]);
    expect(store.getState().removedTemplates).toEqual([]);
    store.getState().remove('user_other');
    expect(JSON.parse(source.getItem(TEMPLATE_LIBRARY_KEY)!)).toEqual({ templates: [template()], removedTemplates: [template('user_other')] });
  });

  it('keeps an applied layout and photos intact while hiding its embedded copy across restarts', () => {
    const source = storage(), store = createTemplateLibraryStore(source), definition = template();
    const project = createProject();
    project.templates[definition.id] = structuredClone(definition);
    project.pages[0].templateId = definition.id;
    project.pages[0].frames[0].imageAssetId = 'photo_in_use';
    project.pages[0].frames[0].transform.zoom = 1.8;
    project.pages[0].frames[0].transform.rotation = 12;
    store.getState().save(definition);
    const savedProject = JSON.stringify(project);
    store.getState().remove(definition.id);
    expect(JSON.stringify(project)).toBe(savedProject);
    expect(getPersonalTemplates(project.templates, store.getState().templates, store.getState().removedTemplates)).toEqual([]);
    const reopened = JSON.parse(savedProject), restarted = createTemplateLibraryStore(source).getState();
    expect(getPersonalTemplates(reopened.templates, restarted.templates, restarted.removedTemplates)).toEqual([]);
    expect(reopened.templates[definition.id]).toEqual(definition);
    restarted.restore(definition.id);
    expect(getPersonalTemplates(project.templates, createTemplateLibraryStore(source).getState().templates, [])).toEqual([definition]);
    expect(JSON.stringify(project)).toBe(savedProject);
  });

  it('can remove and recover a custom layout found only inside the project', () => {
    const source = storage(), store = createTemplateLibraryStore(source), embedded = template('user_embedded');
    const projectTemplates = { [embedded.id]: embedded };
    store.getState().remove(embedded.id, embedded);
    embedded.name = 'changed later'; embedded.root = { kind: 'leaf', slotId: 'later' };
    const restarted = createTemplateLibraryStore(source).getState();
    expect(restarted.templates).toEqual([]);
    expect(restarted.removedTemplates).toEqual([template('user_embedded')]);
    expect(getPersonalTemplates(projectTemplates, restarted.templates, restarted.removedTemplates)).toEqual([]);
    restarted.restore(embedded.id);
    expect(createTemplateLibraryStore(source).getState().templates).toEqual([template('user_embedded')]);
  });

  it('saving the same ID restores visibility and keeps the newly saved geometry', () => {
    const source = storage(), store = createTemplateLibraryStore(source);
    store.getState().save(template());
    store.getState().remove(template().id);
    const edited = template(); edited.name = '更新的布局';
    if (edited.root.kind === 'free') edited.root.frames[0].rect.height = 0.25;
    store.getState().save(edited);
    const restarted = createTemplateLibraryStore(source).getState();
    expect(restarted.templates).toEqual([edited]);
    expect(restarted.removedTemplates).toEqual([]);
  });

  it('does not remove basic layouts, unknown IDs, or mismatched embedded IDs', () => {
    const source = storage(), store = createTemplateLibraryStore(source);
    store.getState().save(template());
    const before = source.getItem(TEMPLATE_LIBRARY_KEY);
    store.getState().remove('single', BUILTIN_TEMPLATES.single);
    store.getState().remove('single', { ...template(), id: 'single' });
    store.getState().remove('missing');
    store.getState().remove('other', template());
    store.getState().restore('missing');
    expect(source.getItem(TEMPLATE_LIBRARY_KEY)).toBe(before);
    expect(store.getState().templates).toEqual([template()]);
    expect(store.getState().removedTemplates).toEqual([]);
  });

  it('reports deletion and recovery write failures without changing either collection', () => {
    const source = storage(JSON.stringify([template()]));
    const store = createTemplateLibraryStore({ getItem: source.getItem, setItem: () => { throw new Error('disk full'); } });
    const active = store.getState().templates, removed = store.getState().removedTemplates;
    expect(() => store.getState().remove(template().id)).toThrow(/模板删除失败.*本机存储/);
    expect(store.getState().templates).toBe(active);
    expect(store.getState().removedTemplates).toBe(removed);
    expect(readTemplateLibrary(source)).toEqual([template()]);
    const deletedSource = storage(JSON.stringify({ templates: [], removedTemplates: [template()] }));
    const recovery = createTemplateLibraryStore({ getItem: deletedSource.getItem, setItem: () => { throw new Error('disk full'); } });
    const original = recovery.getState();
    expect(() => recovery.getState().restore(template().id)).toThrow(/模板恢复失败.*本机存储/);
    expect(recovery.getState().templates).toBe(original.templates);
    expect(recovery.getState().removedTemplates).toBe(original.removedTemplates);
    expect(createTemplateLibraryStore(deletedSource).getState().removedTemplates).toEqual([template()]);
  });

  it('makes repeated removal a no-op and permits recovery by saving after a full active library', () => {
    const source = storage(), store = createTemplateLibraryStore(source);
    const definitions = Array.from({ length: 256 }, (_, index) => template(`user_${index}`));
    definitions.forEach(definition => store.getState().save(definition));
    store.getState().remove('user_0');
    const deleted = store.getState().removedTemplates;
    store.getState().remove('user_0');
    expect(store.getState().removedTemplates).toBe(deleted);
    store.getState().save(template('user_added'));
    expect(() => store.getState().restore('user_0')).toThrow(/最多保存 256/);
    expect(store.getState().removedTemplates).toEqual([template('user_0')]);
    store.getState().remove('user_added');
    store.getState().restore('user_0');
    expect(store.getState().templates).toHaveLength(256);
    expect(store.getState().removedTemplates).toEqual([template('user_added')]);
  });

  it('falls back safely for corrupt storage and invalid or duplicated layouts', () => {
    const valid = template();
    const bad = [
      'not json', '{}', JSON.stringify([valid, valid]),
      JSON.stringify([{ ...valid, root: { kind: 'leaf', slotId: 'a' } }]),
      JSON.stringify([{ ...valid, slotOrder: ['a', 'a'] }]),
      JSON.stringify([{ ...valid, originalPath: '/private/photo.jpg' }]),
      JSON.stringify([{ ...valid, root: { kind: 'free', frames: [{ slotId: 'a', rect: { x: 0.9, y: 0, width: 0.2, height: 1 } }] }, slotOrder: ['a'] }]),
      JSON.stringify({ templates: [valid], removedTemplates: [valid] }),
      JSON.stringify({ templates: [], removedTemplates: [{ ...valid, originalPath: '/private/photo.jpg' }] }),
      JSON.stringify({ templates: [], removedTemplates: [valid, valid] }),
      JSON.stringify({ templates: [valid], removedTemplates: [], extra: 'unknown' }),
    ];
    bad.forEach(raw => expect(readTemplateLibrary(storage(raw))).toEqual([]));
  });

  it('rejects unsafe save values without corrupting the existing library', () => {
    const store = createTemplateLibraryStore(storage()); store.getState().save(template());
    const original = store.getState().templates;
    for (const value of [{ ...template(), name: ' ' }, { ...template(), name: 'x'.repeat(201) }, { ...template(), id: '__proto__' }, { ...template(), defaults: { columns: [1] } }, { ...template(), root: { kind: 'free', frames: [{ slotId: 'a', rect: { x: 0, y: 0, width: NaN, height: 1 } }] }, slotOrder: ['a'] }]) {
      expect(() => store.getState().save(value as TemplateDefinition)).toThrow();
      expect(store.getState().templates).toBe(original);
    }
    expect(() => store.getState().save({ ...template(), id: 'single' })).toThrow();
    expect(() => store.getState().save({ ...template(), category: '2 张' })).toThrow();
  });

  it('reports blocked storage without changing or pretending to save the library', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const store = createTemplateLibraryStore(blocked);
    const original = store.getState().templates;
    expect(original).toEqual([]);
    expect(() => store.getState().save(template())).toThrow(/模板保存失败.*本机存储/);
    expect(store.getState().templates).toBe(original);
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked accessor'); } });
      const browserStore = createTemplateLibraryStore();
      expect(() => browserStore.getState().save(template())).toThrow(/模板保存失败/);
      expect(browserStore.getState().templates).toEqual([]);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('rejects duplicate slots and layouts exceeding 64 frames', () => {
    const store = createTemplateLibraryStore(storage());
    const frames = Array.from({ length: 65 }, (_, index) => ({ slotId: `slot${index}`, rect: { x: 0, y: 0, width: 1, height: 1 } }));
    expect(() => store.getState().save({ ...template(), root: { kind: 'free', frames }, slotOrder: frames.map(frame => frame.slotId) })).toThrow();
    expect(() => store.getState().save({ ...template(), root: { kind: 'free', frames: [frames[0], frames[0]] }, slotOrder: ['slot0', 'slot0'] })).toThrow();
    expect(store.getState().templates).toEqual([]);
  });
});
