"use client";

import { memo } from "react";
import { INDENT, ROW_H, widthOf } from "./layout";
import { Editable, ProgressTrack } from "./cells";
import DateCell from "./DateCell";
import Bar from "../Timeline/Bar";
import {
  durationOf,
  parseDurationInput,
  shiftISO,
  todayISO,
} from "@/lib/dates";
import { isOverdue } from "@/lib/derive";
import { applyPreview } from "@/lib/preview";
import { xForDate, type Scale } from "@/lib/schedule";
import { useStore, type CellRef, type DragMode } from "@/lib/store";
import { STATUS_LABEL } from "@/lib/types";
import type { Row, Status } from "@/lib/types";

interface Props {
  row: Row;
  scale: Scale;
  timelineWidth: number;
  gridStyle: React.CSSProperties;
  showDuration: boolean;
  selected: boolean;
  editing: CellRef | null;
  onEdit: (cell: CellRef | null) => void;
  onNavigate: (id: string, field: CellRef["field"], dir: 1 | -1) => void;
  onEnterRow: (id: string) => void;
  onSelect: (event: React.MouseEvent, id: string) => void;
  onRowDragStart: (event: React.PointerEvent, id: string) => void;
  onRequestDelete: (id: string) => void;
  onBarDrag: (event: React.PointerEvent, id: string, mode: DragMode) => void;
}

const STATUS_DOT: Record<Status, string> = {
  todo: "var(--color-faint)",
  in_progress: "var(--color-bar-fill)",
  blocked: "var(--color-blocked)",
  done: "var(--color-done)",
};

