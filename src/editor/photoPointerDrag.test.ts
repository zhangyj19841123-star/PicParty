import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../core/templates';
import { PHOTO_POINTER_DROP_EVENT, PHOTO_POINTER_HOVER_EVENT, startPhotoPointerDrag, thumbnailPhotoDragAllowed, validPhotoPointerDrop, type PhotoPointerDropDetail } from './photoPointerDrag';

const project = createProject();
project.assets.photo = { id: 'photo', originalPath: '/photo.jpg', fileName: 'photo.jpg', width: 100, height: 100, rawWidth: 100, rawHeight: 100, orientation: 1, format: 'jpeg', fingerprint: 'photo', icc: null };
const page = project.pages[0], source = page.frames[0];
source.imageAssetId = 'photo';
const detail: PhotoPointerDropDetail = { projectId: project.id, from: { pageId: page.id, frameId: source.id }, assetId: 'photo', clientX: 800, clientY: 400 };
afterEach(() => vi.unstubAllGlobals());

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  const event = new Event(type, { cancelable: true });
  // Native PointerEvent coordinates are prototype getters, not enumerable own properties.
  Object.defineProperties(event, { clientX: { get: () => x }, clientY: { get: () => y }, pointerId: { value: 1 }, button: { value: 0 }, isPrimary: { value: true } });
  return event as PointerEvent;
}

function pointerSurface() {
  const surface = Object.assign(new EventTarget(), { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  const node = () => ({ className: '', textContent: '', style: {}, classList: { add: vi.fn(), remove: vi.fn() }, setAttribute: vi.fn(), append: vi.fn(), remove: vi.fn() });
  const document = Object.assign(new EventTarget(), { createElement: node, body: node(), elementFromPoint: () => null });
  const window = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 800 });
  vi.stubGlobal('document', document); vi.stubGlobal('window', window);
  return { surface: surface as unknown as HTMLElement, window };
}

