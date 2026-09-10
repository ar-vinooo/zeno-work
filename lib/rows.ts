import { todayISO } from "./dates";
import { isActive, isOverdue } from "./derive";
import { buildOutline, type Outline } from "./rollup";
import type { Filters, Row, SortSpec, Status, Task, TaskNode } from "./types";
import { weekStartISO, shiftISO, rangeBounds, type RangeKind } from "./dates";

export interface Stats {
  total: number;
  leaves: number;
  byStatus: Record<Status, number>;
  overdue: number;
  avgProgress: number;
  thisWeek: number;
}

const filterActive = (f: Filters) =>
  f.query.trim() !== "" ||
  f.range !== "all" ||
  f.status.length > 0 ||
  f.priority.length > 0 ||
  f.hideDone ||
  f.overdueOnly ||
  f.activeOnly;

function matches(node: TaskNode, f: Filters, today: string): boolean {
  const q = f.query.trim().toLowerCase();
  if (q && !node.task.title.toLowerCase().includes(q) && !node.wbs.startsWith(q))
    return false;
  if (f.range !== "all") {
    // Cocok bila rentang task beririsan dengan periode, bukan harus termuat
    // penuh. Varian "-onward" membuang batas akhirnya: apa pun yang belum
    // selesai sebelum periode dimulai ikut tampil, sejauh apa pun ke depan.
    const onward = f.range.endsWith("-onward");
    const kind = (onward ? f.range.slice(0, -"-onward".length) : f.range) as RangeKind;
    const [from, to] = rangeBounds(kind, today);
    if (node.eff.end < from) return false;
    if (!onward && node.eff.start > to) return false;
  }
  if (f.status.length && !f.status.includes(node.eff.status)) return false;
  if (f.priority.length && !f.priority.includes(node.task.priority)) return false;
  if (f.hideDone && node.eff.status === "done") return false;
  if (f.overdueOnly && !isOverdue(node.eff, today)) return false;
  if (f.activeOnly && !isActive(node.eff, today)) return false;
  return true;
}

export interface RowsResult {
  rows: Row[];
  /** Node yang benar-benar cocok dengan filter, tanpa leluhur konteks. */
  matchedNodes: TaskNode[];
  outline: Outline;
  stats: Stats;
  filtering: boolean;
}

/**
 * Susun baris yang benar-benar digambar: hierarki → collapse → filter.
 *
 * Saat filter aktif, `collapsed` diabaikan dan seluruh leluhur dari baris yang
 * cocok ikut ditampilkan sebagai konteks (§5.6 PRD) — kalau tidak, hasil
 * pencarian bisa tersembunyi di dalam induk yang kebetulan tertutup.
 */
export function computeRows(
  tasks: Task[],
  sort: SortSpec,
  filters: Filters,
): RowsResult {
  const today = todayISO();
  const outline = buildOutline(tasks, sort);
  const filtering = filterActive(filters);

  const matched = new Set<string>();
  const visible = new Set<string>();
  if (filtering) {
    for (const node of outline.all)
      if (matches(node, filters, today)) matched.add(node.task.id);
    const mark = (node: TaskNode, ancestors: string[]) => {
      if (matched.has(node.task.id)) {
        visible.add(node.task.id);
        for (const a of ancestors) visible.add(a);
      }
      for (const c of node.children) mark(c, [...ancestors, node.task.id]);
    };
    for (const root of outline.roots) mark(root, []);
  }

  const matchedNodes = filtering
    ? outline.all.filter((node) => matched.has(node.task.id))
    : outline.all;

  const rows: Row[] = [];
  const walk = (nodes: TaskNode[]) => {
    for (const node of nodes) {
      const id = node.task.id;
      if (filtering && !visible.has(id)) continue;
      rows.push({ ...node, contextOnly: filtering && !matched.has(id) });
      if (filtering || !node.task.collapsed) walk(node.children);
    }
  };
  walk(outline.roots);

  const byStatus: Record<Status, number> = {
    todo: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
  };
  let overdue = 0;
  let activeSum = 0;
  let activeCount = 0;
  let thisWeek = 0;
  const weekStart = weekStartISO(today);
  const weekEnd = shiftISO(weekStart, 6);

  for (const node of outline.all) {
    // Hitung daun saja supaya induk tidak dihitung dobel dengan anaknya.
    if (node.children.length > 0) continue;
    byStatus[node.eff.status] += 1;
    if (isOverdue(node.eff, today)) overdue += 1;
    if (isActive(node.eff, today)) {
      activeSum += node.eff.progress;
      activeCount += 1;
    }
    if (node.eff.start <= weekEnd && node.eff.end >= weekStart) thisWeek += 1;
  }

  return {
    rows,
    matchedNodes,
    outline,
    filtering,
    stats: {
      total: outline.all.length,
      leaves: outline.all.filter((n) => n.children.length === 0).length,
      byStatus,
      overdue,
      avgProgress: activeCount ? Math.round(activeSum / activeCount) : 0,
      thisWeek,
    },
  };
}
