import { describe, expect, it } from 'vitest';
import { createPage, createProject } from '../core/templates';
import { exportPageIds } from './exportSelection';

describe('export page selection', () => {
  const project = createProject({ canvasSizing: 'fixed' });
  project.pages.push(createPage('split-y', project.templates, project.document), createPage('split-y', project.templates, project.document));
  const ids = project.pages.map(page => page.id);

  it('exports only the checked pages in document order and never substitutes the active page', () => {
    expect(exportPageIds(project, 'selected', ids[1], [ids[2], 'deleted', ids[0], ids[2]])).toEqual([ids[0], ids[2]]);
    expect(exportPageIds(project, 'selected', ids[1], [])).toEqual([]);
  });

  it('keeps current/all scopes distinct from export checks and excludes a deleted current page', () => {
    expect(exportPageIds(project, 'current', ids[1], [ids[0], ids[2]])).toEqual([ids[1]]);
    expect(exportPageIds(project, 'all', ids[1], [])).toEqual(ids);
    expect(exportPageIds(project, 'current', 'deleted', ids)).toEqual([]);
  });

  it('captures a fresh list whose target cannot change while an export awaits file selection', () => {
    const selected = [ids[0], ids[2]], frozen = exportPageIds(project, 'selected', ids[1], selected);
    selected.splice(0, selected.length, ids[1]);
    expect(frozen).toEqual([ids[0], ids[2]]);
    expect(exportPageIds(project, 'selected', ids[1], selected)).toEqual([ids[1]]);
  });

  it('exports the sole page without requiring checks or an active page for any scope', () => {
    const onePage = { pages: [project.pages[1]] };
    for (const scope of ['selected', 'all', 'current'] as const) {
      expect(exportPageIds(onePage, scope, 'deleted', [])).toEqual([ids[1]]);
      expect(exportPageIds(onePage, scope, ids[0], [ids[0]])).toEqual([ids[1]]);
    }
  });

  it('does not produce an export target for an empty project in any scope', () => {
    for (const scope of ['selected', 'all', 'current'] as const) {
      expect(exportPageIds({ pages: [] }, scope, ids[0], ids)).toEqual([]);
    }
  });

  it('recomputes the single-page exception when pages are added or removed without falling back in a multi-page project', () => {
    const changing = { pages: [project.pages[0]] };
    expect(exportPageIds(changing, 'selected', ids[0], [])).toEqual([ids[0]]);
    changing.pages.push(project.pages[1]);
    expect(exportPageIds(changing, 'selected', ids[0], [])).toEqual([]);
    expect(exportPageIds(changing, 'current', ids[1], [])).toEqual([ids[1]]);
    expect(exportPageIds(changing, 'all', ids[0], [])).toEqual([ids[0], ids[1]]);
    changing.pages.splice(0, 1);
    expect(exportPageIds(changing, 'selected', ids[0], [])).toEqual([ids[1]]);
  });
});
