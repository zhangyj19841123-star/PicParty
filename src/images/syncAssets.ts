import { refreshAssets } from '../platform/desktop';
import { useEditorStore } from '../state/editorStore';
import type { ImageAsset } from '../core/types';

let queue: Promise<unknown> = Promise.resolve();

/** Polling and export share a serial queue and read fresh snapshots when run. */
export function syncCurrentAssets(): Promise<{ assets: ImageAsset[]; errors: string[]; projectId: string }> {
  const task = queue.then(async () => {
    const start = useEditorStore.getState();
    const projectId = start.project.id;
    const baseline = start.project.assets;
    const snapshots = Object.values(baseline);
    const result = { assets: [] as ImageAsset[], errors: [] as string[], projectId };
    for (let i = 0; i < snapshots.length; i += 1000) {
      const refreshed = await refreshAssets(snapshots.slice(i, i + 1000));
      result.assets.push(...refreshed.assets); result.errors.push(...refreshed.errors);
    }
    const current = useEditorStore.getState();
    if (current.project.id !== projectId) return { assets: [], errors: [], projectId };
    // A relink or undo can happen while reading a file. Never replace a newer
    // document snapshot with a result from that earlier request.
    result.assets = result.assets.filter(asset => {
      const before = baseline[asset.id], now = current.project.assets[asset.id];
      return before && now && now.originalPath === before.originalPath && now.fingerprint === before.fingerprint;
    });
    current.refreshAssets(result.assets);
    return result;
  });
  queue = task.catch(() => {});
  return task;
}
