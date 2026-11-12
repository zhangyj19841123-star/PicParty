import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ImagePlus, LoaderCircle } from 'lucide-react';
import type { ImageAsset, Rect } from '../core/types';
import type { WatermarkCorner } from '../core/watermarkPlacement';
import { positionWatermarkLayer, watermarkLayerRect, type LayerPlacement, type TextWatermark } from '../core/watermarkSettings';
import { useAssetImage } from '../images/cache';
import type { WatermarkLayer, WatermarkPreview } from '../platform/watermark';

interface Gesture {
  pointerId: number;
  target: HTMLElement;
  clientX: number;
  clientY: number;
  fit: number;
  rect: Rect;
  placement: LayerPlacement;
  text: TextWatermark;
  corner?: WatermarkCorner;
}

interface Props {
  photo?: ImageAsset;
  watermark?: ImageAsset;
  imagePlacement: LayerPlacement;
  text: TextWatermark;
  layer: WatermarkLayer;
  preview?: WatermarkPreview;
  loading: boolean;
  current: boolean;
  locked: boolean;
  onGestureStart(): void;
  onGestureEnd(cancelled: boolean): void;
  onImageChange(value: LayerPlacement): void;
  onTextChange(value: TextWatermark): void;
}
const corners = ['nw', 'ne', 'sw', 'se'] as const;

export function WatermarkPreviewPane({ photo, watermark, imagePlacement, text, layer, preview, loading, current, locked, onGestureStart, onGestureEnd, onImageChange, onTextChange }: Props) {
  const container = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null);
  const [bounds, setBounds] = useState({ width: 500, height: 380 });
  const [draftRect, setDraftRect] = useState<Rect>();
  const fallback = useAssetImage(!preview ? photo : undefined, 1024);
  const placement = layer === 'image' ? imagePlacement : text.placement;
  const rect = draftRect ?? preview?.layers[layer];
  const fit = photo ? Math.min(bounds.width / photo.width, bounds.height / photo.height) : 1;
  const source = preview?.url ?? fallback.image?.src;

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setBounds({ width: Math.max(1, entry.contentRect.width - 30), height: Math.max(1, entry.contentRect.height - 30) });
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (current && !gesture.current) setDraftRect(undefined);
  }, [current]);
  useEffect(() => {
    if (gesture.current) onGestureEnd(true);
    gesture.current = null;
    setDraftRect(undefined);
  }, [photo?.id, layer]);

  const begin = (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, corner?: WatermarkCorner) => {
    if (!photo || !rect || !current || locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.closest<HTMLElement>('.wm-layer-selection')?.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, target, clientX: event.clientX, clientY: event.clientY, fit, rect, placement, text, corner };
    onGestureStart();
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!photo || !start || event.pointerId !== start.pointerId) return;
    const dx = (event.clientX - start.clientX) / start.fit, dy = (event.clientY - start.clientY) / start.fit;
    let proposed = { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy };
    let next = start.placement;
    let textScale = start.text.scale;
    if (start.corner) {
      const sx = start.corner.endsWith('e') ? 1 : -1, sy = start.corner.startsWith('s') ? 1 : -1;
      const { width, height, x, y } = start.rect;
      const anchorX = sx > 0 ? x : x + width, anchorY = sy > 0 ? y : y + height;
      const geometryMax = Math.min((sx > 0 ? photo.width - anchorX : anchorX) / width, (sy > 0 ? photo.height - anchorY : anchorY) / height);
      let currentSize = layer === 'image' ? start.placement.widthRatio : start.text.scale;
      if (layer === 'image' && watermark) {
        const radians = (start.placement.rotation ?? 0) * Math.PI / 180;
        const aabbRatio = Math.abs(Math.cos(radians)) + (watermark.height / watermark.width) * Math.abs(Math.sin(radians));
        currentSize = Math.max(0.01, Math.min(currentSize, width / (Math.min(photo.width, photo.height) * aabbRatio)));
      }
      const minFactor = (layer === 'image' ? 0.01 : 0.1) / currentSize;
      const maxFactor = Math.min(geometryMax, (layer === 'image' ? 2 : 10) / currentSize);
      const requested = 1 + (sx * width * dx + sy * height * dy) / (width ** 2 + height ** 2);
      const factor = Math.min(maxFactor, Math.max(minFactor, requested));
      proposed = { x: sx > 0 ? anchorX : anchorX - width * factor, y: sy > 0 ? anchorY : anchorY - height * factor,
        width: width * factor, height: height * factor };
      if (layer === 'image') next = { ...next, widthRatio: Math.max(0.01, currentSize * factor) };
      else textScale = Math.max(0.1, currentSize * factor);
    }
    next = positionWatermarkLayer(photo, proposed, next);
    setDraftRect(watermarkLayerRect(photo, proposed, next));
    if (layer === 'image') onImageChange(next);
    else onTextChange({ ...start.text, scale: textScale, placement: next });
  };
  const end = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const start = gesture.current;
    if (!start || event.pointerId !== start.pointerId) return;
    gesture.current = null;
    if (start.target.hasPointerCapture(event.pointerId)) start.target.releasePointerCapture(event.pointerId);
    onGestureEnd(cancel);
    if (cancel || current) setDraftRect(undefined);
  };

  return <div ref={container} className="wm-preview" aria-label="水印效果预览">
    {photo && source ? <div className="wm-photo-surface" style={{ width: photo.width * fit, height: photo.height * fit }}
      onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}>
      <img className="wm-reference-image" src={source} alt={`${photo.fileName} 水印预览`} draggable={false} />
      {rect && !locked && <div className="wm-layer-selection" role="group" tabIndex={0} aria-label={layer === 'image' ? '图片水印选框' : '文字水印选框'}
        style={{ left: rect.x * fit, top: rect.y * fit, width: rect.width * fit, height: rect.height * fit }} onPointerDown={event => begin(event)}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const step = Math.max(1, Math.min(photo.width, photo.height) * (event.shiftKey ? 0.02 : 0.002));
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          const next = positionWatermarkLayer(photo, { ...rect, x: rect.x + dx, y: rect.y + dy }, placement);
          setDraftRect(watermarkLayerRect(photo, rect, next));
          if (layer === 'image') onImageChange(next);
          else onTextChange({ ...text, placement: next });
        }}>
        {corners.map(corner => <button key={corner} className={`wm-resize-handle ${corner}`} type="button" aria-label={`缩放${layer === 'image' ? '图片' : '文字'}水印`} tabIndex={-1}
          onPointerDown={event => begin(event, corner)} />)}
      </div>}
    </div> : <div className="wm-preview-empty">
      {loading ? <LoaderCircle size={23} className="spin" /> : <ImagePlus size={24} strokeWidth={1.4} />}
      <p>{photo ? loading ? '正在生成预览…' : '照片预览暂不可用' : '选择照片文件夹或参考照片'}</p>
    </div>}
    {loading && source && <span className="wm-preview-updating" role="status"><LoaderCircle size={12} className="spin" />更新预览</span>}
  </div>;
}
