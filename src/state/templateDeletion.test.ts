import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore } from './editorStore';
import { createTemplateLibraryStore, useTemplateLibraryStore, type TemplateLibraryStorage } from './templateLibraryStore';
import { getPersonalTemplates } from '../core/personalTemplates';
import { BUILTIN_TEMPLATES, createPage, createProject } from '../core/templates';
import type { DocumentSize, ImageAsset, Page, TemplateDefinition } from '../core/types';

vi.mock('../core/engine', () => ({ geometry: () => ({
  layout: (_page: Page, document: DocumentSize, template: TemplateDefinition) => {
    if (template.root.kind !== 'free') throw new Error('These integration tests resolve independent custom frames only');
    return { frames: template.root.frames.map(({ slotId, rect }) => ({ slotId, rect: {
      x: rect.x * document.width, y: rect.y * document.height,
      width: rect.width * document.width, height: rect.height * document.height,
    } })), handles: [] };
  },
}) }));

const template = (id = 'user_deletion'): TemplateDefinition => ({ id, version: 1, name: '上满下留白 · 自定义', category: '自定义', defaults: {},
  root: { kind: 'free', frames: [
    { slotId: 'a', rect: { x: 0, y: 0, width: 1, height: 0.6 } },
    { slotId: 'b', rect: { x: 0.16, y: 0.68, width: 0.68, height: 0.24 } },
  ] }, slotOrder: ['a', 'b'] });
const asset = (id: string): ImageAsset => ({ id, originalPath: `/photos/${id}.jpg`, fileName: `${id}.jpg`, width: 3000, height: 4500,
  rawWidth: 3000, rawHeight: 4500, orientation: 1, format: 'jpeg', fingerprint: id, icc: null });
const storage = (): TemplateLibraryStorage => {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
};

let originalLibrary = useTemplateLibraryStore.getState();
let unsubscribe: (() => void) | undefined;
beforeEach(() => { originalLibrary = useTemplateLibraryStore.getState(); });
afterEach(() => { unsubscribe?.(); unsubscribe = undefined; useTemplateLibraryStore.setState(originalLibrary, true); });

/** Editor lookups use the app-wide hook. Mirror a real independently persisted
 * library into that entry point, rather than replacing deletion with a mock. */
const bindLibrary = (source: TemplateLibraryStorage) => {
  unsubscribe?.();
  const library = createTemplateLibraryStore(source);
  useTemplateLibraryStore.setState(library.getState(), true);
  unsubscribe = library.subscribe(state => useTemplateLibraryStore.setState(state, true));
  return library;
};
const personal = (editor: ReturnType<typeof createEditorStore>) => {
  const library = useTemplateLibraryStore.getState();
  return getPersonalTemplates(editor.getState().project.templates, library.templates, library.removedTemplates);
};

