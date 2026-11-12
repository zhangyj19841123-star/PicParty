import { useEffect, useState } from 'react';
import { Link2, FolderOpen, RefreshCw, ChevronDown } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { native, relinkAsset } from '../platform/desktop';
import { checkAssetConnections, locateAssetFolder, useAssetConnections } from './assetConnections';
import './assetConnections.css';

export function AssetReconnectPanel({ notify }: { notify(message: string): void }) {
  const projectId = useEditorStore(s => s.project.id), assets = useEditorStore(s => s.project.assets);
  const state = useAssetConnections(), [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!native) return;
    const check = () => { if (!document.hidden) void checkAssetConnections(); };
    check(); const timer = setInterval(check, 2500);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [projectId]);
  const missing = state.projectId === projectId ? Object.values(state.connections).filter(c => c.status !== 'connected' && assets[c.assetId]) : [];
  if (!native || (!missing.length && !state.error)) return null;
  const run = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); } catch (error) { notify(String(error)); } finally { setBusy(false); } };
  return <section className="asset-reconnect" aria-label="素材连接状态">
    <div><Link2 size={14} /><button onClick={() => setExpanded(!expanded)}>{missing.length ? `${missing.length} 张图片未连接` : '素材检查失败'}<ChevronDown size={12} /></button><span>原布局保留</span>
      <button disabled={busy} onClick={() => void run(() => checkAssetConnections(true))}><RefreshCw size={13} />重新扫描</button>
      <button disabled={busy} onClick={() => void run(locateAssetFolder)}><FolderOpen size={13} />定位素材文件夹</button></div>
    {expanded && <div className="asset-reconnect-details">
      {state.error && <p>{state.error}</p>}
      {state.truncated && <p>已完成限定范围扫描。请指定更接近原图的子文件夹以继续匹配。</p>}
      {missing.map(connection => <article key={connection.assetId}><span>{assets[connection.assetId].fileName}{connection.status === 'ambiguous' ? ' · 多个相同内容候选，请确认' : ' · 原图未连接'}</span>
        <button disabled={busy} onClick={() => void run(async () => { const asset = await relinkAsset(connection.assetId); if (asset && useEditorStore.getState().project.id === projectId) { useEditorStore.getState().updateAsset(asset); await checkAssetConnections(true); } })}>定位图片</button>
        {connection.candidates.map(path => <button key={path} title={path} disabled={busy} onClick={() => void run(async () => {
          const { invoke } = await import('@tauri-apps/api/core');
          const asset = await invoke<typeof assets[string]>('relink_asset', { assetId: connection.assetId, path });
          if (useEditorStore.getState().project.id === projectId) { useEditorStore.getState().updateAsset(asset); await checkAssetConnections(true); }
        })}>使用：{path}</button>)}
      </article>)}
    </div>}
  </section>;
}
