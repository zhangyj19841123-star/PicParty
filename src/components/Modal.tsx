import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export function Modal({ title, children, onClose, className = '', closeOnSpace = false }: { title: string; children: React.ReactNode; onClose(): void; className?: string; closeOnSpace?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,button,select')?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (closeOnSpace && e.code === 'Space')) { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, [tabindex="0"]') ?? [])]
          .filter(item => !item.matches(':disabled, [tabindex="-1"]') && item.getClientRects().length > 0);
        if (!items.length) return;
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && index <= 0) { e.preventDefault(); items.at(-1)?.focus(); }
        else if (!e.shiftKey && index === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => { document.removeEventListener('keydown', handler, true); previous?.focus(); };
  }, [closeOnSpace]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button></header>{children}</div></div>;
}
