import { geometry } from '../core/engine';
import type { Page, Project } from '../core/types';
import { acquireImage } from './cache';
import { adjustedImage } from './adjustments';
import { backgroundPreview } from './backgroundPreview';

interface ThumbnailImage { url: string; blob: Blob; complete: boolean }
const thumbnails = new Map<string, ThumbnailImage>();
let chain = Promise.resolve();
export function thumbnailKey(project: Project, page: Page) {
  const background = page.backgroundImage ? project.assets[page.backgroundImage.imageAssetId] : undefined;
  return JSON.stringify([project.document, page, background && [background.fingerprint, background.originalPath], page.frames.map(frame => frame.imageAssetId ? [project.assets[frame.imageAssetId]?.fingerprint, project.assets[frame.imageAssetId]?.originalPath] : ''), project.templates[page.templateId]]);
}
export async function requestThumbnail(project: Project, page: Page): Promise<string> {
  return (await composeThumbnail(project, page)).url;
}

export async function requestThumbnailBlob(project: Project, page: Page): Promise<Blob> {
  const thumbnail = await composeThumbnail(project, page, true);
  if (!thumbnail.complete) throw new Error('部分原图暂时不可用，无法更新项目封面');
  return thumbnail.blob;
}

function composeThumbnail(project: Project, page: Page, requireComplete = false): Promise<ThumbnailImage> {
  const key = thumbnailKey(project, page);
  const cached = () => {
    const image = thumbnails.get(key);
    return image && (!requireComplete || image.complete) ? image : undefined;
  };
  const existing = cached();
  if (existing) return Promise.resolve(existing);
  const task = chain.then(async () => {
    const existing = cached();
    if (existing) return existing;
    let complete = true;
    const size = project.document;
    const scale = Math.min(512 / size.width, 512 / size.height);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(size.width * scale)); canvas.height = Math.max(1, Math.round(size.height * scale));
    const ctx = canvas.getContext('2d')!; ctx.scale(scale, scale); ctx.fillStyle = page.background; ctx.fillRect(0, 0, size.width, size.height);
    if (page.backgroundImage) {
      const background = page.backgroundImage, asset = project.assets[background.imageAssetId];
      if (asset) {
        const lease = acquireImage(asset, 512);
        try {
          const image = backgroundPreview(adjustedImage(await lease.promise, background.transform.adjustments), page.background, background.opacity);
          const cover = geometry().cover({ x: 0, y: 0, width: size.width, height: size.height }, asset.width, asset.height, background.transform);
          ctx.save(); ctx.beginPath(); ctx.rect(0, 0, size.width, size.height); ctx.clip();
          ctx.translate(cover.centerX, cover.centerY); ctx.rotate(cover.rotation * Math.PI / 180);
          ctx.drawImage(image, -cover.width / 2, -cover.height / 2, cover.width, cover.height); ctx.restore();
        } catch { complete = false; }
        finally { lease.release(); }
      }
    }
    const resolved = geometry().layout(page, size, project.templates[page.templateId]);
    for (const frame of resolved.frames) {
      const placement = page.frames.find(item => item.slotId === frame.slotId);
      const asset = placement?.imageAssetId ? project.assets[placement.imageAssetId] : undefined;
      const rect = frame.rect;
      // Empty frames are editing targets, not painted layers. In an overlapping
      // layout they must reveal the earlier photo, just as native export does.
      if (!asset || !placement) continue;
      const lease = acquireImage(asset, 512);
      try {
        const image = adjustedImage(await lease.promise, placement.transform.adjustments);
        const cover = geometry().cover(rect, asset.width, asset.height, placement.transform);
        ctx.save();
        ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
        ctx.translate(cover.centerX, cover.centerY); ctx.rotate(cover.rotation * Math.PI / 180);
        ctx.drawImage(image, -cover.width / 2, -cover.height / 2, cover.width, cover.height);
        ctx.restore();
      } catch { complete = false; ctx.fillStyle = '#f1dfd9'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height); }
      finally { lease.release(); }
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('缩略图生成失败')), 'image/jpeg', 0.85));
    const url = URL.createObjectURL(blob); canvas.width = canvas.height = 0;
    const thumbnail = { url, blob, complete };
    if (requireComplete && !complete) URL.revokeObjectURL(url);
    else {
      const previous = thumbnails.get(key);
      if (previous) URL.revokeObjectURL(previous.url);
      thumbnails.set(key, thumbnail);
      while (thumbnails.size > 180) { const oldest = thumbnails.keys().next().value!; URL.revokeObjectURL(thumbnails.get(oldest)!.url); thumbnails.delete(oldest); }
    }
    return thumbnail;
  });
  chain = task.then(() => {}, () => {});
  return task;
}
