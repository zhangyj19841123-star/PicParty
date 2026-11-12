import type { Frame, FrameRef } from '../core/types';
import type { EditorState } from '../state/editorStore';

const sameFrame = (a: FrameRef, b: FrameRef) => a.pageId === b.pageId && a.frameId === b.frameId;

/** Photo contents can move between any placed frames, regardless of template slots. */
export function photoFrameDropTarget(source: FrameRef, hit: FrameRef | null, photoTransform: FrameRef | null): FrameRef | null {
  return photoTransform || !hit || sameFrame(source, hit) ? null : hit;
}

export interface PhotoFrameDropSnapshot {
  source: FrameRef;
  frame: Pick<Frame, 'imageAssetId' | 'transform'>;
  transaction: EditorState['transaction'];
}

/** Finish inside the pointer's existing transaction; its caller commits once after
 * releasing capture. A selected photo may already have a temporary crop pan, which
 * must not become part of the photo carried to the destination frame. */
export function finishPhotoFrameDrop(getEditor: () => EditorState, snapshot: PhotoFrameDropSnapshot, hit: FrameRef | null): boolean {
  const state = getEditor(), destination = photoFrameDropTarget(snapshot.source, hit, state.photoTransform);
  if (!destination || !snapshot.transaction || state.transaction !== snapshot.transaction || !snapshot.frame.imageAssetId) return false;
  const source = state.project.pages.find(page => page.id === snapshot.source.pageId)?.frames.find(frame => frame.id === snapshot.source.frameId);
  const target = state.project.pages.find(page => page.id === destination.pageId)?.frames.find(frame => frame.id === destination.frameId);
  if (!source || !target || source.imageAssetId !== snapshot.frame.imageAssetId) return false;
  state.updateTransform(snapshot.source, structuredClone(snapshot.frame.transform));
  state.swapFrames(snapshot.source, destination);
  return true;
}
