"use client";

import { memo, useState } from "react";
import { FolderGit2, RefreshCw, Unlink } from "lucide-react";
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
import { zeno } from "@/lib/bridge";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { RepositorySummary } from "@/lib/repository";
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

/**
 * Status digambar sebagai pil berwarna, bukan teks polos: dalam tabel sepadat
 * ini warna terbaca lebih dulu daripada kata, jadi "mana yang belum jalan"
 * terjawab tanpa membaca satu kolom pun.
 */
const STATUS_PILL: Record<Status, { bg: string; fg: string; dot: string }> = {
  // `dot` dipakai dua tempat: di dalam pil, dan di kolom Task yang latarnya
  // warna baris — jadi titiknya memakai warna pekat, bukan warna teks pil.
  todo: {
    bg: "var(--color-todo-soft)",
    fg: "var(--color-todo-ink)",
    dot: "var(--color-ink-soft)",
  },
  in_progress: {
    bg: "var(--color-progress-soft)",
    fg: "var(--color-progress-ink)",
    dot: "var(--color-bar-fill)",
  },
  blocked: {
    bg: "var(--color-blocked-soft)",
    fg: "var(--color-blocked-ink)",
    dot: "var(--color-blocked)",
  },
  done: {
    bg: "var(--color-done-soft)",
    fg: "var(--color-done-ink)",
    dot: "var(--color-done)",
  },
};

/**
 * Warna latar status mengikuti kemajuan nyata, bukan status yang terakhir
 * dipilih. Dengan begitu 0% selalu terasa sebagai Todo, progres parsial
 * sebagai Jalan, dan 100% sebagai Done. Status Blocked tetap dipertahankan
 * sebagai teks/titik merah agar hambatan tidak hilang dari informasi task.
 */
