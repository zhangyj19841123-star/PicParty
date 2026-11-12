import type { WatermarkPresetSettings } from './watermarkSettings';

export interface DocumentSize { width: number; height: number; colorSpace: 'srgb' }
export interface PhotoAdjustments { exposure: number; temperature: number; tint: number; contrast: number; highlights: number; brightness: number; shadows: number; vibrance: number; saturation: number; blacks: number }
export interface ImageTransform { focusX: number; focusY: number; zoom: number; rotation: number; flipX: boolean; flipY: boolean; adjustments?: PhotoAdjustments }
export interface BackgroundImage { imageAssetId: string; opacity: number; transform: ImageTransform }
export interface Frame { id: string; slotId: string; imageAssetId: string | null; transform: ImageTransform }
export interface ImageAsset { id: string; originalPath: string; fileName: string; width: number; height: number; rawWidth: number; rawHeight: number; orientation: number; format: string; fingerprint: string; icc: string | null; sourceRoot?: string; relativePath?: string; fileSize?: number; initialPath?: string; previousRoots?: string[] }
export interface Margin { top: number; right: number; bottom: number; left: number }
export interface Page { id: string; name: string; templateId: string; templateState: Record<string, number[]>; frameRects?: Record<string, Rect>; background: string; backgroundImage?: BackgroundImage; margin: Margin; columnGap: number; rowGap: number; frames: Frame[]; unplaced: Frame[] }
export type LayoutNode = { kind: 'leaf'; slotId: string } | { kind: 'split'; axis: 'x' | 'y'; parameter: string; children: LayoutNode[] } | { kind: 'grid'; rowsParameter: string; columnsParameter: string; slots: string[][] } | { kind: 'free'; frames: ResolvedFrame[] };
export interface TemplateDefinition { id: string; version: number; name: string; category: string; root: LayoutNode; defaults: Record<string, number[]>; slotOrder: string[] }
export interface Project { schemaVersion: number; engineVersion: number; id: string; name: string; document: DocumentSize; canvasSizing?: 'first-photo' | 'fixed'; pages: Page[]; assets: Record<string, ImageAsset>; templates: Record<string, TemplateDefinition> }
export interface Rect { x: number; y: number; width: number; height: number }
export interface ResolvedFrame { slotId: string; rect: Rect }
export interface SplitHandle { id: string; parameter: string; index: number; axis: 'x' | 'y'; rect: Rect; parent: Rect; gap: number; weights: number[]; min: number; max: number }
export interface ResolvedLayout { frames: ResolvedFrame[]; handles: SplitHandle[] }
export interface CoverResult { scale: number; x: number; y: number; width: number; height: number; centerX: number; centerY: number; rotation: number; crop: Rect }
export interface GeometryEngine { layout(page: Page, document: DocumentSize, template: TemplateDefinition): ResolvedLayout; cover(rect: Rect, width: number, height: number, transform: ImageTransform): CoverResult }
export interface FrameRef { pageId: string; frameId: string }
export interface AssetRuntime { url?: string; status: 'loading' | 'ready' | 'missing' | 'error'; error?: string }
export interface ExportOptions { pageIds: string[]; format: 'jpg' | 'png'; quality: number; directory: string; prefix: string }
export type ExportScope = 'current' | 'selected' | 'all';
export interface CollageExportSettings { scope: ExportScope; format: ExportOptions['format']; quality: number }
export interface ProjectOutputSettings { export?: CollageExportSettings; watermark?: WatermarkPresetSettings }
export interface ExportProgress { jobId: string; completed: number; total: number; pageName: string; state: 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'; errors: string[]; paths: string[] }
