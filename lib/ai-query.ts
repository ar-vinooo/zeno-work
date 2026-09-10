import { durationOf, todayISO } from "./dates";
import { isOverdue } from "./derive";
import { listTasks } from "./db";
import { buildOutline } from "./rollup";
import { STATUS_LABEL, type TaskNode } from "./types";

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

export function findTasks(args: FindArgs): string {
  const outline = buildOutline(listTasks());
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

export function getSubtree(wbs: string, depth = 2): string {
  const outline = buildOutline(listTasks());
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

export function runReadTool(name: string, input: unknown): string {
  const args = (input ?? {}) as FindArgs & { wbs?: string };
  if (name === "find_tasks") return findTasks(args);
  if (name === "get_subtree")
    return args.wbs ? getSubtree(args.wbs, args.depth) : "wbs wajib diisi.";
  return `Tool tidak dikenal: ${name}`;
}
