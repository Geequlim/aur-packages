# 抖音开发者工具 4.5.3 Windows 解包版的 Linux 运行记录

本文记录将 Windows 版抖音开发者工具解包目录改到 Linux Electron 后，达到以下状态所需的操作：

- 可以启动并登录
- 可以创建、打开项目
- 编辑器和模拟器不再黑屏
- 可以生成预览二维码
- 本地 Rspuck 编译成功
- 审核预检可以运行
- 可以上传到平台

最后验证日期：2026-07-24。

## 1. 当前基线

- 应用目录：`/home/geequlim/Desktop/resources/app`
- 原应用版本：`4.5.3`
- Linux Electron：`36.4.0`
- Electron 内置 Node：`22.15.1`
- 架构：Linux x86-64，glibc
- 临时 Electron 安装目录：`/tmp/douyin-electron-probe`

Electron 版本需要尽量和原工具匹配。当前已验证的安装方式：

```bash
mkdir -p /tmp/douyin-electron-probe
npm install \
  --prefix /tmp/douyin-electron-probe \
  --registry=https://registry.npmmirror.com \
  electron@36.4.0
```

`/tmp` 会在重启或系统清理后丢失。自动化时应改为固定缓存目录，或在启动前检查并自动安装。

## 2. 启动参数

当前可靠启动命令：

```bash
env -u http_proxy -u https_proxy \
  GTK_MODULES= NO_AT_BRIDGE=1 \
  /tmp/douyin-electron-probe/node_modules/.bin/electron \
  --no-sandbox --gtk-version=3 \
  /home/geequlim/Desktop/resources/app \
  --user-data-dir=/tmp/douyin-electron-userdata-test
```

参数原因：

- `--gtk-version=3`：避免系统同时加载 GTK 3/GTK 4 导致崩溃或黑屏。
- `GTK_MODULES=`、`NO_AT_BRIDGE=1`：减少 GTK 辅助模块冲突。
- `--no-sandbox`：当前运行环境中的 Electron SUID sandbox 不可用。
- `env -u http_proxy -u https_proxy`：避免开发者工具继承到不可用的本地代理。
- `--user-data-dir`：隔离测试数据；正式自动化应使用固定、持久化目录。

不要额外传入 `--remote-debugging-port`。开发者工具启动时会自行选择调试端口，并同时设置 `BYTEDANCE_IDE_PORT`；内置 Chrome DevTools 会通过这个环境变量查找 `MiniApp Webview`。外部强制指定端口可能导致模拟器画面正常，但内置调试终端只有前端 WebSocket、没有游戏 Target、执行上下文和 Console 消息。

采集日志时：

```bash
env -u http_proxy -u https_proxy \
  GTK_MODULES= NO_AT_BRIDGE=1 \
  /tmp/douyin-electron-probe/node_modules/.bin/electron \
  --no-sandbox --gtk-version=3 \
  /home/geequlim/Desktop/resources/app \
  --user-data-dir=/tmp/douyin-electron-userdata-test \
  2>&1 | tee /tmp/douyin-linux.log
```

## 3. 替换 VS Code/Electron 原生模块

Windows 解包目录中的 `.node` 文件是 PE/Windows 二进制，Linux 加载时会报 `invalid ELF header`。需要按原包版本构建或取得 Linux x64 glibc 版本。

目标目录位于开发者工具内嵌 VS Code 的依赖树：

```text
app/app.content/node_modules/@byted-tila/vscode/out/node_modules
```

需要处理的模块：

| 模块 | 固定版本 | Linux 目标文件 |
| --- | --- | --- |
| `@vscode/spdlog` | `0.15.2` | `build/Release/spdlog.node` |
| `@vscode/sqlite3` | `5.1.8-vscode` | `build/Release/vscode-sqlite3.node` |
| `native-keymap` | `3.3.5` | `build/Release/keymapping.node` |
| `@parcel/watcher` | `2.5.1` | `build/Release/watcher.node` |
| `@vscode/ripgrep` | `1.15.14` | `bin/rg` |

前三个模块已经用系统 `node-gyp` 和系统 Node headers 构建。它们使用 N-API，不必严格绑定 Electron ABI。构建时使用本机 headers，避免 `node-gyp` 再从网络下载：

```bash
npm_config_nodedir=/usr npm_config_build_from_source=true npm install
```

自动化实现建议：

1. 在独立临时目录安装上述精确版本。
2. 对 `spdlog`、`sqlite3`、`native-keymap` 强制源码构建。
3. 对 Parcel Watcher 安装 `@parcel/watcher-linux-x64-glibc@2.5.1`，复制其 Linux 二进制。
4. 执行 `@vscode/ripgrep` 的安装脚本取得 Linux `rg`。
5. 替换前先把原 Windows 文件改名为 `*.win32.original`。
6. 用 `file` 断言新 `.node` 文件是 `ELF 64-bit`，`rg` 是 Linux ELF 可执行文件。

当前保留的 Windows 备份：

