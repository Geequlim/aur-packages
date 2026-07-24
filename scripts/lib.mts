import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface VersionConfig {
  version: string;
  releaseDate: string;
  buildId: string;
  platform: "darwin-arm64";
  dmgUrl: string;
  dmgSha256: string;
  electronVersion: string;
  electronMirror?: string;
  nativeDependencies: Record<string, string>;
}

export interface UpstreamRelease {
  version: string;
  releaseDate: string;
  buildId: string;
  dmgUrl: string;
}

export interface ReleaseState {
  sourcePage: string;
  platform: "darwin-arm64";
  supportedVersion: string;
  latest: UpstreamRelease;
}

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const cacheRoot = resolve(projectRoot, ".cache");
export const buildRoot = resolve(projectRoot, "build");
export const templatesRoot = resolve(projectRoot, "templates");

export async function renderTemplate(
  relativePath: string,
  variables: Record<string, string> = {},
): Promise<string> {
  const template = await readFile(resolve(templatesRoot, relativePath), "utf8");
  const rendered = template.replace(
    /\{\{([A-Z][A-Z0-9_]*)\}\}/g,
    (token, name: string) => {
      const value = variables[name];
      if (value === undefined) {
        throw new Error(`模板 ${relativePath} 缺少变量：${name}`);
      }
      return value;
    },
  );
  const unresolved = rendered.match(/\{\{[A-Z][A-Z0-9_]*\}\}/g);
  if (unresolved) {
    throw new Error(`模板 ${relativePath} 存在未解析变量：${unresolved.join(", ")}`);
  }
  return rendered;
}

export async function copyTemplate(
  relativePath: string,
  destination: string,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(templatesRoot, relativePath), destination);
}

export function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function selectedVersion(): string {
  const override = parseArg("--version") ?? process.env.DOUYIN_VERSION;
  if (override) {
    return override;
  }
  const state = JSON.parse(readFileSync(
    resolve(projectRoot, "configs", "releases.json"),
    "utf8",
  )) as ReleaseState;
  return state.supportedVersion;
}

export async function loadConfig(version = selectedVersion()): Promise<VersionConfig> {
  const path = resolve(projectRoot, "configs", "versions", `${version}.json`);
  const config = JSON.parse(await readFile(path, "utf8")) as VersionConfig;
  if (config.version !== version) {
    throw new Error(`版本配置不一致：期望 ${version}，实际 ${config.version}`);
  }
  return config;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export function withoutProxyEnv(source = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]) {
    delete env[key];
  }
  return env;
}

export async function sha256(path: string): Promise<string> {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolveHash(hash.digest("hex")));
  });
}

export async function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    quiet?: boolean;
    allowFailure?: boolean;
  } = {},
): Promise<number> {
  if (!options.quiet) {
    console.log(`\n$ ${command} ${args.join(" ")}`);
  }
  const code = await new Promise<number>((resolveCode, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: options.env ?? process.env,
      stdio: options.quiet ? "ignore" : "inherit",
    });
    child.on("error", reject);
    child.on("exit", (exitCode, signal) => {
      if (signal) {
        reject(new Error(`${command} 被信号 ${signal} 终止`));
      } else {
        resolveCode(exitCode ?? 1);
      }
    });
  });
  if (code !== 0 && !options.allowFailure) {
    throw new Error(`${command} 退出码为 ${code}`);
  }
  return code;
}

export async function findExtractedApp(root: string): Promise<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".app")) {
      continue;
    }
    const app = resolve(root, entry.name, "Contents", "Resources", "app");
    if (await exists(resolve(app, "package.json"))) {
      return app;
    }
  }
  throw new Error(`在 ${root} 中找不到 macOS 应用的 Resources/app`);
}

export async function assertRegularFile(path: string): Promise<void> {
  if (!(await stat(path)).isFile()) {
    throw new Error(`不是普通文件：${path}`);
  }
}
