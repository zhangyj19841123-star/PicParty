import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check, Minus, Plus, RotateCcw } from 'lucide-react';
import type { Frame, FrameRef } from '../core/types';
import { defaultTransform } from '../core/templates';
import { useEditorStore } from '../state/editorStore';

const numberText = (value: number) => String(Number(value.toFixed(1)));
const adjustmentKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** Rotation content is shared by floating, grouped and docked tool panels. */
export function PhotoRotationControls({ frame, frameRef, editing }: { frame: Frame; frameRef: FrameRef; editing: boolean }) {
  const s = useEditorStore();
  const value = frame.transform.rotation;
  const [draft, setDraft] = useState(() => numberText(value));
  const focused = useRef(false);
  const lastPreview = useRef(value);
  const interaction = useRef<'number' | 'pointer' | 'keyboard' | null>(null);
  const transaction = useRef<ReturnType<typeof useEditorStore.getState>['transaction']>(null);
  const activePointer = useRef<number | null>(null);
  const min = -180, max = 180;
  const begin = (mode: 'number' | 'pointer' | 'keyboard') => {
    useEditorStore.getState().beginTransaction('旋转照片');
    transaction.current = useEditorStore.getState().transaction;
    interaction.current = mode;
  };
  const finish = (cancel = false) => {
    interaction.current = null;
    activePointer.current = null;
    const owned = transaction.current;
    transaction.current = null;
    const store = useEditorStore.getState();
    if (!owned || owned !== store.transaction) return;
    if (cancel) store.cancelTransaction();
    else store.commitTransaction();
  };
  const change = (next: number) => {
    const bounded = Math.min(max, Math.max(min, next));
    lastPreview.current = bounded;
    useEditorStore.getState().updateTransform(frameRef, { rotation: bounded });
  };
  useEffect(() => {
    if (!focused.current || value !== lastPreview.current) setDraft(numberText(value));
    lastPreview.current = value;
  }, [value]);
  // A selection switch must not reuse an unfinished numeric draft or transaction.
  useEffect(() => {
    finish(); focused.current = false; setDraft(numberText(value));
  }, [frameRef.pageId, frameRef.frameId]);
  const operations = useRef({ finish }); operations.current = { finish };
  useEffect(() => {
    const released = (e: PointerEvent) => { if (activePointer.current === e.pointerId) operations.current.finish(); };
    const cancelled = (e: PointerEvent) => { if (activePointer.current === e.pointerId) operations.current.finish(true); };
    const blurred = () => { if (activePointer.current !== null) operations.current.finish(); };
    window.addEventListener('pointerup', released);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('blur', blurred);
    return () => {
      window.removeEventListener('pointerup', released);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('blur', blurred);
      operations.current.finish();
    };
  }, []);
  return <div className="photo-rotation-controls">
    <div className="photo-control-actions">
      <div className="photo-control-spacer" />
      <button className={`photo-reset ${!editing ? 'active' : ''}`} aria-pressed={!editing} aria-label={editing ? '拖动交换照片' : '返回移动照片'} title={editing ? '换位：拖到另一框交换照片' : '返回移动照片'} onClick={() => { finish(); s.setEditingFrame(editing ? null : frameRef); }}><ArrowLeftRight size={14} />换位</button>
      <button className="photo-reset" title="还原这张照片的大小、角度、位置与调色" onClick={() => { finish(); s.updateTransform(frameRef, defaultTransform()); }}><RotateCcw size={14} />还原</button>
      <button className="photo-tool-icon" aria-label="完成照片调整" title="完成" onClick={() => { finish(); s.setSelectedFrame(null); }}><Check size={16} /></button>
    </div>
    <div className="photo-ruler-row">
      <button className="photo-tool-icon" aria-label="逆时针旋转一度" onClick={() => { finish(); change(value - 1); }} disabled={value <= min}><Minus size={14} /></button>
      <div className="photo-ruler rotation">
        <div className="photo-ruler-ticks" aria-hidden="true" />
        <input data-project-control="true" type="range" aria-label="旋转照片刻度" min={min} max={max} step={0.1} value={value}
          onPointerDown={e => { if (e.button === 0) { activePointer.current = e.pointerId; begin('pointer'); } }}
          onPointerUp={() => finish()} onPointerCancel={() => finish(true)}
          onLostPointerCapture={() => { if (interaction.current === 'pointer') finish(); }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); e.currentTarget.blur(); }
            else if (adjustmentKeys.has(e.key)) begin('keyboard');
          }}
          onKeyUp={e => { if (adjustmentKeys.has(e.key)) finish(); }} onBlur={() => finish()}
          onChange={e => {
            const immediate = interaction.current === null;
            begin(interaction.current ?? 'keyboard'); change(Number(e.target.value));
            if (immediate) finish();
          }} />
      </div>
      <button className="photo-tool-icon" aria-label="顺时针旋转一度" onClick={() => { finish(); change(value + 1); }} disabled={value >= max}><Plus size={14} /></button>
      <div className="photo-angle-input"><input aria-label="旋转角度" data-project-control="true" type="text" inputMode="decimal" value={draft}
        onFocus={() => { focused.current = true; begin('number'); }}
        onBlur={() => { focused.current = false; finish(); setDraft(numberText(value)); }}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); focused.current = false; finish(true); e.currentTarget.blur(); }
          else if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault(); begin('number');
            const current = draft.trim() !== '' && Number.isFinite(Number(draft)) ? Number(draft) : value;
            const next = Math.min(max, Math.max(min, current + (e.key === 'ArrowUp' ? 0.1 : -0.1)));
            setDraft(numberText(next)); change(next);
          }
        }}
        onChange={e => {
          const next = e.target.value; setDraft(next);
          if (next.trim() !== '' && Number.isFinite(Number(next))) { begin('number'); change(Number(next)); }
        }} /><span>°</span></div>
    </div>
    <p>{editing ? '拖动移图 · 拖角点缩放' : '拖到另一照片框交换'}</p>
  </div>;
}
