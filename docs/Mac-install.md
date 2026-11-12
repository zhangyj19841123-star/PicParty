# PicParty Mac 安装与首次打开 · Installation and first launch

[中文](#中文) · [English](#english)

## 中文

此公开预览版面向搭载 Apple 芯片的 Mac（arm64），构建的最低系统版本为 macOS 13。实际验证的系统版本见发布说明。点按屏幕左上角的苹果菜单 → **关于本机**，核对「芯片」和 macOS 版本。本版没有 Apple Developer ID 签名，也未经过 Apple 公证，首次打开时可能需要在系统设置中确认。

### 下载并校验

1. 从 PicParty 官方 GitHub Releases 中找到对应版本，在 **Assets（资产）** 下载 `macOS-arm64` 的 `.dmg` 或 `.zip`，以及同版本的 `SHA256SUMS.txt`。
2. 用「终端」输入 `shasum -a 256`，留一个空格，把下载的 `.dmg` 或 `.zip` 从访达拖入终端，按回车。
3. 打开 `SHA256SUMS.txt`，将结果与其中相同文件名对应的 64 个十六进制字符逐字比较。若不一致，请停止安装并从同一发布页重新下载。

### 安装并首次打开

1. **DMG**：在访达双击 `.dmg`，把「拼图派 PicParty」拖到「应用程序」。复制完成后可推出磁盘映像。**ZIP**：双击 `.zip` 解压，将解出的「拼图派 PicParty」拖到「应用程序」。
2. 在访达的「应用程序」中双击「拼图派 PicParty」。如果 App 正常打开，安装即完成。如果 macOS 提示无法验证开发者或无法检查 App 是否含有恶意软件，关闭这条提示，再继续下一步。
3. 前往苹果菜单 → **系统设置** → **隐私与安全性**（部分版本显示为「隐私与安全」），向下滚动到「安全性」。确认提示指向刚才尝试打开的 PicParty，然后点按 **仍要打开**。
4. 在系统确认框中点按 **打开** 或 **仍要打开**，并在系统要求时输入 Mac 登录密码完成验证。macOS 会为这个 App 保存一条例外，之后通常可从「应用程序」双击启动。

Apple 提供了设置页截图和首次打开说明。[在 Mac 上安全地打开 App](https://support.apple.com/zh-cn/102445)

### 如果还是打不开

- **没有「仍要打开」按钮。** 回到「应用程序」双击 PicParty，再立即检查「隐私与安全性」底部的「安全性」。按钮在尝试打开后约一小时内可用。若公司或学校管理的 Mac 禁止放行，请联系管理员。[Apple 使用手册](https://support.apple.com/zh-cn/guide/mac-help/mh40617/mac)
- **系统提示 App 已损坏、将损害电脑，或检测到恶意软件。** 停止打开。从官方发布页重新下载安装包并校验，若仍有提示，请向项目报告版本号、macOS 版本和警告原文。[Apple 对警告类型的说明](https://support.apple.com/zh-cn/102445)
- **系统提示不兼容。** 在「关于本机」核对芯片和系统版本。此下载为 Apple 芯片（arm64）构建，Intel Mac 需要对应的 Intel 构建。macOS 版本低于 13 时需先升级系统。

## English

This public preview is built for Apple silicon (arm64) with a minimum deployment version of macOS 13. See the release notes for tested versions. Choose **Apple menu → About This Mac** to check your chip and macOS version. This build lacks an Apple Developer ID signature and Apple notarization. macOS may ask you to approve the first launch in System Settings.

### Download and verify

1. Find the version on the official PicParty GitHub Releases page. Under **Assets**, download its `macOS-arm64` `.dmg` or `.zip` and the matching `SHA256SUMS.txt`.
2. In Terminal, type `shasum -a 256` followed by a space. Drag the downloaded `.dmg` or `.zip` from Finder into Terminal and press Return.
3. Compare the 64-character result with the entry for the same filename in `SHA256SUMS.txt`. If they differ, stop and download the installer again from the same release page.

### Install and open PicParty

1. **DMG:** Double-click the `.dmg` in Finder and drag **拼图派 PicParty** into **Applications**. Eject the disk image after copying. **ZIP:** Double-click the `.zip` to extract it and drag the extracted app into **Applications**.
2. Open **Applications** in Finder and double-click **拼图派 PicParty**. If it opens, you're done. If macOS says it cannot verify the developer or check the app for malicious software, dismiss that alert and continue to the next step.
3. Go to **Apple menu → System Settings → Privacy & Security** and scroll to **Security**. Check that the message names PicParty, then click **Open Anyway**.
4. Click **Open** or **Open Anyway** in the confirmation dialog and enter your Mac login password if prompted. macOS saves an exception for this app, so you can normally double-click it in **Applications** on later launches.

Apple provides a screenshot of this setting and explains the first-launch flow. [Safely open apps on your Mac](https://support.apple.com/en-us/102445)

### If the app still won't open

- **Open Anyway is missing.** Double-click PicParty in **Applications**, then immediately look under **Security** in **Privacy & Security**. The button is available for about an hour after the launch attempt. If your work or school manages the Mac and prevents exceptions, contact its administrator. [Apple Mac User Guide](https://support.apple.com/en-au/guide/mac-help/mh40617/mac)
- **macOS says the app is damaged, will damage your computer, or contains malware.** Stop. Download a fresh copy from the official release page and verify its checksum. If the alert persists, report the PicParty version, macOS version, and exact alert text to the project. [Apple's explanation of macOS alerts](https://support.apple.com/en-us/102445)
- **The app is incompatible with this Mac.** Check **About This Mac**. This asset targets Apple silicon (arm64). An Intel Mac needs a build for Intel, and Macs running an earlier version of macOS need to update to macOS 13 or later.
