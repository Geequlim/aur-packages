import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  cacheRoot,
  ensureDir,
  exists,
  loadConfig,
  projectRoot,
} from "./lib.mts";

const config = await loadConfig();
const appImage = resolve(
  resolve(projectRoot, "dist"),
  `DouyinDevTools-${config.version}-x86_64.AppImage`,
);
const userData = resolve(cacheRoot, "smoke-appimage-user-data", config.version);
const timeoutMs = 45_000;

if (!(await exists(appImage))) {
  throw new Error(`尚未生成 AppImage：${appImage}`);
}
await ensureDir(userData);

const child = spawn(appImage, [`--user-data-dir=${userData}`], {
  detached: true,
  env: {
    ...process.env,
    APPIMAGE_EXTRACT_AND_RUN: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let mainHelperReady = false;
let processReady = false;
let finished = false;
let timer: NodeJS.Timeout | undefined;

function stopProcessGroup(): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function inspect(chunk: Buffer): void {
  const text = chunk.toString();
  process.stdout.write(text);
  output = `${output}${text}`.slice(-200_000);
  mainHelperReady ||= output.includes("successfully created MainHelper");
  processReady ||= output.includes("process ready");
  if (mainHelperReady && processReady) finish(true);
}

function finish(success: boolean): void {
  if (finished) return;
  finished = true;
  if (timer) clearTimeout(timer);
  stopProcessGroup();
  if (!success) {
    const fatalPatterns = [
      "invalid ELF header",
      "Main helper loader error",
      "utility process is no response",
    ].filter((pattern) => output.includes(pattern));
    console.error(
      `\nAppImage 冒烟测试超时。致命日志：${fatalPatterns.join(", ") || "未发现已知致命日志"}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("\nAppImage 冒烟测试通过：Main Helper 和 utility process 均已就绪。");
}

child.stdout.on("data", inspect);
child.stderr.on("data", inspect);
child.on("error", (error) => {
  console.error(error);
  finish(false);
});
child.on("exit", (code, signal) => {
  if (!finished) {
    console.error(`AppImage 提前退出：code=${code} signal=${signal}`);
    finish(false);
  }
});

timer = setTimeout(() => finish(false), timeoutMs);
