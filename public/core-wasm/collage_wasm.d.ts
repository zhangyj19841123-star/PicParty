/* tslint:disable */
/* eslint-disable */

/**
 * RGBA8 sRGB preview pixels execute the same linear-light photo adjustment
 * pipeline used for original-image export. The Uint8Array alpha is preserved.
 */
export function adjust_rgba(pixels: Uint8Array, adjustments_json: string): Uint8Array;

export function cover_json(rect: string, width: number, height: number, transform: string): string;

export function layout_json(page: string, document: string, template: string): string;

/**
 * Returns the JSON literal `true` on success; throws a readable JS value on failure.
 */
export function validate_project_json(project: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly adjust_rgba: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly cover_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly layout_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly validate_project_json: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
