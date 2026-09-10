const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const env = { ...process.env };
// Beberapa terminal/agent memakai Electron sebagai runtime Node dan mewariskan
// flag ini. Electron desktop harus selalu dimulai dalam mode normal.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(require("electron"), [root], {
  cwd: root,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
