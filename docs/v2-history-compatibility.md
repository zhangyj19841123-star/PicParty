# V2：历史故障复盘、兼容性预检与诊断

检查日期：2026-10-25～2026-10-26。本文区分历史软件的证据、当前拼图包的静态证据和真实运行验收。不能把一个软件或一个机型的通过结果迁移为另一个软件已经通过。

## 找到的真实历史原因

已只读检查相邻的 `电商跑图系统` 工程、Git 历史及保留的本机诊断资料，没有修改该工程或远程机器。

最相关的历史提交为 `106d60a34a31bda8d21b15eed5522aa4cf205ca2`（2026-10-22，定位 Ventura 启动硬隔离并补齐只读诊断和 M 芯片发行检查）。证据位于该工程：

| 证据 | 实际内容 |
| --- | --- |
| `docs/release-0.7.1-macos-ventura.md:3` | 实际测试为 Apple M2 Max / macOS Ventura 13.4，先只读检查，后在新目录测试独立副本 |
| 同文件第 7 行 | 原安装及原挂载镜像被系统以 `File created by an AppSandbox, exec/open not allowed` 拒绝；来源属性包含硬隔离位 `0x0004`，分发来源为飞书 |
| 同文件第 7～11 行 | 主程序权限、arm64、严格签名完整性和关键文件摘要正常；阻断发生在业务入口前。原 DMG 外层属性因接收端隐私保护无法完整读取，该限制保留 |
| 同文件第 15～23 行 | 独立传输副本经正常 LaunchServices 启动、Cocoa 加载及授权窗口获得实际确认；没有改原应用、真实授权或系统安全设置，没有把窗口通过扩大成全部业务通过 |
| 同文件第 27～31 行 | 业务和编译模块保持原字节，修改的是诊断、DMG 发行检查、安装说明和分发来源核验。没有把降级 Python/Qt 或清除隔离当成此次修复 |
| `build/ventura-ssh-diagnostics-20261022/remote-isolated-startup-r1.json`、`remote-final-dmg-startup-r3.json` | 本地保留的受限记录绑定传输/最终 DMG 摘要、隔离目录、系统/芯片、正常入口及窗口确认，并明确其他机型、完整业务和公证未验证 |
| `docs/release-0.7.3-authorization.md:21～31` | 后续同一实际 M2 Max / 13.4 组合有用户确认进入工作台、重开、预览及导出的记录；Gatekeeper 只读检查仍拒绝，不能混淆功能运行和 Apple 信任 |

另外找到两个不同阶段的问题，不能混作上述 M2 故障根因：

- `docs/mac-compatibility-research.md:7～9` 记录过开发启动脚本现场安装依赖时的证书校验错误。完整成品必须携带运行依赖，不能让接收者现场运行 pip。
- 同文件第 16、21、53、61～65 行说明某些 Qt 扩展、SciPy 和 aggdraw 实际 Mach-O 最低系统高于表面声明或包名，因此必须检查全部原生文件，不能只查主程序或改 Info.plist。

跑图使用 Python / PySide / PyInstaller，拼图使用 Rust / Tauri / React / Konva。当前拼图主程序只链接 macOS 系统库及 Framework，不加载外部 Python、Node 或 Homebrew 运行时。迁移的是上述检查方法、分发来源核验和证据边界，没有复制不适用的 Python 依赖降级方案。

## 当前远程环境的实际限制

历史辅助脚本使用有效期 15 分钟的已认证 SSH ControlMaster 会话。检查时该旧控制 socket 已不存在，无法复用当时会话。本轮没有读取或打印密码、私钥、目标账号/IP，没有新建远程权限或部署到该机器。因此目前只确认旧会话不可复用，不声称测试机离线；新拼图包在远端 M2 的启动、编辑、恢复和归档迁移均尚未验证。

如后续恢复受信连接，应在独立测试目录使用合成素材，不覆盖原软件或重要文件，并绑定本次 APP 与 DMG 摘要逐项记录。物理插拔外接盘、系统重启与其他 M 系列型号也应各自记录，没有实测不能填通过。

## Ventura 候选的真实构建目标

