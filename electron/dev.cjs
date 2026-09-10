const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const url = "http://127.0.0.1:3939";
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const electronBin = require("electron");

const electronEnv = { ...process.env, ELECTRON_START_URL: url };
delete electronEnv.ELECTRON_RUN_AS_NODE;

const nextProcess = spawn(
  process.execPath,
  ["--env-file-if-exists=.env", nextBin, "dev", "--hostname", "127.0.0.1", "--port", "3939"],
  { cwd: root, stdio: "inherit" },
);

let electronProcess = null;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  electronProcess?.kill("SIGTERM");
  nextProcess.kill("SIGTERM");
  process.exitCode = code;
}

function waitForServer(attempts = 120) {
  if (attempts <= 0) {
    console.error("ZenoWork dev server tidak siap dalam 60 detik.");
    stop(1);
    return;
  }
  const request = http.get(url, (response) => {
    response.resume();
    electronProcess = spawn(electronBin, [root], {
      cwd: root,
      env: electronEnv,
      stdio: "inherit",
    });
    electronProcess.on("exit", (code) => stop(code ?? 0));
  });
  request.on("error", () => setTimeout(() => waitForServer(attempts - 1), 500));
  request.setTimeout(500, () => request.destroy());
}

nextProcess.on("exit", (code) => {
  if (!stopping) stop(code ?? 1);
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

waitForServer();
