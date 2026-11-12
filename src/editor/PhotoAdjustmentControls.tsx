import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { defaultAdjustments } from '../core/photoAdjustments';
import type { Frame, FrameRef, PhotoAdjustments } from '../core/types';

const numberText = (value: number) => String(Number(value.toFixed(2)));
const adjustmentKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const photoFields: { key: keyof PhotoAdjustments; label: string; max: number; step: number; unit: string }[] = [
  { key: 'exposure', label: '曝光度', max: 3, step: 0.05, unit: 'EV' },
  { key: 'temperature', label: '色温', max: 100, step: 1, unit: '' },
  { key: 'tint', label: '色调', max: 100, step: 1, unit: '' },
  { key: 'contrast', label: '对比度', max: 100, step: 1, unit: '' },
  { key: 'highlights', label: '高光', max: 100, step: 1, unit: '' },
  { key: 'brightness', label: '亮度', max: 100, step: 1, unit: '' },
  { key: 'shadows', label: '阴影', max: 100, step: 1, unit: '' },
  { key: 'vibrance', label: '自然饱和度', max: 100, step: 1, unit: '' },
  { key: 'saturation', label: '饱和度', max: 100, step: 1, unit: '' },
  { key: 'blacks', label: '黑色', max: 100, step: 1, unit: '' },
];

/** One slider drag or complete numeric edit creates one undo step. */
export function RangeControl({ label, value, max, min = 0, step = 1, unit = 'px', onChange }: { label: string; value: number; max: number; min?: number; step?: number; unit?: string; onChange(value: number): void }) {
  const [draft, setDraft] = useState(() => numberText(value));
  const focused = useRef(false);
  const lastPreview = useRef(value);
  const interaction = useRef<'number' | 'pointer' | 'keyboard' | null>(null);
  const activePointer = useRef<number | null>(null);
  const ownedTransaction = useRef<ReturnType<typeof useEditorStore.getState>['transaction']>(null);
  const begin = (mode: 'number' | 'pointer' | 'keyboard') => {
    useEditorStore.getState().beginTransaction(label);
    ownedTransaction.current = useEditorStore.getState().transaction;
    interaction.current = mode;
  };
  const finish = (cancel = false) => {
    if (!interaction.current) return;
    interaction.current = null;
    activePointer.current = null;
    const store = useEditorStore.getState();
    const owned = ownedTransaction.current;
    ownedTransaction.current = null;
    if (!owned || store.transaction !== owned) return;
    if (cancel) store.cancelTransaction();
    else store.commitTransaction();
  };
  const preview = (next: number) => {
    const bounded = Math.min(max, Math.max(min, next));
    lastPreview.current = bounded;
    onChange(bounded);
  };
  useEffect(() => {
    // Keep incomplete entries such as '-' while typing. Undo or another external
    // change still updates the field immediately, even when it keeps focus.
    if (!focused.current || value !== lastPreview.current) setDraft(numberText(value));
    lastPreview.current = value;
  }, [value]);
  useEffect(() => {
    // WebKit owns range tracking; the global listeners finish a drag released
    // outside the slider without stealing its native thumb gesture.
    const released = (event: PointerEvent) => {
      if (interaction.current === 'pointer' && activePointer.current === event.pointerId) finish();
    };
    const cancelled = (event: PointerEvent) => {
      if (interaction.current === 'pointer' && activePointer.current === event.pointerId) finish(true);
    };
    const blurred = () => { if (interaction.current === 'pointer') finish(); };
    window.addEventListener('pointerup', released);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('blur', blurred);
    return () => {
      window.removeEventListener('pointerup', released);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('blur', blurred);
      finish();
    };
  }, []);
  return <div className="range-control">
    <div className="field-label"><label>{label}</label><div className="number-box">
      <input aria-label={label} data-project-control="true" type="text" inputMode="decimal" value={draft}
        onFocus={() => { focused.current = true; begin('number'); }}
        onBlur={() => { focused.current = false; finish(); setDraft(numberText(value)); }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation(); focused.current = false; finish(true); e.currentTarget.blur();
          } else if (e.key === 'Enter') {
            e.preventDefault(); e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault(); begin('number');
            const current = draft.trim() !== '' && Number.isFinite(Number(draft)) ? Number(draft) : value;
            const next = Math.min(max, Math.max(min, current + (e.key === 'ArrowUp' ? step : -step)));
            setDraft(numberText(next)); preview(next);
          }
        }}
        onChange={e => {
          const next = e.target.value; setDraft(next);
          if (next.trim() !== '' && Number.isFinite(Number(next))) { begin('number'); preview(Number(next)); }
        }} />
      <span>{unit}</span>
    </div></div>
    <input aria-label={`${label}滑块`} data-project-control="true" type="range" min={min} max={max} step={step} value={value}
      onPointerDown={e => { if (e.button !== 0) return; activePointer.current = e.pointerId; begin('pointer'); }}
      onPointerUp={() => finish()}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => { if (interaction.current === 'pointer') finish(); }}
      onBlur={() => finish()}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); }
        else if (adjustmentKeys.has(e.key)) begin('keyboard');
      }}
      onKeyUp={e => { if (adjustmentKeys.has(e.key)) finish(); }}
      onChange={e => {
        const immediate = interaction.current === null;
        begin(interaction.current ?? 'keyboard');
        preview(Number(e.target.value));
        if (immediate) finish();
      }} />
  </div>;
}

/** Photo content can be floated, grouped or docked without owning its layout. */
export function PhotoColorControls({ frame, frameRef }: { frame: Frame; frameRef: FrameRef }) {
  const s = useEditorStore();
  const color = { ...defaultAdjustments(), ...frame.transform.adjustments };
  return <div className="photo-color-controls">
    <div className="photo-color-toolbar"><button className="text-button" title="只还原调色，保留照片的位置、大小与角度" onClick={() => { s.commitTransaction(); s.updateTransform(frameRef, { adjustments: defaultAdjustments() }); }}>还原调色</button></div>
    {photoFields.map(field => <RangeControl key={`${frameRef.pageId}:${frameRef.frameId}:${field.key}`} label={field.label} min={-field.max} max={field.max} step={field.step} unit={field.unit} value={color[field.key]} onChange={n => s.updateTransform(frameRef, { adjustments: { [field.key]: n } })} />)}
    <p className="inspector-note">仅调整当前照片，原图保留。</p>
  </div>;
}
