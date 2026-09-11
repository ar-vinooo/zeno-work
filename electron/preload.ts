import { contextBridge, ipcRenderer } from "electron";
import type { Channel, Envelope, ZenoApi } from "./api";

/**
 * Satu-satunya jembatan halaman → proses utama.
 *
 * Berjalan dalam sandbox: hanya modul `electron` yang boleh di-require, jadi
 * nama saluran ditulis literal di sini. Tipe `Channel` di ./api yang menjaga
 * daftarnya tetap sama dengan sisi main (impor tipe hilang saat dikompilasi,
 * tidak menjadi require).
 */
async function invoke<T>(channel: Channel, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

const api: ZenoApi = {
  tasks: {
    load: () => invoke("tasks:load"),
    sync: (diff) => invoke("tasks:sync", diff),
  },
  settings: {
    get: () => invoke("settings:get"),
    set: (patch) => invoke("settings:set", patch),
  },
  repository: {
    choose: () => invoke("repository:choose"),
    status: (taskId, path) => invoke("repository:status", taskId, path),
  },
  backup: {
    save: () => invoke("backup:save"),
    restore: (tasks) => invoke("backup:restore", tasks),
  },
  exports: {
    xlsx: () => invoke("export:xlsx"),
    text: (fileName, content) => invoke("export:text", fileName, content),
  },
  evidence: {
    attach: (taskId) => invoke("evidence:attach", taskId),
    read: (relPath) => invoke("evidence:read", relPath),
    reveal: (relPath) => invoke("evidence:reveal", relPath),
  },
  chat: {
    send: (messages, tasks) => invoke("chat:send", messages, tasks),
  },
};

contextBridge.exposeInMainWorld("zeno", api);
