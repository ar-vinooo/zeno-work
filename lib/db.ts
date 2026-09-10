import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Patch, Task } from "./types";

// Electron mengisi ZENO_DATA_DIR dengan folder userData milik sistem; skrip
// baris perintah (tsx scripts/*.ts) tetap memakai ./data.
//
// Dihitung saat dipakai, bukan saat modul diimpor: proses utama Electron baru
// tahu folder userData setelah app.setName(), yang terjadi setelah impor.
const dataDir = () =>
  process.env.ZENO_DATA_DIR
    ? path.resolve(process.env.ZENO_DATA_DIR)
    : path.join(process.cwd(), "data");
const dbPath = () => process.env.ZENO_DB ?? path.join(dataDir(), "zeno-work.db");
const backupDir = () => path.join(dataDir(), "backups");

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
  "repositoryPath" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT    NOT NULL,
  "updatedAt" TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks("parentId", "order");
CREATE TABLE IF NOT EXISTS meta (
  "key"   TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repo_scans (
  "taskId"         TEXT PRIMARY KEY REFERENCES tasks("id") ON DELETE CASCADE,
  "repositoryRoot" TEXT NOT NULL,
  "head"           TEXT NOT NULL,
  "fingerprint"    TEXT NOT NULL,
  "checkedAt"      TEXT NOT NULL
);
`;

function open(): DatabaseSync {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
  });
  conn.exec("PRAGMA journal_mode = WAL");
  // Saat build, Next.js menjalankan beberapa worker yang membuka file yang
  // sama; tanpa ini salah satunya langsung gagal dengan SQLITE_BUSY.
  conn.exec("PRAGMA busy_timeout = 5000");
  conn.exec("PRAGMA foreign_keys = ON");
  conn.exec(SCHEMA);
  // Database lama sudah punya tabel tasks, sehingga CREATE TABLE IF NOT
  // EXISTS tidak menambahkan kolom baru. Migrasi kecil ini mempertahankan
  // seluruh task lama dan memberi nilai kosong sebagai bawaan.
  const taskColumns = conn
    .prepare(`PRAGMA table_info(tasks)`)
    .all() as { name: string }[];
  if (!taskColumns.some((column) => column.name === "repositoryPath"))
    conn.exec(`ALTER TABLE tasks ADD COLUMN "repositoryPath" TEXT NOT NULL DEFAULT ''`);
  return conn;
}

// Dibuka saat pertama dipakai, bukan saat modul diimpor — impor terjadi juga
// pada tahap pengumpulan data build, di mana DB belum tentu perlu disentuh.
const globalForDb = globalThis as unknown as { zenoDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!globalForDb.zenoDb) globalForDb.zenoDb = open();
  return globalForDb.zenoDb;
}

/** Tutup koneksi saat aplikasi berhenti agar isi WAL ikut tersimpan. */
export function closeDb(): void {
  if (!globalForDb.zenoDb) return;
  try {
    globalForDb.zenoDb.close();
  } catch {
    // Sudah tertutup — tidak ada yang perlu dilakukan.
  }
  globalForDb.zenoDb = undefined;
}

/** `node:sqlite` sengaja dipakai agar web dan Electron tidak membutuhkan
 * binary native dengan ABI yang berbeda. */
function inTransaction(db: DatabaseSync, run: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
  "repositoryPath",
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
  inTransaction(db, () => insertTasksWith(db, tasks));
}

function insertTasksWith(db: DatabaseSync, tasks: Task[]): void {
  const stmt = db.prepare(
    `INSERT INTO tasks ("id", ${COLUMNS.map((c) => `"${c}"`).join(", ")})
     VALUES (@id, ${COLUMNS.map((c) => `@${c}`).join(", ")})`,
  );
  for (const task of tasks)
    stmt.run({
      ...task,
      collapsed: task.collapsed ? 1 : 0,
      rollup: task.rollup ? 1 : 0,
    });
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
  inTransaction(db, () => {
    for (const patch of patches) {
      // createdAt & updatedAt tidak pernah diambil dari klien: updatedAt
      // selalu ditulis proses utama, dan duplikat kolom di SET harus dihindari.
      const fields = COLUMNS.filter(
        (c) => c in patch && c !== "createdAt" && c !== "updatedAt",
      );
      if (fields.length === 0) continue;
      const assignments = fields.map((c) => `"${c}" = @${c}`).join(", ");
      const params: Record<string, SQLInputValue> = {
        id: patch.id,
        updatedAt: now,
      };
      for (const c of fields)
        params[c] = toSql((patch as Record<string, unknown>)[c]);
      db.prepare(
        `UPDATE tasks SET ${assignments}, "updatedAt" = @updatedAt WHERE "id" = @id`,
      ).run(params);
    }
  });
}

export function deleteTasks(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM tasks WHERE "id" = ?`);
  inTransaction(db, () => {
    for (const id of ids) stmt.run(id);
  });
}

/** Import mode replace: tukar seluruh isi tabel dalam satu transaksi. */
export function replaceAll(tasks: Task[]): void {
  const db = getDb();
  inTransaction(db, () => {
    db.prepare(`DELETE FROM tasks`).run();
    if (tasks.length) insertTasksWith(db, tasks);
  });
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

export interface RepositoryScan {
  taskId: string;
  repositoryRoot: string;
  head: string;
  fingerprint: string;
  checkedAt: string;
}

export function getRepositoryScan(taskId: string): RepositoryScan | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM repo_scans WHERE "taskId" = ?`)
      .get(taskId) as RepositoryScan | undefined) ?? null
  );
}

export function saveRepositoryScan(scan: RepositoryScan): void {
  getDb()
    .prepare(
      `INSERT INTO repo_scans
         ("taskId", "repositoryRoot", "head", "fingerprint", "checkedAt")
       VALUES (@taskId, @repositoryRoot, @head, @fingerprint, @checkedAt)
       ON CONFLICT("taskId") DO UPDATE SET
         "repositoryRoot" = excluded."repositoryRoot",
         "head" = excluded."head",
         "fingerprint" = excluded."fingerprint",
         "checkedAt" = excluded."checkedAt"`,
    )
    .run({ ...scan });
}

const KEEP_BACKUPS = 7;

/**
 * Snapshot harian (§5.7 PRD). Satu berkas per tanggal dan TIDAK PERNAH
 * ditimpa: kalau hari ini isinya terlanjur terhapus, snapshot pagi tadi tetap
 * utuh. Database kosong tidak pernah ditulis sebagai snapshot.
 */
export function snapshotDaily(): void {
  const tasks = listTasks();
  if (tasks.length === 0) return;
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `zeno-work-${new Date().toISOString().slice(0, 10)}.json`,
  );
  if (fs.existsSync(file)) return;
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks }, null, 2),
  );
  const older = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const f of older) fs.rmSync(path.join(dir, f), { force: true });
}

export { dbPath, backupDir };
