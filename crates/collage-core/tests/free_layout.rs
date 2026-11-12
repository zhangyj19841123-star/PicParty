use collage_core::*;
use serde_json::json;
use std::collections::BTreeMap;

fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        x,
        y,
        width,
        height,
    }
}

fn free_frame(slot: &str, bounds: Rect) -> ResolvedFrame {
    ResolvedFrame {
        slot_id: slot.into(),
        rect: bounds,
    }
}

fn fixture(root: LayoutNode, slots: &[&str]) -> Project {
    let template = TemplateDefinition {
        id: "free-test".into(),
        version: 1,
        name: "Free layout".into(),
        category: "custom".into(),
        root,
        defaults: BTreeMap::new(),
        slot_order: slots.iter().map(|slot| (*slot).into()).collect(),
    };
    let page = Page {
        id: "page-1".into(),
        name: "Page 1".into(),
        template_id: template.id.clone(),
        template_state: BTreeMap::new(),
        background: "#ffffff".into(),
        background_image: None,
        margin: Margin {
            top: 13.0,
            right: 17.0,
            bottom: 23.0,
            left: 29.0,
        },
        column_gap: 31.0,
        row_gap: 37.0,
        frame_rects: None,
        frames: slots
            .iter()
            .map(|slot| Frame {
                id: format!("frame-{slot}"),
                slot_id: (*slot).into(),
                image_asset_id: None,
                transform: ImageTransform::default(),
            })
            .collect(),
        unplaced: vec![],
    };
    Project {
        schema_version: 1,
        engine_version: 1,
        id: "free-project".into(),
        name: "Geometry contract".into(),
        document: DocumentSize {
            width: 1000.0,
            height: 1600.0,
            color_space: "srgb".into(),
        },
        canvas_sizing: CanvasSizing::Fixed,
        pages: vec![page],
        assets: BTreeMap::new(),
        templates: BTreeMap::from([(template.id.clone(), template)]),
    }
}

fn two_free_frames() -> Project {
    fixture(
        LayoutNode::Free {
            frames: vec![
                free_frame("a", rect(0.1, 0.2, 0.3, 0.4)),
                free_frame("b", rect(0.55, 0.1, 0.45, 0.9)),
            ],
        },
        &["a", "b"],
    )
}

fn split_project() -> Project {
    let mut project = fixture(
        LayoutNode::Split {
            axis: Axis::X,
            parameter: "columns".into(),
            children: vec![
                LayoutNode::Leaf {
                    slot_id: "a".into(),
                },
                LayoutNode::Leaf {
                    slot_id: "b".into(),
                },
            ],
        },
        &["a", "b"],
    );
    project
        .templates
        .get_mut("free-test")
        .unwrap()
        .defaults
        .insert("columns".into(), vec![1.0, 1.0]);
    project
}

fn resolve(project: &Project) -> Result<ResolvedLayout, CoreError> {
    layout(
        &project.pages[0],
        &project.document,
        &project.templates["free-test"],
    )
}

fn assert_rect_close(actual: Rect, expected: Rect) {
    for (actual, expected) in [
        (actual.x, expected.x),
        (actual.y, expected.y),
        (actual.width, expected.width),
        (actual.height, expected.height),
    ] {
        assert!((actual - expected).abs() < 1e-7, "{actual} != {expected}");
    }
}

fn assert_invalid(project: &Project) {
    assert!(validate_project(project).is_err());
    assert!(resolve(project).is_err());
}

#[test]
fn free_frames_scale_normalized_whole_page_coordinates_for_every_document_size() {
    let mut project = two_free_frames();
    for (width, height) in [(1000.0, 1600.0), (4000.0, 6000.0), (6000.0, 4000.0)] {
        project.document.width = width;
        project.document.height = height;
        validate_project(&project).unwrap();
        let output = resolve(&project).unwrap();
        assert_eq!(output.frames.len(), 2);
        assert_eq!(output.frames[0].slot_id, "a");
        assert_rect_close(
            output.frames[0].rect,
            rect(width * 0.1, height * 0.2, width * 0.3, height * 0.4),
        );
        assert_rect_close(
            output.frames[1].rect,
            rect(width * 0.55, height * 0.1, width * 0.45, height * 0.9),
        );
        assert!(output.handles.is_empty());
    }
}

#[test]
fn free_frames_ignore_page_margins_and_gaps_even_when_they_leave_no_split_space() {
    let mut project = two_free_frames();
    let before = resolve(&project).unwrap();
    let page = &mut project.pages[0];
    page.margin = Margin {
        top: 12000.0,
        right: 12000.0,
        bottom: 12000.0,
        left: 12000.0,
    };
    page.column_gap = 32768.0;
    page.row_gap = 32768.0;
    validate_project(&project).unwrap();
    assert_eq!(resolve(&project).unwrap(), before);
}

