#!/usr/bin/env -S node
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env, GTK_MODULES: "", NO_AT_BRIDGE: "1" };
if (env.DOUYIN_KEEP_PROXY !== "1") {
  for (const key of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]) {
    delete env[key];
  }
}
const runtimeArgs = process.argv.slice(2);
if (!runtimeArgs.some((arg) => arg.startsWith("--user-data-dir"))) {
  const configHome = env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
  runtimeArgs.unshift(`--user-data-dir=${resolve(configHome, "douyin-devtools-linux")}`);
}
const args = [
  "--no-sandbox",
  "--gtk-version=3",
  ...runtimeArgs,
  resolve(root, "resources", "app"),
];
const child = spawn(resolve(root, "electron"), args, { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
