use crate::{
    fail, BackgroundImage, CoreError, DocumentSize, ImageTransform, LayoutNode, Page,
    PhotoAdjustments, Project, Rect, TemplateDefinition,
};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn validate_id(value: &str, label: &str) -> Result<(), CoreError> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return fail(format!(
            "{label} must be a nonempty identifier of at most 256 bytes"
        ));
    }
    Ok(())
}

pub(crate) fn validate_document(document: &DocumentSize) -> Result<(), CoreError> {
    if [document.width, document.height]
        .iter()
        .any(|v| !v.is_finite() || *v < 1.0 || *v > 32768.0 || v.fract() != 0.0)
        || document.width * document.height > 268_435_456.0
    {
        return fail(
            "Document dimensions must be whole pixels, 1–32768 per side and at most 268 megapixels",
        );
    }
    if document.color_space != "srgb" {
        return fail("Only sRGB document color space is supported");
    }
    Ok(())
}

pub(crate) fn validate_transform(transform: &ImageTransform) -> Result<(), CoreError> {
    if [transform.focus_x, transform.focus_y]
        .iter()
        .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
    {
        return fail("Photo focus must be within 0 and 1");
    }
    if !transform.zoom.is_finite() || !(1.0..=100.0).contains(&transform.zoom) {
        return fail("Photo zoom must be within 1 and 100");
    }
    if !transform.rotation.is_finite() || !(-180.0..=180.0).contains(&transform.rotation) {
        return fail("Photo rotation must be within -180 and 180 degrees");
    }
    if transform.flip_x || transform.flip_y {
        return fail("This version cannot render flipped photo placements");
    }
    validate_photo_adjustments(&transform.adjustments)?;
    Ok(())
}

fn validate_background_image(background: &BackgroundImage) -> Result<(), CoreError> {
    validate_id(&background.image_asset_id, "Background image asset ID")?;
    if !background.opacity.is_finite() || !(0.0..=1.0).contains(&background.opacity) {
        return fail("Background image opacity must be finite and within 0 and 1");
    }
    validate_transform(&background.transform)?;
    if background.transform.zoom > 8.0 {
        return fail("Background image zoom must be within 1 and 8");
    }
    Ok(())
}

pub fn validate_photo_adjustments(adjustments: &PhotoAdjustments) -> Result<(), CoreError> {
    if !adjustments.exposure.is_finite() || !(-3.0..=3.0).contains(&adjustments.exposure) {
        return fail("Photo exposure must be finite and within -3 and 3 EV");
    }
    for (name, value) in [
        ("temperature", adjustments.temperature),
        ("tint", adjustments.tint),
        ("contrast", adjustments.contrast),
        ("highlights", adjustments.highlights),
        ("brightness", adjustments.brightness),
        ("shadows", adjustments.shadows),
        ("vibrance", adjustments.vibrance),
        ("saturation", adjustments.saturation),
        ("blacks", adjustments.blacks),
    ] {
        if !value.is_finite() || !(-100.0..=100.0).contains(&value) {
            return fail(format!(
                "Photo {name} must be finite and within -100 and 100"
            ));
        }
    }
    Ok(())
}

pub(crate) fn normalize_weights(
    weights: &[f64],
    count: usize,
    parameter: &str,
) -> Result<Vec<f64>, CoreError> {
    if weights.len() != count || weights.is_empty() || weights.len() > 64 {
        return fail(format!(
            "Parameter '{parameter}' needs exactly {count} weights"
        ));
    }
    let sum: f64 = weights.iter().sum();
    if !sum.is_finite() || sum <= 0.0 || weights.iter().any(|v| !v.is_finite() || *v <= 0.0) {
        return fail(format!(
            "Parameter '{parameter}' needs finite, positive weights"
        ));
    }
    Ok(weights.iter().map(|v| v / sum).collect())
}

pub(crate) fn validate_page_geometry(
    page: &Page,
    document: &DocumentSize,
    ignore_spacing: bool,
) -> Result<(), CoreError> {
    validate_document(document)?;
    if [
        page.margin.top,
        page.margin.right,
        page.margin.bottom,
        page.margin.left,
        page.column_gap,
        page.row_gap,
    ]
    .iter()
    .any(|v| !v.is_finite() || *v < 0.0 || *v > 32768.0)
    {
        return fail("Margins and gaps must be finite, nonnegative document pixels");
    }
    if !ignore_spacing
        && (page.margin.left + page.margin.right >= document.width
            || page.margin.top + page.margin.bottom >= document.height)
    {
        return fail("Margins leave no room for the page content");
    }
    if page.background.len() != 7
        || !page.background.starts_with('#')
        || !page.background[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return fail("Page background must be an opaque #RRGGBB color");
    }
    if let Some(background) = &page.background_image {
        validate_background_image(background)?;
    }
    if page.template_state.len() > 128 {
        return fail("Too many template parameters");
    }
    for (key, values) in &page.template_state {
        validate_id(key, "Template parameter")?;
        normalize_weights(values, values.len(), key)?;
    }
    Ok(())
}

