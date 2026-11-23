import { createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  buildRoot,
  cacheRoot,
  copyTemplate,
  ensureDir,
  exists,
  loadConfig,
  projectRoot,
  renderTemplate,
  run,
  sha256,
  withoutProxyEnv,
} from "./lib.mts";
import { downloadDmg } from "./download.mts";
import { prepareRunnableDirectory } from "./prepare.mts";

interface PinnedTool {
  sourceCommit: string;
  url: string;
  apiUrl?: string;
  sha256: string;
}

interface ToolingConfig {
  appimagetool: PinnedTool;
  type2Runtime: PinnedTool;
}

async function loadTooling(): Promise<ToolingConfig> {
  return JSON.parse(
    await readFile(resolve(projectRoot, "configs", "tooling.json"), "utf8"),
  ) as ToolingConfig;
}

async function ensurePinnedTool(
  tool: PinnedTool,
  directoryName: string,
  filename: string,
  executable: boolean,
): Promise<string> {
  const directory = resolve(cacheRoot, "tools", directoryName);
  const destination = resolve(directory, filename);
  await ensureDir(directory);

  if (await exists(destination)) {
    const actual = await sha256(destination);
    if (actual === tool.sha256) {
      if (executable) await chmod(destination, 0o755);
      return destination;
    }
    await rm(destination, { force: true });
  }

  const temporary = `${destination}.part`;
  console.log(`下载 ${directoryName} ${tool.sourceCommit}`);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await rm(temporary, { force: true });
    try {
      const response = await fetch(
        tool.apiUrl ?? tool.url,
        {
        redirect: "follow",
        headers: tool.apiUrl
          ? { Accept: "application/octet-stream" }
          : undefined,
        signal: AbortSignal.timeout(120_000),
        },
      );
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      await pipeline(Readable.from(response.body), createWriteStream(temporary));
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      console.warn(`${directoryName} 下载第 ${attempt} 次失败，准备重试。`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000));
    }
  }
  if (lastError) throw lastError;
  const actual = await sha256(temporary);
  if (actual !== tool.sha256) {
    await rm(temporary, { force: true });
    throw new Error(`${directoryName} SHA-256 不匹配：${actual}`);
  }
  if (executable) await chmod(temporary, 0o755);
  await rm(destination, { force: true });
  const { rename } = await import("node:fs/promises");
  await rename(temporary, destination);
  return destination;
}

function extractLargestPngFromIcns(content: Buffer): Buffer {
  if (content.toString("ascii", 0, 4) !== "icns") {
    throw new Error("图标文件不是有效 ICNS");
  }
  let offset = 8;
  let selected: Buffer | undefined;
  let selectedWidth = 0;
  while (offset + 8 <= content.length) {
    const chunkLength = content.readUInt32BE(offset + 4);
    if (chunkLength < 8 || offset + chunkLength > content.length) break;
    const payload = content.subarray(offset + 8, offset + chunkLength);
    if (
      payload.length >= 24
      && payload.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      const width = payload.readUInt32BE(16);
      if (width > selectedWidth) {
        selected = payload;
        selectedWidth = width;
      }
    }
    offset += chunkLength;
  }
  if (!selected) {
    throw new Error("ICNS 中找不到 PNG 图标");
  }
  return selected;
}

async function ensureIcon(): Promise<string> {
  const config = await loadConfig();
  const iconDirectory = resolve(cacheRoot, "icons", config.version);
  const png = resolve(iconDirectory, "douyin-devtools-512.png");
  if (await exists(png)) return png;

  const dmg = await downloadDmg();
  await rm(iconDirectory, { recursive: true, force: true });
  await ensureDir(iconDirectory);
  await run("7z", [
    "x",
    "-y",
    `-o${iconDirectory}`,
    dmg,
    "抖音开发者工具.app/Contents/Resources/icon.icns",
  ]);

  const icns = resolve(
    iconDirectory,
    "抖音开发者工具.app",
    "Contents",
    "Resources",
    "icon.icns",
  );
  const sourcePng = resolve(iconDirectory, "douyin-devtools-source.png");
  await writeFile(sourcePng, extractLargestPngFromIcns(await readFile(icns)));
  await run("magick", [
    sourcePng,
    "-resize",
    "512x512",
    png,
  ]);
  return png;
}

