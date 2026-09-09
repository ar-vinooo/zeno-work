"use client";

import { create } from "zustand";
import {
  applyPatchList,
  childrenOf,
  indent,
  indexById,
  insertChild,
  insertSibling,
  moveTo,
  moveVertical,
  outdent,
  removeTask,
  shiftSubtree,
  subtreeIds,
  topMost,
} from "./tree";
import { applyRules } from "./validate";
import { buildOutline } from "./rollup";
import { MAX_TASKS_PER_CALL, type AiNewTask, type AiOperation } from "./ai";
import { shiftISO, diffDays } from "./dates";
import { EMPTY_FILTERS } from "./types";
import type {
  Filters,
  Patch,
  SortColumn,
  SortSpec,
  Task,
} from "./types";
import type { ZoomUnit } from "./schedule";

interface Diff {
  creates: Task[];
  patches: Patch[];
  deleteIds: string[];
}

const COMPARED: (keyof Task)[] = [
  "parentId",
  "order",
  "title",
  "progress",
  "start",
  "end",
  "status",
  "priority",
  "rollup",
  "notes",
];

function diffTasks(prev: Task[], next: Task[]): Diff {
  const before = indexById(prev);
  const after = indexById(next);
  const creates: Task[] = [];
  const patches: Patch[] = [];
  const deleteIds: string[] = [];

  for (const task of next) {
    const old = before.get(task.id);
    if (!old) {
      creates.push(task);
      continue;
    }
    const patch: Patch = { id: task.id };
    let changed = false;
    for (const key of COMPARED)
      if (old[key] !== task[key]) {
        (patch as Record<string, unknown>)[key] = task[key];
        changed = true;
      }
    if (changed) patches.push(patch);
  }
  for (const task of prev) if (!after.has(task.id)) deleteIds.push(task.id);

  return { creates, patches, deleteIds };
}

const COLLAPSE_KEY = "zenowork.collapsed";

/** Simpan status buka/tutup di browser — sama kategorinya dengan lebar kolom. */
function persistCollapsed(tasks: Task[]) {
  try {
    localStorage.setItem(
      COLLAPSE_KEY,
      JSON.stringify(tasks.filter((t) => t.collapsed).map((t) => t.id)),
    );
  } catch {
    // localStorage bisa ditolak browser; status tampilan boleh hilang.
  }
}

/** Terapkan status tersimpan. Bila belum pernah ada, nilai dari server dipakai. */
function restoreCollapsed(tasks: Task[]): Task[] {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return tasks;
    const ids = new Set(JSON.parse(raw) as string[]);
    return tasks.map((t) =>
      t.collapsed === ids.has(t.id) ? t : { ...t, collapsed: ids.has(t.id) },
    );
  } catch {
    return tasks;
  }
}

const countDiff = (d: Diff) =>
  d.creates.length + d.patches.length + d.deleteIds.length;

export type DragMode = "move" | "start" | "end";

/** Pratinjau drag: belum tersimpan, tidak masuk riwayat undo (§5.5.2). */
export interface SchedulePreview {
  ids: string[];
  mode: DragMode;
  days: number;
}
export interface CellRef {
  id: string;
  field: "title" | "progress" | "start" | "end" | "duration";
}

interface Store {
  tasks: Task[];
  /** false sampai store diisi di klien — server merender dari initialTasks. */
  hydrated: boolean;
  past: Task[][];
  future: Task[][];
  selection: string[];
  anchorId: string | null;
  editing: CellRef | null;
  sort: SortSpec;
  filters: Filters;
  zoom: ZoomUnit;
  showDuration: boolean;
  chatOpen: boolean;
  settingsOpen: boolean;
  /** Baris yang diubah AI dan belum disimpan — ditandai di tabel. */
  aiTouched: string[];
  saving: number;
  error: string | null;
  preview: SchedulePreview | null;
  /** Kondisi terakhir yang benar-benar ada di database. */
  baseline: Task[];
  /** Jumlah baris yang berbeda dari `baseline`. 0 berarti tidak ada yang perlu disimpan. */
  pending: number;

