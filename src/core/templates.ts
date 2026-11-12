import type { DocumentSize, ImageTransform, LayoutNode, Page, Project, TemplateDefinition } from './types';
import { defaultAdjustments } from './photoAdjustments';

export const defaultTransform = (): ImageTransform => ({
  focusX: 0.5, focusY: 0.5, zoom: 1, rotation: 0, flipX: false, flipY: false, adjustments: defaultAdjustments(),
});

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const leaf = (slotId: string): LayoutNode => ({ kind: 'leaf', slotId });
const split = (axis: 'x' | 'y', parameter: string, children: LayoutNode[]): LayoutNode => ({ kind: 'split', axis, parameter, children });
const definition = (id: string, name: string, category: string, root: LayoutNode, defaults: Record<string, number[]>, slotOrder: string[]): TemplateDefinition => ({ id, name, category, version: 1, root, defaults, slotOrder });

type FrameBounds = readonly [x: number, y: number, width: number, height: number];
const designed = (id: string, name: string, bounds: readonly FrameBounds[]): TemplateDefinition => {
  const frames = bounds.map(([x, y, width, height], index) => ({ slotId: String.fromCharCode(97 + index), rect: { x, y, width, height } }));
  return definition(id, name, `${frames.length} 张`, { kind: 'free', frames }, {}, frames.map(frame => frame.slotId));
};

/** Original photographic compositions: negative space belongs to the frame geometry,
 * so changing output pixels preserves the composition and keeps page spacing at zero. */
const DESIGNED_TEMPLATES: TemplateDefinition[] = [
  designed('design-top-full-bottom-inset', '上满下留白', [
    [0, 0, 1, 0.6], [0.16, 0.68, 0.68, 0.24],
  ]),
  designed('design-top-inset-bottom-full', '上留白下满', [
    [0.16, 0.08, 0.68, 0.24], [0, 0.4, 1, 0.6],
  ]),
  designed('design-offset-diptych', '错位双片', [
    [0.08, 0.06, 0.72, 0.4], [0.22, 0.56, 0.7, 0.38],
  ]),
  designed('design-portrait-diptych', '竖片双联', [
    [0.06, 0.08, 0.54, 0.82], [0.66, 0.26, 0.28, 0.54],
  ]),
  designed('design-hero-two-details', '主图双细节', [
    [0, 0, 1, 0.56], [0.08, 0.64, 0.39, 0.28], [0.53, 0.64, 0.39, 0.28],
  ]),
  designed('design-offset-triptych', '三片错落', [
    [0.08, 0.06, 0.58, 0.3], [0.3, 0.39, 0.62, 0.29], [0.12, 0.73, 0.5, 0.22],
  ]),
  designed('design-portrait-two-details', '竖片与双细节', [
    [0.06, 0.07, 0.55, 0.86], [0.67, 0.17, 0.27, 0.3], [0.67, 0.54, 0.27, 0.3],
  ]),
  designed('design-centered-triptych', '三联留白', [
    [0.16, 0.07, 0.68, 0.25], [0.08, 0.37, 0.84, 0.26], [0.2, 0.69, 0.6, 0.24],
  ]),
  designed('design-hero-three-details', '主图三细节', [
    [0, 0, 1, 0.6], [0.07, 0.7, 0.26, 0.21], [0.37, 0.7, 0.26, 0.21], [0.67, 0.7, 0.26, 0.21],
  ]),
  designed('design-gallery-four', '画廊四联', [
    [0.07, 0.06, 0.405, 0.32], [0.525, 0.13, 0.405, 0.32], [0.07, 0.46, 0.405, 0.42], [0.525, 0.55, 0.405, 0.32],
  ]),
  designed('design-portrait-three-details', '竖图三细节', [
    [0.06, 0.07, 0.58, 0.86], [0.7, 0.1, 0.24, 0.23], [0.7, 0.39, 0.24, 0.23], [0.7, 0.68, 0.24, 0.23],
  ]),
  designed('design-film-four', '四片影记', [
    [0.1, 0.06, 0.8, 0.31], [0.1, 0.415, 0.38, 0.21], [0.52, 0.415, 0.38, 0.21], [0.1, 0.67, 0.8, 0.27],
  ]),
];

export const DESIGNED_TEMPLATE_IDS: ReadonlySet<string> = new Set(DESIGNED_TEMPLATES.map(template => template.id));

