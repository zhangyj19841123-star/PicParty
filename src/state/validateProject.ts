import type { DocumentSize, ImageAsset, Project, TemplateDefinition } from '../core/types';
import { normalizeAdjustments } from '../core/photoAdjustments';
import { normalizedFrameRect } from '../core/freeLayout';

const fail = (message: string): never => { throw new Error(`无效项目：${message}`); };
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}应为对象`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label}应为数组，且不超过 ${max} 项`);
  return value as unknown[];
}
function string(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || value.length > max) fail(`${label}应为不超过 ${max} 个字符的文字`);
  return value as string;
}
function id(value: unknown, label: string): string {
  const result = string(value, label, 256);
  if (!result || /[\u0000-\u001f\u007f]/.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) fail(`${label}不合法`);
  return result;
}
function number(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`${label}超出范围`);
  return value as number;
}
function weights(value: unknown, label: string, count?: number) {
  const values = array(value, label, 64);
  if (!values.length || (count !== undefined && values.length !== count)) fail(`${label}分割数量不正确`);
  const sum = values.reduce<number>((total, v) => total + number(v, label, Number.MIN_VALUE, Number.MAX_VALUE), 0);
  if (!Number.isFinite(sum)) fail(`${label}总和超出范围`);
}

export function validateDocument(value: unknown): asserts value is DocumentSize {
  const document = object(value, '页面尺寸');
  const width = number(document.width, '页面宽度', 1, 32768, true);
  const height = number(document.height, '页面高度', 1, 32768, true);
  if (width * height > 268435456) fail('页面总像素不能超过 268 MP');
  if (document.colorSpace !== 'srgb') fail('当前版本仅支持 sRGB');
}

export function validateAsset(value: unknown): asserts value is ImageAsset {
  const asset = object(value, '照片');
  id(asset.id, '照片 ID');
  const path = string(asset.originalPath, '照片路径', 32768);
  if (!path || path.includes('\0')) fail('照片路径不能为空或包含空字符');
  string(asset.fileName, '照片文件名'); string(asset.fingerprint, '照片指纹', 4096);
  for (const key of ['sourceRoot', 'relativePath', 'initialPath']) if (asset[key] !== undefined) {
    if (string(asset[key], '素材路径记录', 32768).includes('\0')) fail('素材路径记录不能包含空字符');
  }
  if (asset.fileSize !== undefined) number(asset.fileSize, '素材文件大小', 0, Number.MAX_SAFE_INTEGER, true);
  if (asset.previousRoots !== undefined) for (const value of array(asset.previousRoots, '历史素材目录', 16)) {
    if (string(value, '历史素材目录', 32768).includes('\0')) fail('历史素材目录不能包含空字符');
  }
  const format = string(asset.format, '照片格式');
  if (!['jpg', 'jpeg', 'png'].includes(format.toLowerCase())) fail('只支持 JPG / PNG 照片');
  if (asset.icc !== null) string(asset.icc, '照片色彩信息', 1048576);
  const width = number(asset.width, '照片宽度', 1, 100000, true);
  const height = number(asset.height, '照片高度', 1, 100000, true);
  const rawWidth = number(asset.rawWidth, '原始照片宽度', 1, 100000, true);
  const rawHeight = number(asset.rawHeight, '原始照片高度', 1, 100000, true);
  const orientation = number(asset.orientation, 'EXIF 方向', 1, 8, true);
  if (width !== (orientation >= 5 ? rawHeight : rawWidth) || height !== (orientation >= 5 ? rawWidth : rawHeight)) fail('照片尺寸与 EXIF 方向不一致');
}

function validateTransform(value: unknown, maxZoom = 100): void {
  const transform = object(value, '照片构图');
  number(transform.focusX, '横向焦点', 0, 1); number(transform.focusY, '纵向焦点', 0, 1); number(transform.zoom, '照片缩放', 1, maxZoom);
  number(transform.rotation, '照片旋转', -180, 180);
  if (transform.flipX !== false || transform.flipY !== false) fail('当前版本不支持翻转构图');
  normalizeAdjustments(transform.adjustments);
}