  hydrate: (tasks: Task[]) => void;
  save: () => Promise<void>;
  patchTask: (id: string, patch: Omit<Patch, "id">) => void;
  addSiblingAfter: (id: string | null) => string;
  addChildOf: (id: string) => string;
  removeSelected: (mode: "cascade" | "promote") => void;
  indentSelected: () => void;
  outdentSelected: () => void;
  nudgeVertical: (dir: -1 | 1) => void;
  dropRow: (id: string, parentId: string | null, index: number) => void;
  toggleCollapse: (id: string) => void;
  setAllCollapsed: (collapsed: boolean) => void;
  dragSchedule: (ids: string[], mode: DragMode, days: number) => void;
  setPreview: (preview: SchedulePreview | null) => void;
  select: (id: string, mode?: "replace" | "toggle" | "range", ordered?: string[]) => void;
  clearSelection: () => void;
  setEditing: (cell: CellRef | null) => void;
  setSortColumn: (column: SortColumn) => void;
  applySortAsOrder: () => void;
  refresh: () => Promise<void>;
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  setZoom: (zoom: ZoomUnit) => void;
  toggleDurationColumn: () => void;
  toggleChat: () => void;
  setSettingsOpen: (open: boolean) => void;
  /** Terapkan usulan AI sebagai SATU perubahan tertunda dan satu langkah undo. */
  applyAiOperations: (ops: AiOperation[]) => string[];
  undo: () => void;
  redo: () => void;
}

const HISTORY_LIMIT = 50;

