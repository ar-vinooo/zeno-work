"use client";

import { useMemo, type CSSProperties } from "react";
import { CalendarRange, CheckCircle2, CircleAlert, Layers3 } from "lucide-react";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  Progress,
  ProgressIndicator,
} from "@/components/animate-ui/components/radix/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip";
import { durationOf } from "@/lib/dates";
import { isOverdue } from "@/lib/derive";
import { useStore } from "@/lib/store";
import { STATUS_LABEL, type Status, type TaskNode } from "@/lib/types";

const statusStyle: Record<Status, CSSProperties> = {
  todo: {
    background: "var(--color-todo-soft)",
    color: "var(--color-todo-ink)",
  },
  in_progress: {
    background: "var(--color-progress-soft)",
    color: "var(--color-progress-ink)",
  },
  blocked: {
    background: "var(--color-blocked-soft)",
    color: "var(--color-blocked-ink)",
  },
  done: {
    background: "var(--color-done-soft)",
    color: "var(--color-done-ink)",
  },
};

function countNodes(node: TaskNode): { total: number; leaves: number } {
  let total = 1;
  let leaves = node.children.length === 0 ? 1 : 0;
  for (const child of node.children) {
    const count = countNodes(child);
    total += count.total;
    leaves += count.leaves;
  }
  return { total, leaves };
}

function hasMatch(node: TaskNode, matchedIds: Set<string>): boolean {
  if (matchedIds.has(node.task.id)) return true;
  return node.children.some((child) => hasMatch(child, matchedIds));
}

export default function SummaryView({
  nodes,
  matchedNodes,
  filtering,
  onFocusTask,
}: {
  nodes: TaskNode[];
  matchedNodes: TaskNode[];
  filtering: boolean;
  onFocusTask: (id: string) => void;
}) {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const matchedIds = useMemo(
    () => new Set(matchedNodes.map((node) => node.task.id)),
    [matchedNodes],
  );
  const cards = useMemo(
    () =>
      filtering
        ? nodes.filter((node) => hasMatch(node, matchedIds))
        : nodes,
    [filtering, matchedIds, nodes],
  );

  if (cards.length === 0) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-[var(--color-canvas)] px-8 text-center text-[13px] text-[var(--color-ink-soft)]">
        Tidak ada summary yang cocok dengan filter.
      </section>
    );
  }

  return (
    <section className="scroll-pane min-h-0 flex-1 overflow-y-auto bg-[var(--color-canvas)] p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {cards.map((node) => {
          const count = countNodes(node);
          const overdue = isOverdue(node.eff);
          return (
            <Tooltip key={node.task.id} delayDuration={250}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={`flex h-auto min-h-44 w-full flex-col items-stretch justify-start gap-0 whitespace-normal rounded-lg border bg-[var(--color-surface)] p-3 text-left shadow-sm transition hover:border-[var(--color-mark)] hover:bg-[var(--color-surface)] hover:shadow border-[var(--color-line)]`}
                  onClick={() => {
                    select(node.task.id, "replace");
                    onFocusTask(node.task.id);
                  }}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-raised)] font-mono text-[13px] font-semibold text-[var(--color-mark)]">
                      {node.wbs}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="max-h-10 overflow-hidden text-[14px] font-semibold leading-5 text-[var(--color-ink)]">
                        {node.task.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={statusStyle[node.eff.status]}
                        >
                          {STATUS_LABEL[node.eff.status]}
                        </span>
                        {overdue && (
                          <span className="rounded bg-[var(--color-blocked-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-blocked-ink)]">
                            Overdue
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="mb-1 flex items-end justify-between">
                      <span className="text-[11px] text-[var(--color-ink-soft)]">
                        Progress
                      </span>
                      <span className="font-mono text-[24px] font-semibold leading-none text-[var(--color-ink)]">
                        {node.eff.progress}%
                      </span>
                    </div>
                    <Progress
                      value={node.eff.progress}
                      className="h-2 bg-[var(--color-bar-track)]"
                    >
                      <ProgressIndicator className="bg-[var(--color-bar)]" />
                    </Progress>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--color-ink-soft)]">
                    <div className="rounded-md bg-[var(--color-raised)] px-2 py-1.5">
                      <div className="mb-0.5 flex items-center gap-1 text-[var(--color-faint)]">
                        <CalendarRange className="size-3" />
                        Jadwal
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-ink)]">
                        {node.eff.start}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-ink)]">
                        {node.eff.end}
                      </div>
                    </div>
                    <div className="rounded-md bg-[var(--color-raised)] px-2 py-1.5">
                      <div className="mb-0.5 flex items-center gap-1 text-[var(--color-faint)]">
                        <Layers3 className="size-3" />
                        Isi
                      </div>
                      <div className="text-[var(--color-ink)]">
                        {count.total - 1} sub-task
                      </div>
                      <div className="text-[var(--color-ink)]">
                        {count.leaves} daun
                      </div>
                    </div>
                    <div className="rounded-md bg-[var(--color-raised)] px-2 py-1.5">
                      <div className="mb-0.5 flex items-center gap-1 text-[var(--color-faint)]">
                        <CheckCircle2 className="size-3" />
                        Durasi
                      </div>
                      <div className="font-mono text-[var(--color-ink)]">
                        {durationOf(node.eff.start, node.eff.end)} hari
                      </div>
                    </div>
                    <div className="rounded-md bg-[var(--color-raised)] px-2 py-1.5">
                      <div className="mb-0.5 flex items-center gap-1 text-[var(--color-faint)]">
                        <CircleAlert className="size-3" />
                        Prioritas
                      </div>
                      <div className="capitalize text-[var(--color-ink)]">
                        {node.task.priority}
                      </div>
                    </div>
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-72 bg-[var(--color-ink)] text-[var(--color-surface)]"
              >
                <div className="font-mono text-[10px]">{node.wbs}</div>
                <div className="text-[11px]">
                  Klik untuk fokus cabang ini di tabel.
                </div>
                <div className="mt-1 text-[10px] opacity-80">
                  {STATUS_LABEL[node.eff.status]} · {node.eff.start} sampai{" "}
                  {node.eff.end}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </section>
  );
}