function validateTemplate(value: unknown, key: string): TemplateDefinition {
  const template = object(value, '模板');
  if (id(template.id, '模板 ID') !== key) fail('模板索引与 ID 不一致');
  number(template.version, '模板版本', 1, Number.MAX_SAFE_INTEGER, true);
  string(template.name, '模板名称'); string(template.category, '模板分类');
  const defaults = object(template.defaults, '模板默认参数');
  if (Object.keys(defaults).length > 128) fail('模板参数过多');
  for (const [parameter, values] of Object.entries(defaults)) { id(parameter, '分割参数'); weights(values, parameter); }
  const slots = new Set<string>();
  const parameters = new Map<string, number>();
  let nodeCount = 0;
  const addSlot = (value: unknown) => {
    const slot = id(value, '照片框名称');
    if (slots.has(slot)) fail('模板照片框名称重复');
    slots.add(slot);
  };
  const parameter = (value: unknown, count: number) => {
    const name = id(value, '分割参数');
    if (parameters.has(name) && parameters.get(name) !== count) fail('共用分割参数的数量不一致');
    parameters.set(name, count); weights(defaults[name], name, count);
  };
  const inspect = (value: unknown, depth: number): void => {
    if (depth > 32 || ++nodeCount > 512) fail('模板嵌套层数或节点数量过多');
    const node = object(value, '模板节点');
    if (node.kind === 'free') {
      if (depth !== 0) fail('自由布局只能作为模板根节点');
      const frames = array(node.frames, '自由照片框', 64);
      if (!frames.length) fail('自由布局不能为空');
      for (const value of frames) {
        const frame = object(value, '自由照片框'); addSlot(frame.slotId);
        normalizedFrameRect(frame.rect);
      }
      return;
    }
    if (node.kind === 'leaf') { addSlot(node.slotId); return; }
    if (node.kind === 'split') {
      if (node.axis !== 'x' && node.axis !== 'y') fail('分割方向不正确');
      const children = array(node.children, '子分割', 64);
      if (children.length < 2) fail('分割至少需要两个区域');
      parameter(node.parameter, children.length); children.forEach(child => inspect(child, depth + 1)); return;
    }
    if (node.kind === 'grid') {
      const rows = array(node.slots, '网格行', 64);
      if (!rows.length) fail('网格不能为空');
      const columns = array(rows[0], '网格列', 64).length;
      if (!columns) fail('网格列不能为空');
      parameter(node.rowsParameter, rows.length); parameter(node.columnsParameter, columns);
      for (const row of rows) {
        const values = array(row, '网格列', 64);
        if (values.length !== columns) fail('网格列数须一致');
        values.forEach(addSlot);
      }
      return;
    }
    fail('未知模板节点类型');
  };
  inspect(template.root, 0);
  const order = array(template.slotOrder, '照片框顺序', 256).map(slot => id(slot, '照片框顺序'));
  if (!order.length || slots.size !== order.length || new Set(order).size !== order.length || order.some(slot => !slots.has(slot))) fail('照片框顺序必须包含所有框且不能重复');
  return template as unknown as TemplateDefinition;
}

/** Structural validation is independent of WASM initialization. The shared Rust
 * core additionally validates layout feasibility at native load/save/export. */
