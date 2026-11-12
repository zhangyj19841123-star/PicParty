import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import type { ImageAsset, Project, ExportOptions, ExportProgress } from '../core/types';
import { brand } from '../brand';

export const native = isTauri();
const browserFiles = new Map<string, File>();
const browserUrls = new Map<string, string>();

export async function selectPhotos(): Promise<string[] | null> {
  if (!native) return null;
  const result = await open({ multiple: true, title: '导入照片', filters: [{ name: '照片', extensions: ['jpg', 'jpeg', 'png'] }] });
  return result ? (Array.isArray(result) ? result : [result]) : [];
}
export async function importPaths(paths: string[]): Promise<{ assets: ImageAsset[]; errors: string[] }> {
  return invoke('import_assets', { paths });
}
export async function importBrowserFiles(files: File[]): Promise<{ assets: ImageAsset[]; errors: string[] }> {
  const assets: ImageAsset[] = [], errors: string[] = [];
  for (const file of files) {
    if (!/\.(jpe?g|png)$/i.test(file.name)) { errors.push(`${file.name}：暂时支持 JPG / PNG`); continue; }
    try {
      const objectUrl = URL.createObjectURL(file);
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = objectUrl;
      });
      const id = crypto.randomUUID();
      const width = image.naturalWidth, height = image.naturalHeight;
      const max = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * max); canvas.height = Math.round(image.naturalHeight * max);
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(v => v ? resolve(v) : reject(new Error('无法生成预览')), 'image/png'));
      const url = URL.createObjectURL(blob); URL.revokeObjectURL(objectUrl); image.src = ''; canvas.width = canvas.height = 0;
      browserFiles.set(id, file); browserUrls.set(id, url);
      assets.push({ id, originalPath: file.name, fileName: file.name, width, height, rawWidth: width, rawHeight: height, orientation: 1, format: file.type === 'image/png' ? 'png' : 'jpeg', fingerprint: `${file.size}-${file.lastModified}`, icc: null });
    } catch { errors.push(`${file.name}：无法读取这张照片`); }
  }
  return { assets, errors };
}
export async function proxyUrl(asset: ImageAsset, maxSize = 2048): Promise<string> {
  const assetId = asset.id;
  if (!native) {
    const url = browserUrls.get(assetId); if (!url) throw new Error('请重新导入此照片；浏览器预览不保留本地文件授权'); return url;
  }
  const path = await invoke<string>('get_proxy', { assetId, maxSize, asset });
  return convertFileSrc(path);
}
export async function chooseProject(): Promise<string | null> {
  if (!native) return null;
  // AppKit can disable unregistered custom extensions in the native filter.
  // Validate after selection; the native loader also validates the JSON project.
  const path = await open({ multiple: false, title: `打开${brand.name}项目（.collage）` });
  if (!path || Array.isArray(path)) return null;
  if (!path.toLowerCase().endsWith('.collage')) throw new Error('请选择 .collage 格式的拼图项目。');
  return path;
}
export async function loadProject(path: string): Promise<Project> { return invoke('load_project', { path }); }
export async function registerProject(project: Project): Promise<{ missing: string[] }> {
  return native ? invoke('register_project', { project }) : { missing: Object.keys(project.assets).filter(id => !browserUrls.has(id)) };
}
export async function saveProject(project: Project, currentPath?: string | null, saveAs = false): Promise<string | null> {
  if (!native) {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${project.name}.collage`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return project.name + '.collage';
  }
  const path = !saveAs && currentPath ? currentPath : await save({ defaultPath: `${project.name}.collage`, filters: [{ name: `${brand.name} 项目`, extensions: ['collage'] }] });
  if (!path) return null;
  await invoke('save_project', { project, path }); return path;
}
export async function chooseExportDirectory(): Promise<string | null> {
  return await open({ directory: true, title: '选择导出文件夹' }) as string | null;
}
export async function startExport(project: Project, options: ExportOptions): Promise<string> {
  if (!native) throw new Error('请在 macOS 应用中使用原图导出。浏览器仅用于界面预览。');
  return invoke('start_export', { project, options });
}
export async function cancelExport(jobId: string): Promise<void> { return invoke('cancel_export', { jobId }); }
export async function getExportProgress(jobId: string): Promise<ExportProgress> { return invoke('get_export_progress', { jobId }); }
export async function onExportProgress(callback: (progress: ExportProgress) => void) {
  if (!native) return () => {};
  return listen<ExportProgress>('export-progress', event => callback(event.payload));
}
export async function relinkAsset(assetId: string): Promise<ImageAsset | null> {
  const paths = await selectPhotos();
  if (!paths?.length) return null;
  return invoke('relink_asset', { assetId, path: paths[0] });
}
export async function openInPhotoshop(asset: ImageAsset): Promise<void> {
  if (!native) throw new Error('请在 macOS 桌面应用中使用 Photoshop 编辑。');
  return invoke('open_in_photoshop', { assetId: asset.id, asset });
}
export async function refreshAssets(assets: ImageAsset[]): Promise<{ assets: ImageAsset[]; errors: string[] }> {
  return native ? invoke('refresh_assets', { assets }) : { assets: [], errors: [] };
}

/** Apple's screen magnifier returns an opaque sRGB color, or null on Escape. */
export async function sampleScreenColor(): Promise<string | null> {
  return native ? invoke<string | null>('sample_screen_color') : null;
}