/// Free photo rectangles are saved against the complete page, independent of
/// its current output size. Tiny edge tolerance absorbs interactive float math;
/// zero-size, nonfinite and visibly out-of-page rectangles remain invalid.
pub(crate) fn validate_normalized_rect(rect: &Rect) -> Result<(), CoreError> {
    const EDGE_EPSILON: f64 = 1e-9;
    if [rect.x, rect.y, rect.width, rect.height]
        .iter()
        .any(|value| !value.is_finite())
        || rect.x < 0.0
        || rect.y < 0.0
        || rect.width <= 0.0
        || rect.height <= 0.0
        || rect.width > 1.0
        || rect.height > 1.0
        || rect.x + rect.width > 1.0 + EDGE_EPSILON
        || rect.y + rect.height > 1.0 + EDGE_EPSILON
    {
        return fail(
            "Free photo rectangles must be finite, positive and inside the normalized page",
        );
    }
    Ok(())
}

pub(crate) fn validate_frame_rects(
    page: &Page,
    template: &TemplateDefinition,
) -> Result<(), CoreError> {
    let Some(rectangles) = &page.frame_rects else {
        return Ok(());
    };
    if rectangles.len() != template.slot_order.len()
        || template
            .slot_order
            .iter()
            .any(|slot| !rectangles.contains_key(slot))
    {
        return fail("Page frameRects must contain every template slot exactly once");
    }
    for (slot, rect) in rectangles {
        validate_id(slot, "Frame rectangle slot ID")?;
        validate_normalized_rect(rect)?;
    }
    Ok(())
}

/// Validate template shape before recursion, guarding hostile or future project files.
pub fn validate_template(template: &TemplateDefinition) -> Result<(), CoreError> {
    validate_id(&template.id, "Template ID")?;
    if template.version == 0 {
        return fail("Template version must be positive");
    }
    if template.defaults.len() > 128 {
        return fail("Too many template defaults");
    }
    let mut slots = BTreeSet::new();
    let mut parameters = BTreeMap::new();
    let mut nodes = 0;
    inspect_node(&template.root, 0, &mut nodes, &mut slots, &mut parameters)?;
    if slots.is_empty() || slots.len() > 256 {
        return fail("A template needs between 1 and 256 photo slots");
    }
    let order: BTreeSet<_> = template.slot_order.iter().cloned().collect();
    if order != slots || order.len() != template.slot_order.len() {
        return fail("Template slotOrder must contain every photo slot exactly once");
    }
    for (name, count) in parameters {
        let values = template
            .defaults
            .get(&name)
            .ok_or_else(|| CoreError(format!("Template has no default for '{name}'")))?;
        normalize_weights(values, count, &name)?;
    }
    for (name, values) in &template.defaults {
        validate_id(name, "Template parameter")?;
        normalize_weights(values, values.len(), name)?;
    }
    Ok(())
}

fn parameter(
    name: &str,
    count: usize,
    parameters: &mut BTreeMap<String, usize>,
) -> Result<(), CoreError> {
    validate_id(name, "Template parameter")?;
    if parameters
        .insert(name.to_owned(), count)
        .is_some_and(|previous| previous != count)
    {
        return fail(format!(
            "Shared parameter '{name}' uses inconsistent track counts"
        ));
    }
    Ok(())
}

fn slot(name: &str, slots: &mut BTreeSet<String>) -> Result<(), CoreError> {
    validate_id(name, "Slot ID")?;
    if !slots.insert(name.to_owned()) {
        return fail(format!("Duplicate photo slot '{name}'"));
    }
    Ok(())
}

fn inspect_node(
    node: &LayoutNode,
    depth: usize,
    nodes: &mut usize,
    slots: &mut BTreeSet<String>,
    parameters: &mut BTreeMap<String, usize>,
) -> Result<(), CoreError> {
    *nodes += 1;
    if depth > 32 || *nodes > 512 {
        return fail("Template exceeds the safe nesting or node limit");
    }
    match node {
        LayoutNode::Free { frames } => {
            if depth != 0 {
                return fail("Free photo layouts can only be template roots");
            }
            if !(1..=64).contains(&frames.len()) {
                return fail("A free template needs between 1 and 64 photo slots");
            }
            for frame in frames {
                slot(&frame.slot_id, slots)?;
                validate_normalized_rect(&frame.rect)?;
            }
        }
        LayoutNode::Leaf { slot_id } => slot(slot_id, slots)?,
        LayoutNode::Split {
            parameter: name,
            children,
            ..
        } => {
            if !(2..=64).contains(&children.len()) {
                return fail("Split nodes need between 2 and 64 children");
            }
            parameter(name, children.len(), parameters)?;
            for child in children {
                inspect_node(child, depth + 1, nodes, slots, parameters)?;
            }
        }
        LayoutNode::Grid {
            rows_parameter,
            columns_parameter,
            slots: rows,
        } => {
            if rows.is_empty() || rows.len() > 64 || rows[0].is_empty() || rows[0].len() > 64 {
                return fail("Grid must have between 1 and 64 rows and columns");
            }
            let columns = rows[0].len();
            parameter(rows_parameter, rows.len(), parameters)?;
            parameter(columns_parameter, columns, parameters)?;
            for row in rows {
                if row.len() != columns {
                    return fail("Grid rows must have equal numbers of columns");
                }
                for name in row {
                    slot(name, slots)?;
                }
            }
        }
    }
    Ok(())
}