#[test]
fn free_layout_allows_overlapping_frames_and_tiny_positive_rectangles() {
    let project = fixture(
        LayoutNode::Free {
            frames: vec![
                free_frame("background", rect(0.0, 0.0, 1.0, 1.0)),
                free_frame("inset", rect(0.4, 0.4, 0.2, 0.2)),
                free_frame("detail", rect(0.01, 0.03, 0.0001, 0.0002)),
            ],
        },
        &["background", "inset", "detail"],
    );
    validate_project(&project).unwrap();
    let output = resolve(&project).unwrap();
    assert_rect_close(output.frames[0].rect, rect(0.0, 0.0, 1000.0, 1600.0));
    assert_rect_close(output.frames[1].rect, rect(400.0, 640.0, 200.0, 320.0));
    assert_rect_close(output.frames[2].rect, rect(10.0, 48.0, 0.1, 0.32));
    assert!(output.handles.is_empty());
}

#[test]
fn page_rect_overrides_replace_the_entire_split_layout_and_have_no_handles() {
    let mut project = split_project();
    assert_eq!(resolve(&project).unwrap().handles.len(), 1);
    project.pages[0].frame_rects = Some(BTreeMap::from([
        ("a".into(), rect(0.05, 0.1, 0.6, 0.8)),
        ("b".into(), rect(0.4, 0.3, 0.5, 0.6)),
    ]));
    // These remain valid saved values, but would make the original split infeasible.
    project.pages[0].margin.left = 9000.0;
    project.pages[0].column_gap = 20000.0;
    project.pages[0].row_gap = 20000.0;
    validate_project(&project).unwrap();
    let output = resolve(&project).unwrap();
    assert!(output.handles.is_empty());
    let by_slot: BTreeMap<_, _> = output
        .frames
        .iter()
        .map(|frame| (frame.slot_id.as_str(), frame.rect))
        .collect();
    assert_rect_close(by_slot["a"], rect(50.0, 160.0, 600.0, 1280.0));
    assert_rect_close(by_slot["b"], rect(400.0, 480.0, 500.0, 960.0));
}

#[test]
fn page_rect_overrides_take_priority_over_free_template_rectangles() {
    let mut project = two_free_frames();
    project.pages[0].frame_rects = Some(BTreeMap::from([
        ("a".into(), rect(0.0, 0.0, 1.0, 1.0)),
        ("b".into(), rect(0.25, 0.25, 0.5, 0.5)),
    ]));
    validate_project(&project).unwrap();
    let output = resolve(&project).unwrap();
    let by_slot: BTreeMap<_, _> = output
        .frames
        .iter()
        .map(|frame| (frame.slot_id.as_str(), frame.rect))
        .collect();
    assert_rect_close(by_slot["a"], rect(0.0, 0.0, 1000.0, 1600.0));
    assert_rect_close(by_slot["b"], rect(250.0, 400.0, 500.0, 800.0));
}

#[test]
fn every_free_rect_component_must_be_finite() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for component in 0..4 {
            let mut project = two_free_frames();
            let mut bounds = rect(0.1, 0.2, 0.3, 0.4);
            match component {
                0 => bounds.x = value,
                1 => bounds.y = value,
                2 => bounds.width = value,
                _ => bounds.height = value,
            }
            project.templates.get_mut("free-test").unwrap().root = LayoutNode::Free {
                frames: vec![
                    free_frame("a", bounds),
                    free_frame("b", rect(0.0, 0.0, 1.0, 1.0)),
                ],
            };
            assert_invalid(&project);
        }
    }
}

#[test]
fn free_rectangles_must_be_positive_and_entirely_inside_the_page() {
    for bounds in [
        rect(-0.001, 0.0, 0.5, 0.5),
        rect(0.0, -0.001, 0.5, 0.5),
        rect(0.0, 0.0, 0.0, 0.5),
        rect(0.0, 0.0, 0.5, 0.0),
        rect(0.0, 0.0, -0.1, 0.5),
        rect(0.0, 0.0, 0.5, -0.1),
        rect(0.6, 0.0, 0.401, 0.5),
        rect(0.0, 0.6, 0.5, 0.401),
        rect(1.0, 0.0, 0.001, 0.5),
        rect(0.0, 1.0, 0.5, 0.001),
    ] {
        let project = fixture(
            LayoutNode::Free {
                frames: vec![free_frame("a", bounds)],
            },
            &["a"],
        );
        assert_invalid(&project);
    }
}

