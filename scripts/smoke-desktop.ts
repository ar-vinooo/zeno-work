import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import type { ZenoApi } from "../electron/api";

/**
 * Uji asap jalur Renderer → IPC → Main.
 *
 * Menjalankan aplikasi sungguhan di atas folder data kosong, lalu memeriksa
 * bahwa halaman benar-benar memperoleh datanya lewat jembatan IPC dan bahwa
 * tulisan balik sampai ke database. Perlu `npm run build` dan
 * `npm run electron:build` lebih dulu.
 *
 * Dengan `--packaged` yang diuji adalah ZenoWork.app hasil `npm run
 * desktop:pack` — di situlah kesalahan pemaketan (berkas tidak ikut masuk
 * asar, jalur preload salah) baru kelihatan.
 */

/** Ambil jembatan dari dalam halaman. Ditulis ulang di tiap evaluate karena
 * fungsi yang dikirim ke browser tidak membawa lingkup Node-nya. */
type Win = Window & { zeno: ZenoApi };

const root = process.cwd();
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`ok    ${name}`);
  else {
    console.log(`GAGAL ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const PACKAGED_BINARY = "release/mac-arm64/ZenoWork.app/Contents/MacOS/ZenoWork";

async function main(): Promise<void> {
  const packaged = process.argv.includes("--packaged");
  const needed = packaged
    ? [PACKAGED_BINARY]
    : ["out/index.html", "dist-electron/electron/main.js"];
  const hint = packaged
    ? "npm run desktop:pack"
    : "npm run build && npm run electron:build";
  for (const file of needed)
    if (!existsSync(path.join(root, file))) {
      console.error(`${file} belum ada. Jalankan: ${hint}`);
      process.exit(1);
    }

  const dataDir = mkdtempSync(path.join(tmpdir(), "zenowork-smoke-"));

  // Beberapa terminal memakai Electron sebagai runtime Node dan mewariskan
  // flag ini; aplikasinya harus dimulai dalam mode jendela biasa.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") env[key] = value;
  env.ZENO_DATA_DIR = dataDir;

  const app = packaged
    ? await electron.launch({
        executablePath: path.join(root, PACKAGED_BINARY),
        args: [],
        env,
      })
    : await electron.launch({ args: [root], cwd: root, env });
  console.log(packaged ? "menguji ZenoWork.app terpaket" : "menguji dari folder kerja");

  try {
    const page = await app.firstWindow();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.waitForLoadState("domcontentloaded");
    const bridged = await page
      .waitForFunction(() => "zeno" in window, undefined, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check("preload memasang window.zeno", bridged);

    const tasks = await page.evaluate(() => (window as unknown as Win).zeno.tasks.load());
    check(
      "tasks:load mengembalikan data contoh",
      tasks.length > 0,
      `${tasks.length} baris`,
    );

    // Penjaga mutlak, diperiksa SEBELUM ada tulisan apa pun. Kalau folder data
    // sementara tidak terpakai, aplikasinya sedang membuka database pekerjaan
    // yang sesungguhnya dan uji ini akan merusaknya.
    // Status buka/tutup baris disimpan di localStorage. Skema app:// harus
    // terdaftar sebagai `standard` + `secure` supaya halaman punya origin yang
    // sah; kalau tidak, penyimpanannya diam-diam ditolak.
    const storage = await page.evaluate(() => {
      try {
        localStorage.setItem("zenowork.smoke", "1");
        const back = localStorage.getItem("zenowork.smoke");
        localStorage.removeItem("zenowork.smoke");
        return back;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    check("localStorage hidup di origin halaman", storage === "1", String(storage));

    const dbFile = path.join(dataDir, "zeno-work.db");
    if (!existsSync(dbFile))
      throw new Error(
        `Folder data uji tidak terpakai — ${dbFile} tidak ada, jadi aplikasi ` +
          "memakai data sungguhan. Dihentikan sebelum menulis apa pun. " +
          "Kompilasi ulang dulu: npm run electron:build",
      );
    check("database dibuat di folder data yang ditunjuk", true, dbFile);

    const drawn = await page
      .waitForSelector("text=Persiapan", { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check("halaman menggambar baris dari hasil IPC", drawn);

    const written = await page.evaluate(async (id: string) => {
      const api = (window as unknown as Win).zeno;
      await api.tasks.sync({ patches: [{ id, title: "Judul uji asap" }] });
      return (await api.tasks.load()).find((t) => t.id === id)?.title ?? "";
    }, tasks[0].id);
    check("tasks:sync menulis ke database", written === "Judul uji asap", written);

    const settings = await page.evaluate(() =>
      (window as unknown as Win).zeno.settings.get(),
    );
    check(
      "settings:get tidak membocorkan kunci API",
      !("anthropicApiKey" in settings) && settings.hasApiKey === false,
    );

    check(
      "tidak ada error di konsol halaman",
      consoleErrors.length === 0,
      consoleErrors.join(" | "),
    );
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n${failures.length} pemeriksaan gagal.`);
    process.exit(1);
  }
  console.log("\nSemua pemeriksaan lolos.");
}

void main();
