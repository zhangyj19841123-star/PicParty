# Mac 发布流程

以最新已验证的 Apple Silicon 版本为基准。Mac 发行需通过指定版本的 GitHub 下载、安装、功能回归及干净克隆恢复。完成这项验收后，Windows 工作才能基于该标签开始。

## 准备源码和版本

1. 建立本地源码与项目数据备份，记录分支、提交 SHA 和校验值。核对远端仓库所有者、分支和标签，确认目标仓库由项目所有者控制。遇到分支分歧时，先检查双方的提交。
2. 复核将公开的所有 Git refs、历史提交、依赖许可和资源授权，确认作者署名、版权年份和仓库许可证。核对 README、关于页、许可证和 Release 说明中的署名。签名凭据由所有者通过钥匙串或构建环境的 Secrets 配置。
3. 确认 `package.json`、`src-tauri/Cargo.toml`、`Cargo.lock`、`src-tauri/tauri.conf.json` 和变更日志对应同一版本。为候选版或已通过验收的正式版本使用独立标签。记录标签实际指向的提交及构建工具版本。
4. 按 [构建说明](BUILD.md) 完成干净源码构建和自动测试。后续打包、上传和安装验证使用同一组文件。

构建用于公开的资产时，先在独立工作目录强制重建 WASM，再构建原生应用。对 Rust 编译使用路径重映射，检查最终 WASM 和原生可执行文件中是否还含本地账户目录、项目路径和凭据。审阅 Git 提交和标签的作者、邮箱及历史资源。若历史需保护，保留完整本地 Git 备份，另行准备经所有者确认的公开源码快照。

在已按 [构建说明](BUILD.md) 安装依赖的独立 checkout 中，可以用以下方式给同一轮构建设置路径重映射。若使用仓库内的 `.tools/cargo` 或 `.tools/rustup`，对应变量应指向这些目录。

```sh
release_cargo_path="${CARGO_HOME:-$HOME/.cargo}"
release_rustup_path="${RUSTUP_HOME:-$HOME/.rustup}"
export CARGO_ENCODED_RUSTFLAGS="$(printf '%s\037%s\037%s' \
  "--remap-path-prefix=$PWD=/picparty/source" \
  "--remap-path-prefix=$release_cargo_path=/picparty/cargo" \
  "--remap-path-prefix=$release_rustup_path=/picparty/rustup")"
pnpm wasm:build --force
```

## 签名和制作资产

本机通过 `security find-identity -v -p codesigning` 检查有效签名身份。公开的正式 Mac 安装包使用钥匙串中的 `Developer ID Application` 身份、公证凭据和 Hardened Runtime。通过 Tauri 的 `APPLE_SIGNING_IDENTITY` 配置签名身份，并按 Apple 和 Tauri 文档配置公证。确认实际产物的签名身份与预期一致。[Tauri 签名与公证](https://v2.tauri.app/distribute/sign/macos/) · [Apple 公证流程](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

经所有者同意，可用默认临时签名构建公开预览包。在 GitHub 标记为 **Pre-release**，在中英文说明中注明没有 Developer ID 签名且未经过 Apple 公证。记录 Gatekeeper 的实测状态，并将中英文安装教程放在下载链接旁。[Mac 安装与首次打开教程](docs/Mac-install.md)

使用 `pnpm desktop:build --ci --bundles app dmg -- --locked` 生成 App 和 DMG。ZIP 备用包使用 `ditto -c -k --sequesterRsrc --keepParent` 压缩同次构建的 `.app`。正式版应检查公证接受状态，用 `xcrun stapler validate` 验证附到 App 上的票据。ZIP 直接携带已经附上票据的 App。若对 DMG 本身申请公证，在生成校验文件前附加并验证 DMG 票据。将最终资产归集到同一个空目录，文件名包含版本号和 `macOS-arm64`。

```sh
shasum -a 256 ./*.dmg ./*.zip > SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```

用 `hdiutil verify` 检查镜像。对从镜像复制和从 ZIP 解压得到的 App 分别运行 `codesign --verify --deep --strict` 和 `spctl --assess --type execute --verbose=4`。核对两份 App 的 `Contents/Resources` 中均有 `THIRD_PARTY_NOTICES.md` 和 `third-party-licenses/LICENSES.txt`。`scripts/verify-macos-compatibility.py` 可生成架构、最低系统、依赖、签名和 DMG 完整性报告，使用 `--app`、`--dmg`、`--minimum 13.0`、`--expected-version`、`--arch arm64` 和指向新目录的 `--report-dir`。启动与功能测试结果单独记录。

## 发布和重新下载验收

将审核通过的源码和精确标签同步到所有者确认的 GitHub 仓库。创建与标签对应的 Release 草稿，放入 DMG、ZIP 和 `SHA256SUMS.txt`。说明开头复用 README 的中英文核心功能，突出最多十页同屏和跨页拖拽交换。随后列出实际验证的系统和芯片、安装步骤、变更、已知问题、作者、许可证和源码 SHA。确认公开权限和草稿内容后发布。

在独立目录从 Release 页面重新下载全部资产。也可以在一个新的空目录中使用 GitHub CLI，先把 `repo_slug` 和 `release_tag` 设为已核对的 `所有者/仓库` 和版本标签：[GitHub CLI 下载说明](https://cli.github.com/manual/gh_release_download)

```sh
gh release download "$release_tag" --repo "$repo_slug" \
  --pattern '*.dmg' --pattern '*.zip' --pattern SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```

用未登录的浏览器确认公开的下载链接可用，使用浏览器下载的文件验证 Gatekeeper 的实际流程。挂载 DMG 并将 App 拖入「应用程序」。在独立测试账户中从该位置启动并退出。也要解压 ZIP 并验证其中的 App。未公证预览版应在安装验收中验证用户按教程操作后的启动结果，并分别记录常规评估结果和针对 PicParty 的首次打开流程。保留系统的全局安全设置。[Mac 安装与首次打开教程](docs/Mac-install.md)

用合成图片覆盖以下场景，记录包哈希、系统版本、芯片和每项结果。

| 场景 | 验收内容 |
| --- | --- |
| 安装和启动 | Finder 显示正确图标，能从「应用程序」启动和退出，关于页显示正确版本及署名。 |
| 导入和排版 | 中文、英文、空格和特殊字符路径，横竖 JPG/PNG，多页与多图，模板、自由排版、移动和撤销。 |
| 水印与批处理 | 透明 PNG 与文字水印，预览、删除与撤销，批量处理和输出。 |
| 预览与导出 | JPG/PNG 的尺寸、方向和颜色，构图与预览一致。核对大图及多张批量处理，原图哈希不变。 |
| 项目和异常 | 保存后重开，完整 ZIP 项目归档及导入，失联素材和损坏图像反馈。 |

在另一个新目录从 GitHub 克隆同一标签，确认提交、重新安装锁定依赖、重建 WASM 和 Mac App，再运行自动测试及桌面冒烟测试。[从源码恢复](BUILD.md#从-github-恢复)

## 回滚

在替换安装前，退出正在运行的 PicParty，使用完整项目 ZIP 保留带原图的副本，并备份本地项目库。项目格式和恢复方法见 [项目与归档说明](docs/v2-storage-and-archive.md)。从上一版 Release 下载通过校验的安装包，先用独立测试数据确认旧版可读，再恢复日常使用。保留故障版本的标签及记录，修复后用新的版本号和标签发布。
