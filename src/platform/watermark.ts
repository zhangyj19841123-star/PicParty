import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { ExportProgress, ImageAsset, Rect } from '../core/types';
import type { LayerPlacement, TextWatermark } from '../core/watermarkSettings';
import { importPaths, native } from './desktop';

export interface WatermarkOptions {
  assets: ImageAsset[];
  watermark: ImageAsset | null;
  inputDirectory: string;
  directory: string;
  placement: LayerPlacement | null;
  text: TextWatermark | null;
  format: 'jpg' | 'png';
  quality: number;
}
export interface WatermarkScan { directory: string; assets: ImageAsset[]; errors: string[]; skipped: number }
export type WatermarkLayer = 'image' | 'text';
export interface WatermarkPreviewRequest {
  photo: ImageAsset;
  watermark: ImageAsset | null;
  placement: LayerPlacement | null;
  text: TextWatermark | null;
  maxSize: 256 | 512 | 1024;
}
export interface WatermarkPreview { url: string; layers: Partial<Record<WatermarkLayer, Rect>> }
const requireDesktop = () => {
  if (!native) throw new Error('请在 macOS 桌面应用中使用批量水印。');
};

export async function selectWatermarkReference(): Promise<ImageAsset | null> {
  requireDesktop();
  const path = await open({ multiple: false, title: '选择水印参考照片', filters: [{ name: '照片', extensions: ['jpg', 'jpeg', 'png'] }] });
  if (!path || Array.isArray(path)) return null;
  const result = await importPaths([path]);
  if (!result.assets.length) throw new Error(result.errors.join('\n') || '无法读取参考照片');
  return result.assets[0];
}

export async function importWatermarkPath(path: string): Promise<ImageAsset> {
  requireDesktop();
  return invoke('import_watermark', { path });
}
export async function selectPNGWatermark(): Promise<ImageAsset | null> {
  requireDesktop();
  const path = await open({ multiple: false, title: '选择透明 PNG 水印', filters: [{ name: '透明 PNG', extensions: ['png'] }] });
  return path && !Array.isArray(path) ? importWatermarkPath(path) : null;
}
export async function chooseWatermarkDirectory(kind: 'input' | 'output', defaultPath?: string): Promise<string | null> {
  requireDesktop();
  return await open({ directory: true, multiple: false, title: kind === 'input' ? '选择批量照片文件夹' : '选择水印输出文件夹', defaultPath }) as string | null;
}
export async function scanWatermarkDirectory(directory: string): Promise<WatermarkScan> {
  requireDesktop();
  return invoke('scan_watermark_directory', { directory });
}
export async function startWatermark(options: WatermarkOptions): Promise<string> {
  requireDesktop();
  return invoke('start_watermark', { options });
}
export async function listWatermarkFonts(): Promise<string[]> {
  requireDesktop();
  return invoke('list_watermark_fonts');
}
export async function renderWatermarkPreview(request: WatermarkPreviewRequest): Promise<WatermarkPreview> {
  requireDesktop();
  return invoke('render_watermark_preview', { ...request });
}
export async function cancelWatermark(jobId: string): Promise<void> { return invoke('cancel_watermark', { jobId }); }
export async function getWatermarkProgress(jobId: string): Promise<ExportProgress | null> { return invoke('get_watermark_progress', { jobId }); }
export async function onWatermarkProgress(callback: (progress: ExportProgress) => void) {
  if (!native) return () => {};
  return listen<ExportProgress>('watermark-progress', event => callback(event.payload));
}
export async function onWatermarkCloseBlocked(callback: () => void) {
  if (!native) return () => {};
  return listen('watermark-close-blocked', callback);
}
