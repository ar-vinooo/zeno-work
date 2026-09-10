import type { Patch, Task } from "./types";
import { shiftISO, todayISO } from "./dates";

/**
 * Operasi pohon murni di atas daftar datar (adjacency list, §7.2 PRD).
 * Semua fungsi TIDAK memutasi input; hasilnya berupa Patch[] yang siap
 * diterapkan optimistis di klien lalu dikirim ke API sebagai satu transaksi.
 */

export const byOrder = (a: Task, b: Task) => a.order - b.order;

export function childrenOf(tasks: Task[], parentId: string | null): Task[] {
  return tasks.filter((t) => t.parentId === parentId).sort(byOrder);
}

export function indexById(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

/** true bila `id` berada di dalam sub-pohon `ancestorId` (tidak termasuk dirinya). */
export function isDescendant(
  tasks: Task[],
  id: string,
  ancestorId: string,
): boolean {
  const map = indexById(tasks);
  let cur = map.get(id)?.parentId ?? null;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = map.get(cur)?.parentId ?? null;
  }
  return false;
}

export function ancestorIdsOf(tasks: Task[], id: string): string[] {
  const map = indexById(tasks);
  const out: string[] = [];
  let cur = map.get(id)?.parentId ?? null;
  while (cur) {
    out.push(cur);
    cur = map.get(cur)?.parentId ?? null;
  }
  return out;
}

/** Sub-pohon termasuk dirinya sendiri, urut depth-first. */
export function subtreeIds(tasks: Task[], id: string): string[] {
  const out: string[] = [];
  const walk = (nodeId: string) => {
    out.push(nodeId);
    for (const c of childrenOf(tasks, nodeId)) walk(c.id);
  };
  walk(id);
  return out;
}

export function depthOf(tasks: Task[], id: string): number {
  return ancestorIdsOf(tasks, id).length;
}

/** Patch penomoran ulang 0..n untuk satu tingkat, hanya bagi yang berubah. */
function renumber(siblings: Task[], patches: Map<string, Patch>) {
  siblings.forEach((s, i) => {
    if (s.order !== i) mergePatch(patches, { id: s.id, order: i });
  });
}

function mergePatch(patches: Map<string, Patch>, patch: Patch) {
  patches.set(patch.id, { ...patches.get(patch.id), ...patch });
}

/**
 * Pindahkan `id` menjadi anak ke-`index` dari `newParentId`.
 * Sub-pohonnya ikut karena hubungan anak tidak disentuh sama sekali.
 * Mengembalikan [] bila pemindahan tidak sah (siklus / tanpa perubahan).
 */
export function moveTo(
  tasks: Task[],
  id: string,
  newParentId: string | null,
  index: number,
): Patch[] {
  const map = indexById(tasks);
  const task = map.get(id);
  if (!task) return [];
  if (newParentId === id) return [];
  if (newParentId && isDescendant(tasks, newParentId, id)) return []; // siklus

  const patches = new Map<string, Patch>();
  const oldParentId = task.parentId;

  const target = childrenOf(tasks, newParentId).filter((t) => t.id !== id);
  const clamped = Math.max(0, Math.min(index, target.length));
  target.splice(clamped, 0, task);

  if (oldParentId !== newParentId) {
    mergePatch(patches, { id, parentId: newParentId });
    renumber(
      childrenOf(tasks, oldParentId).filter((t) => t.id !== id),
      patches,
    );
    // Induk baru yang tadinya daun: buka & aktifkan roll-up (§5.2 PRD).
    if (newParentId) {
      const parent = map.get(newParentId)!;
      const wasLeaf = childrenOf(tasks, newParentId).length === 0;
      if (parent.collapsed) mergePatch(patches, { id: newParentId, collapsed: false });
      if (wasLeaf && !parent.rollup)
        mergePatch(patches, { id: newParentId, rollup: true });
    }
  }
  renumber(target, patches);

  const list = [...patches.values()];
  // Patch yang isinya cuma id (tidak ada perubahan nyata) dibuang.
  return list.filter((p) => Object.keys(p).length > 1);
}

/** Jadikan anak dari saudara tepat di atasnya. Baris pertama tidak bisa. */
export function indent(tasks: Task[], id: string): Patch[] {
  const map = indexById(tasks);
  const task = map.get(id);
  if (!task) return [];
  const siblings = childrenOf(tasks, task.parentId);
  const pos = siblings.findIndex((s) => s.id === id);
  if (pos <= 0) return [];
  const newParent = siblings[pos - 1];
  return moveTo(tasks, id, newParent.id, childrenOf(tasks, newParent.id).length);
}

/**
 * Naik satu tingkat, ditempatkan tepat setelah mantan induknya.
 * Saudara yang mengikutinya dibiarkan di tempat (perilaku ala MS Project),
 * bukan ikut jadi anak — supaya hasilnya bisa ditebak.
 */
export function outdent(tasks: Task[], id: string): Patch[] {
  const map = indexById(tasks);
  const task = map.get(id);
  if (!task?.parentId) return [];
  const parent = map.get(task.parentId)!;
  return moveTo(tasks, id, parent.parentId, parent.order + 1);
}

/** Geser satu posisi naik/turun di antara saudara sekandung. */
export function moveVertical(tasks: Task[], id: string, dir: -1 | 1): Patch[] {
  const map = indexById(tasks);
  const task = map.get(id);
  if (!task) return [];
  const siblings = childrenOf(tasks, task.parentId);
  const pos = siblings.findIndex((s) => s.id === id);
  const next = pos + dir;
  if (next < 0 || next >= siblings.length) return [];
  return moveTo(tasks, id, task.parentId, next);
}

