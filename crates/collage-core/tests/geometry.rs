use collage_core::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn fixture(
    root: Value,
    defaults: Value,
    slots: &[&str],
) -> (Page, DocumentSize, TemplateDefinition) {
    let template: TemplateDefinition = serde_json::from_value(json!({
        "id": "test", "version": 1, "name": "Test", "category": "test",
        "root": root, "defaults": defaults, "slotOrder": slots,
    }))
    .unwrap();
    let page: Page = serde_json::from_value(json!({
        "id": "page-1", "name": "Page 1", "templateId": "test", "templateState": {},
        "background": "#ffffff", "margin": {"top": 30, "right": 40, "bottom": 50, "left": 60},
        "columnGap": 20, "rowGap": 40,
        "frames": slots.iter().map(|slot| json!({
            "id": format!("frame-{slot}"), "slotId": slot, "imageAssetId": null,
            "transform": {"focusX": 0.5, "focusY": 0.5, "zoom": 1, "rotation": 0, "flipX": false, "flipY": false}
        })).collect::<Vec<_>>(), "unplaced": [],
    })).unwrap();
    (
        page,
        DocumentSize {
            width: 1000.0,
            height: 1600.0,
            color_space: "srgb".into(),
        },
        template,
    )
}

fn leaf(slot: &str) -> Value {
    json!({"kind": "leaf", "slotId": slot})
}
fn split(axis: &str, parameter: &str, children: Vec<Value>) -> Value {
    json!({"kind":"split", "axis":axis, "parameter":parameter, "children":children})
}
fn close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
}

fn source_at(result: &CoverResult, width: f64, height: f64, x: f64, y: f64) -> (f64, f64) {
    let (sin, cos) = result.rotation.to_radians().sin_cos();
    let dx = x - result.center_x;
    let dy = y - result.center_y;
    (
        width / 2.0 + (cos * dx + sin * dy) / result.scale,
        height / 2.0 + (-sin * dx + cos * dy) / result.scale,
    )
}

#[test]
fn nested_layout_uses_axis_specific_gap_and_applies_margin_once() {
    let (mut page, document, template) = fixture(
        split(
            "y",
            "rows",
            vec![leaf("a"), split("x", "columns", vec![leaf("b"), leaf("c")])],
        ),
        json!({"rows":[0.65,0.35], "columns":[0.35,0.65]}),
        &["a", "b", "c"],
    );
    // Page overrides defaults; normalization accepts ratios such as 7:3.
    page.template_state.insert("columns".into(), vec![7.0, 3.0]);
    let result = layout(&page, &document, &template).unwrap();
    assert_eq!(result.frames.len(), 3);
    assert_eq!(
        result.frames[0].rect,
        Rect {
            x: 60.0,
            y: 30.0,
            width: 900.0,
            height: 962.0
        }
    );
    close(result.frames[1].rect.x, 60.0);
    close(result.frames[1].rect.y, 1032.0);
    close(result.frames[1].rect.width, 616.0);
    close(result.frames[1].rect.height, 518.0);
    close(result.frames[2].rect.x, 696.0);
    close(result.frames[2].rect.x + result.frames[2].rect.width, 960.0);
    close(
        result.frames[2].rect.y + result.frames[2].rect.height,
        1550.0,
    );
    assert_eq!(result.handles.len(), 2);
    close(result.handles[0].rect.y, 1012.0);
    close(result.handles[1].rect.x, 686.0);
}

