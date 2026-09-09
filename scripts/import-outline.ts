/**
 * Impor WBS dari docs/data.txt ke database.
 * Jalankan: npm run import  (opsional: npm run import -- path/lain.txt)
 *
 * Format per baris, dipisah TAB:
 *   1.2.3. Judul <TAB> 85% <TAB> W1 07-25 <TAB> W3 07-25
 */
import fs from "node:fs";
import path from "node:path";
import { listTasks, replaceAll, setMeta } from "../lib/db";
import { buildOutline } from "../lib/rollup";
import { makeTask } from "../lib/tree";
import type { Status, Task } from "../lib/types";

const SOURCE = process.argv[2] ?? "docs/data.txt";
const LINE = /^\s*(\d+(?:\.\d+)*)\.\s*(.+?)\s*$/;
const WEEK = /^W([1-5])\s+(\d{2})-(\d{2})$/;

/** Salah ketik di berkas sumber, diperbaiki saat impor. */
const TYPO_FIX: Record<string, string> = {
  "Pembuatan Dasbhoard": "Pembuatan Dashboard",
};

/**
 * Cara meratakan tiap grup tingkat-3 yang punya anak tingkat-4. Ditulis
 * eksplisit per grup, bukan satu aturan otomatis, karena polanya memang
 * berbeda-beda — dan salah pilih berarti menghilangkan pekerjaan nyata.
 *
 *   merge  — anak tunggal yang mengulang judul induknya. Jadi satu baris,
 *            memakai judul anak yang lebih spesifik.
 *   keep   — anak tunggal yang membahas hal berbeda. Keduanya dipertahankan
 *            dan menjadi bersaudara.
 *   lift   — beberapa anak, dan judul induk hanyalah ringkasan dari mereka.
 *            Anak naik, judul induk dicatat di notes tiap anak.
 *   prefix — sama seperti lift, tapi judul anak diberi awalan karena tanpa
 *            induknya mereka kehilangan konteks.
 */
type FlattenMode =
  | { mode: "merge" | "keep" | "lift" }
  | { mode: "prefix"; prefix: string };

const FLATTEN: Record<string, FlattenMode> = {
  "5.7.3": { mode: "keep" },
  "5.8.3": { mode: "keep" },
  "5.10.1": { mode: "keep" },
  "5.11.2": { mode: "lift" },
  "15.1.1": { mode: "lift" },
  "15.1.2": { mode: "lift" },
  "15.1.3": { mode: "prefix", prefix: "Panel saat panggilan — " },
  "15.1.4": { mode: "lift" },
  "15.2.1": { mode: "lift" },
  "15.2.2": { mode: "lift" },
  "15.2.3": { mode: "lift" },
  "15.2.4": { mode: "merge" },
  "15.3.1": { mode: "lift" },
  "15.3.2": { mode: "lift" },
  "15.3.3": { mode: "lift" },
  "15.3.4": { mode: "merge" },
  "15.4.1": { mode: "lift" },
  "15.4.2": { mode: "lift" },
  "15.5.1": { mode: "lift" },
  "15.5.2": { mode: "merge" },
  "15.6.1": { mode: "merge" },
};

