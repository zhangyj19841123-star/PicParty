import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GripHorizontal, PanelRightClose, PanelsTopLeft, Settings2 } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { PhotoColorControls } from './PhotoAdjustmentControls';
import {
  photoControlPositionFraction, resolvePhotoControlPosition, useToolPanelStore,
  type PanelBounds, type PhotoControlPosition, type ToolPanelKind, type ToolPanelPlacement, type ToolPanelPreferences,
} from './toolPanelPreferences';

const labels = { rotation: '旋转', color: '调色' };
interface PanelDrag {
  pointerId: number; kind: ToolPanelKind; wholeGroup: boolean; before: ToolPanelPreferences;
  start: PhotoControlPosition; offset: PhotoControlPosition; width: number; height: number; detached: boolean;
}
interface PanelPreview { kind: ToolPanelKind; position: PhotoControlPosition; width: number; height: number }
type DropTarget = { kind: 'right' } | { kind: 'merge'; panel: ToolPanelKind } | null;
interface PanelContextValue {
  size: { width: number; height: number }; automatic(kind: ToolPanelKind, width: number, height: number): PhotoControlPosition;
  preview: PanelPreview | null; target: DropTarget;
  begin(event: ReactPointerEvent, kind: ToolPanelKind, wholeGroup?: boolean): void;
  moveBy(kind: ToolPanelKind, x: number, y: number, element: HTMLElement): void;
  showRight(): void;
}
const PanelContext = createContext<PanelContextValue | null>(null);

