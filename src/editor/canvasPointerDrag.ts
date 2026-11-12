export interface CanvasPointerDragCallbacks {
  isValid(): boolean;
  move(event: PointerEvent): void;
  finish(event: PointerEvent): void;
  cancel(): void;
}

/** Own one pointer until release, even outside the Konva hit graph or viewport. */
export function startCanvasPointerDrag(event: PointerEvent, captureTarget: HTMLElement, callbacks: CanvasPointerDragCallbacks): () => void {
  const pointerId = event.pointerId;
  let ended = false;
  const cleanup = () => {
    if (ended) return false;
    ended = true;
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', finish, true);
    window.removeEventListener('pointercancel', canceled, true);
    window.removeEventListener('blur', cancel);
    captureTarget.removeEventListener('lostpointercapture', canceled);
    try { if (captureTarget.hasPointerCapture(pointerId)) captureTarget.releasePointerCapture(pointerId); } catch { /* WKWebView may already have released it. */ }
    return true;
  };
  const cancel = () => { if (cleanup()) callbacks.cancel(); };
  const canceled = (pointerEvent: PointerEvent) => { if (pointerEvent.pointerId === pointerId) cancel(); };
  const move = (pointerEvent: PointerEvent) => {
    if (ended || pointerEvent.pointerId !== pointerId) return;
    if (!callbacks.isValid()) { cancel(); return; }
    callbacks.move(pointerEvent);
  };
  const finish = (pointerEvent: PointerEvent) => {
    if (ended || pointerEvent.pointerId !== pointerId) return;
    if (!callbacks.isValid()) { cancel(); return; }
    // Mouse-up can contain the final coalesced position that never emitted a move.
    callbacks.move(pointerEvent);
    if (cleanup()) callbacks.finish(pointerEvent);
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', finish, true);
  window.addEventListener('pointercancel', canceled, true);
  window.addEventListener('blur', cancel);
  captureTarget.addEventListener('lostpointercapture', canceled);
  try { captureTarget.setPointerCapture(pointerId); } catch { /* Window listeners still finish or cancel the gesture. */ }
  return cancel;
}