describe('thumbnail photo transfer intent', () => {
  it('separates editor photo transfers from frame and background tools while keeping overview transfers available', () => {
    for (const workspaceMode of [1, 2, 3, 4, 6, 8, 10] as const) {
      expect(thumbnailPhotoDragAllowed({ workspaceMode, frameEditing: false, backgroundEditing: false })).toBe(true);
      expect(thumbnailPhotoDragAllowed({ workspaceMode, frameEditing: true, backgroundEditing: false })).toBe(false);
      expect(thumbnailPhotoDragAllowed({ workspaceMode, frameEditing: false, backgroundEditing: true })).toBe(false);
    }
    expect(thumbnailPhotoDragAllowed({ workspaceMode: 'overview', frameEditing: true, backgroundEditing: false })).toBe(true);
    expect(thumbnailPhotoDragAllowed({ workspaceMode: 'overview', frameEditing: false, backgroundEditing: true })).toBe(true);
  });
  it('accepts a current occupied source independently of the active page or selection', () => {
    expect(validPhotoPointerDrop(detail, project)).toBe(true);
  });
  it('blocks thumbnail transfers during free transform in every page count and overview', () => {
    for (const workspaceMode of [1, 2, 3, 4, 6, 8, 10, 'overview'] as const) {
      expect(thumbnailPhotoDragAllowed({ workspaceMode, frameEditing: false, backgroundEditing: false, photoTransform: detail.from })).toBe(false);
      expect(thumbnailPhotoDragAllowed({ workspaceMode, frameEditing: false, backgroundEditing: false, photoTransform: null })).toBe(true);
    }
  });
  it('rejects drags after the source was replaced, cleared or removed', () => {
    const changed = structuredClone(project);
    changed.pages[0].frames[0].imageAssetId = null;
    expect(validPhotoPointerDrop(detail, changed)).toBe(false);
    changed.pages[0].frames.shift();
    expect(validPhotoPointerDrop(detail, changed)).toBe(false);
    changed.pages = [];
    expect(validPhotoPointerDrop(detail, changed)).toBe(false);
  });
  it('rejects a switched project, absent source asset, invalid coordinates and modal interaction', () => {
    expect(validPhotoPointerDrop({ ...detail, projectId: 'old-project' }, project)).toBe(false);
    expect(validPhotoPointerDrop(detail, { ...project, assets: {} })).toBe(false);
    expect(validPhotoPointerDrop({ ...detail, clientX: Infinity }, project)).toBe(false);
    expect(validPhotoPointerDrop({ ...detail, clientY: NaN }, project)).toBe(false);
    expect(validPhotoPointerDrop(detail, project, true)).toBe(false);
  });
  it('preserves native PointerEvent coordinates through capture and emits the release target', () => {
    const { surface, window } = pointerSurface(), drop = vi.fn();
    window.addEventListener(PHOTO_POINTER_DROP_EVENT, drop);
    startPhotoPointerDrag(pointerEvent('pointerdown', 100, 200), surface, { ...detail, label: 'photo.jpg', isValid: () => true, suppressClick: vi.fn() });
    surface.dispatchEvent(pointerEvent('pointermove', 500, 350));
    surface.dispatchEvent(pointerEvent('pointerup', 800, 400));
    expect(drop).toHaveBeenCalledOnce();
    expect((drop.mock.calls[0][0] as CustomEvent).detail).toEqual(detail);
  });
  it('keeps an ordinary thumbnail click intact and cancels a drag when the window loses focus', () => {
    const { surface, window } = pointerSurface(), drop = vi.fn(), hover = vi.fn(), suppressClick = vi.fn();
    window.addEventListener(PHOTO_POINTER_DROP_EVENT, drop); window.addEventListener(PHOTO_POINTER_HOVER_EVENT, hover);
    const options = { ...detail, label: 'photo.jpg', isValid: () => true, suppressClick };
    startPhotoPointerDrag(pointerEvent('pointerdown', 100, 200), surface, options);
    surface.dispatchEvent(pointerEvent('pointerup', 103, 203));
    expect(drop).not.toHaveBeenCalled(); expect(suppressClick).not.toHaveBeenCalled();
    startPhotoPointerDrag(pointerEvent('pointerdown', 100, 200), surface, options);
    surface.dispatchEvent(pointerEvent('pointermove', 400, 400)); window.dispatchEvent(new Event('blur'));
    surface.dispatchEvent(pointerEvent('pointerup', 800, 400));
    expect(drop).not.toHaveBeenCalled(); expect(suppressClick).toHaveBeenCalled();
    expect((hover.mock.lastCall![0] as CustomEvent).detail).toBeNull();
  });
  it('cancels a captured thumbnail transfer when the editor switches to layout or background tools', () => {
    for (const mode of ['frameEditing', 'backgroundEditing'] as const) {
      const { surface, window } = pointerSurface(), drop = vi.fn(), hover = vi.fn();
      window.addEventListener(PHOTO_POINTER_DROP_EVENT, drop); window.addEventListener(PHOTO_POINTER_HOVER_EVENT, hover);
      const state = { workspaceMode: 4 as const, frameEditing: false, backgroundEditing: false };
      startPhotoPointerDrag(pointerEvent('pointerdown', 100, 200), surface, { ...detail, label: 'photo.jpg', isValid: () => thumbnailPhotoDragAllowed(state), suppressClick: vi.fn() });
      surface.dispatchEvent(pointerEvent('pointermove', 500, 350));
      state[mode] = true;
      surface.dispatchEvent(pointerEvent('pointerup', 800, 400));
      expect(drop).not.toHaveBeenCalled();
      expect((hover.mock.lastCall![0] as CustomEvent).detail).toBeNull();
      expect(surface.releasePointerCapture).toHaveBeenCalledOnce();
    }
  });
  it('cancels an in-flight thumbnail transfer when free transform becomes active', () => {
    const { surface, window } = pointerSurface(), drop = vi.fn(), hover = vi.fn();
    window.addEventListener(PHOTO_POINTER_DROP_EVENT, drop); window.addEventListener(PHOTO_POINTER_HOVER_EVENT, hover);
    const state = { workspaceMode: 2 as const, frameEditing: false, backgroundEditing: false, photoTransform: null as PhotoPointerDropDetail['from'] | null };
    startPhotoPointerDrag(pointerEvent('pointerdown', 100, 200), surface, { ...detail, label: 'photo.jpg', isValid: () => thumbnailPhotoDragAllowed(state), suppressClick: vi.fn() });
    surface.dispatchEvent(pointerEvent('pointermove', 500, 350));
    state.photoTransform = detail.from;
    surface.dispatchEvent(pointerEvent('pointerup', 800, 400));
    expect(drop).not.toHaveBeenCalled(); expect((hover.mock.lastCall![0] as CustomEvent).detail).toBeNull();
    expect(surface.releasePointerCapture).toHaveBeenCalledOnce();
  });
});
