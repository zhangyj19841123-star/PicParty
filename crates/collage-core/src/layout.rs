use crate::{
    fail, validate_template,
    validation::{normalize_weights, validate_frame_rects, validate_page_geometry},
    Axis, CoreError, DocumentSize, LayoutNode, Page, Rect, ResolvedFrame, ResolvedLayout,
    SplitHandle, TemplateDefinition,
};
use std::collections::{BTreeMap, BTreeSet};

const EPSILON: f64 = 1e-7;

/// Resolve the immutable document into document-pixel geometry. Margins are applied only
/// at the root; each split owns precisely the gaps between its direct children.
///
/// No saved ratio is silently changed. Infeasible margins, gaps or ratios return an error.
/// The returned handles describe the full feasible interval for an adjacent-track edit,
/// including constraints at other uses of a shared parameter.
pub fn layout(
    page: &Page,
    document: &DocumentSize,
    template: &TemplateDefinition,
) -> Result<ResolvedLayout, CoreError> {
    validate_template(template)?;
    if let Some(mut result) = direct_layout(page, document, template)? {
        sort_frame_layers(page, &mut result);
        return Ok(result);
    }
    let (context, root) = page_context(page, document, template)?;
    let prepared = context.prepare(&template.root, None)?;
    let mut result = ResolvedLayout::default();
    emit(&prepared, root, "root", &mut result)?;

    // An identical parameter/index controls every occurrence together. Its legal range
    // must satisfy all occurrences, not just the one under the mouse pointer.
    let mut ranges: BTreeMap<(String, usize), (f64, f64)> = BTreeMap::new();
    for handle in &result.handles {
        ranges
            .entry((handle.parameter.clone(), handle.index))
            .and_modify(|bounds| {
                bounds.0 = bounds.0.max(handle.min);
                bounds.1 = bounds.1.min(handle.max);
            })
            .or_insert((handle.min, handle.max));
    }

    // Most shared parameters are siblings (e.g. aligned columns), for which the
    // analytical intersection above is exact. Nested reuse changes the parent size
    // as well; evaluate the whole tree while locating those bounds instead.
    let mut nested = BTreeSet::new();
    nested_parameters(&template.root, &mut Vec::new(), &mut nested);
    for ((parameter, index), bounds) in &mut ranges {
        if !nested.contains(parameter) {
            continue;
        }
        let weights = context.weights(parameter, context.parameter_count(parameter)?)?;
        let before: f64 = weights[..*index].iter().sum();
        let current = before + weights[*index];
        let after = current + weights[*index + 1];
        let fits = |boundary: f64| {
            let mut candidate = weights.clone();
            candidate[*index] = boundary - before;
            candidate[*index + 1] = after - boundary;
            let candidate = context.prepare(&template.root, Some((parameter, &candidate)));
            candidate.is_ok_and(|node| fits_size(&node, &root))
        };
        bounds.0 = find_boundary(current, before, &fits);
        bounds.1 = find_boundary(current, after, &fits);
    }
    for handle in &mut result.handles {
        let (min, max) = ranges[&(handle.parameter.clone(), handle.index)];
        if min > max + EPSILON {
            return fail(format!(
                "Shared parameter '{}' has no feasible range",
                handle.parameter
            ));
        }
        handle.min = min.min(max);
        handle.max = max;
    }
    sort_frame_layers(page, &mut result);
    Ok(result)
}

/// Saved page placements are ordered from bottom to top, independently of the
/// template's geometry order. Every renderer and hit test receives this same
/// order; slot IDs still select the original rectangles and photo transforms.
fn sort_frame_layers(page: &Page, result: &mut ResolvedLayout) {
    let order: BTreeMap<_, _> = page.frames.iter().enumerate()
        .map(|(index, frame)| (&frame.slot_id, index)).collect();
    result.frames.sort_by_key(|frame| order.get(&frame.slot_id).copied().unwrap_or(usize::MAX));
}

/// Project validation has already checked each embedded template once. It only needs
/// to verify page feasibility, without allocating render output or finding drag ranges
/// for every page in a large document.
pub(crate) fn validate_page_layout(
    page: &Page,
    document: &DocumentSize,
    template: &TemplateDefinition,
) -> Result<(), CoreError> {
    if direct_layout(page, document, template)?.is_some() {
        return Ok(());
    }
    let (context, root) = page_context(page, document, template)?;
    let prepared = context.prepare(&template.root, None)?;
    check_sizes(&prepared, root)
}

