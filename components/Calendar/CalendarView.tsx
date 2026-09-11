"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, LocateFixed } from "lucide-react";
import { Button } from "@/components/animate-ui/components/buttons/button";
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/animate-ui/components/radix/popover";
import {
  diffDays,
  fromISO,
  monthEndISO,
  monthStartISO,
  shiftISO,
  todayISO,
  toISO,
  weekStartISO,
} from "@/lib/dates";
import { useStore } from "@/lib/store";
import { STATUS_LABEL, type Status, type TaskNode } from "@/lib/types";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MAX_VISIBLE = 4;

/**
 * Chip kalender memakai token yang SAMA dengan pil status di tabel. Dulu
 * warnanya dioplos sendiri di sini (`color-mix` 12–14% dari warna pekat), dan
 * hasilnya satu status punya dua warna berbeda tergantung kamu sedang melihat
 * tabel atau kalender.
 */
const statusStyle: Record<Status, CSSProperties> = {
  todo: {
    background: "var(--color-todo-soft)",
    borderColor: "var(--color-faint)",
  },
  in_progress: {
    background: "var(--color-progress-soft)",
    borderColor: "var(--color-bar-fill)",
  },
  blocked: {
    background: "var(--color-blocked-soft)",
    borderColor: "var(--color-blocked)",
  },
  done: {
    background: "var(--color-done-soft)",
    borderColor: "var(--color-done)",
  },
};

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
  }).format(fromISO(month));
}

function taskLabel(node: TaskNode) {
  return `${node.wbs} ${node.task.title}`;
}

