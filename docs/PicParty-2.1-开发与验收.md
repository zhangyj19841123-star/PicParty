# 拼图派 PicParty 2.1 开发与验收

2026 年 11 月 11 日交付 `2.1.0-rc.1` Apple Silicon 候选版。应用已在 Apple M5、macOS 26.3.1（25D2128）实际启动和重开。Developer ID 签名与 Apple 公证仍待完成，当前包的 Gatekeeper 评估为拒绝。

## 交付文件

| 文件 | 工程内位置 |
| --- | --- |
| macOS 应用 | `release/v2.1.0-rc.1/拼图派 PicParty.app` |
| arm64 安装镜像 | `release/v2.1.0-rc.1/PicParty_2.1.0-rc.1_arm64.dmg` |
| 透明 PNG | `release/v2.1.0-rc.1/品牌图标/PicParty-{1024,512,256,128,64}.png` |
| 可编辑矢量标志 | `release/v2.1.0-rc.1/品牌图标/PicParty.svg` |
| macOS 图标 | `release/v2.1.0-rc.1/品牌图标/PicParty.icns` |

PNG 从用户提供的 1254 × 1254 RGBA 原图制作，调整透明留边和小尺寸采样。SVG 用可编辑路径、圆角矩形、渐变和裁切重绘同一构图，供后续修改。实际 APP 使用基于原图生成的 ICNS。五种 PNG 的尺寸、RGBA 和四角透明已验证，ICNS 的 1024 像素层与 PNG 像素一致。窗口、启动、首页、工具栏和原生「关于」采用拼图派 PicParty。关于面板实测显示新标志和 `2.1.0-rc.1`。

## 使用与存储

- 首页「新建拼图」选择照片后直接进入临时工作区。⌘N 先打开空白画布。已有草稿时，首页显示实际封面、名称和最后编辑时间。
- 「打开本地项目」调用原生文件选择器。旧 `.collage` 打开后获得独立草稿，点击「存为项目」可转成正式项目。
- 最近项目支持名称搜索、创建或修改时间排序、全部项目网格、打开、重命名和 Finder 定位。移出最近后可从全部项目重新打开。确认删除的项目进入「已删除」，可恢复。
- 项目封面复用实际拼图渲染，在项目目录独立缓存为最长边 512 px 的 JPEG。封面写入可晚于项目保存，缓存失败时使用占位，旧项目可按需补封面。旧项目的创建时间取文件系统中项目目录的创建时间。
- 批量水印从首页或编辑器顶部打开。左侧加载照片文件夹，中间查看横图、竖图和画布上的水印，右侧分别编辑图片和文字，底部管理预设及输出。图片支持透明 PNG、等比缩放、透明度、旋转、平铺和横纵间距。文字使用本机字体，支持字重、字号、颜色、透明度、倾斜、字符及行间距、多行、换行和对齐。两层各自支持比例、固定像素或边距定位。
- 批量输出最多读取当前目录 5000 张 JPG/PNG。按原图分辨率与 EXIF 方向输出到指定目录，嵌入 sRGB 色彩信息。预览与导出共用原生合成。预览使用最长边 1024 px 的代理，切换照片时按每张原图尺寸重新计算位置。

临时拼图和正式项目继续使用 `~/Library/Application Support/com.framestudio.collage/library-v2`。`project.json` 的 `editorState.outputSettings` 保存项目的拼图导出格式、质量、范围和批量水印参数。独立 `.collage` 沿用现有版式与原图引用结构。完整 ZIP 携带拼图原图、排版和输出设置。批量水印独立引用的本机 PNG 路径会在 ZIP 迁移时清除，到新电脑后重新选择 PNG 即可恢复图片层。本机文字字体应选接收电脑已安装的字体。批次输入和输出文件夹属于本机工具设置。

## 代码修改清单

| 区域 | 文件与职责 |
| --- | --- |
| 工作台和封面 | `src/App.tsx`、`src/projects/WorkspaceHome.tsx`、`projectCovers.ts`、`useProjectWorkspace.ts`、`src/images/thumbnails.ts` 接入首页与缓存。`src-tauri/src/library.rs`、`library_commands.rs` 提供项目封面和 Finder 路径。 |
| 水印交互 | `src/components/WatermarkDialog.tsx`、`WatermarkControls.tsx`、`WatermarkPreviewPane.tsx`、`useWatermarkPreview.ts` 管理批次、图层及实时预览。`src/core/watermarkSettings.ts` 和 `src/state/watermarkPreferences.ts` 处理参数与既有预设。 |
| 水印渲染 | `src-tauri/src/watermark.rs`、`watermark_text.rs`、`render.rs` 提供文件扫描、CoreText 字形排版、旋转与平铺、代理缓存和原分辨率输出。 |
| 项目输出设置 | `src/projects/workspaceState.ts`、`ProjectWatermarkDialog.tsx`、`src/state/editorStore.ts` 和 `src/components/ExportDialog.tsx` 接入项目恢复。`src-tauri/src/archive.rs` 处理迁移时的本机水印引用。 |
| 品牌及构建 | `src/brand.ts`、`brand.css`、`public/brand`、`src-tauri/icons`、`tauri.conf.json` 和 `menus.rs` 统一产品名称、透明图标及原生菜单。`src-tauri/icons/generate.swift` 可由确认的透明原图重新生成安装尺寸集。 |

