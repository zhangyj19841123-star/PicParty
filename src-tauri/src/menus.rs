use tauri::{AppHandle, Emitter, menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder}};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let file = SubmenuBuilder::new(app, "文件")
        .item(&MenuItemBuilder::with_id("new", "新建拼图").accelerator("CmdOrCtrl+N").build(app)?)
        .item(&MenuItemBuilder::with_id("open", "打开项目…").accelerator("CmdOrCtrl+O").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("save", "保存").accelerator("CmdOrCtrl+S").build(app)?)
        .item(&MenuItemBuilder::with_id("save-as", "另存为…").accelerator("CmdOrCtrl+Shift+S").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("import", "导入照片…").accelerator("CmdOrCtrl+I").build(app)?)
        .item(&MenuItemBuilder::with_id("export", "导出页面…").accelerator("CmdOrCtrl+E").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("long-image", "长图拼接…").build(app)?)
        .item(&MenuItemBuilder::with_id("watermark", "批量水印…").build(app)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "编辑")
        .item(&MenuItemBuilder::with_id("undo", "撤销").accelerator("CmdOrCtrl+Z").build(app)?)
        .item(&MenuItemBuilder::with_id("redo", "重做").accelerator("CmdOrCtrl+Shift+Z").build(app)?)
        .item(&MenuItemBuilder::with_id("free-transform", "自由变换照片").accelerator("CmdOrCtrl+T").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("剪切"))?)
        .item(&PredefinedMenuItem::copy(app, Some("拷贝"))?)
        .item(&PredefinedMenuItem::paste(app, Some("粘贴"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("全选"))?)
        .build()?;
    let view = SubmenuBuilder::new(app, "显示")
        .item(&MenuItemBuilder::with_id("view-1", "单页编辑").accelerator("CmdOrCtrl+1").build(app)?)
        .item(&MenuItemBuilder::with_id("view-2", "双页同屏").accelerator("CmdOrCtrl+2").build(app)?)
        .item(&MenuItemBuilder::with_id("view-3", "三页同屏").accelerator("CmdOrCtrl+3").build(app)?)
        .item(&MenuItemBuilder::with_id("view-4", "四页同屏").accelerator("CmdOrCtrl+4").build(app)?)
        .item(&MenuItemBuilder::with_id("view-6", "六页同屏").accelerator("CmdOrCtrl+6").build(app)?)
        .item(&MenuItemBuilder::with_id("view-8", "八页同屏").accelerator("CmdOrCtrl+8").build(app)?)
        .item(&MenuItemBuilder::with_id("view-10", "十页同屏").accelerator("CmdOrCtrl+0").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("overview", "页面总览").build(app)?)
        .item(&PredefinedMenuItem::fullscreen(app, Some("进入全屏幕"))?)
        .build()?;
    let product = app.package_info();
    let about = AboutMetadataBuilder::new()
        .name(Some(product.name.clone()))
        .version(Some(product.version.to_string()))
        .copyright(app.config().bundle.copyright.clone())
        .icon(app.default_window_icon().cloned())
        .build();
    let application = SubmenuBuilder::new(app, &product.name)
        .item(&PredefinedMenuItem::about(app, Some(&format!("关于 {}", product.name)), Some(about))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(&format!("隐藏 {}", product.name)))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("显示全部"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(&format!("退出 {}", product.name)))?)
        .build()?;
    let window = SubmenuBuilder::new(app, "窗口")
        .item(&PredefinedMenuItem::minimize(app, Some("最小化"))?)
        .item(&PredefinedMenuItem::close_window(app, Some("关闭窗口"))?)
        .build()?;
    app.set_menu(MenuBuilder::new(app).items(&[&application, &file, &edit, &view, &window]).build()?)?;
    app.on_menu_event(|app, event| { let _ = app.emit("menu-action", event.id().as_ref()); });
    Ok(())
}
