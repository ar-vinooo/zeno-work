import { readFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, protocol, session } from "electron";
import { getMeta, insertTasks, listTasks, setMeta, snapshotDaily, closeDb } from "../lib/db";
import { seedTasks } from "../lib/seed";
import { registerIpc } from "./ipc";

app.setName("ZenoWork");

/** Alamat halaman saat pengembangan (next dev). Kosong = pakai hasil export. */
const devUrl = process.env.ELECTRON_START_URL || null;

const SCHEME = "app";
const ORIGIN = `${SCHEME}://zeno`;

// Harus didaftarkan sebelum app siap. `standard` membuat URL-nya punya origin
// yang benar (halaman butuh itu untuk localStorage), `secure` membuatnya
// dianggap konteks aman seperti https.
if (!devUrl)
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);

let mainWindow: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

/* ------------------------------------------------------ halaman statis */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

/**
 * Halaman tidak lagi butuh server HTTP: berkas hasil `next build` disajikan
 * langsung dari disk lewat skema app://.
 *
 * CSP-nya rapat karena memang tidak ada yang perlu diambil dari luar — semua
 * data datang lewat IPC. `unsafe-inline` untuk skrip terpaksa ada: Next
 * menyisipkan skrip hidrasi inline di index.html.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function serveStatic(outDir: string) {
  return async (request: Request): Promise<Response> => {
    const requested = decodeURIComponent(new URL(request.url).pathname);
    const rel = requested.endsWith("/") ? `${requested}index.html` : requested;
    const file = path.normalize(path.join(outDir, rel));

    // Penjaga penelusuran folder: `..` di URL tidak boleh keluar dari out/.
    if (file !== outDir && !file.startsWith(outDir + path.sep))
      return new Response("Forbidden", { status: 403 });

    for (const candidate of [file, `${file}.html`]) {
      try {
        const body = await readFile(candidate);
        return new Response(body, {
          headers: {
            "Content-Type": MIME[path.extname(candidate).toLowerCase()] ?? "application/octet-stream",
            "Content-Security-Policy": CSP,
            "Cache-Control": "no-cache",
          },
        });
      } catch {
        // Coba kandidat berikutnya.
      }
    }
    return new Response("Not found", { status: 404 });
  };
}

/* ------------------------------------------------------------- jendela */

function createWindow(startUrl: string) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 650,
    title: "ZenoWork",
    backgroundColor: "#ebeef3",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const ownOrigin = new URL(startUrl).origin;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== ownOrigin) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(startUrl);
}

/**
 * Isi contoh HANYA untuk database yang benar-benar baru. Tabel kosong karena
 * penggunanya menghapus semuanya harus tetap kosong — kalau di sini cuma
 * dicek `tasks.length === 0`, menghapus seluruh baris lalu membuka ulang
 * aplikasi membuat data contoh muncul seolah data sendiri kembali, padahal
 * yang asli sudah hilang.
 */
function prepareData(): void {
  if (!getMeta("seeded")) {
    if (listTasks().length === 0) insertTasks(seedTasks());
    setMeta("seeded", new Date().toISOString());
  }
  snapshotDaily();
}

app.whenReady().then(async () => {
  try {
    // Data tidak boleh berada di dalam .app/.asar: lokasi itu read-only dan
    // ditimpa setiap kali aplikasinya di-upgrade. ZENO_DATA_DIR yang sudah
    // diisi dari luar dihormati — dipakai uji asap agar tidak menyentuh data
    // pekerjaan yang sesungguhnya.
    if (!process.env.ZENO_DATA_DIR)
      process.env.ZENO_DATA_DIR = path.join(app.getPath("userData"), "data");

    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });

    prepareData();
    registerIpc();

    let startUrl = devUrl;
    if (!startUrl) {
      protocol.handle(SCHEME, serveStatic(path.join(app.getAppPath(), "out")));
      startUrl = `${ORIGIN}/index.html`;
    }
    createWindow(startUrl);
  } catch (error) {
    dialog.showErrorBox(
      "ZenoWork gagal dibuka",
      error instanceof Error ? error.stack || error.message : String(error),
    );
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0)
    createWindow(devUrl ?? `${ORIGIN}/index.html`);
});

app.on("window-all-closed", () => app.quit());

// Tutup rapi supaya isi WAL benar-benar masuk ke berkas database.
app.on("will-quit", () => closeDb());
