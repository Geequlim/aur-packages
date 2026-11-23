# AUR Packages

集中维护为第三方软件提供的 Arch Linux 打包和 Linux 适配工程。

| 维护目录 | 软件来源与维护内容 |
| --- | --- |
| [layaair-ide](packages/layaair-ide) | LayaAir 官方 AppImage 重打包 |
| [layaair-cli](packages/layaair-cli) | LayaAir 官方 CLI ZIP 重打包 |
| [cosbrowser-bin](packages/cosbrowser-bin) | 腾讯云 COSBrowser 重打包 |
| [t3-code-cli-bin](packages/t3-code-cli-bin) | T3 Code 官方二进制重打包，支持 x86_64 / aarch64 |
| [thirtyfile-bin](packages/thirtyfile-bin) | ThirtyFile 官方静态二进制与 systemd 服务，支持 x86_64 / aarch64 |
| [douyin-devtools-bin](packages/douyin-devtools-bin) | 抖音开发者工具 Linux 适配、AppImage 与 AUR 打包 |

各原仓库的提交历史通过 Git subtree 合并保留。已有独立软件项目（例如 Agent Glow、VoxSpell、Quota Glance）的 AUR 功能由各自项目维护。

## 维护入口

在仓库根目录执行：

```bash
./scripts/aur list
./scripts/aur check all
./scripts/aur update layaair-ide
./scripts/aur verify layaair-ide
./scripts/aur build layaair-ide
```

`check` 只检测，不修改已跟踪的文件。COSBrowser 必须在上游探测信息变化时下载 ZIP 才能确认实际版本。

`update` 修改本地文件；核对差异、验证并提交后，再发布指定包：

```bash
git diff
git add packages/layaair-ide
git commit -m 'chore(layaair-ide): update packaging'
./scripts/aur publish layaair-ide
```

重打包工程需要 Arch Linux 的 `base-devel`、`git`、`jq`、`curl`、`aria2`、`openssh` 和 `libarchive`。ThirtyFile 的上游构建证明验证另外使用 `github-cli`。`makepkg` 使用普通用户运行。

上游在相同版本号下替换文件时，使用 `FORCE=true ./scripts/aur update <包名>` 重新下载并刷新修订号。各包专有的参数与缓存选项见对应目录的 README。

## 自动更新与 AUR 同步

[Update AUR repacks](.github/workflows/auto-update.yml) 每天 02:37 UTC 维护五个直接重打包的包，也支持手动选择单包和强制刷新。

- 按包依次更新、校验、提交和推送，避免并发修改同一分支。
- 某个包失败时继续处理其他包，最终以失败状态报告需要处理的项目。
- 每次都单独检查 AUR 差异，即使 GitHub 没有新变化，也会重试之前失败的 AUR 发布。
- 从各包的 AUR 仓库克隆历史后同步打包文件，验证源文件再提交；不把本仓库的历史直接推送到 AUR。

新仓库需要配置 Actions secret `AUR_SSH_PRIVATE_KEY`，再将 repository variable `AUR_PUBLISH_ENABLED` 设为 `true`。未启用时仍会更新 GitHub，但跳过 AUR 推送。AUR 用户固定为 `aur`，不需要 `AUR_USERNAME`。

GitHub 公开仓库连续 60 天无活动会停用定时工作流，需要在 Actions 中重新启用；持续维护时应关注工作流的最后运行时间。

## 抖音 Linux 适配

抖音保留完整的版本检测、补丁、原生依赖构建、静态审计、AppImage 和 Arch 打包流程，详细说明见 [包级 README](packages/douyin-devtools-bin/README.md)。先安装脚本依赖：

```bash
cd packages/douyin-devtools-bin
npm ci --ignore-scripts
cd ../..
./scripts/aur check douyin-devtools-bin
./scripts/aur update douyin-devtools-bin
./scripts/aur verify douyin-devtools-bin
./scripts/aur build douyin-devtools-bin
```

`update` 只记录待适配的上游版本，不自动切换已适配版本。迁移后的 [Douyin nightly release](.github/workflows/douyin-release.yml) 继续在构建和审计通过后发布 AppImage、提升默认版本，不自动发布 AUR。

全部产物发布到本仓库，tag 使用 `douyin-devtools-v<版本>`，与其他包的版本区分。历史版本 4.5.3、4.5.5、4.5.6 的 Release 和校验文件也已迁入。准备好本地 AppImage 后，`./scripts/aur publish douyin-devtools-bin` 会发布 Release、生成打包文件、验证源文件并同步 AUR，与原手动发布流程一致。

## 验证

安装抖音脚本依赖后运行 `./scripts/aur verify all`，同时检查五个包的 `.SRCINFO` 和抖音脚本类型。公共维护流程的回归测试使用临时本地 Git 仓库，不访问 AUR：

```bash
python3 -m unittest discover -s tests -v
```
