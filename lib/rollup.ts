import { durationOf, maxISO, minISO } from "./dates";
import { sortSiblings } from "./sort";
import type { Effective, SortSpec, Task, TaskNode } from "./types";

/**
 * Nilai efektif satu induk dari anak-anaknya (§4.3 PRD):
 * progres berbobot durasi, rentang = gabungan anak, status diturunkan.
 */
function rollupOf(children: TaskNode[]): Effective {
  let weighted = 0;
  let totalDays = 0;
  let start = children[0].eff.start;
  let end = children[0].eff.end;
  let allDone = true;
  let anyBlocked = false;
  let anyStarted = false;

  for (const c of children) {
    const days = Math.max(1, durationOf(c.eff.start, c.eff.end));
    weighted += c.eff.progress * days;
    totalDays += days;
    start = minISO(start, c.eff.start);
    end = maxISO(end, c.eff.end);
    if (c.eff.status !== "done") allDone = false;
    if (c.eff.status === "blocked") anyBlocked = true;
    if (c.eff.status !== "todo") anyStarted = true;
  }

  const status = allDone
    ? "done"
    : anyBlocked
      ? "blocked"
      : anyStarted
        ? "in_progress"
        : "todo";

  return {
    progress: totalDays ? Math.round(weighted / totalDays) : 0,
    start,
    end,
    status,
  };
}

export interface Outline {
  roots: TaskNode[];
  /** Seluruh node dalam urutan tampilan, mengabaikan collapsed. */
  all: TaskNode[];
  byId: Map<string, TaskNode>;
}

/**
 * Rangkai daftar datar jadi pohon bernomor.
 *
 * Urutan langkah penting: eff dihitung SEBELUM sorting, karena sorting
 * berdasarkan Start/End/Progress memakai nilai roll-up induk — kalau dibalik,
 * induk akan diurutkan memakai nilai yang belum ada.
 */
export function buildOutline(tasks: Task[], sort: SortSpec): Outline {
  const kids = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const list = kids.get(t.parentId);
    if (list) list.push(t);
    else kids.set(t.parentId, [t]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.order - b.order);

  const build = (task: Task): TaskNode => {
    const children = (kids.get(task.id) ?? []).map(build);
    const own: Effective = {
      progress: task.progress,
      start: task.start,
      end: task.end,
      status: task.status,
    };
    const derived = children.length > 0 && task.rollup;
    return {
      task,
      children,
      depth: 0,
      wbs: "",
      eff: derived ? rollupOf(children) : own,
      derived,
    };
  };

  let roots = (kids.get(null) ?? []).map(build);
  roots = sortSiblings(roots, sort);

  const all: TaskNode[] = [];
  const byId = new Map<string, TaskNode>();
  const label = (nodes: TaskNode[], prefix: string, depth: number) => {
    nodes.forEach((node, i) => {
      node.depth = depth;
      node.wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      all.push(node);
      byId.set(node.task.id, node);
      label(node.children, node.wbs, depth + 1);
    });
  };
  label(roots, "", 0);

  return { roots, all, byId };
}
