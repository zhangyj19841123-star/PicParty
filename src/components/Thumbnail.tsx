import { useEffect, useMemo, useRef, useState } from 'react';
import type { Page, Project } from '../core/types';
import { geometry } from '../core/engine';
import { requestThumbnail, thumbnailKey } from '../images/thumbnails';
import { useEditorStore } from '../state/editorStore';
import { startPhotoPointerDrag, thumbnailPhotoDragAllowed } from '../editor/photoPointerDrag';
import { thumbnailFrameTargets } from '../editor/thumbnailDrop';
import '../editor/thumbnailDrop.css';

export function Thumbnail({ project, page, className = '', interactive = false }: { project: Project; page: Page; className?: string; interactive?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const cancelDrag = useRef<(() => void) | null>(null), suppressUntil = useRef(0);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  const key = thumbnailKey(project, page);
  const targets = useMemo(() => interactive ? thumbnailFrameTargets(page, project.document, geometry().layout(page, project.document, project.templates[page.templateId])) : [], [interactive, page, project.document, project.templates]);
  useEffect(() => () => { cancelDrag.current?.(); }, [project.id, page.id, interactive]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: '180px' });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    const timer = setTimeout(() => requestThumbnail(project, page).then(value => { if (current) setUrl(value); }).catch(() => {}), 80);
    return () => { current = false; clearTimeout(timer); };
  }, [key, visible]);
  const suppressClick = (event: React.MouseEvent) => {
    if (Date.now() > suppressUntil.current) return;
    event.preventDefault(); event.stopPropagation();
  };
  return <div ref={root} data-thumbnail-page={interactive ? page.id : undefined} className={`thumbnail ${interactive ? 'photo-drop-surface' : ''} ${className}`} style={{ aspectRatio: `${project.document.width} / ${project.document.height}`, background: page.background }}
    onClickCapture={suppressClick} onDoubleClickCapture={suppressClick}
    onPointerDown={event => {
      if (!interactive || event.button !== 0 || !event.isPrimary || !thumbnailPhotoDragAllowed(useEditorStore.getState())) return;
      const frameId = (event.target as HTMLElement).closest<HTMLElement>('[data-photo-frame-id]')?.dataset.photoFrameId;
      const frame = page.frames.find(frame => frame.id === frameId), assetId = frame?.imageAssetId;
      if (!frame || !assetId || !project.assets[assetId] || document.querySelector('[role="dialog"]')) return;
      suppressUntil.current = 0; cancelDrag.current?.();
      cancelDrag.current = startPhotoPointerDrag(event.nativeEvent, event.currentTarget, {
        projectId: project.id, from: { pageId: page.id, frameId: frame.id }, assetId, label: project.assets[assetId].fileName,
        isValid: () => {
          const current = useEditorStore.getState();
          return Boolean(root.current?.isConnected && thumbnailPhotoDragAllowed(current) && current.project.id === project.id && !document.querySelector('[role="dialog"]') && current.project.pages.find(item => item.id === page.id)?.frames.find(item => item.id === frame.id)?.imageAssetId === assetId);
        },
        suppressClick: () => { suppressUntil.current = Date.now() + 400; },
      });
    }}>
    {url ? <img src={url} alt={`${page.name}预览`} draggable={false} /> : <div className="thumbnail-loading" />}
    {targets.map(target => <div key={target.ref.frameId} aria-hidden="true" data-photo-frame-page={target.ref.pageId} data-photo-frame-id={target.ref.frameId} className={`thumbnail-frame-target ${page.frames.find(frame => frame.id === target.ref.frameId)?.imageAssetId ? '' : 'empty'}`} style={{ left: `${target.rect.x * 100}%`, top: `${target.rect.y * 100}%`, width: `${target.rect.width * 100}%`, height: `${target.rect.height * 100}%` }} />)}
  </div>;
}
