import { useEffect, useState } from 'react';
import { proxyUrl } from '../platform/desktop';
import type { ImageAsset } from '../core/types';
import { useAssetConnections } from '../projects/assetConnections';

type Entry = { promise: Promise<HTMLImageElement>; image?: HTMLImageElement; bytes: number; users: number; used: number };
const cache = new Map<string, Entry>();
const MAX_BYTES = 256 * 1024 * 1024;
let running = 0;
const queue: (() => void)[] = [];
function limit<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => { running++; task().then(resolve, reject).finally(() => { running--; queue.shift()?.(); }); };
    if (running < 2) start(); else queue.push(start);
  });
}
function trim() {
  let size = [...cache.values()].reduce((sum, item) => sum + item.bytes, 0);
  const candidates = [...cache.entries()].filter(([, item]) => item.users === 0 && item.image).sort((a, b) => a[1].used - b[1].used);
  for (const [key, entry] of candidates) {
    if (size <= MAX_BYTES) break;
    entry.image!.src = ''; cache.delete(key); size -= entry.bytes;
  }
}
export function acquireImage(asset: ImageAsset, size: number, refreshToken = 0) {
  const key = JSON.stringify([asset.id, asset.fingerprint, asset.originalPath, asset.orientation, size, refreshToken]);
  let item = cache.get(key);
  if (!item) {
    const created: Entry = { bytes: 0, users: 0, used: Date.now(), promise: Promise.resolve(null!) };
    created.promise = limit(async () => {
      const url = await proxyUrl(asset, size);
      const image = new Image(); image.decoding = 'async'; image.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('照片不可用，请重新链接')); image.src = url; });
      created.image = image; created.bytes = image.naturalWidth * image.naturalHeight * 4; trim(); return image;
    }).catch(error => { cache.delete(key); throw error; });
    item = created; cache.set(key, item);
  }
  item.users++; item.used = Date.now();
  let released = false;
  return { promise: item.promise, release: () => { if (!released) { released = true; item.users--; item.used = Date.now(); trim(); } } };
}
export function useAssetImage(asset: ImageAsset | undefined, size = 2048) {
  const connectionEpoch = useAssetConnections(state => state.projectId ? state.epochs[asset?.id ?? ''] ?? 0 : 0);
  const [result, setResult] = useState<{ image?: HTMLImageElement; error?: string }>({});
  useEffect(() => {
    setResult({}); if (!asset) return;
    let active = true;
    const lease = acquireImage(asset, size, connectionEpoch);
    lease.promise.then(image => { if (active) setResult({ image }); }, error => { if (active) setResult({ error: String(error.message || error) }); });
    return () => { active = false; lease.release(); };
  }, [asset?.id, asset?.fingerprint, asset?.originalPath, asset?.orientation, size, connectionEpoch]);
  return result;
}