#[test]
fn page_overrides_reject_invalid_rectangles_instead_of_falling_back_to_template() {
    for bounds in [
        rect(f64::NAN, 0.0, 0.5, 0.5),
        rect(0.0, 0.0, f64::INFINITY, 0.5),
        rect(0.1, 0.1, 0.0, 0.5),
        rect(0.0, 0.8, 0.5, 0.3),
    ] {
        let mut project = split_project();
        project.pages[0].frame_rects = Some(BTreeMap::from([
            ("a".into(), bounds),
            ("b".into(), rect(0.0, 0.0, 1.0, 1.0)),
        ]));
        assert_invalid(&project);
    }
}

#[test]
fn free_template_rejects_duplicate_slots_and_mismatched_slot_order() {
    let mut project = two_free_frames();
    let original = project.templates["free-test"].clone();
    for order in [
        vec!["a", "a"],
        vec!["a"],
        vec!["a", "b", "c"],
        vec!["a", "c"],
    ] {
        let mut template = original.clone();
        template.slot_order = order.into_iter().map(str::to_owned).collect();
        project.templates.insert("free-test".into(), template);
        assert_invalid(&project);
    }
    let mut template = original;
    template.root = LayoutNode::Free {
        frames: vec![
            free_frame("a", rect(0.0, 0.0, 0.5, 1.0)),
            free_frame("a", rect(0.5, 0.0, 0.5, 1.0)),
        ],
    };
    project.templates.insert("free-test".into(), template);
    assert_invalid(&project);
}

#[test]
fn free_nodes_are_rejected_when_nested_inside_a_split() {
    let mut project = split_project();
    project.templates.get_mut("free-test").unwrap().root = LayoutNode::Split {
        axis: Axis::X,
        parameter: "columns".into(),
        children: vec![
            LayoutNode::Free {
                frames: vec![free_frame("a", rect(0.0, 0.0, 1.0, 1.0))],
            },
            LayoutNode::Leaf {
                slot_id: "b".into(),
            },
        ],
    };
    assert_invalid(&project);
    // A complete override must not hide an unsupported embedded template shape.
    project.pages[0].frame_rects = Some(BTreeMap::from([
        ("a".into(), rect(0.0, 0.0, 1.0, 1.0)),
        ("b".into(), rect(0.0, 0.0, 1.0, 1.0)),
    ]));
    assert_invalid(&project);
}

#[test]
fn normalized_right_and_bottom_edges_allow_only_the_documented_rounding_tolerance() {
    for excess in [0.0, 0.5e-9, 2.0e-9] {
        for bounds in [
            rect(0.6, 0.0, 0.4 + excess, 0.5),
            rect(0.0, 0.6, 0.5, 0.4 + excess),
        ] {
            let project = fixture(
                LayoutNode::Free {
                    frames: vec![free_frame("a", bounds)],
                },
                &["a"],
            );
            let expected_valid = excess <= 1e-9;
            assert_eq!(validate_project(&project).is_ok(), expected_valid);
            assert_eq!(resolve(&project).is_ok(), expected_valid);
        }
    }
}

#[test]
fn free_geometry_still_rejects_nonfinite_or_negative_saved_spacing_values() {
    for override_enabled in [false, true] {
        for value in [f64::NAN, f64::INFINITY, -1.0, 32769.0] {
            for component in 0..3 {
                let mut project = two_free_frames();
                if override_enabled {
                    project.pages[0].frame_rects = Some(BTreeMap::from([
                        ("a".into(), rect(0.0, 0.0, 1.0, 1.0)),
                        ("b".into(), rect(0.0, 0.0, 1.0, 1.0)),
                    ]));
                }
                match component {
                    0 => project.pages[0].margin.left = value,
                    1 => project.pages[0].column_gap = value,
                    _ => project.pages[0].row_gap = value,
                }
                assert_invalid(&project);
            }
        }
    }
}

#[test]
fn page_rect_overrides_require_every_template_slot_and_no_extra_slots() {
    for overrides in [
        BTreeMap::new(),
        BTreeMap::from([("a".into(), rect(0.0, 0.0, 1.0, 1.0))]),
        BTreeMap::from([
            ("a".into(), rect(0.0, 0.0, 1.0, 1.0)),
            ("b".into(), rect(0.0, 0.0, 1.0, 1.0)),
            ("c".into(), rect(0.0, 0.0, 1.0, 1.0)),
        ]),
        BTreeMap::from([
            ("a".into(), rect(0.0, 0.0, 1.0, 1.0)),
            ("c".into(), rect(0.0, 0.0, 1.0, 1.0)),
        ]),
    ] {
        let mut project = split_project();
        project.pages[0].frame_rects = Some(overrides);
        assert_invalid(&project);
    }
}

