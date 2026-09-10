import { applyPatches, deleteTasks, insertTasks, listTasks, replaceAll } from "./db";
import { applyRules, isTask, sanitizeImport } from "./validate";
import type { Patch, Task } from "./types";

export interface SyncDiff {
  creates?: unknown[];
  patches?: Patch[];
  deleteIds?: string[];
}

/**
 * Satu jalur untuk semua mutasi.
 *
 * Klien bekerja optimistis di memori lalu mengirim selisihnya. Urutan
 * penerapan tidak boleh dibalik:
 *   1. creates  — baris baru harus ada sebelum ada patch yang menunjuknya
 *   2. patches  — termasuk melepas anak dari induk yang akan dihapus
 *   3. deletes  — kalau ini duluan, ON DELETE CASCADE ikut membawa anak yang
 *                 sebenarnya cuma mau dinaikkan satu tingkat
 */
export function syncTasks(diff: SyncDiff): number {
  const creates = (diff.creates ?? []).filter(isTask) as Task[];
  if (creates.length) insertTasks(creates);

  const patches = diff.patches ?? [];
  if (patches.length) {
    const current = new Map(listTasks().map((t) => [t.id, t]));
    applyPatches(
      patches
        .filter((p) => current.has(p.id))
        .map((p) => applyRules(current.get(p.id)!, p)),
    );
  }

  const deleteIds = diff.deleteIds ?? [];
  if (deleteIds.length) deleteTasks(deleteIds);

  return creates.length + patches.length + deleteIds.length;
}

/** Import backup JSON. `replace` menukar seluruh isi tabel dalam satu transaksi. */
export function importTasks(
  raw: unknown,
  mode: "replace" | "merge" = "replace",
): number {
  if (!Array.isArray(raw)) throw new Error("Isi berkas bukan daftar task.");

  const incoming = sanitizeImport((raw as unknown[]).filter(isTask) as Task[]);
  if (incoming.length === 0) throw new Error("Tidak ada task yang valid di berkas itu.");

  if (mode === "merge") {
    const existing = new Set(listTasks().map((t) => t.id));
    insertTasks(incoming.filter((t) => !existing.has(t.id)));
  } else {
    replaceAll(incoming);
  }
  return incoming.length;
}

/** Isi berkas backup JSON — bentuk yang sama dengan yang diterima importTasks. */
export function backupPayload(): { version: 1; exportedAt: string; tasks: Task[] } {
  return { version: 1, exportedAt: new Date().toISOString(), tasks: listTasks() };
}