interface Entry {
  num: string;
  depth: number;
  title: string;
  progress: number;
  start: string;
  end: string;
  /** Jejak judul grup yang diratakan, supaya tidak ada yang benar-benar hilang. */
  notes?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

/**
 * "W2 07-25" → minggu ke-2 bulan Juli 2025.
 * Minggu dihitung sebagai blok tanggal tetap: W1 = 1–7, W2 = 8–14,
 * W3 = 15–21, W4 = 22–28, W5 = 29–akhir bulan. Dipilih karena bisa ditebak
 * dan tidak bergeser mengikuti hari apa tanggal 1 jatuh.
 */
function parseWeek(cell: string, edge: "start" | "end"): string {
  const m = cell.match(WEEK);
  if (!m) throw new Error(`Format tanggal tidak dikenali: ${cell}`);
  const week = Number(m[1]);
  const month = Number(m[2]);
  const year = 2000 + Number(m[3]);
  const first = (week - 1) * 7 + 1;
  const last = Math.min(first + 6, daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(edge === "start" ? first : last)}`;
}

function parseProgress(cell: string): number {
  const n = Number(cell.replace("%", "").trim());
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function read(file: string): Entry[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((line, i) => {
      const cols = line.replace(/\r$/, "").split("\t");
      const m = cols[0].match(LINE);
      if (!m) throw new Error(`Baris ${i + 1} tidak punya nomor: ${cols[0]}`);
      const start = parseWeek(cols[2]?.trim() ?? "", "start");
      const end = parseWeek(cols[3]?.trim() ?? "", "end");
      return {
        num: m[1],
        depth: m[1].split(".").length,
        title: TYPO_FIX[m[2]] ?? m[2],
        progress: parseProgress(cols[1] ?? "0"),
        start,
        end: end < start ? start : end,
      };
    });
}

/**
 * Ratakan tingkat ke-4 menjadi maksimal tiga tingkat, mengikuti FLATTEN.
 * Judul grup yang dibuang selalu dicatat ke notes anaknya, jadi tidak ada
 * informasi yang benar-benar lenyap.
 */
function flattenToThree(entries: Entry[]): {
  kept: Entry[];
  report: string[];
} {
  const byNum = new Map(entries.map((e) => [e.num, e]));
  const drop = new Set<string>();
  const report: string[] = [];

  for (const [group, rule] of Object.entries(FLATTEN)) {
    const parent = byNum.get(group);
    const children = entries.filter(
      (e) => e.depth === 4 && e.num.startsWith(`${group}.`),
    );
    if (!parent || children.length === 0) continue;

    if (rule.mode === "keep") {
      report.push(`keep   ${group} — induk & anak jadi bersaudara`);
      continue;
    }
    if (rule.mode === "merge") {
      // Judul anak menang karena lebih spesifik; progres & tanggal ikut anak.
      drop.add(parent.num);
      children[0].notes = `Sebelumnya: ${parent.title}`;
      report.push(`merge  ${group} — "${parent.title}" → "${children[0].title}"`);
      continue;
    }
    drop.add(parent.num);
    for (const c of children) {
      c.notes = `Bagian dari: ${parent.title}`;
      if (rule.mode === "prefix") c.title = `${rule.prefix}${c.title}`;
    }
    report.push(
      `${rule.mode === "prefix" ? "prefix" : "lift  "} ${group} — ${children.length} anak naik, judul grup "${parent.title}" dicatat di notes`,
    );
  }

  const kept = entries.filter((e) => !drop.has(e.num));
  for (const e of kept) if (e.depth === 4) e.depth = 3;
  return { kept, report };
}

function toTasks(entries: Entry[]): Task[] {
  const tasks: Task[] = [];
  const idAt = new Map<string, string>(); // prefiks nomor → id
  const orderAt = new Map<string, number>();

  for (const e of entries) {
    const segments = e.num.split(".");
    // Induk = leluhur terdekat yang masih ada setelah perataan.
    let parentId: string | null = null;
    for (let cut = Math.min(segments.length - 1, e.depth - 1); cut >= 1; cut--) {
      const candidate = segments.slice(0, cut).join(".");
      if (idAt.has(candidate)) {
        parentId = idAt.get(candidate)!;
        break;
      }
    }
    const key = parentId ?? "__root__";
    const order = orderAt.get(key) ?? 0;
    orderAt.set(key, order + 1);

    const status: Status =
      e.progress >= 100 ? "done" : e.progress > 0 ? "in_progress" : "todo";
    const task = makeTask({
      parentId,
      order,
      title: e.title,
      notes: e.notes ?? "",
      progress: e.progress,
      start: e.start,
      end: e.end,
      status,
      collapsed: true, // 260+ baris terbuka semua tidak terbaca
    });
    tasks.push(task);
    idAt.set(e.num, task.id);
  }
  return tasks;
}

// --- jalankan -------------------------------------------------------------

const entries = read(SOURCE);
const { kept, report } = flattenToThree(entries);
const tasks = toTasks(kept);

const existing = listTasks();
if (existing.length) {
  const dir = path.join(process.cwd(), "data", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `pre-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(file, JSON.stringify({ version: 1, tasks: existing }, null, 2));
  console.log(`Cadangan ${existing.length} baris lama → ${path.relative(process.cwd(), file)}`);
}

replaceAll(tasks);
setMeta("seeded", new Date().toISOString());

const outline = buildOutline(listTasks(), { column: "manual", dir: "asc" });
const depths = new Map<number, number>();
for (const n of outline.all)
  depths.set(n.depth + 1, (depths.get(n.depth + 1) ?? 0) + 1);

console.log(`\nDibaca      : ${entries.length} baris dari ${SOURCE}`);
console.log(`Grup diratakan: ${report.length}`);
console.log(`Dimasukkan  : ${tasks.length} task`);
console.log(
  `Kedalaman   : ${[...depths.entries()].sort().map(([d, n]) => `${d}=${n}`).join("  ")}`,
);
console.log(`Terdalam    : ${Math.max(...outline.all.map((n) => n.depth)) + 1} tingkat`);
console.log("\nPerlakuan tiap grup tingkat-4:");
for (const r of report) console.log(`   ${r}`);