#[test]
fn free_templates_require_one_to_64_frames_with_unique_slots() {
    for count in [0, 1, 64, 65] {
        let names: Vec<_> = (0..count).map(|index| format!("slot-{index}")).collect();
        let slots: Vec<_> = names.iter().map(String::as_str).collect();
        let project = fixture(
            LayoutNode::Free {
                frames: names
                    .iter()
                    .map(|slot| free_frame(slot, rect(0.0, 0.0, 1.0, 1.0)))
                    .collect(),
            },
            &slots,
        );
        let expected_valid = (1..=64).contains(&count);
        assert_eq!(
            validate_project(&project).is_ok(),
            expected_valid,
            "{count} frames"
        );
        assert_eq!(resolve(&project).is_ok(), expected_valid, "{count} frames");
    }
}

#[test]
fn free_geometry_preserves_frame_identity_and_photo_transform_on_resize() {
    let mut project = two_free_frames();
    project.pages[0].frames[0].transform = ImageTransform {
        focus_x: 0.21,
        focus_y: 0.73,
        zoom: 2.8,
        rotation: 37.0,
        ..Default::default()
    };
    let original_frames = project.pages[0].frames.clone();
    let original_template = project.templates["free-test"].clone();
    for (width, height) in [(3000.0, 4500.0), (4000.0, 6000.0)] {
        project.document.width = width;
        project.document.height = height;
        resolve(&project).unwrap();
        assert_eq!(project.pages[0].frames, original_frames);
        assert_eq!(project.templates["free-test"], original_template);
    }
}

#[test]
fn old_projects_without_frame_rects_load_as_template_driven_and_keep_their_layout() {
    let original = split_project();
    let expected = resolve(&original).unwrap();
    let mut legacy = serde_json::to_value(&original).unwrap();
    legacy["pages"][0]
        .as_object_mut()
        .unwrap()
        .remove("frameRects");
    let reopened: Project = serde_json::from_value(legacy).unwrap();
    assert_eq!(reopened.pages[0].frame_rects, None);
    validate_project(&reopened).unwrap();
    assert_eq!(resolve(&reopened).unwrap(), expected);
    let saved = serde_json::to_string(&reopened).unwrap();
    let reopened_again: Project = serde_json::from_str(&saved).unwrap();
    assert_eq!(resolve(&reopened_again).unwrap(), expected);
}

#[test]
fn free_templates_and_page_rect_overrides_round_trip_with_canonical_json_names() {
    let mut project = two_free_frames();
    project.pages[0].frame_rects = Some(BTreeMap::from([
        ("a".into(), rect(0.0, 0.0, 1.0, 1.0)),
        ("b".into(), rect(0.2, 0.3, 0.4, 0.5)),
    ]));
    let saved = serde_json::to_value(&project).unwrap();
    assert_eq!(saved["templates"]["free-test"]["root"]["kind"], "free");
    assert_eq!(
        saved["templates"]["free-test"]["root"]["frames"][0]["slotId"],
        "a"
    );
    assert_eq!(
        saved["pages"][0]["frameRects"]["b"],
        json!({"x":0.2,"y":0.3,"width":0.4,"height":0.5})
    );
    assert!(saved["pages"][0].get("frame_rects").is_none());
    let reopened: Project = serde_json::from_value(saved).unwrap();
    assert_eq!(reopened, project);
    validate_project(&reopened).unwrap();
    assert_eq!(resolve(&reopened).unwrap(), resolve(&project).unwrap());
}

#[test]
fn page_frame_layer_order_controls_free_split_and_override_layout_without_moving_rectangles() {
    for mut project in [two_free_frames(), split_project()] {
        for use_override in [false, true] {
            if use_override {
                project.pages[0].frame_rects = Some(BTreeMap::from([
                    ("a".into(), rect(0.0, 0.0, 1.0, 1.0)),
                    ("b".into(), rect(0.2, 0.3, 0.4, 0.5)),
                ]));
            }
            let before = resolve(&project).unwrap();
            let bounds: BTreeMap<_, _> = before.frames.iter().map(|frame| (frame.slot_id.clone(), frame.rect)).collect();
            let template = project.templates["free-test"].clone();
            project.pages[0].frames.reverse();
            validate_project(&project).unwrap();
            let resolved = resolve(&project).unwrap();
            assert_eq!(resolved.frames.iter().map(|frame| frame.slot_id.as_str()).collect::<Vec<_>>(),
                project.pages[0].frames.iter().map(|frame| frame.slot_id.as_str()).collect::<Vec<_>>());
            for frame in &resolved.frames { assert_eq!(frame.rect, bounds[&frame.slot_id]); }
            assert_eq!(resolved.handles, before.handles);
            assert_eq!(project.templates["free-test"], template);
            let loaded: Project = serde_json::from_str(&serde_json::to_string(&project).unwrap()).unwrap();
            assert_eq!(resolve(&loaded).unwrap(), resolved);
        }
    }
}