#[test]
fn grid_has_shared_full_span_handles_and_exact_edges() {
    let (page, document, template) = fixture(
        json!({
            "kind": "grid", "rowsParameter": "rows", "columnsParameter": "columns",
            "slots": [["a", "b"], ["c", "d"]]
        }),
        json!({"rows": [1, 1], "columns": [1, 1]}),
        &["a", "b", "c", "d"],
    );
    let result = layout(&page, &document, &template).unwrap();
    assert_eq!(result.frames.len(), 4);
    assert_eq!(result.handles.len(), 2);
    close(result.handles[0].rect.width, 900.0);
    close(result.handles[1].rect.height, 1520.0);
    close(result.handles[1].min, 48.0 / 880.0);
    close(result.handles[1].max, 1.0 - 48.0 / 880.0);
    close(result.frames[1].rect.x, result.frames[3].rect.x);
    close(result.frames[2].rect.y, result.frames[3].rect.y);
    close(result.frames[3].rect.x + result.frames[3].rect.width, 960.0);
    close(
        result.frames[3].rect.y + result.frames[3].rect.height,
        1550.0,
    );
}

#[test]
fn split_limits_preserve_fixed_descendant_ratios() {
    let (page, document, template) = fixture(
        split(
            "x",
            "outer",
            vec![split("x", "inner", vec![leaf("a"), leaf("b")]), leaf("c")],
        ),
        json!({"outer": [0.7, 0.3], "inner": [0.1, 0.9]}),
        &["a", "b", "c"],
    );
    let result = layout(&page, &document, &template).unwrap();
    let outer = result
        .handles
        .iter()
        .find(|handle| handle.parameter == "outer")
        .unwrap();
    // The left subtree needs 480px available + its own 20px gap, not just 2*48px.
    close(outer.min, 500.0 / 880.0);
    let mut at_limit = page.clone();
    at_limit
        .template_state
        .insert("outer".into(), vec![outer.min, 1.0 - outer.min]);
    let limited = layout(&at_limit, &document, &template).unwrap();
    close(limited.frames[0].rect.width, 48.0);
    at_limit
        .template_state
        .insert("outer".into(), vec![outer.min - 0.001, 1.001 - outer.min]);
    assert!(layout(&at_limit, &document, &template).is_err());
}

#[test]
fn shared_parameter_intersects_different_parent_constraints() {
    let (page, document, template) = fixture(
        split(
            "x",
            "outer",
            vec![
                split("x", "shared", vec![leaf("a"), leaf("b")]),
                split("x", "shared", vec![leaf("c"), leaf("d")]),
            ],
        ),
        json!({"outer":[0.65,0.35], "shared":[0.5,0.5]}),
        &["a", "b", "c", "d"],
    );
    let result = layout(&page, &document, &template).unwrap();
    let shared: Vec<_> = result
        .handles
        .iter()
        .filter(|handle| handle.parameter == "shared")
        .collect();
    assert_eq!(shared.len(), 2);
    close(shared[0].min, shared[1].min);
    close(shared[0].max, shared[1].max);
    close(shared[0].min, 48.0 / (880.0 * 0.35 - 20.0));
}

#[test]
fn nested_shared_parameter_bounds_remain_valid_when_parent_also_changes() {
    let (page, document, template) = fixture(
        split(
            "x",
            "shared",
            vec![split("x", "shared", vec![leaf("a"), leaf("b")]), leaf("c")],
        ),
        json!({"shared":[0.5,0.5]}),
        &["a", "b", "c"],
    );
    let result = layout(&page, &document, &template).unwrap();
    close(result.handles[0].min, result.handles[1].min);
    close(result.handles[0].max, result.handles[1].max);
    for boundary in [result.handles[0].min, result.handles[0].max] {
        let mut edited = page.clone();
        edited
            .template_state
            .insert("shared".into(), vec![boundary, 1.0 - boundary]);
        let resolved = layout(&edited, &document, &template).unwrap();
        assert!(resolved
            .frames
            .iter()
            .all(|frame| frame.rect.width >= 48.0 - 1e-6));
    }
    for boundary in [result.handles[0].min - 0.001, result.handles[0].max + 0.001] {
        let mut edited = page.clone();
        edited
            .template_state
            .insert("shared".into(), vec![boundary, 1.0 - boundary]);
        assert!(layout(&edited, &document, &template).is_err());
    }
}

