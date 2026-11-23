# 抖音小游戏开发者工具 Linux 构建工程

> 维护已迁移至 [Geequlim/aur-packages](https://github.com/Geequlim/aur-packages/tree/main/packages/douyin-devtools-bin)。后续代码、问题反馈和自动更新请前往新仓库；本仓库保留历史代码与旧版 Release。

从抖音官方 macOS arm64 DMG 提取业务应用，替换 Linux x86-64 原生依赖，
生成可在本机直接启动的 Electron 应用目录，并进一步打包为 AppImage。

## 环境要求

- Linux x86-64，glibc
- Node.js 24 或更高版本
- npm
- 7-Zip（命令名为 `7z`）
- C/C++ 编译工具链、Python 3、`pkg-config`
- ImageMagick（命令名为 `magick`）
- `desktop-file-validate`

所有工程脚本均为 Node.js 24 可直接执行的 `.mts` 文件，不需要预编译。

## 检查官网版本

版本快捷指令统一使用 Tiny。只检查官网，不修改文件：

```bash
tiny run tools/check
```

把官网最新版本、发布日期、构建 ID 和 Mac arm64 DMG 地址写入工程：

```bash
tiny run tools/update
```

版本状态记录在 `configs/releases.json`：

- `latest` 是官网当前公开的最新版本，由 `tools/update` 维护。
- `supportedVersion` 是已经完成 Linux 适配、默认用于构建的版本。

如果官网出现新版本，`tools/update` 只更新 `latest`，不会让尚未验证的版本破坏
现有构建。准备好 `configs/versions/<version>.json`、正确的 DMG SHA-256 和
`templates/patches/<version>.json` 后，再执行：

```bash
tiny run tools/promote
```

提升成功后，没有显式传入 `--version` 的构建、运行和打包命令都会使用新的
`supportedVersion`。命令行 `--version` 和 `DOUYIN_VERSION` 仍可临时覆盖默认值。

### 每夜自动更新

GitHub Actions 在北京时间每天 00:00 检查官网。发现 `latest` 高于当前
`supportedVersion` 时，流水线会：

1. 下载新 DMG，计算 SHA-256，并从应用声明中读取 Electron 和原生依赖版本。
2. 从当前适配版本复制补丁模板，由实际构建验证每个补丁锚点是否仍然兼容。
3. 构建并静态审计可运行目录，然后生成 AppImage 和校验文件。
4. 创建或更新 `v<version>` GitHub Release。
5. 发布成功后提升 `supportedVersion`，由 `github-actions[bot]` 提交并推送生成的
   版本配置和补丁模板。

也可以在 GitHub Actions 页面手动运行 `Nightly Update And Release`。如果新版导致
补丁、原生依赖或构建流程不兼容，任务会失败且不会提升默认版本。该工作流不会生成、
提交或发布 AUR 包；AUR 始终只通过 `tiny run publish/arch/aur` 手动发布。

仓库需要允许 GitHub Actions 使用 `contents: write` 创建 Release 和推送版本配置；
如果默认分支启用了保护规则，也需要允许 `github-actions[bot]` 执行这次自动提交。

## 模板约定

脚本需要输出静态补丁、启动器、桌面入口或其他文本文件时，文件正文统一放在
`templates/`，TS 脚本只负责复制或渲染：

```text
templates/
├── appimage/       # AppRun 和 desktop entry
├── patches/        # 按开发者工具版本区分的补丁定义
└── runtime/        # 可运行目录的启动器和兼容 bridge
```

模板变量使用 `{{VARIABLE}}` 格式。缺少变量时构建会立即失败，防止生成不完整文件。
完全由构建参数组成的 JSON 元数据和哈希文件仍由 TS 动态序列化生成。

## 一键构建

```bash
npm run build -- --version 4.5.3
```

构建依次完成：

1. 下载并校验官方 Mac arm64 DMG。
2. 提取 `Contents/Resources/app`。
3. 下载精确版本的 Linux Electron。
4. 构建或下载 Linux x86-64 原生模块。
5. 应用带出现次数断言的兼容补丁。
6. 生成运行目录并执行静态审计。

如果已经有下载好的官方 DMG：

```bash
npm run build -- \
  --version 4.5.3 \
  --dmg /absolute/path/to/抖音开发者工具-4.5.3-arm64.dmg
```

本地文件仍会经过 SHA-256 校验。

## 启动

```bash
npm start -- --version 4.5.3
```

也可以直接启动构建结果：

```bash
node build/douyin-devtools-4.5.3-linux-x64/run.mts
```

默认用户数据保存在 `~/.config/douyin-devtools-linux`，登录状态和项目记录会在重启后保留。

构建结果位于：

```text
build/douyin-devtools-4.5.3-linux-x64/
├── electron
├── resources/app/
├── run.mts
└── BUILD-INFO.json
```

## AppImage 打包

先完成可运行目录构建，再生成 AppImage：

```bash
npm run build -- --version 4.5.3
npm run appimage -- --version 4.5.3
```

打包脚本会：

1. 生成标准 AppDir 目录及 Linux 桌面入口。
2. 从官方 DMG 提取并转换 512×512 应用图标。
3. 下载并校验固定版本的 `appimagetool` 和 Type 2 runtime。
4. 使用 zstd 压缩，生成 AppImage 和 SHA-256 校验文件。

产物位于：

```text
dist/
├── DouyinDevTools-4.5.3-x86_64.AppImage
└── DouyinDevTools-4.5.3-x86_64.AppImage.sha256
```

启动：

```bash
./dist/DouyinDevTools-4.5.3-x86_64.AppImage
```

如果系统没有 FUSE，可使用 AppImage 自带的解包运行模式：

```bash
APPIMAGE_EXTRACT_AND_RUN=1 \
  ./dist/DouyinDevTools-4.5.3-x86_64.AppImage
```

校验产物：

```bash
cd dist
sha256sum -c DouyinDevTools-4.5.3-x86_64.AppImage.sha256
```

## Arch Linux 包与 AUR

项目级快捷指令统一定义在 `project.tiny`，Arch 打包不使用 npm script。

生成本地 pacman 安装包：

```bash
tiny run publish/arch
```

该指令会重新生成 AppImage，再通过 `makepkg` 输出：

```text
dist/arch/packages/douyin-devtools-bin-4.5.3-1-x86_64.pkg.tar.zst
```

本地安装：

```bash
sudo pacman -U \
  dist/arch/packages/douyin-devtools-bin-4.5.3-1-x86_64.pkg.tar.zst
```

发布到 AUR：

```bash
tiny run publish/arch/aur
```

发布子指令会执行外部写操作：

1. 创建或更新 GitHub Release `v<开发者工具版本>`，上传 AppImage 和校验文件。
2. 生成面向 GitHub Release 的 `PKGBUILD` 与 `.SRCINFO`。
3. 使用 SSH 克隆并更新 `douyin-devtools-bin` AUR 仓库。
4. 验证远端源文件后提交并推送到 AUR。

执行前需要：

- 已安装并登录 GitHub CLI：`gh auth status`
- 已配置 AUR SSH 密钥，能够访问 `aur@aur.archlinux.org`
- 已安装 `git`、`makepkg` 和 `ssh`

Arch 包名、GitHub 仓库和 AUR 仓库统一记录在 `configs/packaging.json`，PKGBUILD
正文位于 `templates/arch/PKGBUILD`。

启动器默认清除当前环境中的 HTTP/HTTPS 代理变量，以避免不可用的本地代理影响
开发者工具联网。如果需要继承代理：

```bash
DOUYIN_KEEP_PROXY=1 npm start -- --version 4.5.3
```

## 验证

静态审计：

```bash
npm run audit -- --version 4.5.3
```

30 秒 GUI 冒烟测试：

```bash
npm run smoke -- --version 4.5.3
```

AppImage GUI 冒烟测试：

```bash
npm run smoke:appimage -- --version 4.5.3
```

冒烟测试等待以下状态：

- `successfully created MainHelper`
- `process ready`

发布前仍需人工验证登录、打开项目、本地编译、模拟器、预览、预检和上传。

## 缓存与重新构建

下载、解包、原生依赖和 AppImage 工具缓存位于 `.cache/`，中间构建结果位于
`build/`，发布产物位于 `dist/`，三者均不提交 Git。重复构建会复用已验证缓存，
但每次都会重新生成干净的运行目录并重新应用补丁。

官网最新版本和当前默认适配版本记录在 `configs/releases.json`；版本、DMG 哈希、
Electron 版本和原生依赖版本统一记录在 `configs/versions/<version>.json`；
AppImage 工具版本和哈希记录在 `configs/tooling.json`。版本专用补丁记录在
`templates/patches/<version>.json`。

## 当前兼容策略

- Electron 固定为官方应用声明的 `36.4.0`。
- 替换 spdlog、sqlite3、native-keymap、Parcel Watcher 和 ripgrep。
- 补齐 Rspack 与 xxhash 的 Linux binding。
- 修复四个 renderer/utility bundle 中缺失应用名和版本的问题。
- Linux 下使用显式 Toolkit bridge，避免加载缺失的私有 `linuxx64.node`。
- 不强制覆盖 `BYTEDANCE_IDE_PORT`，由开发者工具自行管理调试端口。

## 已知限制

### 局域网预览 TTPKG 打包

官方 Mac 应用中的 `@byted-rspuck/toolkit.packAppDist` 用于把项目编译产物转换为
局域网预览所需的 TTPKG 主包和分包。该 Toolkit 经过原生保护，官方包中没有可供
Linux x86-64 直接加载的实现。

当前 Linux Toolkit bridge 保留了 `packAppDist` 接口，但调用时会明确抛出“暂未实现”
错误。因此，任何依赖该接口重新生成 TTPKG 的局域网预览路径目前不可用；不经过
`packAppDist` 的本地编译、模拟器运行及其他功能不受此限制。

原应用同时包含可在 Linux 运行的 `@byted-rspuck/plugin-ttpkg` 打包核心，后续可以
基于它补齐目录遍历、分包识别和 manifest 生成。由于当前目标不要求与 Mac 产物
逐字节一致，这项兼容工作暂缓，不应通过返回空结果或伪造成功状态绕过。

### 发行版兼容性

当前原生模块仍在打包主机上构建，因此这个 AppImage 首先保证在当前 Linux 环境
运行。若要面向更旧的发行版发布，需要在固定的旧版 glibc 构建环境中完成整个流程。

详细的 Windows 版手工验证背景见 `LINUX_PORTING_NOTES.md`。