fn direct_layout(
    page: &Page,
    document: &DocumentSize,
    template: &TemplateDefinition,
) -> Result<Option<ResolvedLayout>, CoreError> {
    let frames = if let Some(rectangles) = &page.frame_rects {
        validate_frame_rects(page, template)?;
        template
            .slot_order
            .iter()
            .map(|slot| ResolvedFrame {
                slot_id: slot.clone(),
                rect: rectangles[slot],
            })
            .collect::<Vec<_>>()
    } else if let LayoutNode::Free { frames } = &template.root {
        frames.clone()
    } else {
        return Ok(None);
    };
    validate_page_geometry(page, document, true)?;
    if page.template_id != template.id {
        return fail("Page and template IDs do not match");
    }
    Ok(Some(ResolvedLayout {
        frames: frames
            .into_iter()
            .map(|frame| ResolvedFrame {
                slot_id: frame.slot_id,
                rect: Rect {
                    x: frame.rect.x * document.width,
                    y: frame.rect.y * document.height,
                    width: frame.rect.width * document.width,
                    height: frame.rect.height * document.height,
                },
            })
            .collect(),
        handles: vec![],
    }))
}

fn page_context<'a>(
    page: &'a Page,
    document: &DocumentSize,
    template: &'a TemplateDefinition,
) -> Result<(Context<'a>, Rect), CoreError> {
    validate_page_geometry(page, document, false)?;
    if page.template_id != template.id {
        return fail("Page and template IDs do not match");
    }
    let context = Context {
        page,
        template,
        // A 1-pixel document remains meaningful. At normal photographic sizes, the
        // leaf minimum is exactly 48 document pixels, independent of screen zoom.
        minimum: 48.0_f64.min(document.width.min(document.height) / 10.0),
    };
    let root = Rect {
        x: page.margin.left,
        y: page.margin.top,
        width: document.width - page.margin.left - page.margin.right,
        height: document.height - page.margin.top - page.margin.bottom,
    };
    Ok((context, root))
}

struct Context<'a> {
    page: &'a Page,
    template: &'a TemplateDefinition,
    minimum: f64,
}

struct Prepared {
    minimum_width: f64,
    minimum_height: f64,
    kind: PreparedKind,
}

enum PreparedKind {
    Leaf(String),
    Split {
        axis: Axis,
        parameter: String,
        weights: Vec<f64>,
        gap: f64,
        children: Vec<Prepared>,
    },
    Grid {
        rows_parameter: String,
        columns_parameter: String,
        rows: Vec<f64>,
        columns: Vec<f64>,
        slots: Vec<Vec<String>>,
        row_gap: f64,
        column_gap: f64,
        minimum: f64,
    },
}