#[test]
fn editing_one_boundary_preserves_other_tracks() {
    let (mut page, document, template) = fixture(
        split("x", "cols", vec![leaf("a"), leaf("b"), leaf("c")]),
        json!({"cols":[0.25,0.4,0.35]}),
        &["a", "b", "c"],
    );
    let original = layout(&page, &document, &template).unwrap();
    let handle = &original.handles[1];
    close(handle.min, 0.25 + 48.0 / 860.0);
    let boundary = 0.7;
    page.template_state
        .insert("cols".into(), vec![0.25, boundary - 0.25, 1.0 - boundary]);
    let changed = layout(&page, &document, &template).unwrap();
    assert_eq!(original.frames[0], changed.frames[0]);
}

#[test]
fn invalid_layouts_fail_without_nan_or_negative_rectangles() {
    let (page, document, template) = fixture(
        split("x", "cols", vec![leaf("a"), leaf("b")]),
        json!({"cols":[1,1]}),
        &["a", "b"],
    );
    let mut invalid = page.clone();
    invalid.column_gap = 901.0;
    assert!(layout(&invalid, &document, &template).is_err());
    invalid = page.clone();
    invalid.margin.left = 1000.0;
    assert!(layout(&invalid, &document, &template).is_err());
    invalid = page.clone();
    invalid.template_state.insert("cols".into(), vec![0.0, 1.0]);
    assert!(layout(&invalid, &document, &template).is_err());
    invalid = page.clone();
    invalid.row_gap = f64::NAN;
    assert!(layout(&invalid, &document, &template).is_err());
    invalid = page.clone();
    invalid.background = "#foofoo".into();
    assert!(layout(&invalid, &document, &template).is_err());
    let bad_document = DocumentSize {
        width: 1000.5,
        ..document.clone()
    };
    assert!(layout(&page, &bad_document, &template).is_err());
}

#[test]
fn tiny_documents_have_scaled_minimums() {
    let (mut page, mut document, template) = fixture(
        split("x", "cols", vec![leaf("a"), leaf("b")]),
        json!({"cols":[1,1]}),
        &["a", "b"],
    );
    document.width = 1.0;
    document.height = 2.0;
    page.margin = Margin {
        top: 0.0,
        right: 0.0,
        bottom: 0.0,
        left: 0.0,
    };
    page.column_gap = 0.0;
    page.row_gap = 0.0;
    let result = layout(&page, &document, &template).unwrap();
    close(result.frames[0].rect.width, 0.5);
    close(result.handles[0].min, 0.1);
}

#[test]
fn cover_uses_oriented_original_pixels_and_preserves_focus_intent() {
    let rect = Rect {
        x: 100.0,
        y: 200.0,
        width: 400.0,
        height: 600.0,
    };
    let transform = ImageTransform {
        focus_x: 0.0,
        focus_y: 1.0,
        zoom: 1.5,
        ..Default::default()
    };
    let before = transform.clone();
    let result = cover(&rect, 6000.0, 4000.0, &transform).unwrap();
    close(result.scale, 0.225);
    close(result.x, rect.x);
    close(result.y + result.height, rect.y + rect.height);
    close(result.crop.x, 0.0);
    close(result.crop.y + result.crop.height, 4000.0);
    close(result.crop.width * result.scale, rect.width);
    close(result.crop.height * result.scale, rect.height);
    assert_eq!(transform, before);
}

