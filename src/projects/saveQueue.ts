import type { Project } from '../core/types';
import type { LibraryDocument, LibraryKind, SaveLibraryRequest } from './library';

/** Mutable identity belongs to one workspace session, never whichever project
 * happens to be visible when a queued filesystem operation completes. */
export interface SaveTarget { projectId: string; kind: LibraryKind; libraryId: string | null; revision: number | null; document: LibraryDocument | null }
export interface SaveSnapshot { project: Project; editorRevision: number; editorState: Record<string, unknown> }
export class ProjectSaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly write: (request: SaveLibraryRequest) => Promise<LibraryDocument>) {}
  save(target: SaveTarget, snapshot: SaveSnapshot): Promise<LibraryDocument> {
    if (snapshot.project.id !== target.projectId) return Promise.reject(new Error('保存目标与作品身份不一致'));
    const immutable = structuredClone(snapshot);
    const work = this.tail.catch(() => {}).then(async () => {
      const result = await this.write({ project: immutable.project, editorState: immutable.editorState, kind: target.kind, libraryId: target.libraryId, expectedRevision: target.revision });
      if (result.project.id !== target.projectId || result.entry.kind !== target.kind) throw new Error('保存结果与当前保存目标不一致');
      target.libraryId = result.entry.id; target.revision = result.entry.revision; target.document = result;
      return result;
    });
    this.tail = work;
    return work;
  }
  async flush(): Promise<void> { await this.tail; }
}
