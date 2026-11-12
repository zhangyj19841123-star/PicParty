import type { GeometryEngine, PhotoAdjustments, Project } from './types';

interface WasmModule {
  default: () => Promise<unknown>;
  layout_json: (page: string, document: string, template: string) => string;
  cover_json: (rect: string, width: number, height: number, transform: string) => string;
  validate_project_json: (project: string) => string;
  adjust_rgba: (pixels: Uint8Array, adjustments: string) => Uint8Array;
}
let engine: GeometryEngine | undefined;
let wasm: WasmModule;
export async function initializeEngine(): Promise<GeometryEngine> {
  const moduleUrl = new URL(`${import.meta.env.BASE_URL}core-wasm/collage_wasm.js`, window.location.href).href;
  wasm = await import(/* @vite-ignore */ moduleUrl) as WasmModule;
  await wasm.default();
  engine = {
    layout: (page, document, template) => JSON.parse(wasm.layout_json(JSON.stringify(page), JSON.stringify(document), JSON.stringify(template))),
    cover: (rect, width, height, transform) => JSON.parse(wasm.cover_json(JSON.stringify(rect), width, height, JSON.stringify(transform))),
  };
  return engine;
}
export function geometry(): GeometryEngine {
  if (!engine) throw new Error('编辑引擎尚未准备完成');
  return engine;
}
export function validateProject(project: Project): void {
  wasm.validate_project_json(JSON.stringify(project));
}
export function adjustPixels(pixels: Uint8Array, adjustments: PhotoAdjustments): Uint8Array {
  return wasm.adjust_rgba(pixels, JSON.stringify(adjustments));
}
