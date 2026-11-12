mod assets;
mod render;
mod storage;
mod service;
mod commands;
mod menus;
mod color_sampler;
mod watermark;
mod watermark_text;
mod library;
mod archive;
mod portable_zip;
mod library_commands;
mod reconnect;
mod diagnostics;
#[cfg(test)]
mod integration_tests;
#[cfg(test)]
mod watermark_tests;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&app.package_info().name)?;
            }
            let data = app.path().app_data_dir()?;
            let logger = diagnostics::DiagnosticLog::open(&data, env!("CARGO_PKG_VERSION")).ok();
            if let Some(logger) = &logger { logger.install_panic_hook(); app.manage(logger.clone()); }
            let service = service::Service::new(app.handle().clone()).inspect_err(|_| {
                if let Some(logger) = &logger { let _ = logger.record(diagnostics::Stage::Services, diagnostics::Outcome::InitializationFailure); }
            })?;
            app.manage(service);
            let library = std::sync::Arc::new(library::Library::new(data.join("library-v2")));
            app.manage(archive::Archives::new(library.clone()).with_diagnostics(logger.clone()));
            app.manage(library);
            app.manage(std::sync::Arc::new(reconnect::ReconnectService::new(&data)?));
            if let Some(logger) = &logger { let _ = logger.record(diagnostics::Stage::Services, diagnostics::Outcome::Ok); }
            menus::install(app.handle()).inspect_err(|_| {
                if let Some(logger) = &logger { let _ = logger.record(diagnostics::Stage::Menus, diagnostics::Outcome::InitializationFailure); }
            })?;
            if let Some(logger) = &logger {
                let _ = logger.record(diagnostics::Stage::Menus, diagnostics::Outcome::Ok);
                let _ = logger.record(diagnostics::Stage::Ready, diagnostics::Outcome::Ok);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_assets, commands::get_proxy, commands::register_project,
            commands::save_project, commands::load_project, commands::relink_asset,
            commands::open_in_photoshop, commands::refresh_assets,
            commands::sample_screen_color,
            commands::start_export, commands::cancel_export, commands::get_export_progress,
            commands::import_watermark, commands::scan_watermark_directory,
            commands::start_watermark, commands::cancel_watermark, commands::get_watermark_progress,
            commands::list_watermark_fonts, commands::render_watermark_preview,
            library_commands::library_list, library_commands::library_open, library_commands::library_save,
            library_commands::library_duplicate, library_commands::library_set_deleted, library_commands::library_rename,
            library_commands::library_read_cover, library_commands::library_write_cover, library_commands::library_reveal,
            library_commands::archive_start, library_commands::archive_import_start,
            library_commands::archive_progress, library_commands::archive_cancel,
            reconnect::authorize_asset_root, reconnect::reconnect_assets,
        ])
        .build(tauri::generate_context!())
        .expect("无法启动摄影拼图工作台")
        .run(|app, event| {
            // macOS Quit (including the Dock) must share the same unsaved-work
            // confirmation as the window close button. The frontend destroys
            // the final window only after the user has resolved that prompt.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<archive::Archives>().has_active() {
                    api.prevent_exit();
                    let _ = app.emit("archive-close-blocked", ());
                    return;
                }
                if app.state::<service::Service>().watermarks.has_active_jobs() {
                    api.prevent_exit();
                    let _ = app.emit("watermark-close-blocked", ());
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    api.prevent_exit();
                    let _ = window.close();
                }
            }
        });
}