升级前拼图包为 `0.1.0`，配置与实际主程序 `LC_BUILD_VERSION` 都是最低 macOS 14.0。历史 M2 测试机仍运行 13.4 时不满足这个要求，这是系统版本范围，不是 M2 芯片本身不支持。

V2 兼容候选同时调整三处：

- `src-tauri/tauri.conf.json` 的最低声明设为 13.0。
- `scripts/desktop.mjs` 向实际 Rust 链接流程传入 `MACOSX_DEPLOYMENT_TARGET=13.0`。
- `vite.config.ts` 的 WebKit 构建目标从 Safari 17 改为 Safari 16.0，以覆盖 Ventura 13.0 自带 Safari 16.1 的语法范围；不能只兼顾历史测试机 13.4 而误声明覆盖更早系统。

这三项只建立构建候选。最终需要检查实际主程序及全部打包原生文件的真实最低系统和依赖，再在 Ventura 真机检查 WebKit、WASM、拖放和文件授权。SDK 版本高不等于最低系统高；反之，仅降低声明也不能降低已经编译的依赖要求。若最终实际依赖仍要求 14，必须如实提高最终最低版本，不能靠改名或忽略检查发行。

## 可重复的开发预检

使用开发电脑已有 Python 3.9+；没有第三方 Python 依赖。普通接收者诊断不需要 Python。

```sh
python3 scripts/verify-macos-compatibility.py \
  --app 'release/v2.0.0-rc.1/Frame Studio.app' \
  --dmg 'release/v2.0.0-rc.1/Frame Studio_2.0.0-rc.1_arm64.dmg' \
  --minimum 13.0 --expected-version 2.0.0-rc.1 --arch arm64 \
  --report-dir artifacts/compatibility/v2-final-new-report
```

请把路径与版本替换为实际产物，并使用新的报告目录。工具不覆盖旧报告，不修改输入，不启动 APP，不清除来源属性，不重签名，不改变系统保护，也不连接其他电脑。输出 `compatibility.json` 与 `compatibility.md`；报告本身没有用户名、账号、IP、电脑名、硬件 UUID、客户照片、项目内容、原始隔离元数据或凭据。

检查覆盖：

- Info.plist、合法主入口、执行权限与 bundle 内相对链接。
- 全部真正 Mach-O 文件的 thin/fat 切片、arm64 基线（拒绝仅 arm64e）、真实最低系统；不靠扩展名筛选。
- 每个目标切片的动态依赖和 rpath；允许系统共享缓存，拒绝未包含或指向开发机外部的库。
- 严格递归代码签名完整性；签名种类单独记录。
- 本机 Gatekeeper 执行评估；拒绝是真实失败，不因 ad-hoc 完整性通过而改写。
- APP、主程序和显式原 DMG 的直接隔离位；没有直接属性仍标记继承状态未知。
- APP 全部文件/权限/相对链接摘要、主程序摘要、DMG 摘要和不挂载的容器完整性检查。
- GUI 启动、项目读写、失联素材、归档导入及导出默认 `not_run`；只有另外执行、绑定精确主程序与完整 APP 摘要的运行记录才能更新对应项。

状态为 `pass` / `fail` / `blocked` / `not_run`。汇总优先级为失败、受阻、未执行、通过；退出码 0 可以仍有 `not_run`，绝不能解释为所有机型通过。未提供 Apple 公证证据时不从签名或 Gatekeeper 推断已公证。当前开发签名包很可能被接收端安全策略拒绝，实际结果必须保留；不能为得到绿色报告关闭保护或删除隔离。

可重复自动测试：

```sh
python3 -m unittest discover -s scripts -p test_macos_compatibility.py -v
```

测试使用合成 Mach-O 和临时目录，覆盖真实部署版本、fat 切片、错误架构、外部库、相对链接、损坏加载命令、包摘要证据绑定、隐私字段拒绝、硬隔离位和脚本语法。它不冒充真实 GUI、移动硬盘插拔或另一台 Mac 的运行验收。

## 升级前包的实际预检结果

历史备份 `release/history/pre-v2-20261025/` 已用本工具检查。受限环境的 Gatekeeper 结果为 `blocked`，另在允许读取系统策略的本机完整环境重跑并保留两份独立报告：

