import type { SortSpec, Status, TaskNode } from "./types";

const STATUS_RANK: Record<Status, number> = {
  todo: 0,
  in_progress: 1,
  blocked: 2,
  done: 3,
};

const PRIORITY_RANK = { low: 0, medium: 1, high: 2 } as const;

function compare(a: TaskNode, b: TaskNode, spec: SortSpec): number {
  switch (spec.column) {
    case "title":
      return a.task.title.localeCompare(b.task.title, "id");
    case "progress":
      return a.eff.progress - b.eff.progress;
    case "start":
      return a.eff.start.localeCompare(b.eff.start);
    case "end":
      return a.eff.end.localeCompare(b.eff.end);
    case "status":
      return STATUS_RANK[a.eff.status] - STATUS_RANK[b.eff.status];
    case "priority":
      return PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
    default:
      return a.task.order - b.task.order;
  }
}

/**
 * Sorting hanya di antara saudara sekandung, rekursif (§5.3 PRD).
 * Hierarki tidak pernah rata: blok 1.x selalu tetap berada di bawah 1.
 * Mode ini murni tampilan — `order` tersimpan tidak disentuh.
 */
export function sortSiblings(nodes: TaskNode[], spec: SortSpec): TaskNode[] {
  if (spec.column === "manual") return nodes;
  const factor = spec.dir === "desc" ? -1 : 1;
  const sorted = [...nodes].sort((a, b) => {
    const primary = compare(a, b, spec) * factor;
    return primary !== 0 ? primary : a.task.order - b.task.order;
  });
  for (const n of sorted) n.children = sortSiblings(n.children, spec);
  return sorted;
}
