# 从源码构建 PicParty

当前桌面工程由 Tauri 2、Rust、React 和 Vite 组成。Mac 构建目标为 Apple Silicon `arm64`，部署目标为 macOS 13.0。部署目标需要结合每个版本的真机验收记录解读。Windows 构建将在 Mac 版完成 GitHub 下载、安装及源码恢复验收后开始。

## Mac 开发环境

| 工具 | 已用于 Mac 候选版的版本或设置 |
| --- | --- |
| Xcode | 26.3，macOS SDK 26.2。构建需 Apple 编译和链接工具，公证需 `notarytool` 与 `stapler`。 |
| Node.js 和 pnpm | Node.js 24.22.1，pnpm 11.25.0。使用仓库的 `pnpm-lock.yaml`。 |
| Rust | 1.98.1，安装 `aarch64-apple-darwin` 和 `wasm32-unknown-unknown` 两个目标。使用 `Cargo.lock`。 |
| wasm-bindgen CLI | 与 `Cargo.lock` 中 `wasm-bindgen` 的版本一致，当前为 `0.2.129`。 |
| Python | Python 3.9 或更新版本，供兼容性预检脚本使用。 |

这些是构建工具。使用已经打包的 App 只需运行环境符合发行说明。安装构建工具请参照 [Tauri 环境准备](https://v2.tauri.app/start/prerequisites/) 和 [Rust 安装](https://www.rust-lang.org/tools/install)。

## 从 GitHub 恢复

从目标 Release 页取得仓库 HTTPS 地址、版本标签及提交 SHA。将 `repo_url`、`release_tag` 和 `expected_commit` 设为对应值，在一个可写目录执行：

```sh
git clone --branch "$release_tag" --single-branch "$repo_url" PicParty-restore
cd PicParty-restore
test "$(git rev-parse HEAD)" = "$expected_commit"
git status --short
```

首次在新电脑构建需要从 npm 和 crates.io 拉取依赖。源码、锁文件、Tauri 配置、图标和默认 WASM 资源均在仓库中。干净克隆可直接使用 PATH 中的工具。脚本也接受本地 `.tools/` 工具目录，供现有开发环境使用。

```sh
rustup target add aarch64-apple-darwin wasm32-unknown-unknown
cargo install --locked wasm-bindgen-cli --version 0.2.129
pnpm install --frozen-lockfile
```

Rust 与前端用同一套核心几何规则。`public/core-wasm/` 包含与源码一同提交的前端运行文件。若要验证 WASM 也能从源码完整生成，在本次恢复用的 checkout 中运行：

```sh
pnpm wasm:build --force
```

从仓库根目录运行测试和桌面构建：

```sh
pnpm test
cargo test --locked -p collage-core
cargo test --locked -p frame-studio --lib
python3 -m unittest discover -s scripts -p 'test_macos_compatibility.py'
pnpm desktop:build --ci --bundles app -- --locked
```

`pnpm desktop:build` 内部会运行前端构建并将原生链接目标设为 macOS 13.0。默认 `.app` 路径为 `target/aarch64-apple-darwin/release/bundle/macos/拼图派 PicParty.app`。开发界面用 `pnpm desktop:dev`，仅预览网页界面用 `pnpm dev`。原生导出、授权文件和水印渲染请用桌面 App 验证。

本地默认构建使用临时签名 `signingIdentity: "-"`。签名和工具链版本会影响最终包的字节。源码恢复通过构建、功能回归及架构检查验证，已发布资产通过 SHA-256 验证。签名、打包和下载验收见 [RELEASE.md](RELEASE.md)。
