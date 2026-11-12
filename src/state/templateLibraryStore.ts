import { create } from 'zustand';
import type { TemplateDefinition } from '../core/types';
import { normalizedFrameRect } from '../core/freeLayout';
import { isPersonalTemplate } from '../core/personalTemplates';

export const TEMPLATE_LIBRARY_KEY = 'frame-studio.template-library.v1';
export type TemplateLibraryStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface TemplateLibraryState {
  templates: TemplateDefinition[];
  removedTemplates: TemplateDefinition[];
  save(template: TemplateDefinition): void;
  remove(id: string, embeddedTemplate?: TemplateDefinition): void;
  restore(id: string): void;
}
const fail = (): never => { throw new Error('自定义模板格式无效'); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
};
const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)
    || ['__proto__', 'prototype', 'constructor'].includes(value)) return fail();
  return value;
};
const text = (value: unknown, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail();
  return value.trim();
};
const keys = (value: Record<string, unknown>, allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) fail(); };

/** The library persists only reusable geometry, never page/photo metadata. */
export function validateLibraryTemplate(value: unknown): TemplateDefinition {
  const template = object(value);
  keys(template, ['id', 'version', 'name', 'category', 'root', 'defaults', 'slotOrder']);
  const id = identifier(template.id), name = text(template.name, 200), category = text(template.category, 200);
  if (!Number.isSafeInteger(template.version) || Number(template.version) < 1) fail();
  const defaults = object(template.defaults); if (Object.keys(defaults).length) fail();
  const root = object(template.root); keys(root, ['kind', 'frames']);
  if (root.kind !== 'free' || !Array.isArray(root.frames) || !root.frames.length || root.frames.length > 64) fail();
  const frames = (root.frames as unknown[]).map(value => {
    const frame = object(value); keys(frame, ['slotId', 'rect']);
    const rect = object(frame.rect); keys(rect, ['x', 'y', 'width', 'height']);
    return { slotId: identifier(frame.slotId), rect: normalizedFrameRect(rect) };
  });
  const slotIds = new Set(frames.map(frame => frame.slotId));
  if (slotIds.size !== frames.length || !Array.isArray(template.slotOrder) || template.slotOrder.length !== frames.length) fail();
  const slotOrder = (template.slotOrder as unknown[]).map(identifier);
  if (new Set(slotOrder).size !== slotIds.size || slotOrder.some(slot => !slotIds.has(slot))) fail();
  const validated: TemplateDefinition = { id, version: Number(template.version), name, category, root: { kind: 'free', frames }, defaults: {}, slotOrder };
  if (!isPersonalTemplate(validated)) fail();
  return validated;
}

interface LibrarySnapshot { templates: TemplateDefinition[]; removedTemplates: TemplateDefinition[] }

function readLibrarySnapshot(storage?: TemplateLibraryStorage): LibrarySnapshot {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(TEMPLATE_LIBRARY_KEY);
    if (!raw) return { templates: [], removedTemplates: [] };
    const data: unknown = JSON.parse(raw);
    // v1 originally stored a plain array. Upgrade it on the next successful write.
    const snapshot = Array.isArray(data) ? { templates: data, removedTemplates: [] } : object(data);
    keys(snapshot, ['templates', 'removedTemplates']);
    if (!Array.isArray(snapshot.templates) || snapshot.templates.length > 256 || !Array.isArray(snapshot.removedTemplates)) fail();
    const templates = (snapshot.templates as unknown[]).map(validateLibraryTemplate);
    const removedTemplates = (snapshot.removedTemplates as unknown[]).map(validateLibraryTemplate);
    const all = [...templates, ...removedTemplates];
    if (new Set(all.map(template => template.id)).size !== all.length) fail();
    return { templates, removedTemplates };
  } catch { return { templates: [], removedTemplates: [] }; }
}

export function readTemplateLibrary(storage?: TemplateLibraryStorage): TemplateDefinition[] {
  return readLibrarySnapshot(storage).templates;
}

export const createTemplateLibraryStore = (storage?: TemplateLibraryStorage) => create<TemplateLibraryState>((set, get) => {
  const persist = (snapshot: LibrarySnapshot, operation: '保存' | '删除' | '恢复') => {
    try {
      // A missing browser storage API permits an in-memory Node session. An
      // available API must finish writing before we claim the content was saved.
      const source = storage ?? globalThis.localStorage;
      source?.setItem(TEMPLATE_LIBRARY_KEY, JSON.stringify(snapshot));
    } catch { throw new Error(`模板${operation}失败：无法写入本机存储，请稍后重试。`); }
    set(snapshot);
  };
  return {
    ...readLibrarySnapshot(storage),
    save: value => {
      const template = validateLibraryTemplate(value);
      const { templates, removedTemplates } = get();
      const found = templates.findIndex(item => item.id === template.id);
      if (found < 0 && templates.length >= 256) throw new Error('自定义模板最多保存 256 个');
      persist({
        templates: found < 0 ? [...templates, template] : templates.map((item, index) => index === found ? template : item),
        removedTemplates: removedTemplates.filter(item => item.id !== template.id),
      }, '保存');
    },
    remove: (id, embeddedTemplate) => {
      const { templates, removedTemplates } = get();
      if (removedTemplates.some(template => template.id === id)) return;
      const candidate = templates.find(template => template.id === id) ?? embeddedTemplate;
      if (!candidate || candidate.id !== id || !isPersonalTemplate(candidate)) return;
      const template = validateLibraryTemplate(candidate);
      persist({ templates: templates.filter(item => item.id !== id), removedTemplates: [...removedTemplates, template] }, '删除');
    },
    restore: id => {
      const { templates, removedTemplates } = get();
      const template = removedTemplates.find(item => item.id === id);
      if (!template) return;
      if (templates.length >= 256) throw new Error('自定义模板最多保存 256 个，请先删除其他模板再恢复。');
      persist({ templates: [...templates, template], removedTemplates: removedTemplates.filter(item => item.id !== id) }, '恢复');
    },
  };
});

export const useTemplateLibraryStore = createTemplateLibraryStore();