export const useStore = create<Store>((set, get) => {
  /** Satu perubahan = satu langkah undo = satu batch sinkronisasi. */
  const commit = (next: Task[]) => {
    const prev = get().tasks;
    if (next === prev) return;
    const diff = diffTasks(prev, next);
    if (!diff.creates.length && !diff.patches.length && !diff.deleteIds.length)
      return;
    set((s) => ({
      tasks: next,
      past: [...s.past, prev].slice(-HISTORY_LIMIT),
      future: [],
      pending: countDiff(diffTasks(s.baseline, next)),
    }));
  };

  return {
    tasks: [],
    hydrated: false,
    past: [],
    future: [],
    selection: [],
    anchorId: null,
    editing: null,
    sort: { column: "manual", dir: "asc" },
    filters: EMPTY_FILTERS,
    zoom: "week",
    showDuration: false,
    chatOpen: false,
    settingsOpen: false,
    aiTouched: [],
    saving: 0,
    error: null,
    preview: null,
    baseline: [],
    pending: 0,

    hydrate: (raw) => {
      const tasks = restoreCollapsed(raw);
      set({
        tasks,
        baseline: tasks,
        pending: 0,
        hydrated: true,
        aiTouched: [],
        past: [],
        future: [],
      });
    },

    /**
     * Kirim selisih terhadap `baseline` ke server. Ini satu-satunya jalan
     * perubahan sampai ke database — mengetik, menyeret, dan menghapus hanya
     * mengubah salinan di memori sampai tombol ini ditekan.
     */
    save: async () => {
      const { baseline, tasks, saving } = get();
      if (saving > 0) return;
      const diff = diffTasks(baseline, tasks);
      if (countDiff(diff) === 0) return set({ pending: 0 });

      set((s) => ({ saving: s.saving + 1 }));
      try {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(diff),
        });
        if (!res.ok) throw new Error(`Gagal menyimpan (${res.status})`);
        // Perubahan yang terjadi SELAMA penyimpanan tidak boleh ikut hilang,
        // jadi sisa selisihnya dihitung ulang terhadap kondisi terkini.
        set((s) => ({
          baseline: tasks,
          pending: countDiff(diffTasks(tasks, s.tasks)),
          aiTouched: [],
          error: null,
        }));
      } catch (err) {
        set({ error: (err as Error).message });
      } finally {
        set((s) => ({ saving: Math.max(0, s.saving - 1) }));
      }
    },

    patchTask: (id, patch) => {
      const tasks = get().tasks;
      const current = indexById(tasks).get(id);
      if (!current) return;
      commit(applyPatchList(tasks, [applyRules(current, { id, ...patch })]));
    },

    addSiblingAfter: (id) => {
      const tasks = get().tasks;
      const { task, patches } = insertSibling(tasks, id);
      commit([...applyPatchList(tasks, patches), task]);
      set({ selection: [task.id], anchorId: task.id, editing: { id: task.id, field: "title" } });
      return task.id;
    },

    addChildOf: (id) => {
      const tasks = get().tasks;
      const { task, patches } = insertChild(tasks, id);
      commit([...applyPatchList(tasks, patches), task]);
      set({ selection: [task.id], anchorId: task.id, editing: { id: task.id, field: "title" } });
      return task.id;
    },

    removeSelected: (mode) => {
      let tasks = get().tasks;
      const targets = topMost(tasks, get().selection);
      if (!targets.length) return;
      const removed = new Set<string>();
      for (const id of targets) {
        if (removed.has(id)) continue;
        const plan = removeTask(tasks, id, mode);
        for (const r of plan.removeIds) removed.add(r);
        tasks = applyPatchList(tasks, plan.patches).filter(
          (t) => !plan.removeIds.includes(t.id),
        );
      }
      commit(tasks);
      set({ selection: [], anchorId: null, editing: null });
    },

    indentSelected: () => {
      let tasks = get().tasks;
      for (const id of topMost(tasks, get().selection))
        tasks = applyPatchList(tasks, indent(tasks, id));
      commit(tasks);
    },

    outdentSelected: () => {
      let tasks = get().tasks;
      // Dari bawah ke atas: memindahkan baris atas lebih dulu menggeser
      // posisi target baris di bawahnya.
      for (const id of topMost(tasks, get().selection).reverse())
        tasks = applyPatchList(tasks, outdent(tasks, id));
      commit(tasks);
    },

    nudgeVertical: (dir) => {
      const tasks = get().tasks;
      const id = get().selection[0];
      if (!id) return;
      commit(applyPatchList(tasks, moveVertical(tasks, id, dir)));
    },

    dropRow: (id, parentId, index) => {
      const tasks = get().tasks;
      commit(applyPatchList(tasks, moveTo(tasks, id, parentId, index)));
    },

    // Buka/tutup hanya mengubah tampilan: tidak menandai ada yang perlu
    // disimpan, tidak masuk riwayat undo, dan tidak pernah dikirim ke server.
    toggleCollapse: (id) => {
      const tasks = get().tasks.map((t) =>
        t.id === id ? { ...t, collapsed: !t.collapsed } : t,
      );
      set({ tasks });
      persistCollapsed(tasks);
    },

    setAllCollapsed: (collapsed) => {
      const source = get().tasks;
      const tasks = source.map((t) =>
        childrenOf(source, t.id).length > 0 && t.collapsed !== collapsed
          ? { ...t, collapsed }
          : t,
      );
      set({ tasks });
      persistCollapsed(tasks);
    },

    /**
     * Geser jadwal (§5.5). Induk ber-roll-up menggeser seluruh sub-pohonnya;
     * durasinya sendiri tidak bisa ditarik karena itu hasil hitungan anak.
     */
    dragSchedule: (ids, mode, days) => {
      if (days === 0) return;
      let tasks = get().tasks;
      const targets = topMost(tasks, ids);
      for (const id of targets) {
        const map = indexById(tasks);
        const task = map.get(id);
        if (!task) continue;
        const isRollupParent =
          task.rollup && childrenOf(tasks, id).length > 0;

        if (isRollupParent) {
          if (mode !== "move") continue;
          tasks = applyPatchList(tasks, shiftSubtree(tasks, id, days));
          continue;
        }

        let { start, end } = task;
        if (mode === "move") {
          start = shiftISO(start, days);
          end = shiftISO(end, days);
        } else if (mode === "start") {
          start = shiftISO(start, days);
          if (diffDays(start, end) < 0) start = end; // durasi minimum 1 hari
        } else {
          end = shiftISO(end, days);
          if (diffDays(start, end) < 0) end = start;
        }
        tasks = applyPatchList(tasks, [{ id, start, end }]);
      }
      commit(tasks);
    },

    setPreview: (preview) => set({ preview }),

    select: (id, mode = "replace", ordered) => {
      const { selection, anchorId } = get();
      if (mode === "toggle") {
        const next = selection.includes(id)
          ? selection.filter((s) => s !== id)
          : [...selection, id];
        set({ selection: next, anchorId: id });
        return;
      }
      if (mode === "range" && anchorId && ordered) {
        const a = ordered.indexOf(anchorId);
        const b = ordered.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          set({ selection: ordered.slice(lo, hi + 1) });
          return;
        }
      }
      set({ selection: [id], anchorId: id });
    },

    clearSelection: () => set({ selection: [], anchorId: null }),
    setEditing: (cell) => set({ editing: cell }),

    setSortColumn: (column) => {
      const { sort } = get();
      if (column === "manual") return set({ sort: { column: "manual", dir: "asc" } });
      if (sort.column !== column) return set({ sort: { column, dir: "asc" } });
      if (sort.dir === "asc") return set({ sort: { column, dir: "desc" } });
      return set({ sort: { column: "manual", dir: "asc" } });
    },

    /** Tulis urutan tampilan hasil sorting ke `order` lalu kembali ke Manual. */
    applySortAsOrder: () => {
      const { tasks, sort } = get();
      if (sort.column === "manual") return;
      const outline = buildOutline(tasks, sort);
      const patches: Patch[] = [];
      const walk = (nodes: typeof outline.roots) => {
        nodes.forEach((node, i) => {
          if (node.task.order !== i) patches.push({ id: node.task.id, order: i });
          walk(node.children);
        });
      };
      walk(outline.roots);
      commit(applyPatchList(tasks, patches));
      set({ sort: { column: "manual", dir: "asc" } });
    },

    refresh: async () => {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const data = (await res.json()) as { tasks: Task[] };
      const restored = restoreCollapsed(data.tasks);
      set({
        tasks: restored,
        baseline: restored,
        pending: 0,
        aiTouched: [],
        past: [],
        future: [],
        selection: [],
      });
    },

    setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
    resetFilters: () => set({ filters: EMPTY_FILTERS }),
    setZoom: (zoom) => set({ zoom }),
    toggleDurationColumn: () => set((s) => ({ showDuration: !s.showDuration })),
    toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

    applyAiOperations: (ops) => {
      let tasks = get().tasks;
      // Nomor WBS dipetakan SEKALI di awal: model menyusun usulannya
      // berdasarkan keadaan yang dia lihat, dan nomor bergeser begitu ada
      // baris yang ditambah atau dihapus. Baris baru tidak butuh nomor karena
      // hubungan induk-anaknya sudah tersusun lewat `children`.
      const outline = buildOutline(tasks, { column: "manual", dir: "asc" });
      const idOf = new Map(outline.all.map((n) => [n.wbs, n.task.id]));
      const titleOf = new Map(outline.all.map((n) => [n.wbs, n.task.title]));
      const log: string[] = [];
      const touched: string[] = [];

      // Nilai dari model diperiksa di sini, bukan lewat skema tool: skema
      // tidak menerima minimum/maximum/pattern. Apa pun yang tidak masuk akal
      // dibuang, bukan dipaksa masuk.
      const ISO = /^\d{4}-\d{2}-\d{2}$/;
      const STATUSES = new Set(["todo", "in_progress", "blocked", "done"]);
      const fieldsOf = (op: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        if (typeof op.title === "string" && op.title.trim())
          out.title = op.title.trim();
        for (const key of ["start", "end"] as const)
          if (typeof op[key] === "string" && ISO.test(op[key] as string))
            out[key] = op[key];
        if (typeof op.progress === "number" && Number.isFinite(op.progress))
          out.progress = Math.max(0, Math.min(100, Math.round(op.progress)));
        if (typeof op.status === "string" && STATUSES.has(op.status))
          out.status = op.status;
        return out;
      };

      let budget = MAX_TASKS_PER_CALL;

      /**
       * Sisipkan satu tingkat beserta keturunannya. Anak memakai id induk yang
       * BARU dibuat, bukan nomor WBS — itulah yang membuat pohon utuh bisa
       * dibuat dalam satu giliran.
       */
      const addTree = (
        nodes: AiNewTask[],
        parentId: string | null,
        afterId: string | null,
      ) => {
        let cursor = afterId;
        for (const node of nodes) {
          if (budget <= 0) break;
          if (typeof node?.title !== "string" || !node.title.trim()) continue;
          budget -= 1;
          const fields = fieldsOf(node as unknown as Record<string, unknown>);
          const made = parentId
            ? insertChild(tasks, parentId, fields)
            : insertSibling(tasks, cursor, fields);
          tasks = [...applyPatchList(tasks, made.patches), made.task];
          touched.push(made.task.id);
          // Saudara berikutnya menyusul di bawah yang baru saja dibuat.
          if (!parentId) cursor = made.task.id;
          if (Array.isArray(node.children) && node.children.length)
            addTree(node.children, made.task.id, null);
        }
      };

      for (const op of ops) {
        if (op.op === "add_tasks") {
          if (!Array.isArray(op.tasks) || op.tasks.length === 0) continue;
          const parentId = op.parent_wbs ? idOf.get(op.parent_wbs) : undefined;
          if (op.parent_wbs && !parentId) {
            log.push(`? induk ${op.parent_wbs} tidak ditemukan — dilewati`);
            continue;
          }
          const afterId = op.after_wbs ? idOf.get(op.after_wbs) ?? null : null;
          const before = touched.length;
          addTree(op.tasks, parentId ?? null, afterId);
          const added = touched.length - before;
          const where = op.parent_wbs
            ? ` di ${op.parent_wbs}`
            : op.after_wbs
              ? ` setelah ${op.after_wbs}`
              : "";
          log.push(
            added === 1
              ? `+ ${op.tasks[0]?.title ?? ""}${where}`
              : `+ ${added} baris${where}`,
          );
          continue;
        }

        if (op.op === "delete_tasks") {
          for (const wbs of Array.isArray(op.wbs) ? op.wbs : []) {
            const id = idOf.get(wbs);
            if (!id) {
              log.push(`? baris ${wbs} tidak ditemukan — dilewati`);
              continue;
            }
            const plan = removeTask(tasks, id, "cascade");
            tasks = applyPatchList(tasks, plan.patches).filter(
              (t) => !plan.removeIds.includes(t.id),
            );
            log.push(
              `− ${wbs} ${titleOf.get(wbs) ?? ""}${
                plan.removeIds.length > 1
                  ? ` (+${plan.removeIds.length - 1} sub-task)`
                  : ""
              }`,
            );
          }
          continue;
        }

        for (const entry of Array.isArray(op.updates) ? op.updates : []) {
          const id = idOf.get(entry?.wbs);
          if (!id) {
            log.push(`? baris ${entry?.wbs} tidak ditemukan — dilewati`);
            continue;
          }
          const current = indexById(tasks).get(id);
          if (!current) continue;
          const fields = fieldsOf(entry as unknown as Record<string, unknown>);
          if (Object.keys(fields).length === 0) continue;
          tasks = applyPatchList(tasks, [applyRules(current, { id, ...fields })]);
          touched.push(id);
          log.push(`~ ${entry.wbs} ${Object.keys(fields).join(", ")}`);
        }
      }

      commit(tasks);
      set((s) => ({ aiTouched: [...new Set([...s.aiTouched, ...touched])] }));
      return log;
    },

    undo: () => {
      const { past, tasks, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set((s) => ({
        tasks: prev,
        past: past.slice(0, -1),
        future: [...future, tasks],
        pending: countDiff(diffTasks(s.baseline, prev)),
      }));
    },

    redo: () => {
      const { future, tasks, past } = get();
      const next = future[future.length - 1];
      if (!next) return;
      set((s) => ({
        tasks: next,
        future: future.slice(0, -1),
        past: [...past, tasks],
        pending: countDiff(diffTasks(s.baseline, next)),
      }));
    },
  };
});

export const selectSubtree = (tasks: Task[], id: string) => subtreeIds(tasks, id);
