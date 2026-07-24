import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRoot, exists, loadConfig, run } from "./lib.mts";

export async function audit(output?: string): Promise<void> {
  const config = await loadConfig();
  const root = output ?? resolve(buildRoot, `douyin-devtools-${config.version}-linux-x64`);
  const app = resolve(root, "resources", "app");
  const files = [
    "app.content/node_modules/@byted-tila/vscode/out/node_modules/@vscode/spdlog/build/Release/spdlog.node",
    "app.content/node_modules/@byted-tila/vscode/out/node_modules/@vscode/sqlite3/build/Release/vscode-sqlite3.node",
    "app.content/node_modules/@byted-tila/vscode/out/node_modules/native-keymap/build/Release/keymapping.node",
    "app.content/node_modules/@byted-tila/vscode/out/node_modules/@parcel/watcher/build/Release/watcher.node",
    "app.content/node_modules/@byted-tila/vscode/out/node_modules/@vscode/ripgrep/bin/rg",
    "app.content/node_modules/@byted-rspuck/rspack-binding/rspack.linux-x64-gnu.node",
    "app.content/node_modules/@node-rs/xxhash/xxhash.linux-x64-gnu.node",
  ].map((path) => resolve(app, path));

  if (!(await exists(resolve(root, "electron")))) {
    throw new Error("缺少 Linux Electron 可执行文件");
  }
  await run("file", files);

  for (const file of files) {
    const handle = await open(file, "r");
    const magic = Buffer.alloc(4);
    await handle.read(magic, 0, magic.length, 0);
    await handle.close();
    if (!magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      throw new Error(`不是 Linux ELF 文件：${file}`);
    }
  }

  const helper = await readFile(
    resolve(app, "app.content/dist/pages/main-helper/index.js"),
    "utf8",
  );
  if (!helper.includes('process.platform==="linux"?require("../../../../linux-toolkit-bridge.js")')) {
    throw new Error("Toolkit bridge 补丁缺失");
  }
  console.log("静态审计通过。");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await audit();
}
