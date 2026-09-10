/**
 * Pemeriksaan logika pohon & roll-up — bagian paling rawan bug (§9 PRD).
 * Jalankan: npx tsx scripts/check-tree.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PALETTE_TOKENS } from "../lib/palette";
import {
  applyPatchList,
  childrenOf,
  indent,
  insertSibling,
  isDescendant,
  makeTask,
  moveTo,
  outdent,
  removeTask,
  shiftSubtree,
} from "../lib/tree";
import { buildOutline } from "../lib/rollup";
import { computeRows } from "../lib/rows";
import { EMPTY_FILTERS, type Task } from "../lib/types";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const ok = a === b;
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n        harap ${b}\n        dapat ${a}`}`);
}

const outlineOf = (tasks: Task[]) =>
  buildOutline(tasks).all.map((n) => `${n.wbs} ${n.task.title}`);

// Susunan awal: 1 A (1.1 A1, 1.2 A2), 2 B, 3 C
const mk = (title: string, parentId: string | null, order: number, start: string, end: string) =>
  makeTask({ title, parentId, order, start, end });

const A = mk("A", null, 0, "2026-01-01", "2026-01-02");
const A1 = mk("A1", A.id, 0, "2026-01-01", "2026-01-04");
const A2 = mk("A2", A.id, 1, "2026-01-05", "2026-01-06");
const B = mk("B", null, 1, "2026-02-01", "2026-02-03");
const C = mk("C", null, 2, "2026-03-01", "2026-03-01");
let tasks: Task[] = [A, A1, A2, B, C];

check("penomoran awal", outlineOf(tasks), ["1 A", "1.1 A1", "1.2 A2", "2 B", "3 C"]);

// Roll-up: A dihitung dari A1 (4 hari, 0%) dan A2 (2 hari, 0%)
A1.progress = 100;
tasks = applyPatchList(tasks, [{ id: A1.id, progress: 100, status: "done" }]);
const rolled = buildOutline(tasks).byId.get(A.id)!;
check("roll-up rentang induk", [rolled.eff.start, rolled.eff.end], ["2026-01-01", "2026-01-06"]);
check("roll-up progres berbobot durasi (4h×100 + 2h×0)/6", rolled.eff.progress, 67);
check("roll-up status campuran", rolled.eff.status, "in_progress");
check("induk ditandai derived", rolled.derived, true);

// Indent B → jadi anak terakhir A
tasks = applyPatchList(tasks, indent(tasks, B.id));
check("indent B", outlineOf(tasks), ["1 A", "1.1 A1", "1.2 A2", "1.3 B", "2 C"]);

// Outdent B → kembali tepat setelah A
tasks = applyPatchList(tasks, outdent(tasks, B.id));
check("outdent B", outlineOf(tasks), ["1 A", "1.1 A1", "1.2 A2", "2 B", "3 C"]);

// Baris pertama tidak bisa di-indent
check("indent baris pertama ditolak", indent(tasks, A.id), []);
check("outdent baris root ditolak", outdent(tasks, A.id), []);

// Siklus: A tidak boleh dipindah ke dalam anaknya sendiri
check("pindah ke keturunan sendiri ditolak", moveTo(tasks, A.id, A1.id, 0), []);
check("isDescendant", isDescendant(tasks, A1.id, A.id), true);

// Pindah C ke posisi pertama; seluruh urutan root dinomori ulang
tasks = applyPatchList(tasks, moveTo(tasks, C.id, null, 0));
check("pindah C ke atas", outlineOf(tasks), ["1 C", "2 A", "2.1 A1", "2.2 A2", "3 B"]);

// Geser sub-pohon A tiga hari
tasks = applyPatchList(tasks, shiftSubtree(tasks, A.id, 3));
const shifted = buildOutline(tasks).byId.get(A.id)!;
check("geser sub-pohon menggeser semua anak", [shifted.eff.start, shifted.eff.end], ["2026-01-04", "2026-01-09"]);

// Hapus induk dengan menaikkan anak
const promote = removeTask(tasks, A.id, "promote");
const afterPromote = applyPatchList(tasks, promote.patches).filter(
  (t) => !promote.removeIds.includes(t.id),
);
check("promote hanya menghapus induknya", promote.removeIds.length, 1);
check("promote menaikkan anak", outlineOf(afterPromote), ["1 C", "2 A1", "3 A2", "4 B"]);

// Hapus induk beserta keturunan
const cascade = removeTask(tasks, A.id, "cascade");
check("cascade menghapus sub-pohon", cascade.removeIds.length, 3);

// Filter menampilkan leluhur sebagai konteks
const filtered = computeRows(tasks, { ...EMPTY_FILTERS, query: "A2" });
check(
  "filter menyertakan leluhur sebagai konteks",
  filtered.rows.map((r) => `${r.wbs}${r.contextOnly ? "*" : ""}`),
  ["2*", "2.2"],
);
check(
  "hasil kalender hanya berisi task yang cocok, bukan leluhur konteks",
  filtered.matchedNodes.map((n) => n.wbs),
  ["2.2"],
);

// Collapse menyembunyikan keturunan tapi induk tetap ada
const collapsed = applyPatchList(tasks, [{ id: A.id, collapsed: true }]);
check(
  "collapse menyembunyikan anak",
  computeRows(collapsed, EMPTY_FILTERS).rows.map((r) => r.wbs),
  ["1", "2", "3"],
);

// Sisip saudara menomori ulang tanpa lompatan
const ins = insertSibling(tasks, C.id, { title: "D" });
check(
  "sisip saudara setelah C",
  outlineOf([...applyPatchList(tasks, ins.patches), ins.task]),
  ["1 C", "2 D", "3 A", "3.1 A1", "3.2 A2", "4 B"],
);

// Warna Gantt hidup di dua tempat yang tidak bisa saling impor: token CSS
// untuk layar, dan lib/palette.ts untuk lembar XLSX. Kalau salah satu diubah
// sendirian, ekspor berhenti mirip dengan yang terlihat — jadi dicocokkan.
const css = fs.readFileSync(
  path.join(process.cwd(), "app/globals.css"),
  "utf8",
);
const theme = css.slice(css.indexOf("@theme {"), css.indexOf("@media"));
for (const [token, hex] of Object.entries(PALETTE_TOKENS)) {
  const found = theme.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6});`));
  check(`token ${token} cocok dengan lib/palette.ts`, found?.[1], hex);
}

console.log(failures === 0 ? "\nSemua pemeriksaan lolos." : `\n${failures} pemeriksaan GAGAL.`);
process.exit(failures === 0 ? 0 : 1);