源码功能提交为 `7a2b0d7`，位于 `feature/puzzle-v2`。本地候选标签为 `v2.1.0-rc.1`，升级前可回溯到 `v2.0.0-rc.1`（`c529bff`）。旧版 APP 和镜像仍位于 `release/v2.0.0-rc.1/`，镜像 SHA-256 已与旧报告复核一致。仓库未配置远程。需要检查旧源码时可用基线标签创建独立检出目录。

## 验收结果

384 项前端测试、89 项原生服务测试、64 项 Rust 共享核心测试、17 项兼容性脚本测试通过，共 554 项。TypeScript、WASM、Vite 和原生 arm64 生产构建通过。归档集成用例另行复测了输出设置迁移及本机水印路径清除。

| 任务书项目 | 证据 |
| --- | --- |
| 1–4 启动、名称、图标、透明度 | 实际 APP 启动两次。首页、工具栏和关于面板显示拼图派 PicParty。ICNS 嵌入资源与交付文件一致，五种 PNG 的边缘及四角 Alpha 核对通过。 |
| 5–8 新建、正式保存、临时拼图、草稿恢复 | 原生选取两张合成照片进入临时拼图，退出后由首页恢复，另存正式项目并重开。应用与项目文件均证实恢复 PNG 输出格式和水印参数。 |
| 9 旧项目 | 通过首页原生选择器打开升级前的四页合成 `.collage`，四页可见。 |
| 10 最近项目 | 旧项目和验收项目均显示封面与时间。验收项目的缓存解码为 341 × 512 JPEG。实测移出最近后仍能从全部项目打开。Finder、搜索与排序入口已接入，Finder 实际跳转和删除恢复在本轮未做界面重测。 |
| 11 离线恢复 | 临时移走合成图文件夹，界面提示两张图未连接并保留排版。放回同路径后自动恢复。物理磁盘插拔本轮未执行。 |
| 12–15 水印与字体 | 同一张照片显示透明 PNG 与多行中文、英文。实测选择 `PingFang SC`、粗体、36 px、字符间距 2 px、倾斜 13°、换行 220 px，图片旋转 24°。分别拖动图片和文字后，原生预览与定位值更新。预设保存、重命名实测通过，删除与调用由自动测试验证。平铺、边距定位、字重及换行另有原生测试。 |
| 16 批处理 | 一张 600 × 900 竖图和一张 900 × 600 横图同时生成双层 PNG 水印成品。读取成品验证原分辨率、两处水印像素变化与 612 字节 sRGB ICC。输入 SHA-256 前后一致。 |
| 17 拼图导出 | 正式项目从原图导出 600 × 900 PNG，确认 RGB 和 sRGB ICC。默认 JPG 100% 界面显示正确。 |
| 18 原有功能 | 核心排版、跨页移动、自由变换、调色、预览、图层、归档与输出有全量自动回归。原生界面另测了导图、四页旧项目、保存与输出。 |

测试只使用了合成照片和本轮品牌图标。项目库保留了标有「验收」的测试项目、草稿及水印预设，工作台已回到首页。成品和去除路径的保存证据位于 `artifacts/picparty/验收/`。精确 APP 摘要绑定的运行证据位于 `artifacts/picparty/runtime-evidence.json`。

## 安装镜像与兼容性

DMG 完整性、APP 签名完整性、Bundle、arm64、真实最低系统和动态依赖检查通过。主程序真实部署版本为 macOS 13.0，使用系统 Framework，包括 CoreText 和 CoreGraphics。原生预检报告见 [兼容性检查](../artifacts/compatibility/picparty-rc1-20261111/compatibility.md)。

| 摘要 | SHA-256 |
| --- | --- |
| arm64 主程序 | `5174ebbf6c02cfa68e23721592603ea10e2f1bdea37e57d9ebf3bb6726ab3bf5` |
| APP 内容、权限和链接 | `bd613ac210c2665613a912d8d0e9cd6a43af77cd58b71ead1e3f1ff14975b286` |
| DMG（6,658,240 字节） | `d6e25c0e2a9d296237b4275c34f8faebc8d7517fd9771206c83593fbd460d173` |

本轮实测覆盖当前 M5。Ventura 真机、其他 Apple Silicon 机型、实体磁盘插拔和大批次性能基准仍待验证。签名为 ad-hoc，Gatekeeper 拒绝，公证未执行，交付保持候选状态。镜像附带系统只读诊断脚本和安装说明。Windows 后续评估见 [平台兼容性说明](platform-compatibility.md)。
