import { durationOf, todayISO } from "./dates";
import { isOverdue } from "./derive";
import { listTasks } from "./db";
import { buildOutline } from "./rollup";
import { STATUS_LABEL, type Task, type TaskNode } from "./types";

const line = (n: TaskNode, today: string) =>
  `${n.wbs}\t${n.task.title}\t${n.eff.progress}%\t${n.eff.start}..${n.eff.end}\t${durationOf(n.eff.start, n.eff.end)}h\t${STATUS_LABEL[n.eff.status]}${
    n.children.length ? "\t[induk]" : ""
  }${isOverdue(n.eff, today) ? "\t[OVERDUE]" : ""}`;

/** true bila `wbs` berada di dalam cabang `scope` (atau memang cabang itu). */
const inScope = (wbs: string, scope: string) =>
  wbs === scope || wbs.startsWith(`${scope}.`);

export interface FindArgs {
  query?: string;
  scope_wbs?: string;
  status?: string;
  overdue?: boolean;
  depth?: number;
  limit?: number;
}

export interface TreeSearchArgs {
  query?: string;
  scope_wbs?: string;
  depth?: number;
  limit?: number;
}

function ancestorsOf(nodes: TaskNode[], wbs: string): Set<string> {
  const out = new Set<string>();
  for (const node of nodes) {
    if (wbs.startsWith(`${node.wbs}.`)) out.add(node.wbs);
  }
  return out;
}

const relativeDepth = (wbs: string, scope?: string) =>
  scope && inScope(wbs, scope)
    ? wbs.slice(scope.length).split(".").filter(Boolean).length
    : wbs.split(".").length - 1;

export function treeSearch(args: TreeSearchArgs, tasks: Task[] = listTasks()): string {
  const outline = buildOutline(tasks);
  const q = (args.query ?? "").trim().toLowerCase();
  const scope = args.scope_wbs?.trim();
  const depth = Math.max(1, Math.min(args.depth ?? 2, 3));
  const limit = Math.max(1, Math.min(args.limit ?? 80, 160));

  const scoped = outline.all.filter((node) => !scope || inScope(node.wbs, scope));
  const matches = q
    ? scoped.filter(
        (node) =>
          node.wbs.startsWith(q) || node.task.title.toLowerCase().includes(q),
      )
    : scoped.filter((node) => relativeDepth(node.wbs, scope) < depth);

  const visible = new Set<string>();
  for (const node of matches) {
    visible.add(node.wbs);
    for (const wbs of ancestorsOf(outline.all, node.wbs)) {
      if (!scope || inScope(wbs, scope)) visible.add(wbs);
    }
    if (q) {
      for (const child of scoped) {
        if (child.wbs.startsWith(`${node.wbs}.`) && relativeDepth(child.wbs, node.wbs) < depth)
          visible.add(child.wbs);
      }
    }
  }

  const shown = outline.all
    .filter((node) => visible.has(node.wbs))
    .slice(0, limit)
    .map((node) => {
      const indent = "  ".repeat(Math.min(2, relativeDepth(node.wbs, scope)));
      const kids = node.children.length ? `, ${node.children.length} sub` : "";
      return `${indent}${node.wbs} ${node.task.title} — ${node.eff.progress}%, ${node.eff.start}..${node.eff.end}${kids}`;
    });

  if (shown.length === 0) return "Tidak ada cabang yang cocok.";
  const total = visible.size;
  const more = total > limit ? `\n... ${total - limit} baris lain tidak ditampilkan.` : "";
  return `Peta WBS (${shown.length} baris):\n${shown.join("\n")}${more}`;
}

export function findTasks(args: FindArgs, tasks: Task[] = listTasks()): string {
  const outline = buildOutline(tasks);
  const today = todayISO();
  const q = (args.query ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(args.limit ?? 40, 120));

  const hits = outline.all.filter((n) => {
    if (q && !n.task.title.toLowerCase().includes(q) && !n.wbs.startsWith(q))
      return false;
    if (args.scope_wbs && !inScope(n.wbs, args.scope_wbs)) return false;
    if (args.status && n.eff.status !== args.status) return false;
    if (args.overdue && !isOverdue(n.eff, today)) return false;
    if (args.depth && n.depth + 1 !== args.depth) return false;
    return true;
  });

  if (hits.length === 0) return "Tidak ada yang cocok.";
  const shown = hits.slice(0, limit).map((n) => line(n, today));
  const more =
    hits.length > limit ? `\n… ${hits.length - limit} lainnya tidak ditampilkan.` : "";
  return `${hits.length} hasil:\n${shown.join("\n")}${more}`;
}

export function getSubtree(wbs: string, depth = 2, tasks: Task[] = listTasks()): string {
  const outline = buildOutline(tasks);
  const today = todayISO();
  const root = outline.all.find((n) => n.wbs === wbs);
  if (!root) return `Tidak ada baris bernomor ${wbs}.`;

  const out: string[] = [];
  const walk = (node: TaskNode, level: number) => {
    out.push(line(node, today));
    if (level >= depth) return;
    for (const c of node.children) walk(c, level + 1);
  };
  walk(root, 0);
  return `${out.length} baris di cabang ${wbs}:\n${out.join("\n")}`;
}

export function runReadTool(name: string, input: unknown, tasks: Task[] = listTasks()): string {
  const args = (input ?? {}) as FindArgs & { wbs?: string };
  if (name === "tree_search") return treeSearch(args, tasks);
  if (name === "find_tasks") return findTasks(args, tasks);
  if (name === "get_subtree")
    return args.wbs ? getSubtree(args.wbs, args.depth, tasks) : "wbs wajib diisi.";
  return `Tool tidak dikenal: ${name}`;
}