/// Check semantic compatibility and references before loading, saving or exporting a project.
pub fn validate_project(project: &Project) -> Result<(), CoreError> {
    if project.schema_version != 1 || project.engine_version != 1 {
        return fail("This project requires an unsupported document or rendering version");
    }
    validate_id(&project.id, "Project ID")?;
    validate_document(&project.document)?;
    if project.name.len() > 4096
        || project.pages.is_empty()
        || project.pages.len() > 1000
        || project.assets.len() > 20000
        || project.templates.len() > 512
    {
        return fail("Project exceeds supported document limits or contains no pages");
    }
    for (key, template) in &project.templates {
        if key != &template.id {
            return fail("Template map key does not match its ID");
        }
        validate_template(template)?;
    }
    for (key, asset) in &project.assets {
        validate_id(&asset.id, "Asset ID")?;
        if key != &asset.id {
            return fail("Asset map key does not match its ID");
        }
        if asset.original_path.is_empty()
            || asset.original_path.len() > 32768
            || asset.original_path.contains('\0')
            || asset.file_name.len() > 4096
        {
            return fail("Invalid original photo path or file name");
        }
        if [&asset.source_root, &asset.relative_path, &asset.initial_path].iter().any(|s| s.as_ref().is_some_and(|s| s.len() > 32768 || s.contains('\0')))
            || asset.previous_roots.len() > 16 || asset.previous_roots.iter().any(|s| s.len() > 32768 || s.contains('\0')) {
            return fail("Invalid photo reconnect metadata");
        }
        if !(1..=8).contains(&asset.orientation)
            || [asset.width, asset.height, asset.raw_width, asset.raw_height]
                .iter()
                .any(|v| *v == 0 || *v > 100000)
        {
            return fail("Invalid photo dimensions or EXIF orientation");
        }
        let expected = if asset.orientation >= 5 {
            (asset.raw_height, asset.raw_width)
        } else {
            (asset.raw_width, asset.raw_height)
        };
        if (asset.width, asset.height) != expected {
            return fail("Photo dimensions do not match EXIF-oriented source dimensions");
        }
        if !matches!(
            asset.format.to_ascii_lowercase().as_str(),
            "jpg" | "jpeg" | "png"
        ) {
            return fail("Only JPEG and PNG photos are supported");
        }
    }
    let mut page_ids = BTreeSet::new();
    let mut placement_ids = BTreeSet::new();
    for page in &project.pages {
        validate_id(&page.id, "Page ID")?;
        if !page_ids.insert(&page.id) {
            return fail("Page IDs must be unique");
        }
        if page.name.len() > 4096 || page.unplaced.len() > 20000 {
            return fail("Page exceeds supported limits");
        }
        if let Some(background) = &page.background_image {
            if !project.assets.contains_key(&background.image_asset_id) {
                return fail(format!(
                    "Page background references missing asset '{}'",
                    background.image_asset_id
                ));
            }
        }
        let template = project
            .templates
            .get(&page.template_id)
            .ok_or_else(|| CoreError(format!("Missing template '{}'", page.template_id)))?;
        let expected: BTreeSet<_> = template.slot_order.iter().collect();
        let actual: BTreeSet<_> = page.frames.iter().map(|frame| &frame.slot_id).collect();
        if actual != expected || actual.len() != page.frames.len() {
            return fail(format!(
                "Page '{}' frames do not match its template slots",
                page.name
            ));
        }
        for frame in page.frames.iter().chain(page.unplaced.iter()) {
            validate_id(&frame.id, "Frame ID")?;
            validate_id(&frame.slot_id, "Frame slot ID")?;
            if !placement_ids.insert(&frame.id) {
                return fail("Frame placement IDs must be unique across pages");
            }
            validate_transform(&frame.transform)?;
            if let Some(id) = &frame.image_asset_id {
                if !project.assets.contains_key(id) {
                    return fail(format!("Photo placement references missing asset '{id}'"));
                }
            }
        }
        crate::layout::validate_page_layout(page, &project.document, template)?;
    }
    Ok(())
}
