import type { ExportScope, Project } from '../core/types';

export type { ExportScope } from '../core/types';

/** A one-page project needs no selection; multi-page projects use the explicit scope. */
export function exportPageIds(project: Pick<Project, 'pages'>, scope: ExportScope, activePageId: string, selectedPageIds: string[]): string[] {
  if (project.pages.length === 1) return [project.pages[0].id];
  const wanted = new Set(scope === 'current' ? [activePageId] : selectedPageIds);
  return project.pages.filter(page => scope === 'all' || wanted.has(page.id)).map(page => page.id);
}