impl Context<'_> {
    fn parameter_count(&self, name: &str) -> Result<usize, CoreError> {
        self.template
            .defaults
            .get(name)
            .map(Vec::len)
            .ok_or_else(|| CoreError(format!("Missing parameter '{name}'")))
    }

    fn weights(&self, name: &str, count: usize) -> Result<Vec<f64>, CoreError> {
        let values = self
            .page
            .template_state
            .get(name)
            .or_else(|| self.template.defaults.get(name))
            .ok_or_else(|| CoreError(format!("Missing parameter '{name}'")))?;
        normalize_weights(values, count, name)
    }

    fn overridden_weights(
        &self,
        name: &str,
        count: usize,
        candidate: Option<(&str, &[f64])>,
    ) -> Result<Vec<f64>, CoreError> {
        if let Some((key, values)) = candidate {
            if key == name {
                return normalize_weights(values, count, name);
            }
        }
        self.weights(name, count)
    }

    fn prepare(
        &self,
        node: &LayoutNode,
        candidate: Option<(&str, &[f64])>,
    ) -> Result<Prepared, CoreError> {
        Ok(match node {
            LayoutNode::Free { .. } => {
                return fail("Free photo layouts can only be template roots")
            }
            LayoutNode::Leaf { slot_id } => Prepared {
                minimum_width: self.minimum,
                minimum_height: self.minimum,
                kind: PreparedKind::Leaf(slot_id.clone()),
            },
            LayoutNode::Split {
                axis,
                parameter,
                children,
            } => {
                let weights = self.overridden_weights(parameter, children.len(), candidate)?;
                let children: Vec<_> = children
                    .iter()
                    .map(|child| self.prepare(child, candidate))
                    .collect::<Result<_, _>>()?;
                let gap = match axis {
                    Axis::X => self.page.column_gap,
                    Axis::Y => self.page.row_gap,
                };
                let along = children
                    .iter()
                    .zip(&weights)
                    .map(|(child, weight)| match axis {
                        Axis::X => child.minimum_width / weight,
                        Axis::Y => child.minimum_height / weight,
                    })
                    .fold(0.0, f64::max)
                    + gap * (children.len() - 1) as f64;
                let across = children
                    .iter()
                    .map(|child| match axis {
                        Axis::X => child.minimum_height,
                        Axis::Y => child.minimum_width,
                    })
                    .fold(0.0, f64::max);
                let (minimum_width, minimum_height) = match axis {
                    Axis::X => (along, across),
                    Axis::Y => (across, along),
                };
                Prepared {
                    minimum_width,
                    minimum_height,
                    kind: PreparedKind::Split {
                        axis: *axis,
                        parameter: parameter.clone(),
                        weights,
                        gap,
                        children,
                    },
                }
            }
            LayoutNode::Grid {
                rows_parameter,
                columns_parameter,
                slots,
            } => {
                let rows = self.overridden_weights(rows_parameter, slots.len(), candidate)?;
                let columns =
                    self.overridden_weights(columns_parameter, slots[0].len(), candidate)?;
                let minimum_width = columns
                    .iter()
                    .map(|weight| self.minimum / weight)
                    .fold(0.0, f64::max)
                    + self.page.column_gap * (columns.len() - 1) as f64;
                let minimum_height = rows
                    .iter()
                    .map(|weight| self.minimum / weight)
                    .fold(0.0, f64::max)
                    + self.page.row_gap * (rows.len() - 1) as f64;
                Prepared {
                    minimum_width,
                    minimum_height,
                    kind: PreparedKind::Grid {
                        rows_parameter: rows_parameter.clone(),
                        columns_parameter: columns_parameter.clone(),
                        rows,
                        columns,
                        slots: slots.clone(),
                        row_gap: self.page.row_gap,
                        column_gap: self.page.column_gap,
                        minimum: self.minimum,
                    },
                }
            }
        })
    }
}

fn fits_size(node: &Prepared, rect: &Rect) -> bool {
    node.minimum_width.is_finite()
        && node.minimum_height.is_finite()
        && node.minimum_width <= rect.width + EPSILON
        && node.minimum_height <= rect.height + EPSILON
}

fn require_size(node: &Prepared, rect: &Rect) -> Result<(), CoreError> {
    if !fits_size(node, rect) {
        return fail(
            "Margins, gaps or split ratios leave a photo frame smaller than its minimum size",
        );
    }
    Ok(())
}

fn check_sizes(node: &Prepared, rect: Rect) -> Result<(), CoreError> {
    require_size(node, &rect)?;
    if let PreparedKind::Split {
        axis,
        gap,
        weights,
        children,
        ..
    } = &node.kind
    {
        for (child, child_rect) in children.iter().zip(tracks(rect, *axis, *gap, weights)) {
            check_sizes(child, child_rect)?;
        }
    }
    Ok(())
}

fn emit(
    node: &Prepared,
    rect: Rect,
    path: &str,
    output: &mut ResolvedLayout,
) -> Result<(), CoreError> {
    require_size(node, &rect)?;
    match &node.kind {
        PreparedKind::Leaf(slot_id) => output.frames.push(ResolvedFrame {
            slot_id: slot_id.clone(),
            rect,
        }),
        PreparedKind::Split {
            axis,
            parameter,
            weights,
            gap,
            children,
        } => {
            let minimums: Vec<f64> = children
                .iter()
                .map(|child| match axis {
                    Axis::X => child.minimum_width,
                    Axis::Y => child.minimum_height,
                })
                .collect();
            emit_handles(
                path, parameter, *axis, rect, *gap, weights, &minimums, output,
            );
            let sizes = tracks(rect, *axis, *gap, weights);
            for (index, (child, child_rect)) in children.iter().zip(sizes).enumerate() {
                emit(child, child_rect, &format!("{path}.{index}"), output)?;
            }
        }
        PreparedKind::Grid {
            rows_parameter,
            columns_parameter,
            rows,
            columns,
            slots,
            row_gap,
            column_gap,
            minimum,
        } => {
            emit_handles(
                path,
                rows_parameter,
                Axis::Y,
                rect,
                *row_gap,
                rows,
                &vec![*minimum; rows.len()],
                output,
            );
            emit_handles(
                path,
                columns_parameter,
                Axis::X,
                rect,
                *column_gap,
                columns,
                &vec![*minimum; columns.len()],
                output,
            );
            for (row_index, row) in tracks(rect, Axis::Y, *row_gap, rows)
                .into_iter()
                .enumerate()
            {
                for (column_index, cell) in tracks(row, Axis::X, *column_gap, columns)
                    .into_iter()
                    .enumerate()
                {
                    output.frames.push(ResolvedFrame {
                        slot_id: slots[row_index][column_index].clone(),
                        rect: cell,
                    });
                }
            }
        }
    }
    Ok(())
}