```text
@parcel/watcher/build/Release/watcher.node.win32.original
@vscode/spdlog/build/Release/spdlog.node.win32.original
@vscode/sqlite3/build/Release/vscode-sqlite3.node.win32.original
native-keymap/build/Release/keymapping.node.win32.original
```

## 4. 修复工作台和辅助进程黑屏

### 4.1 根因

Windows 应用直接由 Linux Electron 加载时，renderer/utility process 中的 Electron app name 和 version 可能是 `null`。内置 `electron-log` 随后调用 `path.join(null, ...)`，导致 React 工作台或 Main Helper 在加载阶段退出。

需要给应用名和版本加兜底：

```text
name: miniprogram-ide
version: 4.5.3
```

### 4.2 工作台 bundle

文件：

```text
app/app.content/dist/applications/common/vendors.js
```

把 minified bundle 中：

```js
return e||(e=r.name),t||(t=r.version),{name:e,version:t}
```

替换为：

```js
return e||(e=r.name||"miniprogram-ide"),t||(t=r.version||"4.5.3"),{name:e,version:t}
```

备份文件：

```text
app/app.content/dist/applications/common/vendors.js.win32.original
```

### 4.3 Main Helper bundle

文件：

```text
app/app.content/dist/pages/main-helper/index.js
```

此 bundle 压缩后的局部变量名不同。把：

```js
return e||(e=n.name),t||(t=n.version),{name:e,version:t}
```

替换为：

```js
return e||(e=n.name||"miniprogram-ide"),t||(t=n.version||"4.5.3"),{name:e,version:t}
```

备份文件：

```text
app/app.content/dist/pages/main-helper/index.js.win32.original
```

自动化替换前必须断言旧字符串恰好出现一次；替换后断言新字符串恰好出现一次。版本升级后变量名或 bundle 内容可能改变，不能盲目全局替换。

### 4.4 模拟器 bundle

本地编译成功并不代表模拟器 runtime 已启动。模拟器使用另一份动态提供的 bundle，其中也内置了相同的 `electron-log`。未修复时的表现是：

- 模拟器一直显示加载转圈。
- 调试器没有业务日志。
- 在调试器控制台输入 `tt` 没有反应。
- 模拟器 WebView 报 `The "path" argument must be of type string. Received null`。

需要修复两个文件：

```text
app/app.content/dist/applications/extract-miniapp-page/vendors-536eaa00.js
app/app.content/dist/applications/extract-miniapp-page/monitor-service.js
```

`vendors-536eaa00.js` 中把：

```js
return e||(e=r.name),t||(t=r.version),{name:e,version:t}
```

替换为：

```js
return e||(e=r.name||"miniprogram-ide"),t||(t=r.version||"4.5.3"),{name:e,version:t}
```

`monitor-service.js` 中把：

```js
return e||(e=n.name),t||(t=n.version),{name:e,version:t}
```

替换为：

```js
return e||(e=n.name||"miniprogram-ide"),t||(t=n.version||"4.5.3"),{name:e,version:t}
```

对应备份：

```text
app/app.content/dist/applications/extract-miniapp-page/vendors-536eaa00.js.win32.original
app/app.content/dist/applications/extract-miniapp-page/monitor-service.js.win32.original
```

修复后通过 Electron CDP 实测：

```text
[simulator] miniapp ready
[simulator] ws client opened
typeof tt === "object"
document.readyState === "complete"
```

如果这之后游戏仍显示“无法启动”，应读取调试器里的业务资源错误。例如测试项目曾请求 `192.168.x.x` 上未启动的资源服务器，这属于项目运行配置或域名校验问题，不是模拟器 runtime 故障。

内置 Chrome DevTools 正常连接时，启动日志还应包含工具自己生成的端口：

```text
[IDE INSPECT PORT] <随机端口>
BYTEDANCE_IDE_PORT <同一端口>
DevTools listening on ws://127.0.0.1:<同一端口>/...
```

三处端口必须一致。不要在自动化启动命令中覆盖它。

## 5. 绕过仅有 Windows 版本的私有 Toolkit 加载

包：

```text
@byted-rspuck/toolkit
```

其入口由 Nodeguard 保护，只包含：

```text
dist/__META-INF__/win32x64.node
```

Linux 下只要在 Main Helper 启动时直接 `require` 它，整个辅助进程就会退出。当前在：

```text
app/app.content/dist/pages/main-helper/index.js
```

把静态导入改为按平台选择：

```js
const _=process.platform==="linux"
  ?require("../../../../linux-toolkit-bridge.js")
  :require("@byted-rspuck/toolkit");
```

Linux bridge：

```text
app/linux-toolkit-bridge.js
```

当前 bridge 只暴露 `packAppDist`，调用时会明确报“尚未实现”。实际验证中，当前项目的成功上传路径没有调用这项接口，因此登录、预览、本地编译、预检和上传均可完成。

注意：其他项目类型或加密上传路径可能调用 `packAppDist`。如果未来日志出现 bridge 的报错，需要单独实现该能力，不能删除这个保护性错误后假装打包成功。

尝试过用 Wine 加载原 Windows 模块：