export function validateProject(value: unknown): Project {
  const project = object(value, '项目');
  if (project.schemaVersion !== 1 || project.engineVersion !== 1) fail('文件或渲染版本不受支持，请使用兼容版本打开');
  if (project.canvasSizing !== undefined && project.canvasSizing !== 'fixed' && project.canvasSizing !== 'first-photo') fail('画布尺寸策略不受支持');
  id(project.id, '项目 ID'); string(project.name, '项目名称'); validateDocument(project.document);
  const assets = object(project.assets, '素材库');
  if (Object.keys(assets).length > 20000) fail('照片数量超过 20000');
  for (const [key, asset] of Object.entries(assets)) {
    validateAsset(asset); if (asset.id !== key) fail('照片索引与 ID 不一致');
  }
  const rawTemplates = object(project.templates, '模板库');
  if (Object.keys(rawTemplates).length > 512) fail('模板数量超过 512');
  const templates = new Map(Object.entries(rawTemplates).map(([key, template]) => [key, validateTemplate(template, key)]));
  const pages = array(project.pages, '页面', 1000);
  if (!pages.length) fail('至少需要一个页面');
  const pageIds = new Set<string>(), placementIds = new Set<string>();
  for (const value of pages) {
    const page = object(value, '页面'); const pageId = id(page.id, '页面 ID');
    if (pageIds.has(pageId)) fail('页面 ID 重复'); pageIds.add(pageId);
    string(page.name, '页面名称');
    const template = templates.get(id(page.templateId, '页面模板'));
    if (!template) fail('页面引用的模板不存在');
    if (!/^#[\da-fA-F]{6}$/.test(string(page.background, '页面背景'))) fail('页面背景必须是 #RRGGBB 颜色');
    if (page.backgroundImage !== undefined) {
      const background = object(page.backgroundImage, '背景图片');
      if (!Object.hasOwn(assets, id(background.imageAssetId, '背景图片引用'))) fail('背景图片引用的素材不存在');
      number(background.opacity, '背景图片透明度', 0, 1);
      validateTransform(background.transform, 8);
    }
    const margin = object(page.margin, '页边距');
    for (const side of ['top', 'right', 'bottom', 'left']) number(margin[side], '页边距', 0, 32768);
    if (page.frameRects === undefined && template!.root.kind !== 'free'
      && (Number(margin.left) + Number(margin.right) >= project.document.width || Number(margin.top) + Number(margin.bottom) >= project.document.height)) fail('页边距不能超出页面');
    number(page.columnGap, '列间距', 0, 32768); number(page.rowGap, '行间距', 0, 32768);
    const parameters = object(page.templateState, '页面分割参数');
    if (Object.keys(parameters).length > 128) fail('页面分割参数过多');
    for (const [key, values] of Object.entries(parameters)) {
      id(key, '分割参数'); weights(values, key, template!.defaults[key]?.length);
    }
    const frames = array(page.frames, '照片框', 256), unplaced = array(page.unplaced, '待排照片', 20000);
    const actualSlots = frames.map(frame => id(object(frame, '照片框').slotId, '照片框名称'));
    if (actualSlots.length !== template!.slotOrder.length || new Set(actualSlots).size !== actualSlots.length || actualSlots.some(slot => !template!.slotOrder.includes(slot))) fail('页面照片框与模板不一致');
    if (page.frameRects !== undefined) {
      const rects = object(page.frameRects, '自由照片框位置'), slots = Object.keys(rects);
      if (slots.length !== template!.slotOrder.length || slots.some(slot => !template!.slotOrder.includes(slot))) fail('自由照片框位置必须包含所有框');
      for (const rect of Object.values(rects)) normalizedFrameRect(rect);
    }
    for (const value of [...frames, ...unplaced]) {
      const frame = object(value, '照片框'); const frameId = id(frame.id, '照片框 ID');
      if (placementIds.has(frameId)) fail('照片框 ID 必须在项目内唯一'); placementIds.add(frameId);
      id(frame.slotId, '照片框名称');
      if (frame.imageAssetId !== null && !Object.hasOwn(assets, id(frame.imageAssetId, '照片引用'))) fail('照片框引用的素材不存在');
      validateTransform(frame.transform);
    }
  }
  const normalized = { ...structuredClone(project), canvasSizing: project.canvasSizing ?? 'fixed' } as unknown as Project;
  for (const page of normalized.pages) {
    if (page.backgroundImage) page.backgroundImage.transform.adjustments = normalizeAdjustments(page.backgroundImage.transform.adjustments);
    for (const frame of [...page.frames, ...page.unplaced]) frame.transform.adjustments = normalizeAdjustments(frame.transform.adjustments);
  }
  return normalized;
}
