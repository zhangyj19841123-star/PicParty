//! Thin JSON boundary over collage-core. Production preview and native export execute
//! identical geometry; the browser never receives file handles or source image bytes.
use collage_core::{
    DocumentSize, ImageTransform, Page, PhotoAdjustments, Project, Rect, TemplateDefinition,
};
use wasm_bindgen::prelude::*;

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[wasm_bindgen]
pub fn layout_json(page: &str, document: &str, template: &str) -> Result<String, JsValue> {
    let page: Page = serde_json::from_str(page).map_err(js_error)?;
    let document: DocumentSize = serde_json::from_str(document).map_err(js_error)?;
    let template: TemplateDefinition = serde_json::from_str(template).map_err(js_error)?;
    let resolved = collage_core::layout(&page, &document, &template).map_err(js_error)?;
    serde_json::to_string(&resolved).map_err(js_error)
}

#[wasm_bindgen]
pub fn cover_json(rect: &str, width: f64, height: f64, transform: &str) -> Result<String, JsValue> {
    let rect: Rect = serde_json::from_str(rect).map_err(js_error)?;
    let transform: ImageTransform = serde_json::from_str(transform).map_err(js_error)?;
    let resolved = collage_core::cover(&rect, width, height, &transform).map_err(js_error)?;
    serde_json::to_string(&resolved).map_err(js_error)
}

/// Returns the JSON literal `true` on success; throws a readable JS value on failure.
#[wasm_bindgen]
pub fn validate_project_json(project: &str) -> Result<String, JsValue> {
    let project: Project = serde_json::from_str(project).map_err(js_error)?;
    collage_core::validate_project(&project).map_err(js_error)?;
    Ok("true".to_owned())
}

/// RGBA8 sRGB preview pixels execute the same linear-light photo adjustment
/// pipeline used for original-image export. The Uint8Array alpha is preserved.
#[wasm_bindgen]
pub fn adjust_rgba(pixels: &[u8], adjustments_json: &str) -> Result<Vec<u8>, JsValue> {
    let adjustments: PhotoAdjustments = serde_json::from_str(adjustments_json).map_err(js_error)?;
    collage_core::adjust_srgba8(pixels, &adjustments).map_err(js_error)
}