#[test]
fn cover_never_exposes_background_for_extreme_focus_and_aspect_ratios() {
    for (source_width, source_height) in [
        (6000.0, 4000.0),
        (4000.0, 6000.0),
        (1.0, 1000.0),
        (1000.0, 1.0),
    ] {
        for (frame_width, frame_height) in [(3000.0, 4500.0), (700.0, 200.0), (1.0, 1.0)] {
            for focus_x in [0.0, 0.13, 0.5, 0.95, 1.0] {
                for focus_y in [0.0, 0.2, 0.5, 0.91, 1.0] {
                    for zoom in [1.0, 1.3, 20.0, 100.0] {
                        let rect = Rect {
                            x: 47.0,
                            y: 83.0,
                            width: frame_width,
                            height: frame_height,
                        };
                        let transform = ImageTransform {
                            focus_x,
                            focus_y,
                            zoom,
                            ..Default::default()
                        };
                        let result = cover(&rect, source_width, source_height, &transform).unwrap();
                        assert!(result.x <= rect.x + 1e-6 && result.y <= rect.y + 1e-6);
                        assert!(result.x + result.width >= rect.x + rect.width - 1e-6);
                        assert!(result.y + result.height >= rect.y + rect.height - 1e-6);
                        assert!(result.crop.x >= 0.0 && result.crop.y >= 0.0);
                        assert!(result.crop.x + result.crop.width <= source_width + 1e-6);
                        assert!(result.crop.y + result.crop.height <= source_height + 1e-6);
                    }
                }
            }
        }
    }
}

