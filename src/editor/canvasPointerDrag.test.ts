import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCanvasPointerDrag } from './canvasPointerDrag';

class CaptureTarget extends EventTarget {
  pointer: number | null = null;
  setPointerCapture(id: number) { this.pointer = id; }
  hasPointerCapture(id: number) { return this.pointer === id; }
  releasePointerCapture(id: number) { if (this.pointer === id) this.pointer = null; }
}
const pointerEvent = (type: string, id = 7, clientX = 0) => Object.assign(new Event(type), { pointerId: id, clientX }) as PointerEvent;
const setup = () => {
  const surface = new EventTarget(); vi.stubGlobal('window', surface);
  const capture = new CaptureTarget();
  const callbacks = { isValid: vi.fn(() => true), move: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
  const stop = startCanvasPointerDrag(pointerEvent('pointerdown'), capture as unknown as HTMLElement, callbacks);
  return { surface, capture, callbacks, stop };
};
afterEach(() => vi.unstubAllGlobals());

describe('canvas pointer ownership', () => {
  it('continues outside the hit graph and applies the final release position once', () => {
    const { surface, capture, callbacks } = setup();
    surface.dispatchEvent(pointerEvent('pointermove', 7, 42));
    surface.dispatchEvent(pointerEvent('pointerup', 7, 84));
    surface.dispatchEvent(pointerEvent('pointermove', 7, 100));
    expect(callbacks.move.mock.calls.map(([event]) => event.clientX)).toEqual([42, 84]);
    expect(callbacks.finish).toHaveBeenCalledOnce(); expect(callbacks.cancel).not.toHaveBeenCalled();
    expect(capture.pointer).toBeNull();
  });
  it('ignores another pointer without ending the active drag', () => {
    const { surface, callbacks } = setup();
    surface.dispatchEvent(pointerEvent('pointermove', 8)); surface.dispatchEvent(pointerEvent('pointerup', 8));
    expect(callbacks.move).not.toHaveBeenCalled(); expect(callbacks.finish).not.toHaveBeenCalled();
    surface.dispatchEvent(pointerEvent('pointerup')); expect(callbacks.finish).toHaveBeenCalledOnce();
  });
  it('cancels a stale mode or replaced project before applying any further motion', () => {
    const { surface, callbacks, capture } = setup(); callbacks.isValid.mockReturnValue(false);
    surface.dispatchEvent(pointerEvent('pointerup', 7, 99));
    expect(callbacks.cancel).toHaveBeenCalledOnce(); expect(callbacks.move).not.toHaveBeenCalled();
    expect(callbacks.finish).not.toHaveBeenCalled(); expect(capture.pointer).toBeNull();
  });
  it.each(['pointercancel', 'lostpointercapture'])('cancels %s without committing and cleans up listeners', type => {
    const { surface, capture, callbacks } = setup();
    (type === 'lostpointercapture' ? capture : surface).dispatchEvent(pointerEvent(type));
    surface.dispatchEvent(pointerEvent('pointerup'));
    expect(callbacks.cancel).toHaveBeenCalledOnce(); expect(callbacks.finish).not.toHaveBeenCalled();
    expect(capture.pointer).toBeNull();
  });
  it('cancels on focus loss or manual mode cleanup only once', () => {
    const { surface, callbacks, stop } = setup(); surface.dispatchEvent(new Event('blur')); stop();
    surface.dispatchEvent(pointerEvent('pointerup'));
    expect(callbacks.cancel).toHaveBeenCalledOnce(); expect(callbacks.finish).not.toHaveBeenCalled();
  });
});
