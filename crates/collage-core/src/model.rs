use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentSize {
    pub width: f64,
    pub height: f64,
    pub color_space: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageTransform {
    pub focus_x: f64,
    pub focus_y: f64,
    pub zoom: f64,
    pub rotation: f64,
    pub flip_x: bool,
    pub flip_y: bool,
    /// Nondestructive, per-placement adjustments. Old projects load as neutral.
    #[serde(default)]
    pub adjustments: PhotoAdjustments,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct PhotoAdjustments {
    /// Linear-light exposure compensation, in stops (EV).
    pub exposure: f64,
    pub temperature: f64,
    pub tint: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub brightness: f64,
    pub shadows: f64,
    pub vibrance: f64,
    pub saturation: f64,
    pub blacks: f64,
}

impl Default for ImageTransform {
    fn default() -> Self {
        Self {
            focus_x: 0.5,
            focus_y: 0.5,
            zoom: 1.0,
            rotation: 0.0,
            flip_x: false,
            flip_y: false,
            adjustments: PhotoAdjustments::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame {
    pub id: String,
    pub slot_id: String,
    pub image_asset_id: Option<String>,
    pub transform: ImageTransform,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageAsset {
    pub id: String,
    pub original_path: String,
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    pub raw_width: u32,
    pub raw_height: u32,
    pub orientation: u8,
    pub format: String,
    pub fingerprint: String,
    pub icc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub previous_roots: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Margin {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

/// A nondestructive photo layer covering the whole page behind its photo frames.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundImage {
    pub image_asset_id: String,
    pub opacity: f64,
    pub transform: ImageTransform,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Page {
    pub id: String,
    pub name: String,
    pub template_id: String,
    pub template_state: BTreeMap<String, Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_rects: Option<BTreeMap<String, Rect>>,
    pub background: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_image: Option<BackgroundImage>,
    pub margin: Margin,
    pub column_gap: f64,
    pub row_gap: f64,
    pub frames: Vec<Frame>,
    pub unplaced: Vec<Frame>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    X,
    Y,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LayoutNode {
    Free {
        frames: Vec<ResolvedFrame>,
    },
    Leaf {
        slot_id: String,
    },
    Split {
        axis: Axis,
        parameter: String,
        children: Vec<LayoutNode>,
    },
    Grid {
        rows_parameter: String,
        columns_parameter: String,
        slots: Vec<Vec<String>>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateDefinition {
    pub id: String,
    pub version: u32,
    pub name: String,
    pub category: String,
    pub root: LayoutNode,
    pub defaults: BTreeMap<String, Vec<f64>>,
    pub slot_order: Vec<String>,
}

/// A new project may take its size from the first imported photo. Legacy
/// documents retain their saved dimensions and therefore default to Fixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CanvasSizing {
    FirstPhoto,
    #[default]
    Fixed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub schema_version: u32,
    pub engine_version: u32,
    pub id: String,
    pub name: String,
    pub document: DocumentSize,
    #[serde(default)]
    pub canvas_sizing: CanvasSizing,
    pub pages: Vec<Page>,
    pub assets: BTreeMap<String, ImageAsset>,
    pub templates: BTreeMap<String, TemplateDefinition>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedFrame {
    pub slot_id: String,
    pub rect: Rect,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SplitHandle {
    pub id: String,
    pub parameter: String,
    pub index: usize,
    pub axis: Axis,
    pub rect: Rect,
    pub parent: Rect,
    pub gap: f64,
    pub weights: Vec<f64>,
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedLayout {
    pub frames: Vec<ResolvedFrame>,
    pub handles: Vec<SplitHandle>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoverResult {
    pub scale: f64,
    /// Top-left of the scaled source before rotating about center_x/center_y.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub center_x: f64,
    pub center_y: f64,
    /// Clockwise degrees in the document's downward-positive Y coordinates.
    pub rotation: f64,
    /// Source-axis bounding box of the inverse-mapped frame; rotated rendering
    /// must use the center and rotation rather than stretching this rectangle.
    pub crop: Rect,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportOptions {
    pub page_ids: Vec<String>,
    pub format: String,
    pub quality: u8,
    pub directory: String,
    pub prefix: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportProgress {
    pub job_id: String,
    pub completed: usize,
    pub total: usize,
    pub page_name: String,
    pub state: String,
    pub errors: Vec<String>,
    pub paths: Vec<String>,
}