#[test]
fn rotated_cover_keeps_every_frame_corner_inside_the_original() {
    for (source_width, source_height) in [
        (6000.0, 4000.0),
        (4000.0, 6000.0),
        (1.0, 1000.0),
        (1000.0, 1.0),
    ] {
        for (frame_width, frame_height) in [(3000.0, 4500.0), (700.0, 200.0), (1.0, 1.0)] {
            let rect = Rect {
                x: 47.0,
                y: 83.0,
                width: frame_width,
                height: frame_height,
            };
            for rotation in [
                -180.0, -135.0, -90.0, -45.0, -0.1, 0.0, 0.1, 30.0, 45.0, 89.9, 90.0, 135.0, 180.0,
            ] {
                for focus_x in [0.0, 0.13, 0.5, 0.95, 1.0] {
                    for focus_y in [0.0, 0.2, 0.5, 0.91, 1.0] {
                        for zoom in [1.0, 1.3, 100.0] {
                            let transform = ImageTransform {
                                focus_x,
                                focus_y,
                                zoom,
                                rotation,
                                ..Default::default()
                            };
                            let before = transform.clone();
                            let result =
                                cover(&rect, source_width, source_height, &transform).unwrap();
                            close(result.x + result.width / 2.0, result.center_x);
                            close(result.y + result.height / 2.0, result.center_y);
                            let mut source_xs = Vec::new();
                            let mut source_ys = Vec::new();
                            for x in [rect.x, rect.x + rect.width] {
                                for y in [rect.y, rect.y + rect.height] {
                                    let (sx, sy) =
                                        source_at(&result, source_width, source_height, x, y);
                                    assert!(
                                        sx >= -1e-6 && sx <= source_width + 1e-6,
                                        "x={sx}, source width={source_width}, rotation={rotation}"
                                    );
                                    assert!(sy >= -1e-6 && sy <= source_height + 1e-6, "y={sy}, source height={source_height}, rotation={rotation}");
                                    source_xs.push(sx);
                                    source_ys.push(sy);
                                }
                            }
                            let min_x = source_xs.iter().copied().reduce(f64::min).unwrap();
                            let max_x = source_xs.iter().copied().reduce(f64::max).unwrap();
                            let min_y = source_ys.iter().copied().reduce(f64::min).unwrap();
                            let max_y = source_ys.iter().copied().reduce(f64::max).unwrap();
                            close(result.crop.x, min_x);
                            close(result.crop.y, min_y);
                            close(result.crop.width, max_x - min_x);
                            close(result.crop.height, max_y - min_y);
                            assert_eq!(
                                transform, before,
                                "Clamping must not replace saved focus intent"
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn rotated_cover_places_unclamped_focus_at_the_frame_center() {
    let rect = Rect {
        x: 100.0,
        y: 200.0,
        width: 400.0,
        height: 600.0,
    };
    let transform = ImageTransform {
        focus_x: 0.3,
        focus_y: 0.6,
        zoom: 2.0,
        rotation: 23.0,
        ..Default::default()
    };
    let result = cover(&rect, 4000.0, 6000.0, &transform).unwrap();
    let focus = source_at(&result, 4000.0, 6000.0, 300.0, 500.0);
    close(focus.0, 1200.0);
    close(focus.1, 3600.0);
    close(result.rotation, 23.0);
}

#[test]
fn quarter_turn_swaps_cover_axes_and_uses_clockwise_source_mapping() {
    let rect = Rect {
        x: 100.0,
        y: 200.0,
        width: 400.0,
        height: 600.0,
    };
    let transform = ImageTransform {
        rotation: 90.0,
        ..Default::default()
    };
    let result = cover(&rect, 6000.0, 4000.0, &transform).unwrap();
    close(result.scale, 0.1);
    close(result.width, 600.0);
    close(result.height, 400.0);
    close(result.center_x, 300.0);
    close(result.center_y, 500.0);
    let top_left = source_at(&result, 6000.0, 4000.0, 100.0, 200.0);
    let top_right = source_at(&result, 6000.0, 4000.0, 500.0, 200.0);
    close(top_left.0, 0.0);
    close(top_left.1, 4000.0);
    close(top_right.0, 0.0);
    close(top_right.1, 0.0);
    close(result.crop.x, 0.0);
    close(result.crop.y, 0.0);
    close(result.crop.width, 6000.0);
    close(result.crop.height, 4000.0);
}

#[test]
fn rotated_cover_json_exposes_the_same_geometry_as_native() {
    let rect: Rect =
        serde_json::from_value(json!({"x":17,"y":31,"width":400,"height":600})).unwrap();
    let transform: ImageTransform = serde_json::from_value(
        json!({"focusX":0.2,"focusY":0.7,"zoom":2,"rotation":-37,"flipX":false,"flipY":false}),
    )
    .unwrap();
    let native = cover(&rect, 4000.0, 6000.0, &transform).unwrap();
    let value = serde_json::to_value(&native).unwrap();
    assert_eq!(value["centerX"], native.center_x);
    assert_eq!(value["centerY"], native.center_y);
    assert_eq!(value["rotation"], -37.0);
    assert!(value.get("center_x").is_none());
    let decoded: CoverResult = serde_json::from_value(value).unwrap();
    assert_eq!(decoded, native);
}

#[test]
fn projects_accept_saved_photo_angles_and_reject_invalid_rotation() {
    let (page, document, template) = fixture(leaf("a"), json!({}), &["a"]);
    let mut project = Project {
        schema_version: 1,
        engine_version: 1,
        canvas_sizing: CanvasSizing::Fixed,
        id: "rotation-project".into(),
        name: "Rotation".into(),
        document,
        pages: vec![page],
        assets: BTreeMap::new(),
        templates: BTreeMap::from([("test".into(), template)]),
    };
    for rotation in [-180.0, -90.0, -37.25, 0.0, 12.3, 90.0, 180.0] {
        project.pages[0].frames[0].transform.rotation = rotation;
        validate_project(&project).unwrap();
        let saved = serde_json::to_string(&project).unwrap();
        let reopened: Project = serde_json::from_str(&saved).unwrap();
        validate_project(&reopened).unwrap();
        assert_eq!(reopened.pages[0].frames[0].transform.rotation, rotation);
    }
    for rotation in [-180.1, 180.1, f64::NAN, f64::INFINITY] {
        project.pages[0].frames[0].transform.rotation = rotation;
        assert!(validate_project(&project).is_err());
    }
}

#[test]
fn cover_rejects_unsupported_transforms_and_numeric_overflow() {
    let rect = Rect {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 200.0,
    };
    for transform in [
        ImageTransform {
            zoom: 0.5,
            ..Default::default()
        },
        ImageTransform {
            rotation: 180.1,
            ..Default::default()
        },
        ImageTransform {
            rotation: -180.1,
            ..Default::default()
        },
        ImageTransform {
            rotation: f64::INFINITY,
            ..Default::default()
        },
        ImageTransform {
            rotation: f64::NAN,
            ..Default::default()
        },
        ImageTransform {
            flip_y: true,
            ..Default::default()
        },
        ImageTransform {
            focus_x: f64::NAN,
            ..Default::default()
        },
    ] {
        assert!(cover(&rect, 4000.0, 6000.0, &transform).is_err());
    }
    assert!(cover(
        &rect,
        f64::MIN_POSITIVE,
        f64::MIN_POSITIVE,
        &ImageTransform::default()
    )
    .is_err());
    assert!(cover(&rect, 0.0, 100.0, &ImageTransform::default()).is_err());
}

#[test]
fn serde_matches_canonical_frontend_contract_and_rejects_future_fields() {
    let node: LayoutNode = serde_json::from_value(
        json!({"kind":"grid", "rowsParameter":"r", "columnsParameter":"c", "slots":[["a"]]}),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(node).unwrap(),
        json!({"kind":"grid", "rowsParameter":"r", "columnsParameter":"c", "slots":[["a"]]})
    );
    assert!(serde_json::from_value::<ImageTransform>(json!({"focusX":0.5,"focusY":0.5,"zoom":1,"rotation":0,"flipX":false,"flipY":false,"futureEffect":true})).is_err());
}

#[test]
fn project_rejects_lost_references_and_duplicate_placement_identity() {
    let (page, document, template) = fixture(leaf("a"), json!({}), &["a"]);
    let mut project = Project {
        schema_version: 1,
        engine_version: 1,
        canvas_sizing: CanvasSizing::Fixed,
        id: "project".into(),
        name: "Test".into(),
        document,
        pages: vec![page],
        assets: BTreeMap::new(),
        templates: BTreeMap::from([("test".into(), template)]),
    };
    validate_project(&project).unwrap();
    project.pages[0].frames[0].image_asset_id = Some("missing".into());
    assert!(validate_project(&project).is_err());
    project.pages[0].frames[0].image_asset_id = None;
    let mut duplicate = project.pages[0].clone();
    duplicate.id = "page-2".into();
    project.pages.push(duplicate);
    assert!(validate_project(&project).is_err());
    project.pages[1].frames[0].id = "other-frame".into();
    validate_project(&project).unwrap();
    project.engine_version = 2;
    assert!(validate_project(&project).is_err());
}

#[test]
fn malformed_templates_and_inconsistent_shared_parameters_are_rejected() {
    let (_, _, mut template) = fixture(
        split("x", "cols", vec![leaf("a"), leaf("b")]),
        json!({"cols":[1,1]}),
        &["a", "b"],
    );
    template.slot_order = vec!["a".into(), "a".into()];
    assert!(validate_template(&template).is_err());
    template.slot_order = vec!["a".into(), "b".into()];
    template.root = serde_json::from_value(split(
        "x",
        "cols",
        vec![
            leaf("a"),
            split("y", "cols", vec![leaf("b"), leaf("c"), leaf("d")]),
        ],
    ))
    .unwrap();
    assert!(validate_template(&template).is_err());
    template.root = serde_json::from_value(json!({"kind":"grid","rowsParameter":"rows","columnsParameter":"cols","slots":[["a","b"],["c"]]})).unwrap();
    assert!(validate_template(&template).is_err());
}

fn project_with_photo() -> Project {
    let (mut page, document, template) = fixture(leaf("a"), json!({}), &["a"]);
    page.frames[0].image_asset_id = Some("photo".into());
    let asset = ImageAsset {
        id: "photo".into(),
        original_path: "/photos/test.jpg".into(),
        file_name: "test.jpg".into(),
        width: 4000,
        height: 6000,
        raw_width: 6000,
        raw_height: 4000,
        orientation: 6,
        format: "jpeg".into(),
        fingerprint: "test-fingerprint".into(),
        icc: None,
        source_root: None,
        relative_path: None,
        file_size: None,
        initial_path: None,
        previous_roots: vec![],
    };
    Project {
        schema_version: 1,
        engine_version: 1,
        canvas_sizing: CanvasSizing::Fixed,
        id: "project".into(),
        name: "Test".into(),
        document,
        pages: vec![page],
        assets: BTreeMap::from([("photo".into(), asset)]),
        templates: BTreeMap::from([("test".into(), template)]),
    }
}

#[test]
fn legacy_projects_default_to_fixed_canvas_and_round_trip_without_resizing() {
    let original = project_with_photo();
    let mut legacy = serde_json::to_value(&original).unwrap();
    legacy.as_object_mut().unwrap().remove("canvasSizing");
    let reopened: Project = serde_json::from_value(legacy).unwrap();
    assert_eq!(reopened.canvas_sizing, CanvasSizing::Fixed);
    assert_eq!(reopened.document, original.document);
    assert_eq!(reopened.pages, original.pages);
    validate_project(&reopened).unwrap();

    let saved = serde_json::to_value(&reopened).unwrap();
    assert_eq!(saved["canvasSizing"], "fixed");
    assert_eq!(serde_json::from_value::<Project>(saved).unwrap(), reopened);

    let mut first_photo = reopened;
    first_photo.canvas_sizing = CanvasSizing::FirstPhoto;
    validate_project(&first_photo).unwrap();
    let mut saved = serde_json::to_value(&first_photo).unwrap();
    assert_eq!(saved["canvasSizing"], "first-photo");
    assert_eq!(
        serde_json::from_value::<Project>(saved.clone()).unwrap(),
        first_photo
    );
    saved["canvasSizing"] = json!("unrecognized-sizing");
    assert!(serde_json::from_value::<Project>(saved).is_err());
}

#[test]
fn oriented_asset_dimensions_are_checked_for_all_exif_orientations() {
    let mut project = project_with_photo();
    for orientation in 1..=8 {
        let asset = project.assets.get_mut("photo").unwrap();
        asset.orientation = orientation;
        (asset.width, asset.height) = if orientation >= 5 {
            (4000, 6000)
        } else {
            (6000, 4000)
        };
        validate_project(&project).unwrap();
        project.assets.get_mut("photo").unwrap().width += 1;
        assert!(
            validate_project(&project).is_err(),
            "orientation {orientation}"
        );
    }
}

#[test]
fn unplaced_photos_keep_the_same_reference_and_transform_guarantees() {
    let mut project = project_with_photo();
    let mut unplaced = project.pages[0].frames[0].clone();
    unplaced.id = "spare-placement".into();
    unplaced.slot_id = "previous-slot".into();
    unplaced.transform.zoom = 2.0;
    project.pages[0].unplaced.push(unplaced);
    validate_project(&project).unwrap();
    project.pages[0].unplaced[0].image_asset_id = Some("missing".into());
    assert!(validate_project(&project).is_err());
    project.pages[0].unplaced[0].image_asset_id = Some("photo".into());
    project.pages[0].unplaced[0].transform.zoom = 0.0;
    assert!(validate_project(&project).is_err());
    project.pages[0].unplaced[0].transform.zoom = 2.0;
    project.pages[0].unplaced[0].id = project.pages[0].frames[0].id.clone();
    assert!(validate_project(&project).is_err());
}

#[test]
fn project_rejects_incompatible_color_spaces_sizes_and_map_identities() {
    let original = project_with_photo();
    for document in [
        DocumentSize {
            width: 0.0,
            ..original.document.clone()
        },
        DocumentSize {
            height: f64::INFINITY,
            ..original.document.clone()
        },
        DocumentSize {
            width: 32768.0,
            height: 32768.0,
            ..original.document.clone()
        },
        DocumentSize {
            color_space: "display-p3".into(),
            ..original.document.clone()
        },
    ] {
        let mut project = original.clone();
        project.document = document;
        assert!(validate_project(&project).is_err());
    }
    let mut project = original.clone();
    project.assets.get_mut("photo").unwrap().id = "another-photo".into();
    assert!(validate_project(&project).is_err());
    project = original.clone();
    project.templates.get_mut("test").unwrap().id = "another-template".into();
    assert!(validate_project(&project).is_err());
    project = original.clone();
    project.pages[0].frames[0].slot_id = "another-slot".into();
    assert!(validate_project(&project).is_err());
    project = original;
    project.assets.get_mut("photo").unwrap().format = "heic".into();
    assert!(validate_project(&project).is_err());
}

#[test]
fn project_validation_enforces_nested_geometry_without_resolving_drag_handles() {
    let (page, document, template) = fixture(
        split(
            "x",
            "outer",
            vec![split("x", "inner", vec![leaf("a"), leaf("b")]), leaf("c")],
        ),
        json!({"outer": [0.7, 0.3], "inner": [0.1, 0.9]}),
        &["a", "b", "c"],
    );
    let mut project = Project {
        schema_version: 1,
        engine_version: 1,
        canvas_sizing: CanvasSizing::Fixed,
        id: "project".into(),
        name: "Nested template".into(),
        document,
        pages: vec![page],
        assets: BTreeMap::new(),
        templates: BTreeMap::from([("test".into(), template)]),
    };
    for outer in [0.2, 0.55, 0.57, 0.7, 0.94, 0.99] {
        project.pages[0]
            .template_state
            .insert("outer".into(), vec![outer, 1.0 - outer]);
        assert_eq!(
            validate_project(&project).is_ok(),
            layout(
                &project.pages[0],
                &project.document,
                &project.templates["test"]
            )
            .is_ok(),
            "outer ratio {outer}",
        );
    }
}

#[test]
fn many_track_ratios_tile_exactly_and_every_advertised_boundary_is_feasible() {
    for count in 2..=8 {
        let names: Vec<_> = (0..count).map(|index| format!("slot-{index}")).collect();
        let slots: Vec<_> = names.iter().map(String::as_str).collect();
        for sample in 0..24 {
            let weights: Vec<_> = (0..count)
                .map(|index| 1.0 + ((index * 17 + sample * 13) % 11) as f64)
                .collect();
            let (mut page, mut document, template) = fixture(
                split("x", "tracks", slots.iter().map(|name| leaf(name)).collect()),
                json!({ "tracks": weights }),
                &slots,
            );
            document.width = 12000.0;
            document.height = 16000.0;
            page.column_gap = (sample * 3) as f64;
            let resolved = layout(&page, &document, &template).unwrap();
            close(resolved.frames[0].rect.x, page.margin.left);
            for pair in resolved.frames.windows(2) {
                close(
                    pair[0].rect.x + pair[0].rect.width + page.column_gap,
                    pair[1].rect.x,
                );
            }
            let last = resolved.frames.last().unwrap().rect;
            close(last.x + last.width, document.width - page.margin.right);
            for handle in resolved.handles {
                let before: f64 = handle.weights[..handle.index].iter().sum();
                let after =
                    before + handle.weights[handle.index] + handle.weights[handle.index + 1];
                for boundary in [handle.min, handle.max] {
                    let mut weights = handle.weights.clone();
                    weights[handle.index] = boundary - before;
                    weights[handle.index + 1] = after - boundary;
                    let mut edited = page.clone();
                    edited.template_state.insert("tracks".into(), weights);
                    let result = layout(&edited, &document, &template).unwrap();
                    assert!(result
                        .frames
                        .iter()
                        .all(|frame| frame.rect.width >= 48.0 - 1e-6));
                }
            }
        }
    }
}
