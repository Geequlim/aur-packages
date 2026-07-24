import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  assertRegularFile,
  buildRoot,
  cacheRoot,
  copyTemplate,
  ensureDir,
  exists,
  loadConfig,
  renderTemplate,
  run,
  withoutProxyEnv,
} from "./lib.mts";
import { extractDmg } from "./extract.mts";

interface CopySpec {
  source: string;
  destination: string;
}

interface PatchSpec {
  file: string;
  label?: string;
  before: string;
  after: string;
}

async function ensureElectron(version: string, mirror?: string): Promise<string> {
  const root = resolve(cacheRoot, "electron", version);
  const distribution = resolve(root, "node_modules", "electron", "dist");
  if (await exists(resolve(distribution, "electron"))) {
    return distribution;
  }
  await rm(root, { recursive: true, force: true });
  await ensureDir(root);
  await writeFile(resolve(root, "package.json"), `${JSON.stringify({
    private: true,
    dependencies: {
      electron: version,
    },
    allowScripts: {
      electron: true,
    },
  }, null, 2)}\n`);
  await run("npm", [
    "install",
    "--registry=https://registry.npmjs.org",
  ], {
    cwd: root,
    env: {
      ...withoutProxyEnv(),
      ...(mirror ? { ELECTRON_MIRROR: mirror } : {}),
    },
  });
  return distribution;
}

async function ensureNativeDependencies(
  dependencies: Record<string, string>,
): Promise<string> {
  const root = resolve(cacheRoot, "native", "linux-x64");
  const expected = [
    "@vscode/spdlog/build/Release/spdlog.node",
    "@vscode/sqlite3/build/Release/vscode-sqlite3.node",
    "native-keymap/build/Release/keymapping.node",
    "@parcel/watcher-linux-x64-glibc/watcher.node",
    "@vscode/ripgrep/bin/rg",
    "@rspack/binding-linux-x64-gnu/rspack.linux-x64-gnu.node",
    "@node-rs/xxhash-linux-x64-gnu/xxhash.linux-x64-gnu.node",
  ];
  if ((await Promise.all(expected.map((path) =>
    exists(resolve(root, "node_modules", path))))).every(Boolean)) {
    return resolve(root, "node_modules");
  }

  await rm(root, { recursive: true, force: true });
  await ensureDir(root);
  const allowedScripts = Object.fromEntries(
    Object.entries(dependencies)
      .filter(([name]) => [
        "@vscode/spdlog",
        "@vscode/sqlite3",
        "native-keymap",
        "@vscode/ripgrep",
      ].includes(name))
      .map(([name]) => [name, true]),
  );
  await writeFile(resolve(root, "package.json"), `${JSON.stringify({
    private: true,
    dependencies,
    allowScripts: allowedScripts,
  }, null, 2)}\n`);
  await run("npm", [
    "install",
    "--registry=https://registry.npmjs.org",
  ], {
    cwd: root,
    env: {
      ...withoutProxyEnv(),
      npm_config_nodedir: "/usr",
      npm_config_build_from_source: "true",
      npm_config_cache: resolve(cacheRoot, "npm"),
    },
  });
  return resolve(root, "node_modules");
}

async function copySpecs(specs: CopySpec[]): Promise<void> {
  for (const spec of specs) {
    await assertRegularFile(spec.source);
    await mkdir(dirname(spec.destination), { recursive: true });
    await copyFile(spec.source, spec.destination);
  }
}

function replaceExactlyOnce(content: string, before: string, after: string, label: string): string {
  const pieces = content.split(before);
  if (pieces.length !== 2) {
    throw new Error(`${label} 补丁锚点应出现 1 次，实际出现 ${pieces.length - 1} 次`);
  }
  return `${pieces[0]}${after}${pieces[1]}`;
}

async function patchBundles(app: string, version: string): Promise<void> {
  const patches = JSON.parse(await renderTemplate(
    `patches/${version}.json`,
    { VERSION: version },
  )) as PatchSpec[];

  for (const patch of patches) {
    const path = resolve(app, patch.file);
    const content = await readFile(path, "utf8");
    await writeFile(
      path,
      replaceExactlyOnce(content, patch.before, patch.after, patch.label ?? patch.file),
    );
  }

  await copyTemplate(
    "runtime/linux-toolkit-bridge.js",
    resolve(app, "linux-toolkit-bridge.js"),
  );
}

export async function prepareRunnableDirectory(sourceApp?: string): Promise<string> {
  const config = await loadConfig();
  const source = sourceApp ?? await extractDmg();
  const output = resolve(buildRoot, `douyin-devtools-${config.version}-linux-x64`);
  const app = resolve(output, "resources", "app");
  const electron = await ensureElectron(config.electronVersion, config.electronMirror);
  const native = await ensureNativeDependencies(config.nativeDependencies);

  await rm(output, { recursive: true, force: true });
  await ensureDir(output);
  await cp(electron, output, { recursive: true, dereference: false });
  await mkdir(dirname(app), { recursive: true });
  await cp(source, app, { recursive: true, dereference: false });

  const vscode = resolve(app, "app.content/node_modules/@byted-tila/vscode/out/node_modules");
  await copySpecs([
    {
      source: resolve(native, "@vscode/spdlog/build/Release/spdlog.node"),
      destination: resolve(vscode, "@vscode/spdlog/build/Release/spdlog.node"),
    },
    {
      source: resolve(native, "@vscode/sqlite3/build/Release/vscode-sqlite3.node"),
      destination: resolve(vscode, "@vscode/sqlite3/build/Release/vscode-sqlite3.node"),
    },
    {
      source: resolve(native, "native-keymap/build/Release/keymapping.node"),
      destination: resolve(vscode, "native-keymap/build/Release/keymapping.node"),
    },
    {
      source: resolve(native, "@parcel/watcher-linux-x64-glibc/watcher.node"),
      destination: resolve(vscode, "@parcel/watcher/build/Release/watcher.node"),
    },
    {
      source: resolve(native, "@vscode/ripgrep/bin/rg"),
      destination: resolve(vscode, "@vscode/ripgrep/bin/rg"),
    },
    {
      source: resolve(native, "@rspack/binding-linux-x64-gnu/rspack.linux-x64-gnu.node"),
      destination: resolve(app, "app.content/node_modules/@byted-rspuck/rspack-binding/rspack.linux-x64-gnu.node"),
    },
    {
      source: resolve(native, "@node-rs/xxhash-linux-x64-gnu/xxhash.linux-x64-gnu.node"),
      destination: resolve(app, "app.content/node_modules/@node-rs/xxhash/xxhash.linux-x64-gnu.node"),
    },
  ]);

  await patchBundles(app, config.version);
  const runPath = resolve(output, "run.mts");
  await copyTemplate("runtime/run.mts", runPath);
  await chmod(runPath, 0o755);
  await writeFile(resolve(output, "BUILD-INFO.json"), `${JSON.stringify({
    source: config.dmgUrl,
    sourceSha256: config.dmgSha256,
    version: config.version,
    electronVersion: config.electronVersion,
    target: "linux-x64-gnu",
  }, null, 2)}\n`);

  console.log(`可运行目录已生成：${output}`);
  console.log(`启动命令：node ${resolve(output, "run.mts")}`);
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await prepareRunnableDirectory();
}