fn tracks(parent: Rect, axis: Axis, gap: f64, weights: &[f64]) -> Vec<Rect> {
    let length = match axis {
        Axis::X => parent.width,
        Axis::Y => parent.height,
    };
    let available = length - gap * (weights.len() - 1) as f64;
    let mut cumulative = 0.0;
    weights
        .iter()
        .enumerate()
        .map(|(index, weight)| {
            let offset = available * cumulative + gap * index as f64;
            cumulative += weight;
            // Pin the final edge to its parent, avoiding cumulative floating-point gaps.
            let size = if index + 1 == weights.len() {
                length - offset
            } else {
                available * weight
            };
            match axis {
                Axis::X => Rect {
                    x: parent.x + offset,
                    width: size,
                    ..parent
                },
                Axis::Y => Rect {
                    y: parent.y + offset,
                    height: size,
                    ..parent
                },
            }
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn emit_handles(
    path: &str,
    parameter: &str,
    axis: Axis,
    parent: Rect,
    gap: f64,
    weights: &[f64],
    minimums: &[f64],
    output: &mut ResolvedLayout,
) {
    let length = match axis {
        Axis::X => parent.width,
        Axis::Y => parent.height,
    };
    let available = length - gap * (weights.len() - 1) as f64;
    let mut before = 0.0;
    for index in 0..weights.len() - 1 {
        let boundary = before + weights[index];
        let position = available * boundary + gap * (index as f64 + 0.5);
        let line = match axis {
            Axis::X => Rect {
                x: parent.x + position,
                width: 0.0,
                ..parent
            },
            Axis::Y => Rect {
                y: parent.y + position,
                height: 0.0,
                ..parent
            },
        };
        output.handles.push(SplitHandle {
            id: format!(
                "{path}:{parameter}:{}:{index}",
                match axis {
                    Axis::X => "x",
                    Axis::Y => "y",
                }
            ),
            parameter: parameter.to_owned(),
            index,
            axis,
            rect: line,
            parent,
            gap,
            weights: weights.to_vec(),
            min: before + minimums[index] / available,
            max: boundary + weights[index + 1] - minimums[index + 1] / available,
        });
        before = boundary;
    }
}

fn nested_parameters(
    node: &LayoutNode,
    ancestors: &mut Vec<String>,
    result: &mut BTreeSet<String>,
) {
    match node {
        LayoutNode::Leaf { .. } | LayoutNode::Free { .. } => {}
        LayoutNode::Split {
            parameter,
            children,
            ..
        } => {
            if ancestors.contains(parameter) {
                result.insert(parameter.clone());
            }
            ancestors.push(parameter.clone());
            for child in children {
                nested_parameters(child, ancestors, result);
            }
            ancestors.pop();
        }
        LayoutNode::Grid {
            rows_parameter,
            columns_parameter,
            ..
        } => {
            for parameter in [rows_parameter, columns_parameter] {
                if ancestors.contains(parameter) {
                    result.insert(parameter.clone());
                }
            }
        }
    }
}

fn find_boundary(current: f64, extreme: f64, fits: &impl Fn(f64) -> bool) -> f64 {
    if fits(extreme) {
        return extreme;
    }
    let mut valid = current;
    let mut invalid = extreme;
    // Track dimensions under repeated ratios have a connected feasible interval.
    // Forty-eight steps are well below a subpixel at the maximum document size.
    for _ in 0..48 {
        let middle = (valid + invalid) / 2.0;
        if fits(middle) {
            valid = middle;
        } else {
            invalid = middle;
        }
    }
    valid
}
