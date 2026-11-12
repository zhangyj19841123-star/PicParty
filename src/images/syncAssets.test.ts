import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageAsset } from '../core/types';
import { refreshAssets } from '../platform/desktop';
import { syncCurrentAssets } from './syncAssets';

const { state } = vi.hoisted(() => ({ state: { project: { id: 'p', assets: {} as Record<string, ImageAsset> }, refreshAssets: (assets: ImageAsset[]) => { for (const asset of assets) state.project.assets[asset.id] = asset; } } }));
vi.mock('../platform/desktop', () => ({ refreshAssets: vi.fn() }));
vi.mock('../state/editorStore', () => ({ useEditorStore: { getState: () => state } }));
const asset = (fingerprint: string, originalPath = '/test/photo.png'): ImageAsset => ({ id: 'photo', fingerprint, originalPath, fileName: 'photo.png', width: 1200, height: 1800, rawWidth: 1200, rawHeight: 1800, orientation: 1, format: 'png', icc: null });

beforeEach(() => { vi.mocked(refreshAssets).mockReset(); state.project = { id: 'p', assets: { photo: asset('original') } }; });

describe('external original synchronization', () => {
  it('serializes polling and export and reads the newest snapshot for the next request', async () => {
    let resolve!: (value: { assets: ImageAsset[]; errors: string[] }) => void;
    vi.mocked(refreshAssets).mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce({ assets: [asset('second')], errors: [] });
    const poll = syncCurrentAssets(), exportCheck = syncCurrentAssets();
    await Promise.resolve();
    expect(refreshAssets).toHaveBeenCalledTimes(1);
    resolve({ assets: [asset('first')], errors: [] });
    await poll; await exportCheck;
    expect(vi.mocked(refreshAssets).mock.calls[1][0][0].fingerprint).toBe('first');
    expect(state.project.assets.photo.fingerprint).toBe('second');
  });
  it('does not overwrite a relink performed while a file is being checked', async () => {
    let resolve!: (value: { assets: ImageAsset[]; errors: string[] }) => void;
    vi.mocked(refreshAssets).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const check = syncCurrentAssets(); await Promise.resolve();
    state.project = { ...state.project, assets: { photo: asset('relinked', '/test/other.png') } };
    resolve({ assets: [asset('external-edit')], errors: [] });
    expect((await check).assets).toEqual([]);
    expect(state.project.assets.photo.fingerprint).toBe('relinked');
  });
  it('does not apply an old project response to a newly opened project', async () => {
    let resolve!: (value: { assets: ImageAsset[]; errors: string[] }) => void;
    vi.mocked(refreshAssets).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const check = syncCurrentAssets(); await Promise.resolve();
    state.project = { id: 'new-project', assets: { photo: asset('new') } };
    resolve({ assets: [asset('external-edit')], errors: ['old project error'] });
    expect((await check).errors).toEqual([]);
    expect(state.project.assets.photo.fingerprint).toBe('new');
  });
});
