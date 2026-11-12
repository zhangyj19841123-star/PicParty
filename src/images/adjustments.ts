import { useEffect, useRef, useState } from 'react';
import { adjustPixels } from '../core/engine';
import { defaultAdjustments } from '../core/photoAdjustments';
import type { ImageAsset, PhotoAdjustments } from '../core/types';
import { useAssetImage } from './cache';

type Adjusted = { image: HTMLCanvasElement; bytes: number };
const adjusted = new Map<string, Adjusted>();
const imageIds = new WeakMap<HTMLImageElement, number>();
let nextId = 0;
const MAX_BYTES = 96 * 1024 * 1024;

/** The proxy and native renderer both use the Rust color transform. */
export function adjustedImage(image: HTMLImageElement, settings?: PhotoAdjustments): HTMLImageElement | HTMLCanvasElement {
  const values = { ...defaultAdjustments(), ...settings };
  if (Object.values(values).every(value => value === 0)) return image;
  let id = imageIds.get(image);
  if (id === undefined) { id = ++nextId; imageIds.set(image, id); }
  const key = JSON.stringify([id, values]);
  const cached = adjusted.get(key);
  if (cached) { adjusted.delete(key); adjusted.set(key, cached); return cached.image; }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  data.data.set(adjustPixels(new Uint8Array(data.data.buffer), values));
  ctx.putImageData(data, 0, 0);
  adjusted.set(key, { image: canvas, bytes: data.data.byteLength });
  let total = [...adjusted.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [oldKey, entry] of adjusted) {
    if (total <= MAX_BYTES) break;
    adjusted.delete(oldKey); total -= entry.bytes;
  }
  return canvas;
}

export function useAdjustedAssetImage(asset: ImageAsset | undefined, size: number, settings?: PhotoAdjustments) {
  const source = useAssetImage(asset, size);
  const [result, setResult] = useState<{ source: HTMLImageElement; image?: HTMLImageElement | HTMLCanvasElement; error?: string }>();
  const pending = useRef<{ image: HTMLImageElement; settings: PhotoAdjustments } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = JSON.stringify({ ...defaultAdjustments(), ...settings });
  useEffect(() => {
    if (!source.image) { pending.current = undefined; setResult(undefined); return; }
    pending.current = { image: source.image, settings: JSON.parse(key) };
    if (timer.current !== undefined) return;
    // Keep showing updates during a continuous drag, using the latest values.
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const latest = pending.current;
      if (!latest) return;
      const image = latest.image;
      try { setResult({ source: image, image: adjustedImage(image, latest.settings) }); }
      catch (error) { setResult({ source: image, error: String(error instanceof Error ? error.message : error) }); }
    }, 35);
  }, [source.image, key]);
  useEffect(() => () => { clearTimeout(timer.current); timer.current = undefined; }, []);
  return { image: result?.source === source.image ? result?.image : source.image, error: source.error ?? (result?.source === source.image ? result?.error : undefined) };
}
