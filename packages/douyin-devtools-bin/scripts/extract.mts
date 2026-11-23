import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  cacheRoot,
  ensureDir,
  findExtractedApp,
  loadConfig,
  parseArg,
  run,
} from "./lib.mts";
import { downloadDmg } from "./download.mts";

export async function extractDmg(dmgPath?: string): Promise<string> {
  const config = await loadConfig();
  const root = resolve(cacheRoot, "sources", config.version);
  const marker = resolve(root, ".extracted");

  try {
    const app = await findExtractedApp(root);
    console.log(`复用已提取的应用目录：${app}`);
    return app;
  } catch {
    await rm(root, { recursive: true, force: true });
  }

  const dmg = dmgPath ?? parseArg("--dmg") ?? await downloadDmg();
  await ensureDir(root);
  const exitCode = await run("7z", [
    "x",
    "-y",
    `-o${root}`,
    resolve(dmg),
    "抖音开发者工具.app/Contents/Resources/app/*",
  ], { allowFailure: true });
  // 7-Zip 在 Linux 上会把 DMG 内安全的相对 npm .bin 链接也标记为
  // "Dangerous link path"，并以 2 退出；应用运行不依赖这些 CLI 链接。
  if (exitCode !== 0 && exitCode !== 2) {
    throw new Error(`7z 解包失败，退出码为 ${exitCode}`);
  }

  const app = await findExtractedApp(root);
  await writeFile(marker, `${config.version}\n`);
  console.log(`提取完成：${app}`);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await extractDmg();
}
