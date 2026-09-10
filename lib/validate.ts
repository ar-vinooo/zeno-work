import type { Patch, Status, Task } from "./types";

const STATUSES: Status[] = ["todo", "in_progress", "blocked", "done"];
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Aturan §4.5 PRD, dipakai di halaman (optimistis) DAN di proses utama (sumber
 * kebenaran) supaya keduanya tidak pernah berbeda hasil.
 */
export function applyRules(current: Task, patch: Patch): Patch {
  const next: Patch = { ...patch };

  if (next.progress !== undefined) next.progress = clamp(next.progress);
  if (next.status !== undefined && !STATUSES.includes(next.status))
    delete next.status;

  const status = next.status ?? current.status;
  const progress = next.progress ?? current.progress;

  // status → progress
  if (next.status === "done") next.progress = 100;
  // progress → status
  else if (next.progress === 100 && status !== "blocked") next.status = "done";
  else if (
    next.progress !== undefined &&
    next.progress < 100 &&
    current.status === "done" &&
    next.status === undefined
  )
    next.status = progress > 0 ? "in_progress" : "todo";

  // end >= start. Ujung yang TIDAK sedang diedit yang mengalah.
  let start = next.start ?? current.start;
  let end = next.end ?? current.end;
  if (end < start) {
    if (next.end !== undefined && next.start === undefined) start = end;
    else end = start;
    next.start = start;
    next.end = end;
  }

  if (next.title !== undefined) next.title = next.title.trim();
  return next;
}

export function isTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.start === "string" &&
    typeof t.end === "string" &&
    (t.parentId === null || typeof t.parentId === "string")
  );
}

/** Buang parentId yatim dan putuskan siklus sebelum data masuk DB. */
export function sanitizeImport(tasks: Task[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.map((t) => {
    let parentId = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    const seen = new Set<string>([t.id]);
    let cursor = parentId;
    while (cursor) {
      if (seen.has(cursor)) {
        parentId = null; // siklus
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return { ...t, parentId };
  });
}