- `artifacts/compatibility/pre-v2-20261025/`：受限检查。
- `artifacts/compatibility/pre-v2-20261025-system-policy/`：本机 Apple M5、Mac17,3、macOS 26.3.1（25D2128）。

旧包 bundle、arm64、真实最低 macOS 14.0、仅系统动态依赖、严格签名完整性、DMG 完整性及直接来源属性检查均通过；系统 Gatekeeper 实际拒绝，完整环境报告汇总为 `fail`，没有改写成通过。主程序 SHA-256 为 `2e727b0a608030b6c251ae7baeaec045a74ccef2bca2db8add3cda39bfa94df2`，旧 DMG SHA-256 为 `e3bff5a19df80c7ff518471189daa5ca28f8e66ed148ccc98567a439f56aacfa`。

这证明旧开发签名包的完整性与已查架构，不证明 Apple 信任、Ventura 运行或新版包兼容。新包仍须重新检查。本轮接收端无 Python 诊断脚本也已对旧包实际执行，输出保存在 `artifacts/compatibility/receiver-pre-v2-20261025/`；受限读取芯片及安全策略的结果明确记录为 blocked。17 项合成预检测试全部通过。

## 接收端诊断与启动日志

`scripts/collect-mac-diagnostics.command` 只用 macOS 自带的 zsh、Perl、PlistBuddy、file、codesign、spctl、xattr、shasum、sw_vers、sysctl；不需要 Python、Node、Xcode、网络下载或管理员密码。默认读取 `/Applications/Frame Studio.app`，也可显式选择 APP 与原 DMG：

```sh
/bin/zsh scripts/collect-mac-diagnostics.command \
  --app '/Applications/Frame Studio.app' \
  --dmg '/path/to/Frame Studio.dmg'
```

默认报告在 `~/Library/Application Support/com.framestudio.collage/diagnostics/` 的独立新目录。每个系统命令有 20 秒上限。它不启动应用、不读取项目或素材、不自动上传；只记录版本、系统/芯片类型、入口架构、校验值、签名与隔离分类。收到报告前不应凭“无法打开”直接判断是芯片、依赖或安全问题。

Rust 的 `DiagnosticLog` 将程序已经进入启动阶段后的受控记录写到 app data 下 `logs/startup.jsonl`，即通常的 `~/Library/Application Support/com.framestudio.collage/logs/startup.jsonl`。记录只含版本、时间、架构、系统版本、阶段与错误类别，不写错误原文、panic 载荷、文件路径、图片名或其他私人内容；目录为 0700、文件为 0600，旧日志达到阈值后另名保留。系统在进程入口前拒绝执行时，程序本身不可能落日志，应使用接收端只读诊断区分系统拒绝和应用初始化错误。

## 发行与回归边界

完整性签名通过、镜像校验通过、本机可编辑与其他 Mac 可运行是不同结论。M1/M2/M3/M4 共享目标 arm64 不等于已逐型号验收。每次修改程序、资源、签名或镜像后，都应重新绑定摘要并执行预检与必要的实际操作；不能沿用旧包的运行记录。

旧包和其摘要保存在 `release/history/pre-v2-20261025/`，源码基线为 `baseline/pre-v2-upgrade`。只读身份检查发现本机有效代码签名身份为 0 条，Developer ID Application 有效身份为 0 条；没有读取私钥、签名上传或公证。没有 Developer ID、公证或真实远程验收时，交付保持 `2.0.0-rc.1` 候选说明，不创建或宣称稳定正式发布标签。最终实际测试结果和产物位置以本次 V2 验收报告为准。

2026-10-26 再次运行 `python3 scripts/test_macos_compatibility.py`，17 项测试通过。新版包的独立检查见下节，不挪用旧包结果。

## V2 首个候选 APP 的实际预检（2026-10-26）

首个候选位于 `release/v2.0.0-rc.1/Frame Studio.app`。它使用独立 `target/v2-ventura` 目录真正重新链接，避免复用上一份最低 14.0 的应用产物。独立报告为：