- 普通 Windows Node 22.14.0：Node ABI 不支持。
- Windows Electron 36.4.0：ABI 通过，但 Nodeguard 解密后的源码在 Wine 下语法损坏。

因此 Wine 方案目前不适合自动化生产流程。

## 6. 补齐本地 Rspuck 编译链

### 6.1 Rspack Linux binding

私有包：

```text
@byted-rspuck/rspack-binding@0.1.4
```

声明依赖 `@byted-rspuck/rspack-binding-linux-x64-gnu@0.1.4`，但该包发布在字节内部 registry，公网无法取得。

通过依赖元数据确认该私有 fork 基于上游 Rspack `1.3.0`：

- `@module-federation/runtime-tools@0.11.1`
- `@rspack/lite-tapable@1.0.1`
- `caniuse-lite@^1.0.30001706`

这些依赖与 `@rspack/core@1.3.0` 精确一致。安装上游 Linux binding：

```bash
npm install \
  --prefix /tmp/douyin-linux-bindings \
  --registry=https://registry.npmjs.org \
  @rspack/binding-linux-x64-gnu@1.3.0
```

把：

```text
/tmp/douyin-linux-bindings/node_modules/@rspack/binding-linux-x64-gnu/rspack.linux-x64-gnu.node
```

复制到：

```text
app/app.content/node_modules/@byted-rspuck/rspack-binding/rspack.linux-x64-gnu.node
```

当前文件 SHA-256：

```text
fb2828f4d6486c3d2a90e0948dc60cb8083fdcecd2eb45b5b50085c71c5f2627
```

### 6.2 xxhash Linux binding

精确版本：

```text
@node-rs/xxhash@1.7.6
```

安装：

```bash
npm install \
  --prefix /tmp/douyin-linux-bindings \
  --registry=https://registry.npmjs.org \
  @node-rs/xxhash-linux-x64-gnu@1.7.6
```

把：

```text
/tmp/douyin-linux-bindings/node_modules/@node-rs/xxhash-linux-x64-gnu/xxhash.linux-x64-gnu.node
```

复制到：

```text
app/app.content/node_modules/@node-rs/xxhash/xxhash.linux-x64-gnu.node
```

当前文件 SHA-256：

```text
88f183eb8cbef68ec86fed89a3b36e18afd5a8d1632166c92db1aba7d295a5bc
```

不要执行一次无约束的 `npm install` 覆盖应用依赖树。只安装和复制确认过的精确 Linux 原生包，保留原有 JavaScript 依赖和 Windows 包。

## 7. 验证方法

### 7.1 Main Helper

启动日志必须出现：

```text
successfully created MainHelper
process ready
```

不能再出现：

```text
Main helper loader error
utility process is no response
The "path" argument must be of type string. Received null
```

### 7.2 本地编译

开发者工具内的实际编译日志必须出现：

```text
[puck message] { name: 'START', ... }
[puck message] { name: 'END', ..., result: 'success' }
[compile success]update project hash ...
```

不能只依据模拟器显示正常判断编译成功。此前缺少 Linux binding 时，工具会启动 compiler，但立即出现：

```text
compile process exit, exit with compile end: { code: 1, signal: null }
```

### 7.3 功能回归

按顺序验证：

1. 启动工具，无黑屏。
2. 登录。
3. 创建并打开项目。
4. 修改一个源文件，确认触发本地编译成功。
5. 打开模拟器。
6. 生成预览二维码。
7. 执行审核预检。
8. 上传到平台。

服务端返回的真实能力审核结果与本地 compiler/utility process 故障是两类问题。只有本地日志已出现编译成功后，平台仍返回的能力缺失才应按业务代码问题处理。

## 8. 自动化脚本建议

后续脚本应设计为幂等流程：

1. 校验应用版本是 `4.5.3`，Electron 目标版本是 `36.4.0`。
2. 校验系统是 Linux x86-64 glibc。
3. 下载依赖到固定缓存，并校验版本或 SHA-256。
4. 备份 Windows 原生文件；已有备份时不重复覆盖。
5. 构建/复制 VS Code Linux 原生模块。
6. 复制 Rspack 和 xxhash Linux binding。
7. 对两个 minified bundle 做带出现次数断言的精确替换。
8. 安装 `linux-toolkit-bridge.js` 并切换 Linux 导入。
9. 用 `file`、`sha256sum`、`require()` 做静态和加载验证。
10. 启动一次冒烟测试，等待 `process ready` 和 `result: success`。
11. 输出固定启动脚本。

自动化不能包含账号、cookie、App ID、设备 ID、项目路径或上传令牌；这些应由用户数据目录和运行时环境提供。

## 9. 已知非阻塞日志

当前可正常运行和上传时，仍可能看到以下日志：

- crash reporter 初始化接口缺失
- `getApplicationInfoForProtocol is not a function`
- Fontconfig 配置警告
- GTK/IBus 警告
- VSync/GPU 警告
- 无法联通字节内网
- 更新器只提供 Windows/macOS manifest

这些日志目前不是本地编译或上传失败的判据。自动化测试应关注 Main Helper 是否 ready，以及 compiler 是否返回 `result: success`。
