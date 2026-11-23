import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { buildRoot, exists, loadConfig } from "./lib.mts";

const config = await loadConfig();
const root = resolve(buildRoot, `douyin-devtools-${config.version}-linux-x64`);
const launcher = resolve(root, "run.mts");
if (!(await exists(launcher))) {
  throw new Error(`尚未生成可运行目录，请先执行：npm run build -- --version ${config.version}`);
}

const child = spawn(process.execPath, [launcher, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