- `artifacts/compatibility/v2-rc1-20261026/`：受限环境，Gatekeeper 读取受阻，汇总 `blocked`。
- `artifacts/compatibility/v2-rc1-20261026-system-policy/`：系统完整环境的只读核验，Gatekeeper 实际拒绝，汇总 `fail`。

这次检查绑定以下 APP 摘要：

| 项目 | 实际结果 |
| --- | --- |
| CFBundleShortVersionString | `2.0.0-rc.1`，与目标一致 |
| Info.plist 最低系统 | `13.0` |
| 所有原生文件 | 唯一 Mach-O 为 `Contents/MacOS/frame-studio`，arm64，CPU subtype 0 |
| 主程序真实最低系统 | `LC_BUILD_VERSION` 为 `13.0.0`，不是只改 Info.plist |
| 依赖 | 仅系统库/Framework，无未解析或开发机外部动态运行时 |
| Bundle、执行权限、内部链接 | 通过 |
| 严格递归签名完整性 | 通过；签名种类为 ad-hoc |
| APP 与主程序直接来源属性 | 通过直接属性检查；不推断其他传输载体的继承状态 |
| Gatekeeper | 完整环境检查实际拒绝，未改写成通过 |
| 公证 | 未执行 |
| 主程序 SHA-256 | `7038cc30393ab35a643cc1612286131e76863319e8b1d1899340d16a5155f04a` |
| 完整 APP 内容/权限/链接摘要 | `38ced5d3248596d35374c20cfc8d613fef7524e3f17a9ada831ad78332c26892` |
| 检查主机 | Apple M5 / Mac17,3 / macOS 26.3.1（25D2128） |

此时尚未提供最终 DMG，镜像为 `not_run`；这份只读报告不启动应用，所以 GUI、项目读写、失联素材、归档导入与导出也保留 `not_run`。实际界面验收完成后须用完全相同的 APP 摘要绑定运行证据，镜像生成后另存新完整报告。之后若任何代码、资源、权限或签名改变，以上摘要只代表本次候选，不能沿用为新包通过。

接收端 `.command` 也已针对同一候选 APP 实际执行，报告保存在 `artifacts/compatibility/receiver-v2-rc1-20261026/` 的独立子目录。系统版本、APP 版本、13.0 声明、入口 arm64 与签名完整性正确；受限环境不允许读取的芯片、型号与 Gatekeeper 明确记为 `blocked`，不与完整系统策略的实际失败混淆。此脚本仅调用 macOS 系统工具，没有安装 Python、Node、开发依赖或上传内容。

截至本次静态检查，M1/M2/M3/M4 上的新包和 Ventura 真机运行仍未实测。可确认的是当前候选具备真实 arm64/13.0 部署目标及完整依赖，不能由此推导所有 Apple Silicon 机器的实际使用结果。

## 最终 APP、DMG 与实际界面证据（2026-10-27 汇总）

最终报告为 `artifacts/compatibility/v2-rc1-final-20261027/compatibility.json` 和同目录 `.md`。绑定的 APP 摘要与上表一致；DMG SHA-256 为 `42c302d261f9326a47c5ec229f460faa7a0d09ec5be7ffafcbbea4bbf767dbf2`，镜像完整性通过。

运行证据 `artifacts/v2/runtime-evidence-20261027.json` 记录同一候选在 M5 / macOS 26.3.1 的真实原生 UI 操作：首次和再次启动、临时草稿恢复、正式项目自动保存与 SIGKILL 后重开、模拟素材路径断开/恢复及改目录批量重连、原路径不存在时导入独立归档并继续编辑保存、JPG 原图导出。归档迁移项目再次重开后显示 130% 缩放与 19° 旋转。

最终运行五项均为 `pass`，静态架构、真实最低系统、依赖、签名完整性和 DMG 完整性也通过。**Gatekeeper 仍为真实 `fail`，公证仍为 `not_run`，因此报告汇总为 `fail`，并非全部发布验收通过。** 没有关闭保护、清除隔离或重新传输绕过检查。M1/M2/M3/M4、Ventura 真机及物理外接盘插拔继续列为未验证。完整操作证据及交付范围见 [V2 开发与验收报告](V2.0-开发与验收报告.md)。
