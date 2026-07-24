import { createWriteStream } from "node:fs";
import {
  copyFile,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  cacheRoot,
  ensureDir,
  exists,
  loadConfig,
  projectRoot,
  sha256,
  type ReleaseState,
  type VersionConfig,
} from "./lib.mts";
import { compareVersions } from "./check-version.mts";
import { extractDmg } from "./extract.mts";

const statePath = resolve(projectRoot, "configs", "releases.json");

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp`;
  await ensureDir(dirname(path));
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function downloadSource(
  url: string,
  version: string,
): Promise<{ path: string; digest: string }> {
  const directory = resolve(cacheRoot, "downloads");
  const destination = resolve(directory, `douyin-devtools-${version}-arm64.dmg`);
  await ensureDir(directory);
  if (await exists(destination)) {
    return { path: destination, digest: await sha256(destination) };
  }

  const temporary = `${destination}.part`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await rm(temporary, { force: true });
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      await pipeline(Readable.from(response.body), createWriteStream(temporary));
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      console.warn(`DMG 下载第 ${attempt} 次失败，准备重试。`);
    }
  }
  if (lastError) {
    throw lastError;
  }
  await rename(temporary, destination);
  return { path: destination, digest: await sha256(destination) };
}

async function packageVersion(app: string, relativePath: string): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(resolve(app, relativePath, "package.json"), "utf8"),
  ) as { version?: string };
  if (!packageJson.version) {
    throw new Error(`${relativePath}/package.json 没有 version`);
  }
  return packageJson.version;
}

async function prepareUpdate(): Promise<void> {
  const state = JSON.parse(await readFile(statePath, "utf8")) as ReleaseState;
  const latest = state.latest;
  if (compareVersions(latest.version, state.supportedVersion) <= 0) {
    throw new Error(
      `官网版本 ${latest.version} 不高于当前适配版本 ${state.supportedVersion}`,
    );
  }

  const base = await loadConfig(state.supportedVersion);
  const versionPath = resolve(
    projectRoot,
    "configs",
    "versions",
    `${latest.version}.json`,
  );
  const patchPath = resolve(
    projectRoot,
    "templates",
    "patches",
    `${latest.version}.json`,
  );
  const sourcePatch = resolve(
    projectRoot,
    "templates",
    "patches",
    `${state.supportedVersion}.json`,
  );
  const existing = await exists(versionPath)
    ? JSON.parse(await readFile(versionPath, "utf8")) as VersionConfig
    : base;
  const source = await downloadSource(latest.dmgUrl, latest.version);

  let candidate: VersionConfig = {
    ...existing,
    version: latest.version,
    releaseDate: latest.releaseDate,
    buildId: latest.buildId,
    platform: state.platform,
    dmgUrl: latest.dmgUrl,
    dmgSha256: source.digest,
  };
  await writeJson(versionPath, candidate);

  process.env.DOUYIN_VERSION = latest.version;
  const app = await extractDmg(source.path);
  const applicationPackage = JSON.parse(
    await readFile(resolve(app, "package.json"), "utf8"),
  ) as {
    version?: string;
    devDependencies?: Record<string, string>;
  };
  if (applicationPackage.version !== latest.version) {
    throw new Error(
      `DMG 内应用版本 ${applicationPackage.version ?? "未知"} 与官网版本 ${latest.version} 不一致`,
    );
  }
  const electronVersion = applicationPackage.devDependencies?.electron;
  if (!electronVersion) {
    throw new Error("DMG 内应用没有声明 Electron 版本");
  }

  const vscodeModules = "app.content/node_modules/@byted-tila/vscode/out/node_modules";
  const contentModules = "app.content/node_modules";
  candidate = {
    ...candidate,
    electronVersion,
    nativeDependencies: {
      ...candidate.nativeDependencies,
      "@vscode/spdlog": await packageVersion(app, `${vscodeModules}/@vscode/spdlog`),
      "@vscode/sqlite3": await packageVersion(app, `${vscodeModules}/@vscode/sqlite3`),
      "native-keymap": await packageVersion(app, `${vscodeModules}/native-keymap`),
      "@parcel/watcher-linux-x64-glibc": await packageVersion(
        app,
        `${vscodeModules}/@parcel/watcher`,
      ),
      "@vscode/ripgrep": await packageVersion(app, `${vscodeModules}/@vscode/ripgrep`),
      "@node-rs/xxhash-linux-x64-gnu": await packageVersion(
        app,
        `${contentModules}/@node-rs/xxhash`,
      ),
    },
  };
  await writeJson(versionPath, candidate);

  if (!(await exists(patchPath))) {
    await copyFile(sourcePatch, patchPath);
    console.log(`已从 ${state.supportedVersion} 复制补丁模板，构建时将验证所有锚点`);
  }
  console.log(`已准备自动构建配置：${versionPath}`);
}

await prepareUpdate();
