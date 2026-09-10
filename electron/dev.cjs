const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * Mode pengembangan: `next dev` untuk hot reload halaman, lalu jendela
 * Electron diarahkan ke sana lewat ELECTRON_START_URL.
 *
 * Portnya diambil dari sistem, bukan ditetapkan. Halaman ini tidak pernah
 * dibuka dari browser lagi — satu-satunya yang perlu tahu alamatnya adalah
 * jendela yang dijalankan skrip ini sendiri — jadi port tetap cuma menyisakan
 * satu cara gagal: bentrok dengan proses lain. Isi PORT kalau tetap ingin
 * alamat yang bisa ditebak.
 */

const root = path.resolve(__dirname, "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const electronBin = require("electron");

let nextProcess = null;
let electronProcess = null;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  electronProcess?.kill("SIGTERM");
  nextProcess?.kill("SIGTERM");
  process.exitCode = code;
}

/** Port kosong menurut sistem operasi. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Tidak memperoleh port dari sistem."));
        return;
      }
      probe.close(() => resolve(String(address.port)));
    });
  });
}

function waitForServer(url, env, attempts = 120) {
  if (attempts <= 0) {
    console.error("ZenoWork dev server tidak siap dalam 60 detik.");
    stop(1);
    return;
  }
  const request = http.get(url, (response) => {
    response.resume();
    electronProcess = spawn(electronBin, [root], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    electronProcess.on("exit", (code) => stop(code ?? 0));
  });
  request.on("error", () => setTimeout(() => waitForServer(url, env, attempts - 1), 500));
  request.setTimeout(500, () => request.destroy());
}

async function main() {
  const port = process.env.PORT || (await freePort());
  const url = `http://127.0.0.1:${port}`;
  console.log(`ZenoWork dev → ${url}`);

  const env = { ...process.env, ELECTRON_START_URL: url };
  // Beberapa terminal/agent memakai Electron sebagai runtime Node dan
  // mewariskan flag ini; jendela desktop harus dimulai dalam mode normal.
  delete env.ELECTRON_RUN_AS_NODE;

  nextProcess = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", nextBin, "dev", "--hostname", "127.0.0.1", "--port", port],
    { cwd: root, stdio: "inherit" },
  );
  nextProcess.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });

  waitForServer(url, env);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

void main().catch((error) => {
  console.error(error);
  stop(1);
});
