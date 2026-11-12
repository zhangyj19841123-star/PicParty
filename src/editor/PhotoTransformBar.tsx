import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import './photoTransform.css';

const numberText = (value: number) => String(Number(value.toFixed(1)));

/** Part of the canvas transform session, never a separate rotation panel. */
export function PhotoTransformBar() {
  const state = useEditorStore(), ref = state.photoTransform;
  const frame = state.project.pages.find(page => page.id === ref?.pageId)?.frames.find(frame => frame.id === ref?.frameId);
  const [angle, setAngle] = useState('0'), [zoom, setZoom] = useState('100');
  const angleFocused = useRef(false), zoomFocused = useRef(false);
  useEffect(() => { if (frame && !angleFocused.current) setAngle(numberText(frame.transform.rotation)); }, [frame?.transform.rotation]);
  useEffect(() => { if (frame && !zoomFocused.current) setZoom(numberText(frame.transform.zoom * 100)); }, [frame?.transform.zoom]);
  if (!frame || !ref) return null;
  const finishKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter') state.commitPhotoTransform(); else state.cancelPhotoTransform();
    }
  };
  return <div className="photo-transform-bar" role="group" aria-label="照片自由变换">
    <strong>自由变换</strong><span className="transform-tip">拖角缩放 · 移至框外拖动旋转</span>
    <label>缩放<input aria-label="自由变换缩放百分比" inputMode="decimal" value={zoom} onKeyDown={finishKey} onFocus={() => { zoomFocused.current = true; }} onBlur={() => { zoomFocused.current = false; setZoom(numberText(frame.transform.zoom * 100)); }} onChange={event => { setZoom(event.target.value); const value = Number(event.target.value); if (event.target.value.trim() && Number.isFinite(value) && value >= 100) state.updateTransform(ref, { zoom: value / 100 }); }} /><span>%</span></label>
    <label>角度<input aria-label="自由变换旋转角度" inputMode="decimal" value={angle} onKeyDown={finishKey} onFocus={() => { angleFocused.current = true; }} onBlur={() => { angleFocused.current = false; setAngle(numberText(frame.transform.rotation)); }} onChange={event => { setAngle(event.target.value); const value = Number(event.target.value); if (event.target.value.trim() && Number.isFinite(value)) state.updateTransform(ref, { rotation: value }); }} /><span>°</span></label>
    <button title="确认自由变换 · Enter" aria-label="确认自由变换" onClick={() => state.commitPhotoTransform()}><Check size={15} /><kbd>↵</kbd></button>
    <button title="取消本次自由变换 · Esc" aria-label="取消自由变换" onClick={() => state.cancelPhotoTransform()}><X size={15} /><kbd>Esc</kbd></button>
  </div>;
}