/** One coordinate system covers the canvas and inspector, so docking never depends on a document's pixels. */
export function ToolPanelLayout({ children, rightOpen, onShowRight }: { children: ReactNode; rightOpen: boolean; onShowRight(): void }) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [preview, setPreview] = useState<PanelPreview | null>(null);
  const [target, setTarget] = useState<DropTarget>(null);
  const drag = useRef<PanelDrag | null>(null);
  const targetRef = useRef(target); targetRef.current = target;
  const previewRef = useRef(preview); previewRef.current = preview;
  const sizeRef = useRef(size); sizeRef.current = size;
  const showRightRef = useRef(onShowRight); showRightRef.current = onShowRight;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const begin = (event: ReactPointerEvent, kind: ToolPanelKind, wholeGroup = false) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button:not(.tool-panel-grip),input')) return;
    const group = event.currentTarget.closest<HTMLElement>('[data-tool-group]');
    if (!group || !root.current) return;
    event.preventDefault(); event.stopPropagation();
    (document.activeElement as HTMLElement | null)?.blur();
    useEditorStore.getState().commitTransaction();
    const section = event.currentTarget.closest<HTMLElement>('.tool-panel');
    const rect = (!wholeGroup && section ? section : group).getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, kind, wholeGroup, before: useToolPanelStore.getState().preferences,
      start: { x: event.clientX, y: event.clientY }, offset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      width: rect.width, height: rect.height, detached: false };
    // This stable layout survives undocking; a title's element can be unmounted mid-drag.
    try { root.current.setPointerCapture(event.pointerId); } catch { /* Window listeners remain the fallback. */ }
  };
  useEffect(() => {
    const moved = (event: PointerEvent) => {
      const current = drag.current, element = root.current;
      if (!current || event.pointerId !== current.pointerId || !element) return;
      if (!current.detached && Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) < 4) return;
      const store = useToolPanelStore.getState();
      if (!current.detached) {
        current.detached = true;
        if (current.before.merged && !current.wholeGroup) store.split(current.kind);
        else store.undock(current.kind);
      }
      const rect = element.getBoundingClientRect(), available = sizeRef.current;
      const candidate = element.querySelector<HTMLElement>(`[data-floating-panel="${current.kind}"]`);
      // A split/undock is rendered after this event. Ignore the old merged shell's
      // dimensions until the single panel has mounted, including on pointerup.
      const remainsMerged = current.before.merged && current.wholeGroup;
      const active = candidate?.classList.contains('merged') === remainsMerged ? candidate : null;
      const fallbackWidth = remainsMerged ? 310 : current.kind === 'rotation' ? 340 : 280;
      const width = active?.offsetWidth ?? Math.min(fallbackWidth, Math.max(180, available.width - 16));
      const height = active?.offsetHeight ?? current.height;
      const position = resolvePhotoControlPosition(null, { viewportWidth: available.width, viewportHeight: available.height, panelWidth: width, panelHeight: height },
        { x: event.clientX - rect.left - Math.min(current.offset.x, width - 20), y: event.clientY - rect.top - Math.min(current.offset.y, 24) });
      const next = { kind: current.kind, position, width, height };
      previewRef.current = next; setPreview(next);
      // The moving group has pointer-events:none, exposing the drop target below it.
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const header = under?.closest<HTMLElement>('[data-tool-header]');
      const headerKind = header?.dataset.toolHeader as ToolPanelKind | undefined;
      const sidebar = element.querySelector<HTMLElement>('.inspector')?.getBoundingClientRect();
      let drop: DropTarget = null;
      if (headerKind && headerKind !== current.kind && !store.preferences.merged) drop = { kind: 'merge', panel: headerKind };
      else if ((sidebar && event.clientX >= sidebar.left && event.clientX <= sidebar.right) || event.clientX >= rect.right - 36) drop = { kind: 'right' };
      targetRef.current = drop; setTarget(drop);
    };
    const ended = (cancelled: boolean, pointerId?: number) => {
      const current = drag.current;
      if (!current || pointerId !== undefined && pointerId !== current.pointerId) return;
      drag.current = null;
      if (root.current?.hasPointerCapture(current.pointerId)) root.current.releasePointerCapture(current.pointerId);
      const store = useToolPanelStore.getState();
      if (current.detached) {
        if (cancelled) store.setPreferences(current.before);
        else if (targetRef.current?.kind === 'merge') store.merge(current.kind, targetRef.current.panel);
        else if (targetRef.current?.kind === 'right') { store.dock(current.kind); showRightRef.current(); }
        else if (previewRef.current) {
          store.move(current.kind, photoControlPositionFraction(previewRef.current.position, {
            viewportWidth: sizeRef.current.width, viewportHeight: sizeRef.current.height,
            panelWidth: previewRef.current.width, panelHeight: previewRef.current.height,
          }));
        }
      }
      previewRef.current = null; targetRef.current = null; setPreview(null); setTarget(null);
    };
    const released = (event: PointerEvent) => ended(false, event.pointerId);
    const cancelled = (event: PointerEvent) => ended(true, event.pointerId);
    const blurred = () => ended(false);
    const keyed = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopImmediatePropagation(); ended(true); }
    };
    window.addEventListener('pointermove', moved); window.addEventListener('pointerup', released);
    window.addEventListener('pointercancel', cancelled); window.addEventListener('blur', blurred); window.addEventListener('keydown', keyed, true);
    window.addEventListener('lostpointercapture', cancelled);
    return () => {
      window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', released);
      window.removeEventListener('pointercancel', cancelled); window.removeEventListener('blur', blurred); window.removeEventListener('keydown', keyed, true);
      window.removeEventListener('lostpointercapture', cancelled);
      if (drag.current?.detached) useToolPanelStore.getState().setPreferences(drag.current.before);
    };
  }, []);
  const automatic = (kind: ToolPanelKind, width: number, height: number) => {
    const area = root.current?.querySelector<HTMLElement>('.editor-main');
    return kind === 'rotation' ? { x: (area?.offsetLeft ?? 0) + ((area?.clientWidth ?? size.width) - width) / 2, y: size.height - height - 46 }
      : { x: (area?.offsetLeft ?? 0) + (area?.clientWidth ?? size.width) - width - 18, y: 22 };
  };
  const moveBy = (kind: ToolPanelKind, x: number, y: number, element: HTMLElement) => {
    const group = element.closest<HTMLElement>('[data-tool-group]');
    if (!group || !root.current) return;
    const rect = group.getBoundingClientRect(), parent = root.current.getBoundingClientRect();
    const position = photoControlPositionFraction({ x: rect.left - parent.left + x, y: rect.top - parent.top + y }, {
      viewportWidth: size.width, viewportHeight: size.height, panelWidth: rect.width, panelHeight: rect.height,
    });
    useToolPanelStore.getState().undock(kind, position);
  };
  return <PanelContext.Provider value={{ size, automatic, preview, target, begin, moveBy, showRight: onShowRight }}>
    <div className={`main-layout${preview ? ' dragging-tool-panel' : ''}`} ref={root}>
      {children}
      <div className="tool-panel-layer"><ToolPanels placement="floating" />
        {target?.kind === 'right' && <div className="tool-dock-target" style={{ width: rightOpen ? root.current?.querySelector<HTMLElement>('.inspector')?.offsetWidth ?? 260 : 180 }}><PanelRightClose size={19} />松开以停靠右侧</div>}
      </div>
    </div>
  </PanelContext.Provider>;
}

export function ToolPanels({ placement }: { placement: ToolPanelPlacement }) {
  const state = useEditorStore(), { preferences } = useToolPanelStore();
  const selected = state.selectedFrame;
  const frame = selected && state.project.pages.find(page => page.id === selected.pageId)?.frames.find(frame => frame.id === selected.frameId);
  if (!frame?.imageAssetId || !selected || state.workspaceMode === 'overview' || state.frameEditing || state.photoTransform) return null;
  // Retain old preferences for compatibility, but rotation now lives on canvas.
  const groups: ToolPanelKind[][] = [['color']];
  return <>{groups.filter(group => preferences.panels[group[0]].placement === placement).map(group => <ToolGroup key={group.join('-')} kinds={group} placement={placement} />)}</>;
}

