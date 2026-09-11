import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { getRepositoryScan, listTasks } from "../lib/db";
import { assetPath, attachFiles, readAsset } from "../lib/evidence";
import { runChat, type ChatMessage } from "../lib/chat";
import { publicSettings, writeSettings, type Settings } from "../lib/settings";
import { backupPayload, importTasks, syncTasks, type SyncDiff } from "../lib/sync";
import { buildTimelineWorkbook, xlsxFileName } from "../lib/xlsx";
import { inspectRepository, repositoryRoot } from "../lib/repository";
import type { Channel, Envelope, SaveResult } from "./api";

/**
 * Pendaftaran handler IPC. Setiap saluran membungkus hasilnya dalam Envelope,
 * jadi kegagalan sampai ke halaman sebagai pesan apa adanya — bukan sebagai
 * exception IPC yang teksnya sudah tercampur.
 */
function handle<T>(
  channel: Channel,
  run: (...args: never[]) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Envelope<T>> => {
    try {
      return { ok: true, value: await run(...(args as never[])) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/** Dialog simpan yang menempel ke jendela utama bila ada. */
async function saveAs(
  fileName: string,
  filters: Electron.FileFilter[],
  data: string | Buffer,
): Promise<SaveResult> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options = { defaultPath: fileName, filters };
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { saved: false };
  await writeFile(result.filePath, data);
  return { saved: true, path: result.filePath };
}

/** Setelan yang boleh ditulis halaman, disaring per field. */
function settingsPatch(body: Partial<Settings>): Partial<Settings> {
  const patch: Partial<Settings> = {};

  if (
    body.aiProvider === "api" ||
    body.aiProvider === "claude-cli" ||
    body.aiProvider === "codex-cli"
  )
    patch.aiProvider = body.aiProvider;

  for (const key of [
    "anthropicModel",
    "anthropicWorkspaceId",
    "anthropicEffort",
    "claudeCliPath",
    "codexCliPath",
    "codexModel",
    "codexEffort",
  ] as const)
    if (typeof body[key] === "string") patch[key] = body[key].trim();

  // Kunci hanya ditulis bila field-nya benar-benar dikirim. String kosong
  // berarti "hapus", bukan "biarkan" — supaya menghapus kunci tetap mungkin.
  if (typeof body.anthropicApiKey === "string")
    patch.anthropicApiKey = body.anthropicApiKey.trim();

  return patch;
}

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];

export function registerIpc(): void {
  handle("tasks:load", () => listTasks());
  handle("tasks:sync", (diff: SyncDiff) => syncTasks(diff ?? {}));

  handle("settings:get", () => publicSettings());
  handle("settings:set", (patch: Partial<Settings>) => {
    writeSettings(settingsPatch(patch ?? {}));
    return publicSettings();
  });
  handle("repository:choose", async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    // Simpan root Git kanonis, walau pengguna memilih sub-folder proyek.
    return repositoryRoot(result.filePaths[0]);
  });
  handle("repository:status", async (taskId: string, path: string) => {
    if (typeof taskId !== "string" || typeof path !== "string" || !path.trim())
      throw new Error("Task dan folder repository wajib diisi.");
    return (await inspectRepository(path, getRepositoryScan(taskId))).summary;
  });

  handle("backup:save", () =>
    saveAs(
      `zeno-work-${new Date().toISOString().slice(0, 10)}.json`,
      JSON_FILTER,
      JSON.stringify(backupPayload(), null, 2),
    ),
  );
  handle("backup:restore", (tasks: unknown) => importTasks(tasks, "replace"));

  handle("export:xlsx", async () =>
    saveAs(
      xlsxFileName(),
      [{ name: "Excel", extensions: ["xlsx"] }],
      await buildTimelineWorkbook(),
    ),
  );
  handle("export:text", (fileName: string, content: string) =>
    saveAs(
      fileName,
      [{ name: "Berkas teks", extensions: [fileName.split(".").pop() || "txt"] }],
      content,
    ),
  );

  handle("evidence:attach", async (taskId: string) => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return [];
    return attachFiles(taskId, result.filePaths);
  });
  handle("evidence:read", (relPath: string) => readAsset(relPath));
  handle("evidence:reveal", async (relPath: string) => {
    const error = await shell.openPath(assetPath(relPath));
    if (error) throw new Error(error);
  });

  handle("chat:send", (messages: ChatMessage[], tasks: unknown) =>
    runChat(messages ?? [], tasks),
  );
}
