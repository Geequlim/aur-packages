import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { buildRoot, cacheRoot, ensureDir, exists, loadConfig } from "./lib.mts";

const config = await loadConfig();
const root = resolve(buildRoot, `douyin-devtools-${config.version}-linux-x64`);
const launcher = resolve(root, "run.mts");
const userData = resolve(cacheRoot, "smoke-user-data", config.version);
const timeoutMs = 30_000;

if (!(await exists(launcher))) {
  throw new Error(`尚未生成可运行目录：${root}`);
}
await ensureDir(userData);

const child = spawn(process.execPath, [
  launcher,
  `--user-data-dir=${userData}`,
], {
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let mainHelperReady = false;
let processReady = false;
let finished = false;
let timer: NodeJS.Timeout | undefined;

function inspect(chunk: Buffer): void {
  const text = chunk.toString();
  process.stdout.write(text);
  output = `${output}${text}`.slice(-200_000);
  mainHelperReady ||= output.includes("successfully created MainHelper");
  processReady ||= output.includes("process ready");
  if (mainHelperReady && processReady) {
    finish(true);
  }
}

function finish(success: boolean): void {
  if (finished) return;
  finished = true;
  if (timer) clearTimeout(timer);
  child.kill("SIGTERM");
  if (!success) {
    const fatalPatterns = [
      "invalid ELF header",
      "Main helper loader error",
      "utility process is no response",
    ].filter((pattern) => output.includes(pattern));
    console.error(`\n冒烟测试超时。致命日志：${fatalPatterns.join(", ") || "未发现已知致命日志"}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n冒烟测试通过：Main Helper 和 utility process 均已就绪。");
}

child.stdout.on("data", inspect);
child.stderr.on("data", inspect);
child.on("error", (error) => {
  console.error(error);
  finish(false);
});
child.on("exit", (code, signal) => {
  if (!finished) {
    console.error(`应用提前退出：code=${code} signal=${signal}`);
    finish(false);
  }
});

timer = setTimeout(() => finish(false), timeoutMs);
