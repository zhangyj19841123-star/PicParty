use collage_core::*;
use serde_json::json;

fn fixture() -> Project {
    serde_json::from_value(json!({
        "schemaVersion": 1, "engineVersion": 1, "id": "background-project", "name": "Background",
        "document": {"width": 120, "height": 180, "colorSpace": "srgb"},
        "pages": [{
            "id": "page", "name": "Page", "templateId": "full", "templateState": {},
            "background": "#a0b1c2", "margin": {"top": 0, "right": 0, "bottom": 0, "left": 0},
            "columnGap": 0, "rowGap": 0,
            "frames": [{"id": "frame", "slotId": "photo", "imageAssetId": null,
                "transform": {"focusX": 0.5, "focusY": 0.5, "zoom": 1, "rotation": 0, "flipX": false, "flipY": false}}],
            "unplaced": []
        }],
        "assets": {"source": {"id": "source", "originalPath": "/photo.png", "fileName": "photo.png",
            "width": 120, "height": 180, "rawWidth": 120, "rawHeight": 180, "orientation": 1,
            "format": "png", "fingerprint": "test", "icc": null}},
        "templates": {"full": {"id": "full", "version": 1, "name": "Full", "category": "single",
            "root": {"kind": "leaf", "slotId": "photo"}, "defaults": {}, "slotOrder": ["photo"]}}
    })).unwrap()
}

fn with_background() -> Project {
    let mut project = fixture();
    project.pages[0].background_image = Some(BackgroundImage {
        image_asset_id: "source".into(), opacity: 0.5, transform: ImageTransform::default(),
    });
    project
}

#[test]
fn legacy_pages_without_background_images_keep_their_solid_color() {
    let project = fixture();
    assert_eq!(project.pages[0].background_image, None);
    validate_project(&project).unwrap();
    let saved = serde_json::to_value(&project).unwrap();
    assert!(saved["pages"][0].get("backgroundImage").is_none());
    let reopened: Project = serde_json::from_value(saved).unwrap();
    assert_eq!(reopened, project);
}

#[test]
fn background_photo_properties_round_trip_separately_from_frame_properties() {
    let mut project = with_background();
    let background = project.pages[0].background_image.as_mut().unwrap();
    background.opacity = 0.37;
    background.transform.focus_x = 0.2;
    background.transform.focus_y = 0.8;
    background.transform.zoom = 2.7;
    background.transform.rotation = -27.0;
    background.transform.adjustments.exposure = 0.75;
    validate_project(&project).unwrap();
    assert_eq!(project.pages[0].frames[0].transform, ImageTransform::default());
    let saved = serde_json::to_value(&project).unwrap();
    assert_eq!(saved["pages"][0]["backgroundImage"]["imageAssetId"], "source");
    assert!(saved["pages"][0].get("background_image").is_none());
    let reopened: Project = serde_json::from_value(saved).unwrap();
    assert_eq!(reopened, project);
    validate_project(&reopened).unwrap();
}

#[test]
fn background_opacity_accepts_invisible_and_opaque_but_rejects_outside_or_nonfinite_values() {
    for opacity in [0.0, 0.001, 0.5, 1.0, -0.001, 1.001, f64::NAN, f64::INFINITY] {
        let mut project = with_background();
        project.pages[0].background_image.as_mut().unwrap().opacity = opacity;
        assert_eq!(validate_project(&project).is_ok(), opacity.is_finite() && (0.0..=1.0).contains(&opacity));
    }
}

#[test]
fn background_photo_requires_an_existing_asset_even_at_zero_opacity() {
    for id in ["", "missing", "bad\nidentifier"] {
        let mut project = with_background();
        let background = project.pages[0].background_image.as_mut().unwrap();
        background.image_asset_id = id.into();
        background.opacity = 0.0;
        assert!(validate_project(&project).is_err());
    }
}

#[test]
fn background_transform_enforces_focus_rotation_adjustment_and_one_to_eight_zoom_limits() {
    for zoom in [0.999, 1.0, 2.0, 8.0, 8.001, 100.0, f64::NAN] {
        let mut project = with_background();
        project.pages[0].background_image.as_mut().unwrap().transform.zoom = zoom;
        assert_eq!(validate_project(&project).is_ok(), zoom.is_finite() && (1.0..=8.0).contains(&zoom));
    }
    for invalid in [
        ImageTransform { focus_x: -0.1, ..Default::default() },
        ImageTransform { focus_y: 1.1, ..Default::default() },
        ImageTransform { rotation: 180.1, ..Default::default() },
        ImageTransform { rotation: f64::NAN, ..Default::default() },
        ImageTransform { flip_x: true, ..Default::default() },
        ImageTransform { adjustments: PhotoAdjustments { exposure: 3.1, ..Default::default() }, ..Default::default() },
    ] {
        let mut project = with_background();
        project.pages[0].background_image.as_mut().unwrap().transform = invalid;
        assert!(validate_project(&project).is_err());
    }
}

#[test]
fn background_settings_do_not_change_the_template_geometry_or_document_dimensions() {
    let mut project = with_background();
    let old_size = project.document.clone();
    let before = layout(&project.pages[0], &project.document, &project.templates["full"]).unwrap();
    let background = project.pages[0].background_image.as_mut().unwrap();
    background.opacity = 0.13;
    background.transform.zoom = 7.0;
    background.transform.rotation = 51.0;
    let after = layout(&project.pages[0], &project.document, &project.templates["full"]).unwrap();
    assert_eq!(before, after);
    assert_eq!(project.document, old_size);
}