describe('custom template deletion with live editor projects', () => {
  it.each([false, true])('retains every page, photo, edit and editor state while deleting a library layout (dirty=%s)', dirty => {
    const source = storage(), library = bindLibrary(source), definition = template();
    library.getState().save(definition);
    const editor = createEditorStore(createProject({ canvasSizing: 'fixed' }));
    const pageId = editor.getState().activePageId;
    editor.getState().assignAssets([asset('portrait'), asset('detail')]);
    editor.getState().applyTemplate([pageId], definition.id);
    const ref = { pageId, frameId: editor.getState().project.pages[0].frames[0].id };
    editor.getState().updateTransform(ref, { zoom: 1.7, rotation: 14, focusX: 0.31,
      adjustments: { exposure: 0.8, temperature: 19, shadows: 24, saturation: -17 } });
    editor.getState().updatePage([pageId], { background: '#ebe8df' });
    editor.getState().assignBackgroundAsset(asset('paper'), pageId);
    editor.getState().updateBackgroundImage(pageId, { opacity: 0.36, transform: { zoom: 1.4, rotation: -6 } });
    editor.getState().updateFrameRect(ref, { x: 0.02, y: 0.03, width: 0.96, height: 0.56 });
    const otherPageId = editor.getState().addPage('single');
    editor.getState().setSelectedPageIds([pageId, otherPageId]);
    editor.getState().setWorkspaceMode(2, { onlySelected: true });
    editor.getState().setSelectedFrame(ref);
    editor.getState().setFrameEditing(true);
    editor.getState().markSaved(editor.getState().revision, '/projects/in-progress.collage');
    if (dirty) editor.getState().updateTransform(ref, { zoom: 2.1 });
    editor.getState().updateTransform(ref, { zoom: 2.6 });
    editor.getState().undo(); // Also protect a nonempty redo stack.
    const before = editor.getState(), bytes = JSON.stringify(before.project);
    expect(before.revision !== before.savedRevision).toBe(dirty);
    expect(before.redoCount).toBe(1);

    library.getState().remove(definition.id);

    // A library action must not even install a new editor session object.
    expect(editor.getState()).toBe(before);
    expect(JSON.stringify(editor.getState().project)).toBe(bytes);
    expect(editor.getState().project.templates[definition.id]).toEqual(definition);
    expect(editor.getState().project.pages[0].frames.map(frame => frame.imageAssetId)).toEqual(['portrait', 'detail']);
    expect(editor.getState().project.pages[0].backgroundImage).toMatchObject({ imageAssetId: 'paper', opacity: 0.36 });
    expect(personal(editor)).toEqual([]);
    expect(createTemplateLibraryStore(source).getState().removedTemplates).toEqual([definition]);
  });

  it('keeps an embedded-only layout usable by its saved pages without resurrecting it on reopen, undo or redo', () => {
    const source = storage(), library = bindLibrary(source), definition = template('user_embedded_only');
    const project = createProject({ canvasSizing: 'fixed' });
    project.templates[definition.id] = structuredClone(definition);
    project.pages = [createPage(definition.id, project.templates, project.document)];
    const editor = createEditorStore(project), pageId = editor.getState().activePageId;
    editor.getState().assignAssets([asset('portrait'), asset('detail')]);
    editor.getState().updatePage([pageId], { background: '#f0eee9' });
    const before = editor.getState(), saved = structuredClone(before.project);

    library.getState().remove(definition.id, before.project.templates[definition.id]);
    expect(editor.getState()).toBe(before);
    expect(personal(editor)).toEqual([]);
    editor.getState().undo();
    expect(editor.getState().project.pages[0].templateId).toBe(definition.id);
    expect(personal(editor)).toEqual([]);
    editor.getState().redo();
    expect(editor.getState().project).toEqual(saved);
    expect(personal(editor)).toEqual([]);

    bindLibrary(source); // Simulate a new app session with the saved project.
    const reopened = createEditorStore(JSON.parse(JSON.stringify(saved)));
    expect(personal(reopened)).toEqual([]);
    expect(reopened.getState().project.templates[definition.id]).toEqual(definition);
    expect(reopened.getState().project.pages[0].frames.map(frame => frame.imageAssetId)).toEqual(['portrait', 'detail']);
    const copyId = reopened.getState().duplicatePages([pageId])[0];
    expect(reopened.getState().project.pages.find(page => page.id === copyId)?.templateId).toBe(definition.id);
    expect(personal(reopened)).toEqual([]);
  });

  it('recovers a layout without changing existing work and makes it available to a separate project', () => {
    const source = storage(), library = bindLibrary(source), definition = template();
    library.getState().save(definition);
    const editor = createEditorStore(createProject({ canvasSizing: 'fixed' }));
    editor.getState().assignAssets([asset('portrait'), asset('detail')]);
    editor.getState().applyTemplate([editor.getState().activePageId], definition.id);
    editor.getState().updatePage([editor.getState().activePageId], { background: '#ddd8cc' });
    library.getState().remove(definition.id);
    const before = editor.getState();

    library.getState().restore(definition.id);
    expect(editor.getState()).toBe(before);
    expect(personal(editor)).toEqual([definition]);

    const separate = createEditorStore(createProject({ canvasSizing: 'fixed' }));
    separate.getState().assignAssets([asset('new-portrait'), asset('new-detail')]);
    separate.getState().applyTemplate([separate.getState().activePageId], definition.id);
    expect(separate.getState().project.pages[0].templateId).toBe(definition.id);
    expect(separate.getState().project.pages[0].frames.map(frame => frame.imageAssetId)).toEqual(['new-portrait', 'new-detail']);
    const newPageId = separate.getState().addPage(definition.id);
    const newPage = separate.getState().project.pages.find(page => page.id === newPageId)!;
    expect(newPage.frames.map(frame => frame.slotId)).toEqual(definition.slotOrder);
    expect(newPage.frames.every(frame => frame.imageAssetId === null)).toBe(true);
    expect(separate.getState().project.templates[definition.id]).toEqual(definition);
    expect(editor.getState()).toBe(before);
    expect(createTemplateLibraryStore(source).getState().removedTemplates).toEqual([]);
  });

  it('cannot delete built-in layouts or replace their definitions with custom impostors', () => {
    const library = bindLibrary(storage()), editor = createEditorStore(createProject());
    const before = editor.getState(), builtins = JSON.stringify(BUILTIN_TEMPLATES);
    for (const definition of Object.values(BUILTIN_TEMPLATES)) {
      library.getState().remove(definition.id, definition);
      library.getState().remove(definition.id, { ...template(), id: definition.id });
    }
    expect(editor.getState()).toBe(before);
    expect(JSON.stringify(BUILTIN_TEMPLATES)).toBe(builtins);
    expect(library.getState().templates).toEqual([]);
    expect(library.getState().removedTemplates).toEqual([]);
  });
});
