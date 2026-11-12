import { BUILTIN_TEMPLATES } from './templates';
import type { TemplateDefinition } from './types';

/** Built-in layouts never belong to the user's editable template library. */
export const isPersonalTemplate = (template: TemplateDefinition): boolean =>
  template.category === '自定义' && !Object.hasOwn(BUILTIN_TEMPLATES, template.id);

/** Hide removed layouts without changing the snapshots needed by saved pages. */
export function getPersonalTemplates(
  projectTemplates: Record<string, TemplateDefinition>,
  libraryTemplates: TemplateDefinition[],
  removedTemplates: TemplateDefinition[],
): TemplateDefinition[] {
  const removed = new Set(removedTemplates.map(template => template.id));
  return [...new Map([
    ...Object.values(projectTemplates), ...libraryTemplates,
  ].filter(template => isPersonalTemplate(template) && !removed.has(template.id))
    .map(template => [template.id, template])).values()];
}
