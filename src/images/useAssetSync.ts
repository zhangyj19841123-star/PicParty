import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { native } from '../platform/desktop';
import { useEditorStore } from '../state/editorStore';
import { syncCurrentAssets } from './syncAssets';
import { useAssetConnections } from '../projects/assetConnections';

export function useAssetSync(ready: boolean, notify: (message: string) => void) {
  useEffect(() => {
    if (!ready || !native) return;
    let ended = false, checking = false, lastError = '', cleanupFocus: (() => void) | undefined;
    const check = async () => {
      if (ended || checking || document.hidden) return;
      const start = useEditorStore.getState();
      const ids = Object.keys(start.project.assets);
      if (!ids.length) return;
      checking = true;
      try {
        const result = await syncCurrentAssets();
        const current = useEditorStore.getState();
        if (ended || current.project.id !== start.project.id) return;
        const error = result.errors.join('；');
        const offline = Object.values(useAssetConnections.getState().connections).some(c => c.status !== 'connected');
        if (error && error !== lastError && !offline) notify(`原图同步：${error}`);
        lastError = error;
        if (result.assets.length) notify(`已同步 ${result.assets.length} 张修改后的原图`);
      } catch (error) {
        const message = String(error);
        if (!ended && message !== lastError) { lastError = message; notify(`原图同步失败：${message}`); }
      } finally { checking = false; }
    };
    const timer = setInterval(() => { void check(); }, 2000);
    const visible = () => { if (!document.hidden) void check(); };
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    getCurrentWindow().onFocusChanged(event => { if (event.payload) void check(); }).then(fn => { if (ended) fn(); else cleanupFocus = fn; }).catch(error => { if (!ended) notify(String(error)); });
    void check();
    return () => { ended = true; clearInterval(timer); cleanupFocus?.(); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [ready, notify]);
}
