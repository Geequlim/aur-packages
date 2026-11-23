import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import {
  cacheRoot,
  ensureDir,
  exists,
  loadConfig,
  parseArg,
  sha256,
} from "./lib.mts";

export async function downloadDmg(): Promise<string> {
  const config = await loadConfig();
  const downloads = resolve(cacheRoot, "downloads");
  const destination = resolve(downloads, `douyin-devtools-${config.version}-arm64.dmg`);
  const supplied = parseArg("--dmg");

  await ensureDir(downloads);

  if (supplied) {
    const source = resolve(supplied);
    const actual = await sha256(source);
    if (actual !== config.dmgSha256) {
      throw new Error(`指定 DMG 的 SHA-256 不匹配：${actual}`);
    }
    console.log(`使用已校验的本地 DMG：${source}`);
    return source;
  }

  if (await exists(destination)) {
    const actual = await sha256(destination);
    if (actual === config.dmgSha256) {
      console.log(`复用已校验的下载缓存：${destination}`);
      return destination;
    }
    await unlink(destination);
  }

  const temporary = `${destination}.part`;
  console.log(`下载 ${config.dmgUrl}`);
  const response = await fetch(config.dmgUrl, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败：HTTP ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.from(response.body), createWriteStream(temporary));
  const actual = await sha256(temporary);
  if (actual !== config.dmgSha256) {
    await unlink(temporary);
    throw new Error(`DMG 的 SHA-256 不匹配：${actual}`);
  }
  await rename(temporary, destination);
  console.log(`下载完成并通过 SHA-256 校验：${destination}`);
  return destination;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await downloadDmg();
}
