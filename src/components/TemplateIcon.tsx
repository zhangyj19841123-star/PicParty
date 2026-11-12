import type { TemplateDefinition } from '../core/types';
import { geometry } from '../core/engine';
import { createPage } from '../core/templates';

export function TemplateIcon({ template, selected = false }: { template: TemplateDefinition; selected?: boolean }) {
  const page = createPage(template.id, { [template.id]: template });
  // Free layouts include their own whitespace; show their actual 2:3 geometry.
  if (template.root.kind !== 'free') { page.margin = { top: 4, right: 4, bottom: 4, left: 4 }; page.columnGap = page.rowGap = 4; }
  let rects;
  try { rects = geometry().layout(page, { width: 120, height: 180, colorSpace: 'srgb' }, template).frames; }
  catch { return <span className="template-placeholder" style={{ background: '#fafbfb', border: '1px solid #d5d9dc', borderRadius: 2 }} />; }
  return <svg viewBox="0 0 120 180" aria-hidden="true" className="template-icon">
    <rect x="0.5" y="0.5" width="119" height="179" rx="2" fill="#fff" stroke="#e2e5e7" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
    {rects.map(({ slotId, rect }) => <rect key={slotId} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="2" fill="#fff" stroke={selected ? '#7b8389' : '#b6bdc2'} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />)}
  </svg>;
}