function backgroundStatus(progress: number): Exclude<Status, "blocked"> {
  if (progress <= 0) return "todo";
  if (progress >= 100) return "done";
  return "in_progress";
}

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
  const setFocusRoot = useStore((s) => s.setFocusRoot);
  const preview = useStore((s) => s.preview);
  const aiEdited = useStore((s) => s.aiTouched.includes(row.task.id));

  const { task } = row;
  const [repoOpen, setRepoOpen] = useState(false);
  const [repoSummary, setRepoSummary] = useState<RepositorySummary | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);

  const loadRepositoryStatus = async (path = task.repositoryPath) => {
    if (!path || repoLoading) return;
    setRepoLoading(true);
    setRepoError(null);
    try {
      setRepoSummary(await zeno().repository.status(task.id, path));
    } catch (error) {
      setRepoError(
        error instanceof Error ? error.message : "Gagal membaca status Git.",
      );
    } finally {
      setRepoLoading(false);
    }
  };

  const chooseRepository = async () => {
    try {
      const selected = await zeno().repository.choose();
      if (selected) {
        patchTask(task.id, { repositoryPath: selected });
        setRepoOpen(true);
        setRepoSummary(null);
        await loadRepositoryStatus(selected);
      }
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Gagal memilih repository Git.",
      );
    }
  };
  const display = applyPreview(row.eff, task.id, preview);
  const previewing =
    !!preview && preview.days !== 0 && preview.ids.includes(task.id);
  const isPrimary = previewing && preview!.ids[0] === task.id;
  const overdue = isOverdue(display);
  const hasChildren = row.children.length > 0;
  const readOnly = row.derived;
  const statusBackground = STATUS_PILL[backgroundStatus(display.progress)].bg;
  const today = todayISO();
  // Latar berdasarkan tingkat, dipakai baris sekaligus panel kirinya yang
  // menempel — keduanya harus sewarna supaya pitanya tidak terputus saat
  // timeline digeser mendatar.
  // Urutan: pilihan menang atas tanda AI, tanda AI menang atas warna tingkat.
  // Baris yang baru diubah AI memang harus menonjol sampai kamu menyimpannya.
  //
  // Latar saja tidak cukup. Kedalaman, baris terpilih, dan tanda AI adalah tiga
  // hal berbeda; kalau ketiganya cuma diberi beda tingkat terang, semuanya
  // berdesakan dalam rentang beberapa persen dan tak ada yang terbaca. Jadi
  // terpilih dan tanda AI mendapat saluran keduanya sendiri: garis tepi kiri.
  const background = selected
    ? "var(--color-selected)"
    : aiEdited
      ? "var(--color-ai)"
      : row.depth === 0
        ? "var(--color-row-1)"
        : row.depth === 1
          ? "var(--color-row-2)"
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
          boxShadow: selected
            ? "inset 3px 0 0 0 var(--color-mark)"
            : aiEdited
              ? "inset 3px 0 0 0 var(--color-ai-edge)"
              : undefined,
        }}
        title={aiEdited ? "Diubah asisten AI, belum disimpan" : undefined}
      >
        {/* Action: tombol baris, muncul saat baris di-hover */}
        <div
          className="cell shrink-0 gap-1 text-[11px] text-[var(--color-faint)]"
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
          <button
            className={`w-3 shrink-0 text-center text-[12px] leading-none opacity-0 transition-opacity hover:text-[var(--color-mark)] focus-visible:opacity-100 [.row:hover_&]:opacity-100 ${
              hasChildren ? "" : "invisible pointer-events-none"
            }`}
            title={
              hasChildren
                ? `Fokus ke ${row.wbs} dan seluruh sub-task-nya`
                : undefined
            }
            aria-label={
              hasChildren
                ? `Fokus ke ${row.wbs} dan seluruh sub-task-nya`
                : undefined
            }
            aria-hidden={!hasChildren}
            tabIndex={hasChildren ? 0 : -1}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) setFocusRoot(task.id);
            }}
          >
            ◎
          </button>
          {task.repositoryPath ? (
            <Popover
              open={repoOpen}
              onOpenChange={(next) => {
                setRepoOpen(next);
                if (next) void loadRepositoryStatus();
              }}
            >
              <PopoverTrigger asChild>
                <button
                  className="w-3 shrink-0 text-center leading-none text-[var(--color-mark)]"
                  title={`Git: ${task.repositoryPath}`}
                  aria-label={`Status repository Git untuk ${row.wbs}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <FolderGit2 className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="w-80 border border-[var(--color-line)] bg-[var(--color-surface)] text-[11px] text-[var(--color-ink)]"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="font-semibold">Git · {row.wbs} {task.title}</div>
                <div className="break-all text-[10px] text-[var(--color-faint)]">
                  {task.repositoryPath}
                </div>
                {repoLoading && !repoSummary ? (
                  <div className="text-[var(--color-faint)]">membaca Git…</div>
                ) : repoError ? (
                  <div className="text-[var(--color-blocked)]">{repoError}</div>
                ) : repoSummary ? (
                  <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 rounded bg-[var(--color-raised)] p-2">
                    <span className="text-[var(--color-faint)]">Branch</span>
                    <span className="num truncate">{repoSummary.branch}</span>
                    <span className="text-[var(--color-faint)]">HEAD</span>
                    <span className="num">{repoSummary.shortHead}</span>
                    <span className="text-[var(--color-faint)]">Perubahan</span>
                    <span>
                      {repoSummary.changedFiles} file · {repoSummary.stagedFiles} staged ·{" "}
                      {repoSummary.untrackedFiles} untracked
                    </span>
                    <span className="text-[var(--color-faint)]">Cek AI terakhir</span>
                    <span>
                      {repoSummary.lastCheckedAt
                        ? new Date(repoSummary.lastCheckedAt).toLocaleString("id-ID")
                        : "Belum pernah"}
                    </span>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => void chooseRepository()}
                  >
                    Ganti
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    disabled={repoLoading}
                    onClick={() => void loadRepositoryStatus()}
                  >
                    <RefreshCw className={`size-3 ${repoLoading ? "animate-spin" : ""}`} />
                    Cek sekarang
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-[11px] text-[var(--color-blocked)]"
                    onClick={() => {
                      patchTask(task.id, { repositoryPath: "" });
                      setRepoOpen(false);
                      setRepoSummary(null);
                    }}
                  >
                    <Unlink className="size-3" />
                    Lepas
                  </Button>
                </div>
                <div className="text-[10px] text-[var(--color-faint)]">
                  Sub-task tanpa repo sendiri otomatis memakai repository ini.
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <button
              className="w-3 shrink-0 text-center leading-none opacity-0 transition-opacity hover:text-[var(--color-mark)] focus-visible:opacity-100 [.row:hover_&]:opacity-100"
              title="Tautkan repository Git ke task ini"
              aria-label={`Tautkan repository Git ke ${row.wbs}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void chooseRepository();
              }}
            >
              <FolderGit2 className="size-3" />
            </button>
          )}
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
              style={{ background: STATUS_PILL[display.status].dot }}
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
          {/* Pil memeluk teksnya, dan select-nya ditumpangkan transparan di
              atasnya. Kalau select-nya yang digambar langsung, lebarnya
              mengikuti opsi terpanjang ("Blocked") sehingga semua pil ikut
              melebar seukuran kolom. */}
          <span
            className="relative inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-[2px]"
            style={{
              background: statusBackground,
              color: STATUS_PILL[display.status].fg,
            }}
            title={readOnly ? "Dihitung dari sub-task" : undefined}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: STATUS_PILL[display.status].dot }}
            />
            <span className="truncate text-[11px]">
              {STATUS_LABEL[display.status]}
            </span>
            {!readOnly && (
              <select
                className="absolute inset-0 cursor-pointer opacity-0"
                value={task.status}
                aria-label="Status"
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
          </span>
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
          style={{ left: todayX, background: "var(--color-today)", opacity: 0.8 }}
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
