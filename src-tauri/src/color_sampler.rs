use tauri::AppHandle;
use std::sync::atomic::{AtomicBool, Ordering};

static SAMPLING: AtomicBool = AtomicBool::new(false);

/// A pending web command may be abandoned before the system UI finishes. The
/// AppKit handler, rather than the async caller, owns this guard until then.
struct SamplingSession;
impl SamplingSession {
    fn begin() -> Result<Self, String> {
        SAMPLING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "系统吸管正在取色，请选择屏幕颜色或按 Esc 结束后重试".into())
    }
}
impl Drop for SamplingSession {
    fn drop(&mut self) { SAMPLING.store(false, Ordering::Release); }
}

/// NSColor's sRGB components are encoded, rather than linear-light, values.
/// Clamp extended gamut/HDR values to the document's opaque sRGB8 color model.
fn rgb_hex(components: [f64; 3]) -> Result<String, String> {
    if components.iter().any(|channel| !channel.is_finite()) {
        return Err("无法读取这个颜色，请重新取色".into());
    }
    let [red, green, blue] = components.map(|channel| (channel.clamp(0.0, 1.0) * 255.0).round() as u8);
    Ok(format!("#{red:02x}{green:02x}{blue:02x}"))
}

#[cfg(target_os = "macos")]
pub async fn sample(app: AppHandle) -> Result<Option<String>, String> {
    use block2::RcBlock;
    use objc2_app_kit::{NSColor, NSColorSampler, NSColorSpace};
    use std::cell::RefCell;

    let session = SamplingSession::begin()?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let sampler = NSColorSampler::new();
        // Keep an explicit reference until selection/cancellation. AppKit also
        // retains the sampler and copies the escaping handler for the session.
        let keep_alive = RefCell::new(Some(sampler.clone()));
        let session = RefCell::new(Some(session));
        let reply = RefCell::new(Some(sender));
        let handler = RcBlock::new(move |selected: *mut NSColor| {
            // AppKit calls this on the main thread. Its borrowed NSColor stays
            // valid for the callback; no Cocoa object crosses an async thread.
            let outcome = match unsafe { selected.as_ref() } {
                None => Ok(None), // Escape/user cancellation.
                Some(color) => match color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()) {
                    None => Err("无法将选中的颜色转换为 RGB，请重新取色".into()),
                    Some(rgb) => rgb_hex([rgb.redComponent(), rgb.greenComponent(), rgb.blueComponent()]).map(Some),
                },
            };
            if let Some(sender) = reply.borrow_mut().take() { let _ = sender.send(outcome); }
            keep_alive.borrow_mut().take();
            session.borrow_mut().take();
        });
        // The known AppKit API consumes an escaping color-selection handler;
        // it shows only Apple's magnifier and returns a color or nil. No image
        // is captured or persisted by the app.
        unsafe { sampler.showSamplerWithSelectionHandler(&handler); }
    }).map_err(|error| format!("无法打开系统吸管：{error}"))?;
    receiver.await.map_err(|_| "系统取色已结束，请重试".to_string())?
}

#[cfg(not(target_os = "macos"))]
pub async fn sample(_app: AppHandle) -> Result<Option<String>, String> {
    Err("系统吸管需要在 macOS 桌面应用中使用".into())
}

#[cfg(test)]
mod tests {
    use super::{rgb_hex, SamplingSession};

    #[test]
    fn one_system_sampling_session_remains_exclusive_until_its_callback_guard_is_dropped() {
        let first = SamplingSession::begin().unwrap();
        assert!(SamplingSession::begin().is_err());
        drop(first);
        let next = SamplingSession::begin().unwrap();
        assert!(SamplingSession::begin().is_err());
        drop(next);
    }

    #[test]
    fn sampled_srgb_components_round_and_clamp_to_the_document_color_model() {
        assert_eq!(rgb_hex([0.0, 0.5, 1.0]).unwrap(), "#0080ff");
        assert_eq!(rgb_hex([-0.2, 1.4, 128.0 / 255.0]).unwrap(), "#00ff80");
        assert_eq!(rgb_hex([18.0 / 255.0, 52.0 / 255.0, 86.0 / 255.0]).unwrap(), "#123456");
    }

    #[test]
    fn invalid_sample_components_are_reported_instead_of_saved_as_black() {
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            for channel in 0..3 {
                let mut components = [0.2, 0.3, 0.4];
                components[channel] = invalid;
                assert!(rgb_hex(components).is_err());
            }
        }
    }
}