function TaskRow({
  row,
  scale,
  timelineWidth,
  gridStyle,
  showDuration,
  selected,
  editing,
  onEdit,
  onNavigate,
  onEnterRow,
  onSelect,
  onRowDragStart,
  onRequestDelete,
  onBarDrag,
}: Props) {
  const patchTask = useStore((s) => s.patchTask);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  const addChildOf = useStore((s) => s.addChildOf);
  const addSiblingAfter = useStore((s) => s.addSiblingAfter);
  const preview = useStore((s) => s.preview);
  const aiEdited = useStore((s) => s.aiTouched.includes(row.task.id));

  const { task } = row;
  const display = applyPreview(row.eff, task.id, preview);
  const previewing =
    !!preview && preview.days !== 0 && preview.ids.includes(task.id);
  const isPrimary = previewing && preview!.ids[0] === task.id;
  const overdue = isOverdue(display);
  const hasChildren = row.children.length > 0;
  const readOnly = row.derived;
  const today = todayISO();
  // Latar berdasarkan tingkat, dipakai baris sekaligus panel kirinya yang
  // menempel — keduanya harus sewarna supaya pitanya tidak terputus saat
  // timeline digeser mendatar.
  // Urutan: pilihan menang atas tanda AI, tanda AI menang atas warna tingkat.
  // Baris yang baru diubah AI memang harus menonjol sampai kamu menyimpannya.
  const background = selected
    ? "var(--color-selected)"
    : aiEdited
      ? "var(--color-ai)"
      : row.depth === 0
        ? "var(--color-level-1)"
        : row.depth === 1
          ? "var(--color-level-2)"
          : "var(--color-surface)";
  const todayX = xForDate(scale, today);

  const cell = (field: CellRef["field"]) =>
    editing?.id === task.id && editing.field === field;

  return (
    <div
      className="row flex no-select"
      style={{
        height: ROW_H,
        background,
        opacity: row.contextOnly ? 0.5 : 1,
      }}
      onMouseDown={(e) => onSelect(e, task.id)}
    >
      <div
        className="sticky left-0 z-10 flex border-b border-[var(--color-line)]"
        style={{
          width: "var(--col-left)",
          background,
          boxShadow: aiEdited
            ? "inset 3px 0 0 0 var(--color-ai-edge)"
            : undefined,
        }}
        title={aiEdited ? "Diubah asisten AI, belum disimpan" : undefined}
      >
        {/* Action: tombol baris, muncul saat baris di-hover */}
        <div
          className="cell shrink-0 gap-0.5 text-[11px] text-[var(--color-faint)]"
          style={{ width: widthOf("action") }}
        >
          <button
            className="w-3 shrink-0 text-center text-[11px] leading-none opacity-0 transition-opacity hover:text-[var(--color-mark)] [.row:hover_&]:opacity-100"
            title={`Tambah sub-task di dalam baris ini (jadi ${row.wbs}.${
              row.children.length + 1
            })`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              addChildOf(task.id);
            }}
          >
            ⤷
          </button>
          <button
            className="w-3 shrink-0 text-center text-[11px] leading-none opacity-0 transition-opacity hover:text-[var(--color-mark)] [.row:hover_&]:opacity-100"
            title={`Tambah baris setingkat setelah ini (jadi ${row.wbs
              .split(".")
              .slice(0, -1)
              .concat(String(Number(row.wbs.split(".").pop()) + 1))
              .join(".")})`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              addSiblingAfter(task.id);
            }}
          >
            ⤓
          </button>
          <button
            className="w-3 shrink-0 text-center text-[13px] leading-none opacity-0 transition-opacity hover:text-[var(--color-blocked)] [.row:hover_&]:opacity-100"
            title="Hapus baris ini"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete(task.id);
            }}
          >
            ×
          </button>
        </div>

        {/* Nomor WBS + expand/collapse, sekaligus handle pemindah baris */}
        <div
          className="cell num shrink-0 gap-0.5 border-l border-[var(--color-line)] text-[11px] text-[var(--color-faint)]"
          style={{ width: widthOf("wbs") }}
        >
          <button
            className={`w-3 shrink-0 text-center ${hasChildren ? "" : "invisible"}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse(task.id);
            }}
            title={task.collapsed ? "Buka sub-task" : "Tutup sub-task"}
          >
            {task.collapsed ? "▸" : "▾"}
          </button>
          <span
            className="cursor-grab truncate hover:text-[var(--color-ink)]"
            title="Geser nomor ini untuk memindahkan baris beserta sub-task-nya"
            onPointerDown={(e) => onRowDragStart(e, task.id)}
          >
            {row.wbs}
          </span>
        </div>

        {/* Task */}
        <div
          className="cell shrink-0 border-l border-[var(--color-line)]"
          style={{ width: widthOf("title") }}
        >
          <div
            style={{ paddingLeft: row.depth * INDENT }}
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: STATUS_DOT[display.status] }}
            />
            <Editable
              value={task.title}
              editing={cell("title")}
              placeholder="Tanpa judul"
              className={hasChildren ? "font-medium" : ""}
              onStart={() => onEdit({ id: task.id, field: "title" })}
              onCommit={(raw) => {
                onEdit(null);
                if (raw.trim() && raw.trim() !== task.title)
                  patchTask(task.id, { title: raw });
              }}
              onCancel={() => onEdit(null)}
              onNavigate={(dir) => onNavigate(task.id, "title", dir)}
              onEnter={() => onEnterRow(task.id)}
            />
          </div>
        </div>

        {/* Progress */}
        <div
          className="cell shrink-0 gap-1.5 border-l border-[var(--color-line)]"
          style={{ width: widthOf("progress") }}
        >
          <ProgressTrack
            value={display.progress}
            readOnly={readOnly}
            onChange={(v) => patchTask(task.id, { progress: v })}
          >
            <span />
          </ProgressTrack>
          <div className="w-8 shrink-0 text-right text-[11px]">
            <Editable
              value={String(display.progress)}
              editing={cell("progress")}
              align="right"
              readOnly={readOnly}
              title={readOnly ? "Progres induk dihitung dari sub-task-nya" : undefined}
              className={readOnly ? "text-[var(--color-faint)]" : ""}
              render={() => `${display.progress}%`}
              onStart={() => onEdit({ id: task.id, field: "progress" })}
              onCommit={(raw) => {
                onEdit(null);
                const n = Number(raw.replace("%", "").trim());
                if (Number.isFinite(n)) patchTask(task.id, { progress: n });
              }}
              onCancel={() => onEdit(null)}
              onNavigate={(dir) => onNavigate(task.id, "progress", dir)}
            />
          </div>
        </div>

        {/* Status */}
        <div
          className="cell shrink-0 border-l border-[var(--color-line)]"
          style={{ width: widthOf("status") }}
        >
          {readOnly ? (
            <span
              className="text-[11px] text-[var(--color-faint)]"
              title="Dihitung dari sub-task"
            >
              {STATUS_LABEL[display.status]}
            </span>
          ) : (
            <select
              className="bare cursor-pointer text-[11px]"
              value={task.status}
              onChange={(e) =>
                patchTask(task.id, { status: e.target.value as Status })
              }
              onMouseDown={(e) => e.stopPropagation()}
            >
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Start & End */}
        {(["start", "end"] as const).map((field) => (
          <div
            key={field}
            className="cell shrink-0 border-l border-[var(--color-line)] text-[11px]"
            style={{ width: widthOf(field) }}
          >
            <DateCell
              value={display[field]}
              editing={cell(field)}
              readOnly={readOnly}
              overdue={field === "end" && overdue}
              onStart={() => onEdit({ id: task.id, field })}
              onEnd={() => onEdit(null)}
              onChange={(iso) => patchTask(task.id, { [field]: iso })}
              onNavigate={(dir) => onNavigate(task.id, field, dir)}
            />
          </div>
        ))}

        {/* Duration (opsional) */}
        {showDuration && (
          <div
            className="cell num shrink-0 border-l border-[var(--color-line)] text-[11px]"
            style={{ width: widthOf("duration") }}
          >
            <Editable
              value={String(durationOf(display.start, display.end))}
              editing={cell("duration")}
              align="right"
              readOnly={readOnly}
              render={() => `${durationOf(display.start, display.end)}h`}
              className={readOnly ? "text-[var(--color-faint)]" : ""}
              onStart={() => onEdit({ id: task.id, field: "duration" })}
              onCommit={(raw) => {
                onEdit(null);
                const days = parseDurationInput(raw);
                if (days)
                  patchTask(task.id, { end: shiftISO(task.start, days - 1) });
              }}
              onCancel={() => onEdit(null)}
              onNavigate={(dir) => onNavigate(task.id, "duration", dir)}
            />
          </div>
        )}
      </div>

      {/* Date range */}
      <div
        className="relative shrink-0 border-b border-[var(--color-line)]"
        style={{ width: timelineWidth, ...gridStyle }}
      >
        <div
          className="pointer-events-none absolute inset-y-0 w-px"
          style={{ left: todayX, background: "var(--color-mark)", opacity: 0.7 }}
        />
        <Bar
          row={row}
          scale={scale}
          eff={row.eff}
          display={display}
          previewing={previewing}
          showTooltip={isPrimary}
          deltaDays={preview?.days ?? 0}
          onBegin={(e, mode) => onBarDrag(e, task.id, mode)}
        />
      </div>
    </div>
  );
}

export default memo(TaskRow);
