import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect as CanvasRect, Image as CanvasImage, Text as CanvasText, Line, Circle, Shape } from 'react-konva';
import type Konva from 'konva';
import type { Context } from 'konva/lib/Context';
import { Maximize2, ImagePlus, Plus } from 'lucide-react';
import type { BackgroundImage, CoverResult, Frame, FrameRef, ImageAsset, ImageTransform, Page, Rect, ResolvedLayout, SplitHandle } from '../core/types';
import { geometry } from '../core/engine';
import { useEditorStore, type EditorState } from '../state/editorStore';
import { PageExportSelection } from '../components/PageExportSelection';
import { PageTemplateAction } from '../components/PageTemplateAction';
import { useAdjustedAssetImage } from '../images/adjustments';
import { focusAfterDrag } from '../core/photoTransform';
import { dragFrameRect, frameMovementHint, type FrameResizeHandle } from './frameGeometry';
import { startCanvasPointerDrag } from './canvasPointerDrag';
import { frameControlPoints, frameEditPointerInside } from './frameInteraction';
import { beginPhotoRotation, updatePhotoRotation, photoZoomAfterDrag, photoTransformCorners, type PhotoPoint, type PhotoRotationGesture } from './photoTransformGesture';
import { PhotoTransformBar } from './PhotoTransformBar';
import { photoFrameDropTarget, finishPhotoFrameDrop } from './photoFrameDrop';
import { photoRotationHitArea, photoRotationAt, PHOTO_RESIZE_CLEARANCE } from './photoRotationTargets';
import './canvasPointerDrag.css';
import { backgroundPreview } from '../images/backgroundPreview';
import { workspaceFrameHit, workspacePageHit, workspaceViewClip, workspaceLayout, type WorkspacePageBounds } from './workspaceLayout';

export interface WorkspaceBridge { hitTest(x: number, y: number): FrameRef | null; pageHitTest(x: number, y: number): string | null; setDropTarget(target: FrameRef | null): void }
type View = WorkspacePageBounds & { page: Page; layout: ResolvedLayout };
type Drag = { kind: 'swap' | 'move'; ref: FrameRef; start: { x: number; y: number }; point: { x: number; y: number }; view: View; rect: Rect; frame: Frame; asset: ImageAsset; moved: boolean } | { kind: 'zoom'; ref: FrameRef; center: { x: number; y: number }; start: { x: number; y: number }; zoom: number } | { kind: 'rotate'; ref: FrameRef; gesture: PhotoRotationGesture } | { kind: 'background-move'; view: View; start: { x: number; y: number }; transform: ImageTransform; asset: ImageAsset } | { kind: 'background-zoom'; pageId: string; center: { x: number; y: number }; startDistance: number; zoom: number } | { kind: 'split'; view: View; handle: SplitHandle } | { kind: 'frame'; ref: FrameRef; start: { x: number; y: number }; view: View; rect: Rect; lastRect: Rect; handle: FrameResizeHandle | null; moved: boolean } | { kind: 'pan'; start: { x: number; y: number }; initial: { x: number; y: number } };
const same = (a: FrameRef | null, b: FrameRef | null) => a?.pageId === b?.pageId && a?.frameId === b?.frameId;
const rotationArrowPath = 'M -5 -9 C 9 -9 9 9 -5 9 M -5 -9 L -1 -13 M -5 -9 L -1 -5 M -5 9 L -1 5 M -5 9 L -1 13';
const rotationCursor = (corner: number) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g transform="translate(16 16) rotate(${(corner - 1) * 90})" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${rotationArrowPath}" stroke="white" stroke-width="3.5"/><path d="${rotationArrowPath}" stroke="#263b32" stroke-width="1.5"/></g></svg>`)}") 16 16, crosshair`;

function BackgroundPhoto({ background, asset, color, rect }: { background: BackgroundImage; asset?: ImageAsset; color: string; rect: Rect }) {
  const { image, error } = useAdjustedAssetImage(asset, 1024, background.transform.adjustments);
  const composed = useMemo(() => {
    if (!image) return undefined;
    try { return backgroundPreview(image, color, background.opacity); } catch { return undefined; }
  }, [image, color, background.opacity]);
  const cover = asset ? geometry().cover(rect, asset.width, asset.height, background.transform) : undefined;
  return <Group {...{ clipX: rect.x, clipY: rect.y, clipWidth: rect.width, clipHeight: rect.height }} listening={false}>
    {composed && cover && <CanvasImage image={composed} x={cover.centerX} y={cover.centerY} offsetX={cover.width / 2} offsetY={cover.height / 2} rotation={cover.rotation} width={cover.width} height={cover.height} />}
    {error && <CanvasText x={rect.x} y={rect.y + 8} width={rect.width} text="背景图片不可用 · 请重新链接" fontSize={Math.max(18, rect.width / 45)} align="center" fill="#8b716b" />}
  </Group>;
}