/** Geser seluruh sub-pohon sejumlah `days` (§5.5.3 PRD). */
export function shiftSubtree(tasks: Task[], id: string, days: number): Patch[] {
  if (days === 0) return [];
  const map = indexById(tasks);
  return subtreeIds(tasks, id).map((nodeId) => {
    const t = map.get(nodeId)!;
    return {
      id: nodeId,
      start: shiftISO(t.start, days),
      end: shiftISO(t.end, days),
    };
  });
}

export interface RemovalPlan {
  removeIds: string[];
  patches: Patch[];
}

/**
 * `cascade` menghapus beserta keturunan; `promote` menaikkan anak-anaknya
 * ke posisi induk yang dihapus (§4.3 PRD).
 */
export function removeTask(
  tasks: Task[],
  id: string,
  mode: "cascade" | "promote",
): RemovalPlan {
  const map = indexById(tasks);
  const task = map.get(id);
  if (!task) return { removeIds: [], patches: [] };

  const patches = new Map<string, Patch>();
  const kids = childrenOf(tasks, id);

  if (mode === "cascade" || kids.length === 0) {
    const removeIds = subtreeIds(tasks, id);
    renumber(
      childrenOf(tasks, task.parentId).filter((t) => t.id !== id),
      patches,
    );
    return { removeIds, patches: [...patches.values()] };
  }

  const siblings = childrenOf(tasks, task.parentId).filter((t) => t.id !== id);
  siblings.splice(task.order, 0, ...kids);
  for (const k of kids) mergePatch(patches, { id: k.id, parentId: task.parentId });
  renumber(siblings, patches);
  return { removeIds: [id], patches: [...patches.values()] };
}

let counter = 0;
export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  counter += 1;
  return `t${Date.now().toString(36)}${counter}`;
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  const start = overrides.start ?? todayISO();
  return {
    id: newId(),
    parentId: null,
    order: 0,
    title: "",
    progress: 0,
    start,
    end: overrides.end ?? start,
    status: "todo",
    priority: "medium",
    collapsed: false,
    rollup: true,
    notes: "",
    repositoryPath: "",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Sisipkan task baru pada indeks tertentu di antara anak-anak `parentId`. */
function insertAt(
  tasks: Task[],
  parentId: string | null,
  index: number,
  overrides: Partial<Task>,
): { task: Task; patches: Patch[] } {
  const siblings = childrenOf(tasks, parentId);
  const at = Math.max(0, Math.min(index, siblings.length));
  const task = makeTask({ ...overrides, parentId, order: at });
  const patches = new Map<string, Patch>();
  const next = [...siblings];
  next.splice(at, 0, task);
  renumber(next, patches);
  return { task, patches: [...patches.values()].filter((p) => p.id !== task.id) };
}

/**
 * Tanggal baris baru mengikuti baris acuannya, bukan hari ini: baris yang
 * disisipkan di tengah rencana hampir selalu milik periode yang sama dengan
 * tetangganya.
 */
const inheritDates = (anchor: Task | null | undefined, overrides: Partial<Task>) =>
  anchor ? { start: anchor.start, end: anchor.start, ...overrides } : overrides;

/** Task baru sebagai saudara tepat di bawah `afterId`, atau di akhir root. */
export function insertSibling(
  tasks: Task[],
  afterId: string | null,
  overrides: Partial<Task> = {},
): { task: Task; patches: Patch[] } {
  const anchor = afterId ? indexById(tasks).get(afterId) ?? null : null;
  const parentId = anchor?.parentId ?? null;
  const index = anchor ? anchor.order + 1 : childrenOf(tasks, parentId).length;
  return insertAt(tasks, parentId, index, inheritDates(anchor, overrides));
}

/** Task baru sebagai anak terakhir dari `parentId`. */
export function insertChild(
  tasks: Task[],
  parentId: string,
  overrides: Partial<Task> = {},
): { task: Task; patches: Patch[] } {
  const map = indexById(tasks);
  const parent = map.get(parentId);
  const kids = childrenOf(tasks, parentId);
  const task = makeTask({
    ...overrides,
    parentId,
    order: kids.length,
    start: overrides.start ?? parent?.start,
    end: overrides.end ?? parent?.end,
  });
  const patches: Patch[] = [];
  if (parent?.collapsed) patches.push({ id: parentId, collapsed: false });
  if (parent && kids.length === 0 && !parent.rollup)
    patches.push({ id: parentId, rollup: true });
  return { task, patches };
}

/** Buang id yang leluhurnya juga terpilih — supaya sub-pohon tak diproses dua kali. */
export function topMost(tasks: Task[], ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => !ancestorIdsOf(tasks, id).some((a) => set.has(a)));
}

/** Terapkan daftar patch ke salinan baru dari daftar task. */
export function applyPatchList(tasks: Task[], patches: Patch[]): Task[] {
  if (patches.length === 0) return tasks;
  const merged = new Map<string, Patch>();
  for (const p of patches) merged.set(p.id, { ...merged.get(p.id), ...p });
  return tasks.map((t) => {
    const patch = merged.get(t.id);
    return patch ? { ...t, ...patch, id: t.id } : t;
  });
}
