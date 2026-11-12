use crate::{fail, validation::validate_transform, CoreError, CoverResult, ImageTransform, Rect};

/// Resolve a rotated cover without modifying the saved focus intent. Source sizes
/// and crop coordinates are EXIF-oriented original pixels, even for proxy previews.
/// Positive angles rotate clockwise in document coordinates. Inverse-rotating the
/// frame gives the minimum source-axis box that must fit inside the photo.
pub fn cover(
    rect: &Rect,
    width: f64,
    height: f64,
    transform: &ImageTransform,
) -> Result<CoverResult, CoreError> {
    validate_transform(transform)?;
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || [rect.width, rect.height, width, height]
            .iter()
            .any(|v| !v.is_finite() || *v <= 0.0 || *v > 1_000_000.0)
    {
        return fail("Cover requires finite, positive source and frame dimensions");
    }
    let (sin, cos) = transform.rotation.to_radians().sin_cos();
    let projected_width = rect.width * cos.abs() + rect.height * sin.abs();
    let projected_height = rect.width * sin.abs() + rect.height * cos.abs();
    let scale = (projected_width / width).max(projected_height / height) * transform.zoom;
    let rendered_width = width * scale;
    let rendered_height = height * scale;
    if !scale.is_finite()
        || scale <= 0.0
        || !rendered_width.is_finite()
        || !rendered_height.is_finite()
    {
        return fail("Cover dimensions exceed the supported numeric range");
    }
    // Clamp the effective focus so all inverse-mapped frame corners stay on the
    // original. Min guards absorb floating-point noise at exactly cover scale.
    let crop_width = (projected_width / scale).min(width);
    let crop_height = (projected_height / scale).min(height);
    let half_crop_width = crop_width / 2.0;
    let half_crop_height = crop_height / 2.0;
    let focus_x = (transform.focus_x * width).clamp(half_crop_width, width - half_crop_width);
    let focus_y = (transform.focus_y * height).clamp(half_crop_height, height - half_crop_height);
    let source_offset_x = (width / 2.0 - focus_x) * scale;
    let source_offset_y = (height / 2.0 - focus_y) * scale;
    let center_x = rect.x + rect.width / 2.0 + cos * source_offset_x - sin * source_offset_y;
    let center_y = rect.y + rect.height / 2.0 + sin * source_offset_x + cos * source_offset_y;
    let x = center_x - rendered_width / 2.0;
    let y = center_y - rendered_height / 2.0;
    if [center_x, center_y, x, y].iter().any(|v| !v.is_finite()) {
        return fail("Cover position exceeds the supported numeric range");
    }
    Ok(CoverResult {
        scale,
        x,
        y,
        width: rendered_width,
        height: rendered_height,
        center_x,
        center_y,
        rotation: transform.rotation,
        crop: Rect {
            x: (focus_x - half_crop_width).clamp(0.0, (width - crop_width).max(0.0)),
            y: (focus_y - half_crop_height).clamp(0.0, (height - crop_height).max(0.0)),
            width: crop_width,
            height: crop_height,
        },
    })
}