async function buildAppDir(runtime: string, icon: string): Promise<string> {
  const config = await loadConfig();
  const appDir = resolve(buildRoot, `douyin-devtools-${config.version}.AppDir`);
  const appRoot = resolve(appDir, "usr", "lib", "douyin-devtools");
  const bin = resolve(appDir, "usr", "bin", "douyin-devtools");
  const desktop = resolve(appDir, "douyin-devtools.desktop");
  const installedDesktop = resolve(
    appDir,
    "usr",
    "share",
    "applications",
    "douyin-devtools.desktop",
  );
  const rootIcon = resolve(appDir, "douyin-devtools.png");
  const installedIcon = resolve(
    appDir,
    "usr",
    "share",
    "icons",
    "hicolor",
    "512x512",
    "apps",
    "douyin-devtools.png",
  );
  await rm(appDir, { recursive: true, force: true });
  await mkdir(appRoot, { recursive: true });
  await run("cp", ["-a", "--reflink=auto", `${runtime}/.`, appRoot]);
  await mkdir(dirname(bin), { recursive: true });
  await copyTemplate("appimage/AppRun.sh", bin);
  await chmod(bin, 0o755);
  await symlink("usr/bin/douyin-devtools", resolve(appDir, "AppRun"));
  await writeFile(
    desktop,
    await renderTemplate(
      "appimage/douyin-devtools.desktop",
      { VERSION: config.version },
    ),
  );
  await mkdir(dirname(installedDesktop), { recursive: true });
  await copyFile(desktop, installedDesktop);
  await copyFile(icon, rootIcon);
  await mkdir(dirname(installedIcon), { recursive: true });
  await copyFile(icon, installedIcon);
  await symlink("douyin-devtools.png", resolve(appDir, ".DirIcon"));
  await run("desktop-file-validate", [desktop]);
  return appDir;
}

export async function buildAppImage(): Promise<string> {
  const config = await loadConfig();
  const tooling = await loadTooling();
  const runtime = resolve(buildRoot, `douyin-devtools-${config.version}-linux-x64`);
  const verifiedRuntime = await exists(resolve(runtime, "electron"))
    ? runtime
    : await prepareRunnableDirectory();
  const [tool, type2Runtime, icon] = await Promise.all([
    ensurePinnedTool(
      tooling.appimagetool,
      "appimagetool",
      "appimagetool-x86_64.AppImage",
      true,
    ),
    ensurePinnedTool(
      tooling.type2Runtime,
      "type2-runtime",
      "runtime-x86_64",
      false,
    ),
    ensureIcon(),
  ]);
  const appDir = await buildAppDir(verifiedRuntime, icon);
  const dist = resolve(projectRoot, "dist");
  const output = resolve(dist, `DouyinDevTools-${config.version}-x86_64.AppImage`);
  await ensureDir(dist);
  await rm(output, { force: true });
  await run(tool, [
    "--comp",
    "zstd",
    "--runtime-file",
    type2Runtime,
    appDir,
    output,
  ], {
    env: {
      ...withoutProxyEnv(),
      APPIMAGE_EXTRACT_AND_RUN: "1",
      ARCH: "x86_64",
      VERSION: config.version,
    },
  });
  await chmod(output, 0o755);
  const digest = await sha256(output);
  await writeFile(`${output}.sha256`, `${digest}  ${basename(output)}\n`);
  console.log(`AppImage 已生成：${output}`);
  console.log(`SHA-256：${digest}`);
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildAppImage();
}
