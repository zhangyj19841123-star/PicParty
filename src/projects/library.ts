import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { native } from '../platform/desktop';
import type { Project } from '../core/types';

export type LibraryKind = 'project' | 'draft';
export interface LibraryEntry { id: string; name: string; kind: LibraryKind; updatedAt: number; createdAt?: number | null; coverRevision?: number | null; deletedAt: number | null; pageCount: number; assetCount: number; revision: number }
export interface LibraryDocument { entry: LibraryEntry; project: Project; path: string; editorState: Record<string, unknown> | null; recovered: boolean }
export interface LibraryList { root: string; entries: LibraryEntry[]; errors: string[] }
export interface SaveLibraryRequest { project: Project; kind: LibraryKind; libraryId?: string | null; editorState?: Record<string, unknown> | null; expectedRevision?: number | null }
export interface ArchiveProgress { jobId: string; kind: 'export' | 'import'; state: 'running' | 'completed' | 'failed' | 'cancelled'; completed: number; total: number; message: string; path: string | null; result: LibraryDocument | null; error: string | null }
const PREVIEW_KEY = 'frame-studio-project-library-preview-v2';
const preview = (): LibraryDocument[] => { try { return JSON.parse(localStorage.getItem(PREVIEW_KEY) || '[]'); } catch { return []; } };
function writePreview(documents: LibraryDocument[]) { localStorage.setItem(PREVIEW_KEY, JSON.stringify(documents)); }
export async function listLibrary(kind: LibraryKind, includeDeleted = true): Promise<LibraryList> {
  return native ? invoke('library_list', { kind, includeDeleted }) : { root: '浏览器预览本地存储', entries: preview().filter(d => d.entry.kind === kind && (includeDeleted || !d.entry.deletedAt)).map(d => d.entry), errors: [] };
}
export async function saveLibrary(request: SaveLibraryRequest): Promise<LibraryDocument> {
  if (native) return invoke('library_save', request as unknown as Record<string, unknown>);
  const documents = preview(), old = documents.find(d => d.entry.kind === request.kind && (request.libraryId ? d.entry.id === request.libraryId : d.project.id === request.project.id));
  if (request.expectedRevision !== undefined && request.expectedRevision !== null && old && old.entry.revision !== request.expectedRevision) throw new Error('项目已被其他窗口修改，请重新打开后继续');
  const time = Date.now();
  const id = old?.entry.id ?? crypto.randomUUID(), entry: LibraryEntry = { id, kind: request.kind, name: request.project.name, updatedAt: time, createdAt: old?.entry.createdAt ?? old?.entry.updatedAt ?? time, deletedAt: null, pageCount: request.project.pages.length, assetCount: Object.keys(request.project.assets).length, revision: (old?.entry.revision ?? 0) + 1 };
  const document: LibraryDocument = { entry, project: structuredClone(request.project), path: `preview://${request.kind}/${id}`, editorState: request.editorState ?? null, recovered: false };
  writePreview([...documents.filter(d => d.entry.id !== id), document]); return document;
}
export async function openLibrary(id: string, kind: LibraryKind): Promise<LibraryDocument> {
  if (native) return invoke('library_open', { id, kind });
  const document = preview().find(d => d.entry.id === id && d.entry.kind === kind && !d.entry.deletedAt); if (!document) throw new Error('项目不存在或已移入已删除'); return structuredClone(document);
}
export async function renameLibrary(id: string, kind: LibraryKind, name: string): Promise<LibraryEntry> {
  if (native) return invoke('library_rename', { id, kind, name });
  const documents = preview(), document = documents.find(d => d.entry.id === id && d.entry.kind === kind); if (!document) throw new Error('项目不存在');
  document.project.name = name.trim() || '未命名拼图'; document.entry = { ...document.entry, name: document.project.name, updatedAt: Date.now(), revision: document.entry.revision + 1 }; writePreview(documents); return document.entry;
}
export async function duplicateLibrary(id: string, kind: LibraryKind): Promise<LibraryDocument> {
  if (native) return invoke('library_duplicate', { id, kind });
  const old = await openLibrary(id, kind); old.project.id = crypto.randomUUID(); old.project.name += ' 副本'; return saveLibrary({ project: old.project, kind, editorState: old.editorState });
}
export async function setLibraryDeleted(id: string, kind: LibraryKind, deleted: boolean): Promise<LibraryEntry> {
  if (native) return invoke('library_set_deleted', { id, kind, deleted });
  const documents = preview(), document = documents.find(d => d.entry.id === id && d.entry.kind === kind); if (!document) throw new Error('项目不存在'); document.entry.deletedAt = deleted ? Date.now() : null; document.entry.revision++; writePreview(documents); return document.entry;
}
export function revealLibrary(entry: LibraryEntry): Promise<void> {
  return invoke('library_reveal', { id: entry.id, kind: entry.kind });
}
export async function chooseArchiveOutput(name: string): Promise<string | null> {
  if (!native) throw new Error('请在 macOS 应用中打包归档');
  return save({ title: '打包完整项目归档', defaultPath: `${name.replace(/[\\/:*?"<>|]/g, '-')}_${new Date().toLocaleDateString('sv-SE')}.zip`, filters: [{ name: '完整项目归档', extensions: ['zip'] }] });
}
export async function chooseArchiveInput(): Promise<string | null> {
  if (!native) throw new Error('请在 macOS 应用中导入归档');
  const path = await open({ title: '导入完整项目归档', multiple: false, filters: [{ name: '完整项目归档', extensions: ['zip'] }] }); return typeof path === 'string' ? path : null;
}
export const startArchive = (project: Project, path: string, editorState: Record<string, unknown>) => invoke<string>('archive_start', { project, path, editorState });
export const startArchiveImport = (path: string) => invoke<string>('archive_import_start', { path });
export const archiveProgress = (jobId: string) => invoke<ArchiveProgress>('archive_progress', { jobId });
export const cancelArchive = (jobId: string) => invoke<void>('archive_cancel', { jobId });