function ToolGroup({ kinds, placement }: { kinds: ToolPanelKind[]; placement: ToolPanelPlacement }) {
  const context = useContext(PanelContext)!;
  const store = useToolPanelStore(), state = useEditorStore();
  const group = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(100);
  const kind = kinds[0];
  const width = Math.min(280, Math.max(180, context.size.width - 16));
  useLayoutEffect(() => {
    const element = group.current;
    if (!element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const bounds: PanelBounds = { viewportWidth: context.size.width, viewportHeight: context.size.height, panelWidth: width, panelHeight: height };
  const moving = context.preview && kinds.includes(context.preview.kind);
  const position = moving ? context.preview!.position : resolvePhotoControlPosition(store.preferences.panels[kind].position, bounds, context.automatic(kind, width, height));
  const selected = state.selectedFrame!;
  const frame = state.project.pages.find(page => page.id === selected.pageId)!.frames.find(frame => frame.id === selected.frameId)!;
  const grip = (label: string, primary: ToolPanelKind) => <button className="tool-panel-grip" aria-label={`移动${label}面板`} title="拖动标题移动，拖到右侧停靠"
    onKeyDown={event => {
      const directions: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = directions[event.key]; if (!direction) return;
      event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 1 : 10;
      context.moveBy(primary, direction[0] * step, direction[1] * step, event.currentTarget);
    }}><GripHorizontal size={13} />{label}</button>;
  return <div ref={group} data-tool-group={kind} data-floating-panel={placement === 'floating' ? kind : undefined}
    className={`tool-group ${placement}${moving ? ' moving' : ''}`}
    style={placement === 'floating' ? { left: position.x, top: position.y, width, maxHeight: Math.max(80, context.size.height - 16), zIndex: moving ? 12 : 7 } : undefined}>
    <div className="tool-group-sections">{kinds.map(panel => <ToolSection key={panel} kind={panel} placement={placement} grip={grip(labels[panel], panel)}>
      <PhotoColorControls frame={frame} frameRef={selected} />
    </ToolSection>)}</div>
  </div>;
}

function ToolSection({ kind, placement, grip, children }: { kind: ToolPanelKind; placement: ToolPanelPlacement; grip: ReactNode; children: ReactNode }) {
  const context = useContext(PanelContext)!, store = useToolPanelStore();
  const [settings, setSettings] = useState(false);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const pressed = (event: PointerEvent) => { if (!section.current?.contains(event.target as Node)) setSettings(false); };
    const keyed = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]') || (event.target as HTMLElement)?.closest('[data-project-control]')) return;
      if (event.key === 'Escape' && settings) { event.preventDefault(); event.stopImmediatePropagation(); setSettings(false); }
    };
    window.addEventListener('pointerdown', pressed, true); window.addEventListener('keydown', keyed, true);
    return () => { window.removeEventListener('pointerdown', pressed, true); window.removeEventListener('keydown', keyed, true); };
  }, [settings]);
  return <section ref={section} className={`tool-panel tool-${kind}${context.target?.kind === 'merge' && context.target.panel === kind ? ' merge-target' : ''}`} aria-label={`${labels[kind]}面板`}
    style={{ backgroundColor: `rgba(251,252,249,${store.preferences.panels[kind].opacity / 100})` }}>
    <div className="tool-panel-header" data-tool-header={kind} onPointerDown={event => { if ((event.target as HTMLElement).closest('button:not(.tool-panel-grip),input')) return; setSettings(false); context.begin(event, kind); }}>
      {grip}<div className="photo-control-spacer" />
      <button className="tool-header-button" aria-label={`${labels[kind]}面板设置`} title="透明度与停靠" aria-expanded={settings} onClick={() => setSettings(!settings)}><Settings2 size={14} /></button>
      <button className="tool-header-button" aria-label={placement === 'right' ? `浮动${labels[kind]}面板` : `停靠${labels[kind]}到右侧`} title={placement === 'right' ? '拖出右侧栏' : '停靠右侧栏'} onClick={() => {
        if (placement === 'right') store.undock(kind); else { store.dock(kind); context.showRight(); }
      }}>{placement === 'right' ? <PanelsTopLeft size={14} /> : <PanelRightClose size={14} />}</button>
    </div>
    {settings && <div className="tool-panel-settings" role="group" aria-label={`${labels[kind]}面板偏好`}>
      <div className="photo-opacity-label"><label>背景不透明度</label><output>{store.preferences.panels[kind].opacity}%</output></div>
      <input aria-label={`${labels[kind]}面板不透明度`} type="range" min={20} max={100} step={1} value={store.preferences.panels[kind].opacity} onChange={event => store.setOpacity(kind, Number(event.target.value))} />
      <div className="tool-settings-actions"><button onClick={() => { store.move(kind, null); setSettings(false); }}>自动位置</button></div>
      <p>位置与透明度会自动记住</p>
    </div>}
    <div className="tool-panel-body">{children}</div>
  </section>;
}