export default function CalendarView({
  nodes,
  todayToken,
  onOpenTable,
}: {
  nodes: TaskNode[];
  todayToken: number;
  onOpenTable: () => void;
}) {
  const [month, setMonth] = useState(() => monthStartISO(todayISO()));
  const [leavesOnly, setLeavesOnly] = useState(true);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const selectionSet = useMemo(() => new Set(selection), [selection]);

  useEffect(() => {
    setMonth(monthStartISO(todayISO()));
  }, [todayToken]);

  const days = useMemo(() => {
    const start = weekStartISO(month);
    const monthEnd = monthEndISO(month);
    const count = Math.ceil((diffDays(start, monthEnd) + 1) / 7) * 7;
    return Array.from({ length: count }, (_, i) => shiftISO(start, i));
  }, [month]);

  const visibleNodes = useMemo(
    () =>
      leavesOnly
        ? nodes.filter((node) => node.children.length === 0)
        : nodes,
    [leavesOnly, nodes],
  );

  const byDay = useMemo(() => {
    const result = new Map<string, TaskNode[]>();
    for (const day of days) {
      result.set(
        day,
        visibleNodes.filter(
          (node) => node.eff.start <= day && node.eff.end >= day,
        ),
      );
    }
    return result;
  }, [days, visibleNodes]);

  const today = todayISO();
  const moveMonth = (delta: number) => {
    const date = fromISO(month);
    date.setMonth(date.getMonth() + delta);
    setMonth(monthStartISO(toISO(date)));
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[var(--color-canvas)]">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--color-line)] px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Bulan sebelumnya"
          onClick={() => moveMonth(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Bulan berikutnya"
          onClick={() => moveMonth(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-1 h-7 gap-1.5 text-[11px]"
          onClick={() => setMonth(monthStartISO(today))}
        >
          <LocateFixed className="size-3.5" />
          Hari ini
        </Button>
        <h2 className="ml-3 text-[14px] font-semibold capitalize">
          {monthLabel(month)}
        </h2>
        <span className="ml-2 text-[11px] text-[var(--color-faint)]">
          {visibleNodes.length} task
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-[var(--color-ink-soft)]">
          <Checkbox
            checked={leavesOnly}
            onCheckedChange={(checked) => setLeavesOnly(checked === true)}
            size="sm"
          />
          Hanya task daun
        </label>
      </div>

      <div className="grid shrink-0 grid-cols-7 border-b border-[var(--color-line)] bg-[var(--color-raised)]">
        {WEEKDAYS.map((day, index) => (
          <div
            key={day}
            className={`px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)] ${
              index > 4 ? "bg-[var(--color-canvas)]" : ""
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      <div
        className="scroll-pane grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
        style={{ gridAutoRows: "minmax(112px, 1fr)" }}
      >
        {days.map((day, index) => {
          const dayNodes = byDay.get(day) ?? [];
          const inMonth = day.slice(0, 7) === month.slice(0, 7);
          const isToday = day === today;
          const weekend = index % 7 > 4;
          return (
            <div
              key={day}
              className={`min-w-0 border-b border-r border-[var(--color-line)] p-1.5 ${
                weekend
                  ? "bg-[var(--color-raised)]/55"
                  : "bg-[var(--color-surface)]"
              } ${inMonth ? "" : "opacity-45"}`}
            >
              <div className="mb-1 flex h-5 items-center justify-between">
                <span
                  className={`flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums ${
                    isToday
                      ? "bg-[var(--color-mark)] font-semibold text-white"
                      : "text-[var(--color-ink-soft)]"
                  }`}
                >
                  {Number(day.slice(8))}
                </span>
                {dayNodes.length > 0 && (
                  <span className="text-[9px] tabular-nums text-[var(--color-faint)]">
                    {dayNodes.length}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {dayNodes.slice(0, MAX_VISIBLE).map((node) => (
                  <Button
                    key={node.task.id}
                    variant="ghost"
                    size="sm"
                    type="button"
                    className={`h-5 w-full justify-start truncate rounded border-l-2 px-1.5 text-left text-[10px] leading-5 text-[var(--color-ink)] transition-shadow hover:shadow-sm ${
                      selectionSet.has(node.task.id)
                        ? "ring-1 ring-[var(--color-mark)] ring-offset-1 ring-offset-[var(--color-surface)]"
                        : ""
                    } ${node.children.length ? "font-semibold" : ""}`}
                    style={statusStyle[node.eff.status]}
                    title={`${node.wbs} ${node.task.title} · ${STATUS_LABEL[node.eff.status]} · ${node.eff.start} → ${node.eff.end}\nKlik ganda untuk buka di tabel`}
                    onClick={(event) =>
                      select(
                        node.task.id,
                        event.metaKey || event.ctrlKey ? "toggle" : "replace",
                      )
                    }
                    onDoubleClick={onOpenTable}
                  >
                    <span className="mr-1 font-mono text-[9px] opacity-60">
                      {node.wbs}
                    </span>
                    {node.task.title}
                  </Button>
                ))}
                {dayNodes.length > MAX_VISIBLE && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        className="h-5 w-full justify-start rounded px-1 text-left text-[10px] text-[var(--color-mark)] hover:bg-[var(--color-raised)]"
                        title={`Lihat semua task tanggal ${day}`}
                      >
                        +{dayNodes.length - MAX_VISIBLE} lainnya
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="right"
                      className="max-h-80 w-[calc(100vw-2rem)] max-w-[24rem] overflow-y-auto border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-[11px] text-[var(--color-ink)] sm:w-96"
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-3 border-b border-[var(--color-line)] pb-1.5">
                        <div className="font-semibold">{day}</div>
                        <div className="num text-[var(--color-faint)]">
                          {dayNodes.length} task
                        </div>
                      </div>
                      <div className="space-y-1">
                        {dayNodes.map((node) => (
                          <Button
                            key={node.task.id}
                            variant="ghost"
                            size="sm"
                            type="button"
                            className={`h-auto w-full justify-start rounded border-l-2 px-2 py-1 text-left transition-colors hover:bg-[var(--color-raised)] ${
                              selectionSet.has(node.task.id)
                                ? "ring-1 ring-[var(--color-mark)]"
                                : ""
                            } ${node.children.length ? "font-semibold" : ""}`}
                            style={statusStyle[node.eff.status]}
                            title={`${taskLabel(node)} · ${STATUS_LABEL[node.eff.status]} · ${node.eff.start} → ${node.eff.end}\nKlik ganda untuk buka di tabel`}
                            onClick={(event) =>
                              select(
                                node.task.id,
                                event.metaKey || event.ctrlKey
                                  ? "toggle"
                                  : "replace",
                              )
                            }
                            onDoubleClick={onOpenTable}
                          >
                            <span className="mr-1 font-mono text-[10px] opacity-60">
                              {node.wbs}
                            </span>
                            {node.task.title}
                            <span className="ml-1 text-[10px] text-[var(--color-ink-soft)]">
                              · {STATUS_LABEL[node.eff.status]}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
