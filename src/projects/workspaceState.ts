import type { EditorState } from '../state/editorStore';
import type { ProjectOutputSettings } from '../core/types';
import { isWorkspacePageCount } from '../core/workspaceModes';
import { normalizeWatermarkPreset } from '../core/watermarkSettings';
import { clearLegacyWatermarkFixture } from '../state/watermarkPreferences';

function outputSettings(value: unknown): ProjectOutputSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const data = value as Record<string, unknown>;
  const settings: ProjectOutputSettings = {};
  if (data.export && typeof data.export === 'object') {
    const { scope, format, quality } = data.export as Record<string, unknown>;
    if ((scope === 'all' || scope === 'current' || scope === 'selected')
      && (format === 'jpg' || format === 'png')
      && typeof quality === 'number' && [80, 90, 95, 100].includes(quality)) {
      settings.export = { scope, format, quality };
    }
  }
  if (data.watermark && typeof data.watermark === 'object' && !Array.isArray(data.watermark)) {
    settings.watermark = clearLegacyWatermarkFixture(normalizeWatermarkPreset(data.watermark));
  }
  return settings;
}

export function captureWorkspace(state: EditorState): Record<string, unknown> {
  return { version: 1, activePageId: state.activePageId, selectedPageIds: [...state.selectedPageIds], visiblePageIds: [...state.visiblePageIds], workspaceMode: state.workspaceMode, previousMode: state.previousMode, workspaceSelectionOnly: state.workspaceSelectionOnly, viewZoom: state.viewZoom, selectedFrame: state.selectedFrame, editingFrame: state.editingFrame, frameEditing: state.frameEditing, backgroundEditing: state.backgroundEditing, outputSettings: state.outputSettings };
}
export function restoredWorkspace(state: EditorState, value: Record<string, unknown> | null): Partial<EditorState> {
  if (!value || value.version !== 1) return {};
  const ids = state.project.pages.map(p => p.id), list = (input: unknown) => Array.isArray(input) ? [...new Set(input.filter((id): id is string => typeof id === 'string' && ids.includes(id)))] : [];
  const previousMode = typeof value.previousMode === 'number' && isWorkspacePageCount(value.previousMode) ? value.previousMode : 1;
  const workspaceMode = value.workspaceMode === 'overview' || typeof value.workspaceMode === 'number' && isWorkspacePageCount(value.workspaceMode) ? value.workspaceMode : previousMode;
  const capacity = workspaceMode === 'overview' ? previousMode : workspaceMode;
  const activePageId = typeof value.activePageId === 'string' && ids.includes(value.activePageId) ? value.activePageId : ids[0];
  const visiblePageIds = list(value.visiblePageIds).slice(0, capacity); if (!visiblePageIds.length) visiblePageIds.push(activePageId);
  const frame = (input: unknown) => { if (!input || typeof input !== 'object') return null; const ref = input as {pageId?:unknown;frameId?:unknown}; if (typeof ref.pageId !== 'string' || typeof ref.frameId !== 'string') return null; return state.project.pages.find(p => p.id === ref.pageId)?.frames.some(f => f.id === ref.frameId) ? {pageId:ref.pageId, frameId:ref.frameId} : null; };
  const selectedFrame = frame(value.selectedFrame), frameEditing = value.frameEditing === true && Boolean(selectedFrame), backgroundEditing = !frameEditing && value.backgroundEditing === true && Boolean(state.project.pages.find(p => p.id === activePageId)?.backgroundImage);
  return { activePageId: workspaceMode !== 'overview' && !visiblePageIds.includes(activePageId) ? visiblePageIds[0] : activePageId, selectedPageIds: list(value.selectedPageIds), visiblePageIds, workspaceMode, previousMode, workspaceSelectionOnly: value.workspaceSelectionOnly === true, viewZoom: value.viewZoom === 'fit' ? 'fit' : typeof value.viewZoom === 'number' && Number.isFinite(value.viewZoom) && value.viewZoom >= 0.001 && value.viewZoom <= 2 ? value.viewZoom : 'fit', selectedFrame, editingFrame: frameEditing || backgroundEditing ? null : frame(value.editingFrame), frameEditing, backgroundEditing, photoTransform: null, outputSettings: outputSettings(value.outputSettings) };
}
