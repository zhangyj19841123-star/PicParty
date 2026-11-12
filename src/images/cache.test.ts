import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageAsset } from '../core/types';

const { proxyUrl } = vi.hoisted(() => ({ proxyUrl: vi.fn<(asset: ImageAsset, size: number) => Promise<string>>() }));
vi.mock('../platform/desktop', () => ({ proxyUrl }));
vi.mock('../projects/assetConnections', () => ({ useAssetConnections: vi.fn() }));

class PreviewImage {
  naturalWidth = 0;
  naturalHeight = 0;
  decoding = '';
  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = '';
  get src() { return this.source; }
  set src(value: string) {
    this.source = value;
    if (!value) return;
    const size = value.startsWith('offline') ? 256 : 2048;
    this.naturalWidth = size; this.naturalHeight = size;
    queueMicrotask(() => this.onload?.());
  }
}
const photo = (id = 'photo'): ImageAsset => ({ id, originalPath: '/Volumes/Photos/same.png', fileName: 'same.png', width: 4000, height: 6000, rawWidth: 4000, rawHeight: 6000, orientation: 1, format: 'png', fingerprint: 'same-content-hash', icc: null });
beforeEach(() => { vi.resetModules(); proxyUrl.mockReset(); vi.stubGlobal('Image', PreviewImage); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('source reconnection preview cache', () => {
  it('requests high resolution after reconnecting the same path and content, without reusing the offline fallback', async () => {
    const { acquireImage } = await import('./cache');
    proxyUrl.mockResolvedValueOnce('offline-256').mockResolvedValueOnce('connected-2048');
    const asset = photo(), offline = acquireImage(asset, 2048, 0), sharedOffline = acquireImage(asset, 2048, 0);
    const cached = await offline.promise;
    expect(cached.naturalWidth).toBe(256);
    expect(await sharedOffline.promise).toBe(cached);
    expect(proxyUrl).toHaveBeenCalledTimes(1);

    const connected = acquireImage(asset, 2048, 1), full = await connected.promise;
    expect(proxyUrl).toHaveBeenCalledTimes(2);
    expect(proxyUrl).toHaveBeenLastCalledWith(asset, 2048);
    expect(full.naturalWidth).toBe(2048);
    expect(full).not.toBe(cached);
    // Releasing an old epoch, even twice, cannot dispose a live new-epoch lease.
    offline.release(); offline.release(); sharedOffline.release();
    const sharedConnected = acquireImage(asset, 2048, 1);
    expect(await sharedConnected.promise).toBe(full);
    expect(proxyUrl).toHaveBeenCalledTimes(2);
    expect(full.src).toBe('connected-2048');
    connected.release(); sharedConnected.release();
  });

  it('keeps at most two proxy reads active and starts the waiting request after a read completes', async () => {
    const { acquireImage } = await import('./cache');
    const finish: Array<(url: string) => void> = [];
    proxyUrl.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const leases = ['one', 'two', 'three'].map(id => acquireImage(photo(id), 2048, 1));
    expect(proxyUrl).toHaveBeenCalledTimes(2);
    finish[0]('connected-one');
    await leases[0].promise;
    await vi.waitFor(() => expect(proxyUrl).toHaveBeenCalledTimes(3));
    finish[1]('connected-two'); finish[2]('connected-three');
    expect((await Promise.all(leases.map(lease => lease.promise))).every(image => image.naturalWidth === 2048)).toBe(true);
    leases.forEach(lease => lease.release());
  });

  it('retries an unavailable original rather than caching the rejected promise', async () => {
    const { acquireImage } = await import('./cache');
    proxyUrl.mockRejectedValueOnce(new Error('原图未连接')).mockResolvedValueOnce('connected-2048');
    const missing = acquireImage(photo(), 2048, 0);
    await expect(missing.promise).rejects.toThrow('原图未连接'); missing.release();
    const retry = acquireImage(photo(), 2048, 0);
    expect((await retry.promise).naturalWidth).toBe(2048);
    expect(proxyUrl).toHaveBeenCalledTimes(2); retry.release();
  });
});
