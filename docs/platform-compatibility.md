# 拼图派 PicParty 平台兼容性评估

评估日期为 2026 年 11 月 11 日。当前构建面向 macOS Apple Silicon，部署目标为 macOS 13.0，前端按 Safari 16 构建。交付报告记录实际测试过的硬件和系统。Windows 版本待明确启动后评估和开发。

| 平台 | 当前技术判断 |
| --- | --- |
| macOS Apple Silicon | Tauri 2.12、WKWebView、Rust arm64、CoreText 和 CoreGraphics。可复用原有项目、原图预览及导出流程。 |
| Windows 10 / 11 x64 | 当前技术栈可作为将来移植的起点。应验证目标系统版本、WebView2、Windows 字体、原生文件选择、ICC 与发布签名。 |
| Windows 7 SP1 / 8.1 x64 | 当前构建工具链不提供兼容保证。Tauri 2.12 已停止正式支持 Windows 7，现代 Rust MSVC 目标要求 Windows 10 或更新版本，旧 Windows 的 Edge/WebView2 停留在 109 世代。 |

Windows 7 SP1 的技术验证需要单独锁定可用的 WebView2、旧系统可加载的原生依赖和工具链，并逐项检查前端 API、安装器、字体与输出。Rust 提供需自行构建标准库的 `x86_64-win7-windows-msvc` Tier 3 目标，适用性还取决于所有依赖是否支持该目标。旧 WebView2 的安全维护和离线安装也属于独立交付决策。参考 [Tauri 2.12 公告](https://v2.tauri.app/blog/tauri-2.12/)、[Microsoft Edge 系统生命周期](https://learn.microsoft.com/en-us/lifecycle/products/microsoft-edge)、[Rust MSVC 目标](https://doc.rust-lang.org/rustc/platform-support/windows-msvc.html) 与 [Rust Win7 目标](https://doc.rust-lang.org/rustc/platform-support/win7-windows-msvc.html)。

现有的可复用边界如下。

- `crates/collage-core` 保存跨平台项目模型、排版、裁切和图像计算。`crates/collage-wasm` 将相同模型提供给前端预览。
- `src/platform/desktop.ts` 和 `src/platform/watermark.ts` 负责桌面命令和系统文件选择。原生路径、挂载检测、Finder 和 macOS 外部编辑留在原生层。
- 文字水印由 macOS 字体与渲染服务处理。将来的 Windows 适配可提供独立的 DirectWrite 实现，保存的水印参数继续使用同一模型。不同机器的本机字体可能不同，迁移后应明确提示替换。
- `.collage` 的 JSON 结构继续可读。完整 ZIP 使用相对素材路径及校验清单，适合跨系统迁移。直接引用原图的项目在驱动器或目录改变后需要重新定位素材。