function Photo({ frame, asset, rect, editing, layoutEditing, scale, onDown, onDouble, onContext, selected, targeted, small, dense }: { frame: Frame; asset?: ImageAsset; rect: Rect; editing: boolean; layoutEditing: boolean; scale: number; onDown(e: Konva.KonvaEventObject<PointerEvent>): void; onDouble(): void; onContext(e: Konva.KonvaEventObject<MouseEvent>): void; selected: boolean; targeted: boolean; small: boolean; dense: boolean }) {
  const { image, error } = useAdjustedAssetImage(asset, dense ? editing || selected ? 1024 : 512 : small ? 1024 : 2048, frame.transform.adjustments);
  const cover = asset ? geometry().cover(rect, asset.width, asset.height, frame.transform) : undefined;
  const fontSize = Math.max(12, small ? 11 : 13) / scale;
  // Keep the placeholder and its fine strokes the same screen size at any zoom.
  const iconHeight = Math.min(small ? 20 : 24, rect.height * scale * 0.32, rect.width * scale * 0.4) / scale;
  const iconWidth = iconHeight * 1.25;
  const iconX = rect.x + (rect.width - iconWidth) / 2;
  const iconY = rect.y + rect.height / 2 - iconHeight * 0.75;
  return <Group>
    <Group clipX={rect.x} clipY={rect.y} clipWidth={rect.width} clipHeight={rect.height} listening={false}>
      {/* Empty frames remain transparent over lower photos, matching native export. */}
      <CanvasRect {...rect} fill={error ? '#f5e9e4' : image || !asset ? 'transparent' : '#edf0ee'} />
      {image && cover && <CanvasImage image={image} x={cover.centerX} y={cover.centerY} offsetX={cover.width / 2} offsetY={cover.height / 2} rotation={cover.rotation} width={cover.width} height={cover.height} listening={false} />}
      {!image && !asset && !error && <Group x={iconX} y={iconY}>
        <CanvasRect width={iconWidth} height={iconHeight} cornerRadius={3 / scale} stroke="#939b97" strokeWidth={1.2 / scale} />
        <Line points={[iconWidth * 0.12, iconHeight * 0.82, iconWidth * 0.38, iconHeight * 0.46, iconWidth * 0.58, iconHeight * 0.68, iconWidth * 0.72, iconHeight * 0.51, iconWidth * 0.88, iconHeight * 0.76]} stroke="#939b97" strokeWidth={1.2 / scale} lineCap="round" lineJoin="round" />
        <Circle x={iconWidth * 0.73} y={iconHeight * 0.27} radius={iconHeight * 0.07} stroke="#939b97" strokeWidth={1.2 / scale} />
      </Group>}
      {!image && (asset || error) && <CanvasText x={rect.x} y={rect.y + rect.height / 2 - fontSize * 1.5} width={rect.width} align="center" fontSize={fontSize * 2} fill={error ? '#a96950' : '#a9b3ad'} text={error ? '!' : '· · ·'} />}
      {!image && <CanvasText x={rect.x + 8 / scale} y={asset ? rect.y + rect.height / 2 + fontSize : iconY + iconHeight + 9 / scale} width={Math.max(0, rect.width - 16 / scale)} align="center" fontFamily="-apple-system, sans-serif" fontSize={fontSize} fill={asset ? '#839087' : '#939b97'} text={error ? '照片不可用 · 重新链接' : asset ? '正在载入照片' : '拖入照片'} />}
    </Group>
    <CanvasRect {...rect} fill="transparent" stroke={targeted ? '#2e785f' : layoutEditing ? selected ? '#c49a30' : '#a5afac' : editing ? '#2e785f' : selected ? '#6c9c83' : !asset ? '#c4cdc7' : undefined} strokeWidth={(editing || targeted || layoutEditing && selected ? 2 : 1) / scale} onPointerDown={onDown} onContextMenu={onContext} onPointerDblClick={onDouble} onDblClick={onDouble} onDblTap={onDouble} onMouseEnter={e => { const container = e.target.getStage()?.container(); if (container) container.style.cursor = layoutEditing ? 'move' : asset ? editing ? 'move' : 'grab' : 'pointer'; }} onMouseLeave={e => { const container = e.target.getStage()?.container(); if (container) container.style.cursor = 'default'; }} />


  </Group>;
}

function PhotoResizeControls({ rect, scale, onResize }: { rect: Rect; scale: number; onResize(e: Konva.KonvaEventObject<PointerEvent>): void }) {
  return <Group><CanvasRect {...rect} stroke="#2e785f" strokeWidth={2 / scale} listening={false} />
    {[[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]].map(([x, y], i) => <CanvasRect key={i} x={x - 3.5 / scale} y={y - 3.5 / scale} width={7 / scale} height={7 / scale} fill="#fbfcf9" stroke="#2e785f" strokeWidth={1.5 / scale} hitStrokeWidth={8 / scale} cornerRadius={1 / scale} onPointerDown={onResize} onMouseEnter={e => { e.target.getStage()!.container().style.cursor = i === 0 || i === 3 ? 'nwse-resize' : 'nesw-resize'; }} onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }} />)}
  </Group>;
}

/** These are the actual photo bounds; the yellow crop frame stays independent. */
function PhotoTransformControls({ view, cover, rect, safe, exclusions, onResize, onRotate }: { view: View; cover: CoverResult; rect: Rect; safe: Rect; exclusions: Rect[]; onResize(e: Konva.KonvaEventObject<PointerEvent>): void; onRotate(e: Konva.KonvaEventObject<PointerEvent>): void }) {
  const cursorContainer = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => {
    const container = cursorContainer.current;
    if (container) {
      container.style.cursor = 'default';
      container.closest<HTMLElement>('.canvas-workspace')?.style.removeProperty('--photo-rotation-cursor');
    }
  }, []);
  const points = photoTransformCorners(cover).map(point => ({ x: view.x + point.x * view.scale, y: view.y + point.y * view.scale }));
  const crop = { x: view.x + rect.x * view.scale, y: view.y + rect.y * view.scale, width: rect.width * view.scale, height: rect.height * view.scale };
  const area = photoRotationHitArea(points, crop, safe, exclusions);
  const trace = (context: Context, polygon: PhotoPoint[]) => {
    polygon.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
  };
  const updateCursor = (event: Konva.KonvaEventObject<Event>) => {
    const stage = event.target.getStage(), point = stage?.getPointerPosition();
    if (!stage || !point) return;
    const corner = photoRotationAt(point, area), container = stage.container();
    cursorContainer.current = container;
    if (corner === null) return;
    const cursor = rotationCursor(corner);
    container.style.cursor = cursor;
    container.closest<HTMLElement>('.canvas-workspace')?.style.setProperty('--photo-rotation-cursor', cursor);
  };
  return <Group>
    <Line points={points.flatMap(point => [point.x, point.y])} closed stroke="#2e785f" strokeWidth={1.5} listening={false} />
    {/* Invisible outer bands provide a generous hover target without adding canvas icons.
        Clip each hole separately: combining overlapping holes would make XOR islands. */}
    <Shape fill="transparent" sceneFunc={() => {}} hitFunc={(context, shape) => {
      context.save(); context.beginPath(); context.rect(area.safe.x, area.safe.y, area.safe.width, area.safe.height); context.clip();
      for (const region of area.regions) {
        context.save(); context.beginPath(); trace(context, region.outer); trace(context, region.inner); context.clip('evenodd');
        for (const excluded of area.exclusions) {
          context.beginPath(); trace(context, region.outer); context.rect(excluded.x, excluded.y, excluded.width, excluded.height); context.clip('evenodd');
        }
        for (const corner of area.resizeCorners) {
          context.beginPath(); trace(context, region.outer); context.moveTo(corner.x + PHOTO_RESIZE_CLEARANCE, corner.y); context.arc(corner.x, corner.y, PHOTO_RESIZE_CLEARANCE, 0, Math.PI * 2); context.clip('evenodd');
        }
        context.beginPath(); trace(context, region.outer); context.fillStrokeShape(shape); context.restore();
      }
      context.restore();
    }} onPointerDown={e => { updateCursor(e); onRotate(e); }} onMouseEnter={updateCursor} onMouseMove={updateCursor} onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }} />
    {/* Draw resize handles last so their hit areas always take priority over rotation. */}
    {points.map((point, index) => <CanvasRect key={index} x={point.x - 4} y={point.y - 4} width={8} height={8} fill="#fbfcf9" stroke="#2e785f" strokeWidth={1.5} hitStrokeWidth={12} onPointerDown={onResize} onMouseEnter={e => { e.target.getStage()!.container().style.cursor = index % 2 ? 'nesw-resize' : 'nwse-resize'; }} onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }} />)}
  </Group>;
}

