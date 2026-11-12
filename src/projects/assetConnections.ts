import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { native } from '../platform/desktop';
import { useEditorStore } from '../state/editorStore';
import type { ImageAsset } from '../core/types';

export interface Connection { assetId: string; status: 'connected' | 'missing' | 'ambiguous'; candidates: string[] }
interface Report { assets: ImageAsset[]; connections: Connection[]; scanned: number; truncated: boolean }
interface ConnectionState { projectId: string; connections: Record<string, Connection>; epochs: Record<string, number>; error: string; truncated: boolean }
export const useAssetConnections = create<ConnectionState>(() => ({ projectId: '', connections: {}, epochs: {}, error: '', truncated: false }));
let queue: Promise<unknown> = Promise.resolve();
export function checkAssetConnections(force = false): Promise<void> {
  const task = queue.then(async () => {
    if (!native) return;
    const before = useEditorStore.getState(), projectId = before.project.id, snapshots = Object.values(before.project.assets);
    if (useAssetConnections.getState().projectId !== projectId) useAssetConnections.setState({ projectId, connections: {}, epochs: {}, error: '', truncated: false });
    if (!snapshots.length) return;
    try {
      const report = await invoke<Report>('reconnect_assets', { projectId, assets: snapshots, force });
      const current = useEditorStore.getState(); if (current.project.id !== projectId) return;
      const valid = (id: string) => current.project.assets[id]?.originalPath === before.project.assets[id]?.originalPath && current.project.assets[id]?.fingerprint === before.project.assets[id]?.fingerprint;
      const assets = report.assets.filter(asset => valid(asset.id));
      current.refreshAssets(assets, Object.fromEntries(snapshots.map(asset => [asset.id, asset.originalPath])));
      const previous = useAssetConnections.getState(), epochs = { ...previous.epochs }, connections = { ...previous.connections };
      for (const connection of report.connections.filter(connection => valid(connection.assetId) || assets.some(asset => asset.id === connection.assetId))) {
        const old = connections[connection.assetId];
        if (old?.status !== connection.status) epochs[connection.assetId] = (epochs[connection.assetId] ?? 0) + 1;
        connections[connection.assetId] = connection;
      }
      useAssetConnections.setState({ projectId, connections, epochs, error: '', truncated: report.truncated });
    } catch (error) { if (useEditorStore.getState().project.id === projectId) useAssetConnections.setState({ error: String(error) }); }
  });
  queue = task.catch(() => {}); return task;
}
export async function locateAssetFolder(): Promise<void> {
  const state = useEditorStore.getState(), projectId = state.project.id;
  const path = await open({ directory: true, multiple: false, title: '定位素材文件夹 · 自动匹配其他未连接图片' });
  if (typeof path !== 'string' || useEditorStore.getState().project.id !== projectId) return;
  await invoke('authorize_asset_root', { projectId, path });
  await checkAssetConnections(true);
}
