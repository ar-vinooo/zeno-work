import { shiftISO, todayISO } from "./dates";
import { makeTask } from "./tree";
import type { Task } from "./types";

interface SeedSpec {
  title: string;
  offset: number;
  days: number;
  progress?: number;
  children?: SeedSpec[];
}

const OUTLINE: SeedSpec[] = [
  {
    title: "Persiapan",
    offset: -7,
    days: 1,
    children: [
      { title: "Setup repo & tooling", offset: -7, days: 2, progress: 100 },
      {
        title: "Skema database",
        offset: -5,
        days: 1,
        children: [
          { title: "Desain tabel tasks", offset: -5, days: 3, progress: 100 },
          { title: "Migrasi awal", offset: -2, days: 3, progress: 40 },
        ],
      },
    ],
  },
  {
    title: "Implementasi",
    offset: 1,
    days: 1,
    children: [
      { title: "Tabel WBS + inline edit", offset: 1, days: 5, progress: 20 },
      { title: "Timeline & drag jadwal", offset: 6, days: 6 },
      { title: "Filter dan sorting", offset: 12, days: 3 },
    ],
  },
  { title: "Rilis v0.1", offset: 16, days: 2 },
];

/** Isi awal supaya layar pertama langsung menunjukkan bentuk aplikasinya. */
export function seedTasks(): Task[] {
  const today = todayISO();
  const out: Task[] = [];

  const walk = (specs: SeedSpec[], parentId: string | null) => {
    specs.forEach((spec, i) => {
      const start = shiftISO(today, spec.offset);
      const task = makeTask({
        parentId,
        order: i,
        title: spec.title,
        start,
        end: shiftISO(start, spec.days - 1),
        progress: spec.progress ?? 0,
        status:
          spec.progress === 100 ? "done" : spec.progress ? "in_progress" : "todo",
      });
      out.push(task);
      if (spec.children) walk(spec.children, task.id);
    });
  };

  walk(OUTLINE, null);
  return out;
}