/** Independent page templates. These never describe the number of visible pages. */
export const TEMPLATE_LIST: TemplateDefinition[] = [
  definition('single', '整页', '1 张', leaf('a'), {}, ['a']),
  definition('split-y', '上下双拼', '2 张', split('y', 'rows', [leaf('a'), leaf('b')]), { rows: [0.5, 0.5] }, ['a', 'b']),
  definition('split-x', '左右双拼', '2 张', split('x', 'columns', [leaf('a'), leaf('b')]), { columns: [0.5, 0.5] }, ['a', 'b']),
  definition('three-y', '纵向三拼', '3 张', split('y', 'rows', [leaf('a'), leaf('b'), leaf('c')]), { rows: [1 / 3, 1 / 3, 1 / 3] }, ['a', 'b', 'c']),
  definition('three-x', '横向三拼', '3 张', split('x', 'columns', [leaf('a'), leaf('b'), leaf('c')]), { columns: [1 / 3, 1 / 3, 1 / 3] }, ['a', 'b', 'c']),
  definition('grid-4', '四宫格', '4 张', { kind: 'grid', rowsParameter: 'rows', columnsParameter: 'columns', slots: [['a', 'b'], ['c', 'd']] }, { rows: [0.5, 0.5], columns: [0.5, 0.5] }, ['a', 'b', 'c', 'd']),
  definition('top-one', '上一下二', '3 张', split('y', 'rows', [leaf('a'), split('x', 'bottomColumns', [leaf('b'), leaf('c')])]), { rows: [0.6, 0.4], bottomColumns: [0.5, 0.5] }, ['a', 'b', 'c']),
  definition('bottom-one', '上二下一', '3 张', split('y', 'rows', [split('x', 'topColumns', [leaf('a'), leaf('b')]), leaf('c')]), { rows: [0.4, 0.6], topColumns: [0.5, 0.5] }, ['a', 'b', 'c']),
  definition('left-one', '左一右二', '3 张', split('x', 'columns', [leaf('a'), split('y', 'rightRows', [leaf('b'), leaf('c')])]), { columns: [0.6, 0.4], rightRows: [0.5, 0.5] }, ['a', 'b', 'c']),
  definition('right-one', '左二右一', '3 张', split('x', 'columns', [split('y', 'leftRows', [leaf('a'), leaf('b')]), leaf('c')]), { columns: [0.4, 0.6], leftRows: [0.5, 0.5] }, ['a', 'b', 'c']),
  definition('hero-three', '一大三小', '4 张', split('y', 'rows', [leaf('a'), split('x', 'bottomColumns', [leaf('b'), leaf('c'), leaf('d')])]), { rows: [0.68, 0.32], bottomColumns: [1 / 3, 1 / 3, 1 / 3] }, ['a', 'b', 'c', 'd']),
  definition('uneven-y', '上下错落', '2 张', split('y', 'rows', [leaf('a'), leaf('b')]), { rows: [0.65, 0.35] }, ['a', 'b']),
  definition('uneven-x', '左右错落', '2 张', split('x', 'columns', [leaf('a'), leaf('b')]), { columns: [0.65, 0.35] }, ['a', 'b']),
  ...DESIGNED_TEMPLATES,
];

export const BUILTIN_TEMPLATES: Record<string, TemplateDefinition> = Object.fromEntries(TEMPLATE_LIST.map(template => [template.id, template]));

export function createPage(templateId = 'split-y', templates: Record<string, TemplateDefinition> = BUILTIN_TEMPLATES, _document: DocumentSize = { width: 4000, height: 6000, colorSpace: 'srgb' }): Page {
  const template = templates[templateId];
  if (!template) throw new Error(`找不到模板：${templateId}`);
  return {
    id: newId('page'), name: '新页面', templateId, templateState: structuredClone(template.defaults),
    background: '#ffffff', margin: { top: 0, right: 0, bottom: 0, left: 0 }, columnGap: 0, rowGap: 0,
    frames: template.slotOrder.map(slotId => ({ id: newId('frame'), slotId, imageAssetId: null, transform: defaultTransform() })),
    unplaced: [],
  };
}

export interface NewProjectOptions { name?: string; width?: number; height?: number; canvasSizing?: 'first-photo' | 'fixed' }

export function createProject(options: NewProjectOptions = {}): Project {
  const width = options.width ?? 4000;
  const height = options.height ?? 6000;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32768 || height > 32768 || width * height > 268435456) throw new Error('页面尺寸须为正整数，单边不超过 32768 px，总像素不超过 268 MP');
  const document: DocumentSize = { width, height, colorSpace: 'srgb' };
  const name = options.name?.trim() || '未命名项目';
  if (name.length > 4096) throw new Error('项目名称不能超过 4096 个字符');
  const page = createPage('split-y', BUILTIN_TEMPLATES, document);
  page.name = '页面 01';
  return {
    schemaVersion: 1, engineVersion: 1, id: newId('project'), name, canvasSizing: options.canvasSizing ?? 'first-photo',
    document, pages: [page], assets: {},
    templates: { 'split-y': structuredClone(BUILTIN_TEMPLATES['split-y']) },
  };
}
