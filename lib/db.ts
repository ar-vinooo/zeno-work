import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Patch, Task } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.ZENO_DB ?? path.join(DATA_DIR, "zeno-work.db");

type Row = Omit<Task, "collapsed" | "rollup"> & {
  collapsed: number;
  rollup: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  "id"        TEXT PRIMARY KEY,
  "parentId"  TEXT REFERENCES tasks("id") ON DELETE CASCADE,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "title"     TEXT    NOT NULL DEFAULT '',
  "progress"  INTEGER NOT NULL DEFAULT 0,
  "start"     TEXT    NOT NULL,
  "end"       TEXT    NOT NULL,
  "status"    TEXT    NOT NULL DEFAULT 'todo',
  "priority"  TEXT    NOT NULL DEFAULT 'medium',
  "collapsed" INTEGER NOT NULL DEFAULT 0,
  "rollup"    INTEGER NOT NULL DEFAULT 1,
  "notes"     TEXT    NOT NULL DEFAULT '',
  "createdAt" TEXT    NOT NULL,
  "updatedAt" TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks("parentId", "order");
CREATE TABLE IF NOT EXISTS meta (
  "key"   TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
`;

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma("journal_mode = WAL");
  // Saat build, Next.js menjalankan beberapa worker yang membuka file yang
  // sama; tanpa ini salah satunya langsung gagal dengan SQLITE_BUSY.
  conn.pragma("busy_timeout = 5000");
  conn.pragma("foreign_keys = ON");
  conn.exec(SCHEMA);
  return conn;
}

// Dibuka saat pertama dipakai, bukan saat modul diimpor — impor terjadi juga
// pada tahap pengumpulan data build, di mana DB belum tentu perlu disentuh.
const globalForDb = globalThis as unknown as { zenoDb?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb.zenoDb) globalForDb.zenoDb = open();
  return globalForDb.zenoDb;
}

const COLUMNS = [
  "parentId",
  "order",
  "title",
  "progress",
  "start",
  "end",
  "status",
  "priority",
  "collapsed",
  "rollup",
  "notes",
  "createdAt",
  "updatedAt",
] as const;

const toTask = (row: Row): Task => ({
  ...row,
  collapsed: !!row.collapsed,
  rollup: !!row.rollup,
});

const toSql = (value: unknown) =>
  typeof value === "boolean" ? (value ? 1 : 0) : (value as string | number | null);

export function listTasks(): Task[] {
  const rows = getDb()
    .prepare(`SELECT * FROM tasks ORDER BY "parentId", "order"`)
    .all() as Row[];
  return rows.map(toTask);
}

export function insertTasks(tasks: Task[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO tasks ("id", ${COLUMNS.map((c) => `"${c}"`).join(", ")})
     VALUES (@id, ${COLUMNS.map((c) => `@${c}`).join(", ")})`,
  );
  const run = db.transaction((items: Task[]) => {
    for (const t of items)
      stmt.run({
        ...t,
        collapsed: t.collapsed ? 1 : 0,
        rollup: t.rollup ? 1 : 0,
      });
  });
  run(tasks);
}

/**
 * Terapkan banyak perubahan parsial dalam SATU transaksi.
 * Semua operasi pohon (pindah, indent, geser sub-pohon) menyentuh beberapa
 * baris sekaligus dan harus atomik — kalau setengah tertulis, urutan rusak.
 */
export function applyPatches(patches: Patch[]): void {
  if (patches.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const run = db.transaction((items: Patch[]) => {
    for (const patch of items) {
      // createdAt & updatedAt tidak pernah diambil dari klien: updatedAt
      // selalu ditulis server, dan duplikat kolom di SET harus dihindari.
      const fields = COLUMNS.filter(
        (c) => c in patch && c !== "createdAt" && c !== "updatedAt",
      );
      if (fields.length === 0) continue;
      const assignments = fields.map((c) => `"${c}" = @${c}`).join(", ");
      const params: Record<string, unknown> = { id: patch.id, updatedAt: now };
      for (const c of fields)
        params[c] = toSql((patch as Record<string, unknown>)[c]);
      db.prepare(
        `UPDATE tasks SET ${assignments}, "updatedAt" = @updatedAt WHERE "id" = @id`,
      ).run(params);
    }
  });
  run(patches);
}

export function deleteTasks(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM tasks WHERE "id" = ?`);
  const run = db.transaction((items: string[]) => {
    for (const id of items) stmt.run(id);
  });
  run(ids);
}

/** Import mode replace: tukar seluruh isi tabel dalam satu transaksi. */
export function replaceAll(tasks: Task[]): void {
  const db = getDb();
  const run = db.transaction((items: Task[]) => {
    db.prepare(`DELETE FROM tasks`).run();
    if (items.length) insertTasks(items);
  });
  run(tasks);
}

export function getMeta(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT "value" FROM meta WHERE "key" = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO meta ("key", "value") VALUES (?, ?)
       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`,
    )
    .run(key, value);
}

const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP_BACKUPS = 7;

/**
 * Snapshot harian (§5.7 PRD). Satu berkas per tanggal dan TIDAK PERNAH
 * ditimpa: kalau hari ini isinya terlanjur terhapus, snapshot pagi tadi tetap
 * utuh. Database kosong tidak pernah ditulis sebagai snapshot.
 */
export function snapshotDaily(): void {
  const tasks = listTasks();
  if (tasks.length === 0) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(
    BACKUP_DIR,
    `zeno-work-${new Date().toISOString().slice(0, 10)}.json`,
  );
  if (fs.existsSync(file)) return;
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks }, null, 2),
  );
  const older = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const f of older) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
}

export { DB_PATH, BACKUP_DIR };