function FrameResizeControls({ rect, scale, onResize }: { rect: Rect; scale: number; onResize(handle: FrameResizeHandle, e: Konva.KonvaEventObject<PointerEvent>): void }) {
  return <Group><CanvasRect {...rect} stroke="#c49a30" strokeWidth={2 / scale} listening={false} />
    {frameControlPoints(rect).map(({ handle, x, y }) => {
      const cursor = handle === 'n' || handle === 's' ? 'ns-resize' : handle === 'e' || handle === 'w' ? 'ew-resize' : handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize';
      return <CanvasRect key={handle} x={x - 3.5 / scale} y={y - 3.5 / scale} width={7 / scale} height={7 / scale} fill="#fffdf5" stroke="#c49a30" strokeWidth={1.3 / scale} hitStrokeWidth={8 / scale} cornerRadius={1 / scale} onPointerDown={e => onResize(handle, e)} onMouseEnter={e => { e.target.getStage()!.container().style.cursor = cursor; }} onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }} />;
    })}
  </Group>;
}

export function Workspace({ bridge, onEditExternal, onSaveTemplate }: { bridge: React.MutableRefObject<WorkspaceBridge | null>; onImport(target?: FrameRef): void; onEditExternal(ref: FrameRef): void; onSaveTemplate(pageId: string): void }) {
  const state = useEditorStore();
  const root = useRef<HTMLDivElement>(null), stage = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<Drag | null>(null);
  const pointerCleanup = useRef<(() => void) | null>(null);
  const pointerTransaction = useRef<EditorState['transaction']>(null);
  const pointerActions = useRef<{ move(event?: PointerEvent): void; finish(): void } | null>(null);
  const pointerValidity = useRef<(() => boolean) | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [target, setTarget] = useState<FrameRef | null>(null);
  const [contextMenu, setContextMenu] = useState<{ ref: FrameRef; x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const document = state.project.document;
  const cancelPointerGesture = () => {
    const transaction = pointerTransaction.current;
    drag.current = null; pointerCleanup.current = null; pointerTransaction.current = null; pointerValidity.current = null;
    if (transaction && useEditorStore.getState().transaction === transaction) useEditorStore.getState().cancelTransaction();
    root.current?.classList.remove('is-rotating');
    if (stage.current) stage.current.container().style.cursor = 'default';
    setGhost(null); setTarget(null);
  };
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement)?.closest('.photo-context-menu')) setContextMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
  }, []);
  const pages = state.visiblePageIds.map(id => state.project.pages.find(page => page.id === id)).filter((page): page is Page => Boolean(page));
  useEffect(() => {
    const observer = new ResizeObserver(entries => { const r = entries[0].contentRect; setSize({ width: r.width, height: r.height }); });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setPan({ x: 0, y: 0 }); }, [state.workspaceMode, state.activePageId, state.viewZoom]);
  useEffect(() => {
    const cancel = () => { setSpace(false); pointerCleanup.current?.(); };
    const down = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); if (event.code === 'Space' && !window.document.querySelector('[role="dialog"]') && !(event.target as HTMLElement)?.closest('input,textarea,select,button,[contenteditable]')) { event.preventDefault(); setSpace(true); } };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', cancel); pointerCleanup.current?.(); clearTimeout(wheelTimer.current); useEditorStore.getState().commitTransaction(); bridge.current = null; };
  }, []);
  useEffect(() => {
    if (pointerValidity.current && !pointerValidity.current()) pointerCleanup.current?.();
  }, [state.project.id, state.frameEditing, state.backgroundEditing, state.workspaceMode, state.visiblePageIds, state.editingFrame, state.selectedFrame, state.transaction]);
  const views = useMemo((): View[] => {
    const mode = state.workspaceMode === 'overview' ? state.previousMode : state.workspaceMode;
    const screen = workspaceLayout({ document, viewport: size, count: pages.length, mode, zoom: state.viewZoom, pan });
    return screen.views.map((view, index) => ({ ...view, page: pages[index], layout: geometry().layout(pages[index], document, state.project.templates[pages[index].templateId]) }));
  }, [state.project, state.visiblePageIds, state.workspaceMode, state.previousMode, size, state.viewZoom, pan]);
  const viewsRef = useRef(views); viewsRef.current = views;
  const viewportRef = useRef(size); viewportRef.current = size;
  useEffect(() => {
    const confirmOutside = (event: PointerEvent) => {
      const current = useEditorStore.getState();
      if (!current.frameEditing || event.button !== 0 || event.isPrimary === false) return;
      const element = event.target instanceof Element ? event.target : null;
      // Explicit mode commands and frame-menu commands decide their own next mode.
      if (element?.closest('.interaction-modes,.photo-context-menu')) return;
      const box = root.current?.getBoundingClientRect();
      const onCanvas = element && stage.current?.content.contains(element);
      if (box && onCanvas) {
        const point = { x: event.clientX - box.left, y: event.clientY - box.top };
        const currentViews = viewsRef.current, viewport = viewportRef.current;
        const topmost = workspaceFrameHit(currentViews, point, viewport);
        // F can be entered before a frame has been picked; the next frame click picks it.
        if (!current.selectedFrame && topmost) return;
        const view = currentViews.find(view => view.page.id === current.selectedFrame?.pageId);
        const frame = view?.page.frames.find(frame => frame.id === current.selectedFrame?.frameId);
        const resolved = view?.layout.frames.find(resolved => resolved.slotId === frame?.slotId);
        if (current.selectedFrame && view && resolved) {
          const screenRect = { x: view.x + resolved.rect.x * view.scale, y: view.y + resolved.rect.y * view.scale, width: resolved.rect.width * view.scale, height: resolved.rect.height * view.scale };
          if (frameEditPointerInside(current.selectedFrame, topmost, screenRect, point, workspaceViewClip(view, currentViews.length, viewport))) return;
        }
      }
      // Commit before the normal pointer/click handler runs, without swallowing its action.
      current.setFrameEditing(false);
      pointerCleanup.current?.();
    };
    window.addEventListener('pointerdown', confirmOutside, true);
    return () => window.removeEventListener('pointerdown', confirmOutside, true);
  }, []);
  useEffect(() => {
    // WKWebView emits GestureEvents for trackpad pinch; Chromium uses ctrl+wheel.
    let initial: { ref: FrameRef | null; backgroundPage?: string; zoom: number; projectId: string; transaction: EditorState['transaction'] } | null = null;
    const start = (event: Event) => {
      event.preventDefault(); const s = useEditorStore.getState(); initial = null;
      const frame = s.project.pages.find(page => page.id === s.editingFrame?.pageId)?.frames.find(frame => frame.id === s.editingFrame?.frameId);
      const background = s.project.pages.find(page => page.id === s.activePageId)?.backgroundImage;
      if (s.backgroundEditing && background) { s.beginTransaction('缩放背景图片'); initial = { ref: null, backgroundPage: s.activePageId, zoom: background.transform.zoom, projectId: s.project.id, transaction: useEditorStore.getState().transaction }; }
      else if (frame && s.editingFrame) { s.beginTransaction('缩放照片'); initial = { ref: s.editingFrame, zoom: frame.transform.zoom, projectId: s.project.id, transaction: useEditorStore.getState().transaction }; }
      else if (viewsRef.current.length === 1) initial = { ref: null, zoom: s.viewZoom === 'fit' ? viewsRef.current[0].scale : s.viewZoom, projectId: s.project.id, transaction: null };
    };
    const change = (event: Event) => {
      event.preventDefault(); if (!initial) return;
      const scale = (event as Event & { scale: number }).scale;
      if (!Number.isFinite(scale)) return;
      const s = useEditorStore.getState();
      if (initial.projectId !== s.project.id || initial.transaction && initial.transaction !== s.transaction || initial.ref && !same(initial.ref, s.editingFrame) || initial.backgroundPage && (!s.backgroundEditing || initial.backgroundPage !== s.activePageId)) { initial = null; return; }
      if (initial.backgroundPage) s.updateBackgroundImage(initial.backgroundPage, { transform: { zoom: Math.max(1, Math.min(8, initial.zoom * scale)) } });
      else if (initial.ref) s.updateTransform(initial.ref, { zoom: Math.max(1, Math.min(100, initial.zoom * scale)) });
      else s.setViewZoom(Math.max(0.001, Math.min(2, initial.zoom * scale)));
    };
    const end = (event: Event) => { event.preventDefault(); const latest = useEditorStore.getState(); if (initial?.transaction && initial.transaction === latest.transaction && !latest.photoTransform) latest.commitTransaction(); initial = null; };
    const node = root.current;
    node?.addEventListener('gesturestart', start, { passive: false }); node?.addEventListener('gesturechange', change, { passive: false }); node?.addEventListener('gestureend', end, { passive: false });
    return () => { node?.removeEventListener('gesturestart', start); node?.removeEventListener('gesturechange', change); node?.removeEventListener('gestureend', end); };
  }, []);
  const hit = (x: number, y: number): FrameRef | null => workspaceFrameHit(views, { x, y }, size);
  bridge.current = {
    hitTest: (x, y) => { const box = root.current?.getBoundingClientRect(); return box ? hit(x - box.left, y - box.top) : null; },
    pageHitTest: (x, y) => { const box = root.current?.getBoundingClientRect(); return box ? workspacePageHit(views, { x: x - box.left, y: y - box.top }, size) : null; },
    setDropTarget: value => setTarget(previous => same(previous, value) ? previous : value),
  };
  const pointer = () => stage.current?.getPointerPosition() ?? { x: 0, y: 0 };
  const preparePointerGesture = (preservePhotoTransform = false) => {
    pointerCleanup.current?.(); clearTimeout(wheelTimer.current);
    if (!preservePhotoTransform || !useEditorStore.getState().photoTransform) useEditorStore.getState().commitTransaction();
  };
  const capturePointerGesture = (event: PointerEvent) => {
    const current = drag.current, captureTarget = stage.current?.content;
    if (!current || !captureTarget) return;
    const initialState = useEditorStore.getState();
    const projectId = initialState.project.id;
    const transaction = initialState.transaction;
    pointerTransaction.current = transaction;
    const isValid = () => {
      const latest = useEditorStore.getState();
      if (drag.current !== current || latest.project.id !== projectId || latest.workspaceMode !== initialState.workspaceMode || latest.viewZoom !== initialState.viewZoom || window.document.querySelector('[role="dialog"]')
        || transaction && latest.transaction !== transaction) return false;
      if (current.kind === 'pan') return true;
      const pageId = 'ref' in current ? current.ref.pageId : 'pageId' in current ? current.pageId : current.view.page.id;
      if (!latest.visiblePageIds.includes(pageId)) return false;
      const page = latest.project.pages.find(page => page.id === pageId);
      if (!page) return false;
      if (current.kind === 'frame') return latest.frameEditing && !latest.backgroundEditing && page.frames.some(frame => frame.id === current.ref.frameId);
      if (current.kind === 'background-move' || current.kind === 'background-zoom') return latest.backgroundEditing && Boolean(page.backgroundImage);
      if (latest.frameEditing || latest.backgroundEditing) return false;
      if (current.kind === 'split') return !latest.editingFrame;
      const frame = page.frames.find(frame => frame.id === current.ref.frameId);
      if (!frame?.imageAssetId) return false;
      if (current.kind === 'swap' || current.kind === 'move') {
        if (frame.imageAssetId !== current.asset.id) return false;
        if (current.kind === 'swap') return true;
      }
      return same(latest.editingFrame, current.ref);
    };
    pointerValidity.current = isValid;
    pointerCleanup.current = startCanvasPointerDrag(event, captureTarget, {
      isValid,
      move: nativeEvent => { stage.current?.setPointersPositions(nativeEvent); pointerActions.current?.move(nativeEvent); },
      finish: nativeEvent => { stage.current?.setPointersPositions(nativeEvent); pointerActions.current?.finish(); },
      cancel: cancelPointerGesture,
    });
  };
  const beginBackground = (view: View, e: Konva.KonvaEventObject<PointerEvent>, zoom = false) => {
    if (e.evt.button !== 0 || e.evt.isPrimary === false || !view.page.backgroundImage || !useEditorStore.getState().backgroundEditing) return;
    e.cancelBubble = true; (window.document.activeElement as HTMLElement | null)?.blur();
    preparePointerGesture();
    if (space) { drag.current = { kind: 'pan', start: pointer(), initial: pan }; capturePointerGesture(e.evt); return; }
    const asset = state.project.assets[view.page.backgroundImage.imageAssetId]; if (!asset) return;
    const center = { x: view.x + view.width / 2, y: view.y + view.height / 2 }, point = pointer();
    state.beginTransaction(zoom ? '缩放背景图片' : '移动背景图片');
    drag.current = zoom
      ? { kind: 'background-zoom', pageId: view.page.id, center, startDistance: Math.max(1, Math.hypot(point.x - center.x, point.y - center.y)), zoom: view.page.backgroundImage.transform.zoom }
      : { kind: 'background-move', view, start: point, transform: structuredClone(view.page.backgroundImage.transform), asset };
    capturePointerGesture(e.evt);
  };
  const beginFrame = (view: View, frame: Frame, rect: Rect, e: Konva.KonvaEventObject<PointerEvent>, handle: FrameResizeHandle | null = null) => {
    if (e.evt.button !== 0 || e.evt.isPrimary === false || !useEditorStore.getState().frameEditing) return; e.cancelBubble = true;
    (window.document.activeElement as HTMLElement | null)?.blur();
    preparePointerGesture();
    if (space) { drag.current = { kind: 'pan', start: pointer(), initial: pan }; capturePointerGesture(e.evt); return; }
    const ref = { pageId: view.page.id, frameId: frame.id };
    state.setSelectedFrame(ref); state.beginTransaction(handle ? '调整照片框大小' : '移动照片框');
    const normalized = { x: rect.x / document.width, y: rect.y / document.height, width: rect.width / document.width, height: rect.height / document.height };
    drag.current = { kind: 'frame', ref, view, start: pointer(), rect: normalized, lastRect: normalized, handle, moved: false };
    capturePointerGesture(e.evt);
  };
  const beginPhoto = (view: View, frame: Frame, rect: Rect, e: Konva.KonvaEventObject<PointerEvent>) => {
    if (e.evt.button !== 0 || e.evt.isPrimary === false) return;
    (window.document.activeElement as HTMLElement | null)?.blur();
    e.cancelBubble = true;
    const point = pointer();
    if (space) { preparePointerGesture(Boolean(useEditorStore.getState().photoTransform)); drag.current = { kind: 'pan', start: point, initial: pan }; capturePointerGesture(e.evt); return; }
    if (useEditorStore.getState().frameEditing) { beginFrame(view, frame, rect, e); return; }
    const ref = { pageId: view.page.id, frameId: frame.id };
    preparePointerGesture(same(useEditorStore.getState().photoTransform, ref));
    state.setSelectedFrame(ref);
    const asset = frame.imageAssetId ? state.project.assets[frame.imageAssetId] : undefined;
    if (!asset) return;
    const editing = same(useEditorStore.getState().editingFrame, ref);
    state.beginTransaction(editing ? '移动或交换照片' : '交换照片');
    drag.current = { kind: editing ? 'move' : 'swap', ref, start: point, point, view, rect, frame: structuredClone(frame), asset, moved: false };
    capturePointerGesture(e.evt);
  };
  const beginZoom = (view: View, frame: Frame, rect: Rect, e: Konva.KonvaEventObject<PointerEvent>) => {
    const latest = useEditorStore.getState();
    if (e.evt.button !== 0 || e.evt.isPrimary === false || latest.frameEditing || latest.backgroundEditing || !same(latest.editingFrame, { pageId: view.page.id, frameId: frame.id })) return; e.cancelBubble = true;
    (window.document.activeElement as HTMLElement | null)?.blur();
    preparePointerGesture(same(latest.photoTransform, { pageId: view.page.id, frameId: frame.id }));
    if (space) { drag.current = { kind: 'pan', start: pointer(), initial: pan }; capturePointerGesture(e.evt); return; }
    const ref = { pageId: view.page.id, frameId: frame.id }, p = pointer();
    const asset = frame.imageAssetId ? latest.project.assets[frame.imageAssetId] : undefined;
    const cover = latest.photoTransform && asset ? geometry().cover(rect, asset.width, asset.height, frame.transform) : null;
    const center = { x: view.x + (cover?.centerX ?? rect.x + rect.width / 2) * view.scale, y: view.y + (cover?.centerY ?? rect.y + rect.height / 2) * view.scale };
    state.beginTransaction('缩放照片');
    drag.current = { kind: 'zoom', ref, center, start: p, zoom: frame.transform.zoom };
    capturePointerGesture(e.evt);
  };
  const beginRotate = (view: View, frame: Frame, rect: Rect, e: Konva.KonvaEventObject<PointerEvent>) => {
    const latest = useEditorStore.getState(), ref = { pageId: view.page.id, frameId: frame.id };
    if (e.evt.button !== 0 || e.evt.isPrimary === false || !same(latest.photoTransform, ref) || !frame.imageAssetId) return;
    e.cancelBubble = true; (window.document.activeElement as HTMLElement | null)?.blur();
    preparePointerGesture(true);
    if (space) { drag.current = { kind: 'pan', start: pointer(), initial: pan }; capturePointerGesture(e.evt); return; }
    const asset = latest.project.assets[frame.imageAssetId], cover = geometry().cover(rect, asset.width, asset.height, frame.transform);
    const center = { x: view.x + cover.centerX * view.scale, y: view.y + cover.centerY * view.scale };
    drag.current = { kind: 'rotate', ref, gesture: beginPhotoRotation(center, pointer(), frame.transform.rotation) };
    root.current?.classList.add('is-rotating');
    capturePointerGesture(e.evt);
  };
  const move = (event?: PointerEvent) => {
    const current = drag.current; if (!current) return;
    const p = pointer();
    if (current.kind === 'pan') { setPan({ x: current.initial.x + p.x - current.start.x, y: current.initial.y + p.y - current.start.y }); return; }
    if (current.kind === 'background-zoom') { state.updateBackgroundImage(current.pageId, { transform: { zoom: Math.max(1, Math.min(8, current.zoom * Math.hypot(p.x - current.center.x, p.y - current.center.y) / current.startDistance)) } }); return; }
    if (current.kind === 'background-move') {
      const rect = { x: 0, y: 0, width: document.width, height: document.height };
      const cover = geometry().cover(rect, current.asset.width, current.asset.height, current.transform);
      state.updateBackgroundImage(current.view.page.id, { transform: focusAfterDrag(rect, current.asset.width, current.asset.height, cover, (p.x - current.start.x) / current.view.scale, (p.y - current.start.y) / current.view.scale) }); return;
    }
    if (current.kind === 'frame') {
      const dx = (p.x - current.start.x) / current.view.scale / document.width, dy = (p.y - current.start.y) / current.view.scale / document.height;
      if (!current.moved && Math.hypot(p.x - current.start.x, p.y - current.start.y) < 2) return;
      current.moved = true;
      const next = dragFrameRect(current.rect, dx, dy, current.handle, Math.min(.08, 12 / current.view.width), Math.min(.08, 12 / current.view.height));
      if (Object.entries(next).every(([key, value]) => Math.abs(value - current.lastRect[key as keyof Rect]) < 1e-12)) return;
      current.lastRect = next; state.updateFrameRect(current.ref, next); return;
    }
    if (current.kind === 'zoom') { state.updateTransform(current.ref, { zoom: photoZoomAfterDrag(current.zoom, current.center, current.start, p) }); return; }
    if (current.kind === 'rotate') { const next = updatePhotoRotation(current.gesture, p, event?.shiftKey); current.gesture = next.gesture; state.updateTransform(current.ref, { rotation: next.rotation }); return; }
    if (current.kind === 'split') {
      const h = current.handle, coord = h.axis === 'x' ? (p.x - current.view.x) / current.view.scale : (p.y - current.view.y) / current.view.scale;
      const length = h.axis === 'x' ? h.parent.width : h.parent.height, start = h.axis === 'x' ? h.parent.x : h.parent.y;
      const available = length - h.gap * (h.weights.length - 1);
      const boundary = Math.max(h.min, Math.min(h.max, (coord - start - h.gap * (h.index + 0.5)) / available));
      const previous = h.weights.slice(0, h.index + 1).reduce((a, b) => a + b, 0), delta = boundary - previous;
      const weights = [...h.weights]; weights[h.index] += delta; weights[h.index + 1] -= delta;
      state.updatePage([current.view.page.id], { templateState: { [h.parameter]: weights } }); return;
    }
    const dx = p.x - current.start.x, dy = p.y - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    current.moved = true;
    const destination = photoFrameDropTarget(current.ref, hit(p.x, p.y), useEditorStore.getState().photoTransform);
    setTarget(destination);
    if (current.kind === 'swap' || destination) {
      setGhost({ x: p.x, y: p.y, label: current.asset.fileName }); return;
    }
    setGhost(null);
    const cover = geometry().cover(current.rect, current.asset.width, current.asset.height, current.frame.transform);
    state.updateTransform(current.ref, focusAfterDrag(current.rect, current.asset.width, current.asset.height, cover, dx / current.view.scale, dy / current.view.scale));
  };
  const finish = () => {
    const current = drag.current;
    if ((current?.kind === 'swap' || current?.kind === 'move') && current.moved) {
      const p = pointer(), destination = hit(p.x, p.y);
      if (finishPhotoFrameDrop(useEditorStore.getState, { source: current.ref, frame: current.frame, transaction: pointerTransaction.current }, destination) && destination) {
        state.setSelectedFrame(destination); state.setEditingFrame(destination);
      }
    }
    if (current?.kind === 'swap' && !current.moved) state.setEditingFrame(current.ref);
    const transaction = pointerTransaction.current;
    drag.current = null; pointerCleanup.current = null; pointerTransaction.current = null; pointerValidity.current = null;
    root.current?.classList.remove('is-rotating');
    if (stage.current) stage.current.container().style.cursor = 'default';
    if (transaction && useEditorStore.getState().transaction === transaction && !useEditorStore.getState().photoTransform) useEditorStore.getState().commitTransaction();
    setGhost(null); setTarget(null);
  };
  pointerActions.current = { move, finish };
  const wheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const s = useEditorStore.getState();
    const background = s.project.pages.find(page => page.id === s.activePageId)?.backgroundImage;
    if (s.backgroundEditing && background) {
      s.beginTransaction('缩放背景图片'); clearTimeout(wheelTimer.current);
      s.updateBackgroundImage(s.activePageId, { transform: { zoom: Math.max(1, Math.min(8, background.transform.zoom * Math.exp(-e.evt.deltaY * .008))) } });
      const owned = useEditorStore.getState().transaction;
      wheelTimer.current = setTimeout(() => { const latest = useEditorStore.getState(); if (latest.transaction === owned && !latest.photoTransform) latest.commitTransaction(); }, 180); return;
    }
    const view = views.find(v => v.page.id === s.editingFrame?.pageId);
    const frame = view?.page.frames.find(f => f.id === s.editingFrame?.frameId);
    const asset = frame?.imageAssetId ? s.project.assets[frame.imageAssetId] : undefined;
    if (view && frame && asset && s.editingFrame) {
      s.beginTransaction('调整照片'); clearTimeout(wheelTimer.current);
      s.updateTransform(s.editingFrame, { zoom: Math.max(1, Math.min(100, frame.transform.zoom * Math.exp(-e.evt.deltaY * 0.008))) });
      const owned = useEditorStore.getState().transaction;
      if (!s.photoTransform) wheelTimer.current = setTimeout(() => { const latest = useEditorStore.getState(); if (latest.transaction === owned && !latest.photoTransform) latest.commitTransaction(); }, 180);
    } else if ((e.evt.ctrlKey || e.evt.metaKey) && views.length === 1) {
      s.setViewZoom(Math.max(0.001, Math.min(2, (s.viewZoom === 'fit' ? views[0].scale : s.viewZoom) * Math.exp(-e.evt.deltaY * 0.008))));
    } else if (views.length === 1) setPan(p => ({ x: p.x - e.evt.deltaX, y: p.y - e.evt.deltaY }));
  };
  return <div className={`canvas-workspace ${space ? 'space-pan' : ''}`} ref={root}>
    <Stage ref={stage} width={size.width} height={size.height} onWheel={wheel} onPointerDown={e => { if (e.target === e.target.getStage() && e.evt.button === 0 && e.evt.isPrimary !== false) { if (space) { preparePointerGesture(Boolean(useEditorStore.getState().photoTransform)); drag.current = { kind: 'pan', start: pointer(), initial: pan }; capturePointerGesture(e.evt); } else { state.setSelectedFrame(null); state.setEditingFrame(null); } } }}>
      <Layer>
        {views.map(view => { const clip = workspaceViewClip(view, views.length, size); return <Group key={view.page.id} clipX={clip.x} clipY={clip.y} clipWidth={clip.width} clipHeight={clip.height}>
          <CanvasRect x={view.x} y={view.y} width={view.width} height={view.height} fill={view.page.background} shadowColor="#34403b" shadowBlur={15} shadowOpacity={0.13} shadowOffsetY={5} listening={false} />
          <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
            {view.page.backgroundImage && <BackgroundPhoto background={view.page.backgroundImage} asset={state.project.assets[view.page.backgroundImage.imageAssetId]} color={view.page.background} rect={{ x: 0, y: 0, width: document.width, height: document.height }} />}
            <Group listening={!(state.backgroundEditing && view.page.id === state.activePageId)}>
            {view.layout.frames.map(resolved => {
              const frame = view.page.frames.find(f => f.slotId === resolved.slotId)!;
              if (!frame) return null;
              const ref = { pageId: view.page.id, frameId: frame.id };
              return <Photo key={frame.id} frame={frame} asset={frame.imageAssetId ? state.project.assets[frame.imageAssetId] : undefined} rect={resolved.rect} scale={view.scale} editing={same(state.editingFrame, ref)} layoutEditing={state.frameEditing} selected={same(state.selectedFrame, ref)} targeted={same(target, ref)} onDown={e => beginPhoto(view, frame, resolved.rect, e)} onDouble={() => { const current = useEditorStore.getState(); if (current.frameEditing && same(current.selectedFrame, ref)) return; preparePointerGesture(); state.setFrameEditing(true); state.setSelectedFrame(ref); setContextMenu(null); }} onContext={e => {
                e.evt.preventDefault(); e.cancelBubble = true;
                (window.document.activeElement as HTMLElement | null)?.blur();
                state.setSelectedFrame(ref); if (frame.imageAssetId && !state.frameEditing) state.setEditingFrame(ref);
                setContextMenu({ ref, x: Math.max(8, Math.min(window.innerWidth - 240, e.evt.clientX)), y: Math.max(8, Math.min(window.innerHeight - 200, e.evt.clientY)) });
              }} small={views.length > 2} dense={typeof state.workspaceMode === 'number' && state.workspaceMode > 4} />;
            })}
            {!state.frameEditing && !state.photoTransform && view.layout.frames.map(resolved => {
              const frame = view.page.frames.find(frame => frame.slotId === resolved.slotId);
              if (!frame?.imageAssetId || !same(state.editingFrame, { pageId: view.page.id, frameId: frame.id })) return null;
              return <PhotoResizeControls key={frame.id} rect={resolved.rect} scale={view.scale} onResize={e => beginZoom(view, frame, resolved.rect, e)} />;
            })}
            {state.frameEditing && view.layout.frames.map(resolved => {
              const frame = view.page.frames.find(frame => frame.slotId === resolved.slotId);
              if (!frame || !same(state.selectedFrame, { pageId: view.page.id, frameId: frame.id })) return null;
              return <FrameResizeControls key={frame.id} rect={resolved.rect} scale={view.scale} onResize={(handle, e) => beginFrame(view, frame, resolved.rect, e, handle)} />;
            })}
            {!state.editingFrame && !state.frameEditing && view.layout.handles.map(handle => <Line key={handle.id} points={handle.axis === 'x' ? [handle.rect.x, handle.rect.y, handle.rect.x, handle.rect.y + handle.rect.height] : [handle.rect.x, handle.rect.y, handle.rect.x + handle.rect.width, handle.rect.y]} stroke="rgba(71,114,154,0.14)" strokeWidth={Math.max(1 / view.scale, Math.min(handle.gap, 3 / view.scale))} hitStrokeWidth={12 / view.scale} onPointerDown={e => { if (space || e.evt.button !== 0 || e.evt.isPrimary === false) return; e.cancelBubble = true; preparePointerGesture(); state.setActivePage(view.page.id); state.beginTransaction('调整分割线'); drag.current = { kind: 'split', view, handle }; capturePointerGesture(e.evt); }} onMouseEnter={e => { e.target.getStage()!.container().style.cursor = handle.axis === 'x' ? 'col-resize' : 'row-resize'; }} onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }} />)}
            </Group>
            {state.backgroundEditing && view.page.id === state.activePageId && view.page.backgroundImage && <Group>
              <CanvasRect x={0} y={0} width={document.width} height={document.height} fill="transparent" onPointerDown={e => beginBackground(view, e)} onMouseEnter={e => { e.target.getStage()!.container().style.cursor = 'move'; }} onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }} />
              <PhotoResizeControls rect={{ x: 0, y: 0, width: document.width, height: document.height }} scale={view.scale} onResize={e => beginBackground(view, e, true)} />
            </Group>}
          </Group>
        </Group>; })}
        {state.photoTransform && (() => {
          const view = views.find(view => view.page.id === state.photoTransform!.pageId);
          const frame = view?.page.frames.find(frame => frame.id === state.photoTransform!.frameId);
          const rect = view?.layout.frames.find(resolved => resolved.slotId === frame?.slotId)?.rect;
          const asset = frame?.imageAssetId ? state.project.assets[frame.imageAssetId] : undefined;
          if (!view || !frame || !rect || !asset) return null;
          return <PhotoTransformControls key={`${view.page.id}:${frame.id}`} view={view} cover={geometry().cover(rect, asset.width, asset.height, frame.transform)} rect={rect} safe={{ x: 12, y: 60, width: Math.max(0, size.width - 24), height: Math.max(0, size.height - 72) }} exclusions={views.map(view => view.label)} onResize={e => beginZoom(view, frame, rect, e)} onRotate={e => beginRotate(view, frame, rect, e)} />;
        })()}
      </Layer>
    </Stage>
    {state.photoTransform && <PhotoTransformBar />}
    {state.frameEditing && state.selectedFrame && (() => {
      const view = views.find(view => view.page.id === state.selectedFrame!.pageId);
      const frame = view?.page.frames.find(frame => frame.id === state.selectedFrame!.frameId);
      const rect = view?.layout.frames.find(resolved => resolved.slotId === frame?.slotId)?.rect;
      if (!view || !rect) return null;
      const hint = frameMovementHint({ x: rect.x / document.width, y: rect.y / document.height, width: rect.width / document.width, height: rect.height / document.height });
      const hintWidth = Math.min(280, Math.max(100, view.width - 16), Math.max(100, size.width - 20));
      const text = hintWidth < 200 ? hint?.includes('整页') ? '已贴满整页 · 先拖边点缩小' : hint?.includes('页宽') ? '已贴满页宽 · 先拖侧边缩窄' : '已贴满页高 · 先拖上下边缩短' : hint;
      return hint && <div className="frame-movement-hint" style={{ left: Math.max(10, Math.min(size.width - hintWidth - 10, view.x + rect.x * view.scale + 8)), top: Math.max(10, Math.min(size.height - 48, view.y + (rect.y + rect.height) * view.scale - 40)), maxWidth: hintWidth }}>{text}</div>;
    })()}
    {views.map(view => <div className={`page-label ${views.length > 1 ? 'multiple' : ''} ${view.label.width < 160 ? 'compact' : ''} ${state.activePageId === view.page.id ? 'active' : ''}`} key={view.page.id} style={{ left: view.label.x, top: view.label.y, width: view.label.width }}>
      <div className="page-heading"><button onClick={() => state.setActivePage(view.page.id)} onDoubleClick={() => { state.setActivePage(view.page.id); state.setWorkspaceMode(1); }}><span className="page-number">{String(state.project.pages.findIndex(page => page.id === view.page.id) + 1).padStart(2, '0')}</span><span>{view.page.name.replace(/^页面 \d+$/, '页面')}</span></button>
      {views.length > 1 && <button className="icon-button" title="单页编辑" onClick={() => { state.setActivePage(view.page.id); state.setWorkspaceMode(1); }}><Maximize2 size={12} /></button>}</div>
      <div className="page-actions"><PageTemplateAction pageId={view.page.id} pageNumber={state.project.pages.findIndex(page => page.id === view.page.id) + 1} onSave={onSaveTemplate} />
      {views.length > 1 && <PageExportSelection pageId={view.page.id} />}</div>
    </div>)}
    {ghost && <div className="photo-drag-ghost" style={{ left: ghost.x + 16, top: ghost.y + 16 }}><ImagePlus size={18} /><span>{ghost.label}</span><small>{target ? '松开以交换照片' : '拖到另一个照片框'}</small></div>}
    {pages.length === 0 && <button className="empty-add" onClick={() => state.addPage()}><Plus />添加页面</button>}
    {contextMenu && (() => {
      const page = state.project.pages.find(page => page.id === contextMenu.ref.pageId);
      const frameIndex = page?.frames.findIndex(frame => frame.id === contextMenu.ref.frameId) ?? -1;
      const frame = page?.frames[frameIndex];
      return <div className="photo-context-menu" role="menu" aria-label="照片框操作" style={{ left: contextMenu.x, top: contextMenu.y }}>
        <button autoFocus role="menuitem" disabled={!frame} onClick={() => { state.setFrameEditing(true); state.setSelectedFrame(contextMenu.ref); setContextMenu(null); }}>编辑此照片框 <kbd>F</kbd></button>
        {frame?.imageAssetId && <button role="menuitem" onClick={() => { state.setFrameEditing(false); state.setEditingFrame(contextMenu.ref); setContextMenu(null); }}>调整此照片 <kbd>V</kbd></button>}
        {frame?.imageAssetId && <button role="menuitem" onClick={() => { state.setSelectedFrame(contextMenu.ref); state.beginPhotoTransform(); setContextMenu(null); }}>自由变换照片 <kbd>⌘ / Ctrl T</kbd></button>}
        <button role="menuitem" disabled={!frame || frameIndex === (page?.frames.length ?? 0) - 1} onClick={() => { state.reorderFrameLayer(contextMenu.ref, 'front'); setContextMenu(null); }}>置于最上层</button>
        <button role="menuitem" disabled={!frame || frameIndex === 0} onClick={() => { state.reorderFrameLayer(contextMenu.ref, 'back'); setContextMenu(null); }}>置于最下层</button>
        {frame?.imageAssetId && <button role="menuitem" onClick={() => { onEditExternal(contextMenu.ref); setContextMenu(null); }}>在 Photoshop 中编辑</button>}
      </div>;
    })()}
  </div>;
}
