//! Versioned document types and deterministic geometry shared by desktop export and WASM.
//! This crate has no filesystem, image decoder, UI or platform dependencies.

mod cover;
mod layout;
pub mod model;
mod photo_color;
mod validation;

pub use cover::cover;
pub use layout::layout;
pub use model::*;
pub use photo_color::{adjust_srgba8, PhotoColorTransform};
pub use validation::{validate_photo_adjustments, validate_project, validate_template};

/// Human-readable validation errors cross both the native and WASM boundaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreError(pub String);

impl std::fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for CoreError {}

impl From<serde_json::Error> for CoreError {
    fn from(error: serde_json::Error) -> Self {
        Self(format!("Invalid document JSON: {error}"))
    }
}

pub(crate) fn fail<T>(message: impl Into<String>) -> Result<T, CoreError> {
    Err(CoreError(message.into()))
}
