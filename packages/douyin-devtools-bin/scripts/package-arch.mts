import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import {
  buildRoot,
  ensureDir,
  exists,
  loadConfig,
  projectRoot,
  renderTemplate,
  run,
  sha256,
} from "./lib.mts";
import { buildAppImage } from "./appimage.mts";

interface ArchPackagingConfig {
  packageName: string;
  provides: string;
  githubRepository: string;
  githubTagPrefix: string;
  aurRepository: string;
}

interface PackagingConfig {
  arch: ArchPackagingConfig;
}

interface GeneratedPackageFiles {
  appImage: string;
  directory: string;
  packageConfig: ArchPackagingConfig;
  version: string;
}

const execFileAsync = promisify(execFile);
const archDistRoot = resolve(projectRoot, "dist", "arch");

async function capture(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

async function commandSucceeds(
  command: string,
  args: string[],
  cwd = projectRoot,
): Promise<boolean> {
  try {
    await capture(command, args, { cwd });
    return true;
  } catch {
    return false;
  }
}

async function loadPackagingConfig(): Promise<ArchPackagingConfig> {
  const source = await readFile(
    resolve(projectRoot, "configs", "packaging.json"),
    "utf8",
  );
  return (JSON.parse(source) as PackagingConfig).arch;
}

async function ensureArchEnvironment(publishing: boolean): Promise<void> {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Arch 打包当前只支持 Linux x86_64");
  }
  await access("/etc/arch-release");
  const commands = publishing
    ? [["git", "--version"], ["gh", "--version"], ["makepkg", "--version"], ["ssh", "-V"]]
    : [["makepkg", "--version"]];
  for (const [command, argument] of commands) {
    if (!(await commandSucceeds(command, [argument]))) {
      throw new Error(`缺少 Arch 打包命令：${command}`);
    }
  }
}

async function preparePackageFiles(
  mode: "local" | "aur",
): Promise<GeneratedPackageFiles> {
  await ensureArchEnvironment(mode === "aur");
  const versionConfig = await loadConfig();
  const packageConfig = await loadPackagingConfig();
  const appImage = await buildAppImage();
  const appImageName = basename(appImage);
  const icon = resolve(
    buildRoot,
    `douyin-devtools-${versionConfig.version}.AppDir`,
    "douyin-devtools.png",
  );
  if (!(await exists(icon))) {
    throw new Error(`AppImage 图标不存在：${icon}`);
  }

  const directory = resolve(archDistRoot, mode);
  const desktop = resolve(directory, "douyin-devtools.desktop");
  const packagedIcon = resolve(directory, "douyin-devtools.png");
  await rm(directory, { recursive: true, force: true });
  await ensureDir(directory);
  await writeFile(
    desktop,
    await renderTemplate(
      "appimage/douyin-devtools.desktop",
      { VERSION: versionConfig.version },
    ),
  );
  await copyFile(icon, packagedIcon);

  if (mode === "local") {
    await copyFile(appImage, resolve(directory, appImageName));
  }
  const appImageSource = mode === "local"
    ? appImageName
    : `${appImageName}::https://github.com/${packageConfig.githubRepository}/releases/download/${packageConfig.githubTagPrefix}${versionConfig.version}/${appImageName}`;
  await writeFile(
    resolve(directory, "PKGBUILD"),
    await renderTemplate("arch/PKGBUILD", {
      APPIMAGE_NAME: appImageName,
      APPIMAGE_SHA256: await sha256(appImage),
      APPIMAGE_SOURCE: appImageSource,
      DESKTOP_SHA256: await sha256(desktop),
      GITHUB_REPOSITORY: packageConfig.githubRepository,
      ICON_SHA256: await sha256(packagedIcon),
      PACKAGE_NAME: packageConfig.packageName,
      PROVIDES: packageConfig.provides,
      VERSION: versionConfig.version,
    }),
  );
  const srcInfo = await capture("makepkg", ["--printsrcinfo"], { cwd: directory });
  await writeFile(resolve(directory, ".SRCINFO"), srcInfo);
  return {
    appImage,
    directory,
    packageConfig,
    version: versionConfig.version,
  };
}

async function buildArchPackage(): Promise<void> {
  const generated = await preparePackageFiles("local");
  const packageDestination = resolve(archDistRoot, "packages");
  await ensureDir(packageDestination);
  const env = {
    ...process.env,
    PKGDEST: packageDestination,
  };
  await run(
    "makepkg",
    ["--nodeps", "--cleanbuild", "--force"],
    { cwd: generated.directory, env },
  );
  const packageList = await capture(
    "makepkg",
    ["--packagelist"],
    { cwd: generated.directory, env },
  );
  console.log(`Arch 包已生成：${packageList.trim()}`);
}

async function publishGitHubRelease(
  generated: GeneratedPackageFiles,
): Promise<void> {
  const tag = `${generated.packageConfig.githubTagPrefix}${generated.version}`;
  const checksum = `${generated.appImage}.sha256`;
  const common = ["--repo", generated.packageConfig.githubRepository];
  if (await commandSucceeds("gh", ["release", "view", tag, ...common])) {
    await run(
      "gh",
      ["release", "upload", tag, generated.appImage, checksum, "--clobber", ...common],
    );
    return;
  }
  await run(
    "gh",
    [
      "release",
      "create",
      tag,
      generated.appImage,
      checksum,
      "--title",
      `抖音开发者工具 ${generated.version} Linux`,
      "--notes",
      `Linux x86_64 AppImage，基于官方 macOS ${generated.version} 版本重新打包。`,
      ...common,
    ],
  );
}

async function publishAur(): Promise<void> {
  const generated = await preparePackageFiles("aur");
  await publishGitHubRelease(generated);
  const temporary = await mkdtemp(resolve(tmpdir(), "douyin-devtools-aur-"));
  const repository = resolve(temporary, generated.packageConfig.packageName);
  try {
    await run("git", [
      "-c",
      "init.defaultBranch=master",
      "clone",
      generated.packageConfig.aurRepository,
      repository,
    ]);
    for (const file of [
      "PKGBUILD",
      ".SRCINFO",
      "douyin-devtools.desktop",
      "douyin-devtools.png",
    ]) {
      await copyFile(
        resolve(generated.directory, file),
        resolve(repository, file),
      );
    }
    await run("makepkg", ["--verifysource"], { cwd: repository });
    await run(
      "git",
      [
        "add",
        "PKGBUILD",
        ".SRCINFO",
        "douyin-devtools.desktop",
        "douyin-devtools.png",
      ],
      { cwd: repository },
    );
    const changes = await capture(
      "git",
      ["status", "--porcelain"],
      { cwd: repository },
    );
    if (!changes.trim()) {
      console.log("AUR 已是当前版本，无需发布。");
      return;
    }
    await run(
      "git",
      ["commit", "-m", `更新至 ${generated.version}`],
      { cwd: repository },
    );
    await run(
      "git",
      ["push", "origin", "HEAD:master"],
      { cwd: repository },
    );
    console.log(`AUR 已发布：${generated.packageConfig.packageName} ${generated.version}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const command = process.argv[2] ?? "build";
if (command === "build") {
  await buildArchPackage();
} else if (command === "publish") {
  await publishAur();
} else {
  throw new Error("用法：node scripts/package-arch.mts [build|publish]");
}
