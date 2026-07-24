import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  exists,
  projectRoot,
  type ReleaseState,
  type UpstreamRelease,
  type VersionConfig,
} from "./lib.mts";

const statePath = resolve(projectRoot, "configs", "releases.json");

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_token, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_token, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function parseLatestRelease(html: string, platform: string): UpstreamRelease {
  const headings = [...html.matchAll(
    /<h1\b[^>]*>[\s\S]*?<span\b[^>]*>\s*(\d+(?:\.\d+){1,3})\s*[（(](\d{4}-\d{2}-\d{2})[）)]\s*<\/span>[\s\S]*?<\/h1>/gi,
  )];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    const link = section.match(new RegExp(
      `href=["']([^"']+/ide/(\\d+)/${platform.replace("-", "\\-")}/[^"']+?\\.dmg)["']`,
      "i",
    ));
    if (!link) {
      continue;
    }

    const dmgUrl = decodeHtml(link[1]);
    const url = new URL(dmgUrl);
    const fileName = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    const fileVersion = fileName.match(/-(\d+(?:\.\d+){1,3})-arm64\.dmg$/i)?.[1];
    if (fileVersion !== heading[1]) {
      throw new Error(`官网标题版本 ${heading[1]} 与 DMG 文件名版本 ${fileVersion ?? "未知"} 不一致`);
    }

    return {
      version: heading[1],
      releaseDate: heading[2],
      buildId: link[2],
      dmgUrl,
    };
  }

  throw new Error(`官网页面中找不到 ${platform} 的版本标题和 DMG 下载地址`);
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

async function loadState(): Promise<ReleaseState> {
  return JSON.parse(await readFile(statePath, "utf8")) as ReleaseState;
}

async function writeJsonIfChanged(path: string, value: unknown): Promise<boolean> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (await exists(path) && await readFile(path, "utf8") === content) {
    return false;
  }
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
  return true;
}

async function fetchLatest(state: ReleaseState): Promise<UpstreamRelease> {
  const response = await fetch(state.sourcePage, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "douyin-game-devtools-linux-version-check/1.0",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`读取官网版本页面失败：HTTP ${response.status} ${response.statusText}`);
  }
  return parseLatestRelease(await response.text(), state.platform);
}

function printComparison(state: ReleaseState, latest: UpstreamRelease): void {
  console.log(`当前已适配版本：${state.supportedVersion}`);
  console.log(`官网最新版本：  ${latest.version}（${latest.releaseDate}）`);
  console.log(`官网构建 ID：   ${latest.buildId}`);
  console.log(`Mac arm64 DMG： ${latest.dmgUrl}`);
  const comparison = compareVersions(latest.version, state.supportedVersion);
  if (comparison === 0) {
    console.log("状态：已是官网最新版本");
  } else if (comparison > 0) {
    console.log(`状态：发现待适配版本 ${latest.version}`);
  } else {
    console.log("状态：官网版本低于当前适配版本，不执行降级");
  }
}

async function writeCiOutputs(
  state: ReleaseState,
  latest: UpstreamRelease,
): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) {
    return;
  }
  await appendFile(
    output,
    [
      `supported_version=${state.supportedVersion}`,
      `latest_version=${latest.version}`,
      `update_available=${compareVersions(latest.version, state.supportedVersion) > 0}`,
      "",
    ].join("\n"),
  );
}

async function update(state: ReleaseState, latest: UpstreamRelease): Promise<void> {
  const nextState: ReleaseState = { ...state, latest };
  const stateChanged = await writeJsonIfChanged(statePath, nextState);
  console.log(stateChanged ? `已更新 ${statePath}` : "版本状态无需更新");

  const versionPath = resolve(projectRoot, "configs", "versions", `${latest.version}.json`);
  if (!(await exists(versionPath))) {
    console.log(`尚无 ${latest.version} 的完整版本配置；未切换默认构建版本`);
    console.log(`下一步：准备 ${versionPath} 和 templates/patches/${latest.version}.json`);
    return;
  }

  const versionConfig = JSON.parse(await readFile(versionPath, "utf8")) as VersionConfig;
  if (versionConfig.version !== latest.version) {
    throw new Error(`版本配置内容与文件名不一致：${versionPath}`);
  }
  const nextVersionConfig: VersionConfig = {
    ...versionConfig,
    releaseDate: latest.releaseDate,
    buildId: latest.buildId,
    platform: state.platform,
    dmgUrl: latest.dmgUrl,
  };
  const configChanged = await writeJsonIfChanged(versionPath, nextVersionConfig);
  console.log(configChanged ? `已同步 ${versionPath}` : "完整版本配置无需同步");
}

async function promote(state: ReleaseState): Promise<void> {
  const version = state.latest.version;
  const versionPath = resolve(projectRoot, "configs", "versions", `${version}.json`);
  const patchPath = resolve(projectRoot, "templates", "patches", `${version}.json`);
  if (!(await exists(versionPath)) || !(await exists(patchPath))) {
    throw new Error(`不能提升 ${version}：版本配置或补丁模板尚未准备好`);
  }
  const config = JSON.parse(await readFile(versionPath, "utf8")) as VersionConfig;
  if (config.version !== version || !/^[0-9a-f]{64}$/i.test(config.dmgSha256)) {
    throw new Error(`不能提升 ${version}：版本号或 DMG SHA-256 配置无效`);
  }
  const changed = await writeJsonIfChanged(statePath, {
    ...state,
    supportedVersion: version,
  } satisfies ReleaseState);
  console.log(changed ? `默认构建版本已切换为 ${version}` : `${version} 已是默认构建版本`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "check";
  const state = await loadState();
  if (command === "promote") {
    await promote(state);
  } else if (command === "check" || command === "update") {
    const latest = await fetchLatest(state);
    printComparison(state, latest);
    await writeCiOutputs(state, latest);
    if (command === "update") {
      await update(state, latest);
    }
  } else {
    throw new Error(`未知子命令：${command}；可用值为 check、update、promote`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
