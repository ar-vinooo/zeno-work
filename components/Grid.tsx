"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TaskRow from "./TaskTable/TaskRow";
import TimelineHeader from "./Timeline/TimelineHeader";
import {
  COL,
  COL_MAX,
  COL_MIN,
  INDENT,
  ROW_H,
  STORAGE_KEY,
  cssVar,
  initialVars,
  widthOf,
  type ColKey,
} from "./TaskTable/layout";
import { useBarDrag } from "./Timeline/useBarDrag";
import { todayISO } from "@/lib/dates";
import { xForDate, type Scale } from "@/lib/schedule";
import { useStore, type CellRef } from "@/lib/store";
import { childrenOf, subtreeIds } from "@/lib/tree";
import type { Row } from "@/lib/types";

interface Props {
  rows: Row[];
  scale: Scale;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onRequestDelete: (id: string) => void;
  /** Database benar-benar kosong. Dikirim dari App karena store baru terisi
   *  setelah hydrate — kalau dibaca dari store, render server selalu
   *  menganggapnya kosong dan tombolnya sempat berkedip. */
  isEmpty: boolean;
}

interface RowDrag {
  id: string;
  /** Posisi garis sisip dalam satuan baris. */
  slot: number;
  depth: number;
  parentId: string | null;
  index: number;
  /** Ada induk yang sah di kedalaman ini pada posisi tersebut. */
  valid: boolean;
}

const HEADERS: { key: ColKey; label: string }[] = [
  { key: "title", label: "Task" },
  { key: "progress", label: "Progress" },
  { key: "status", label: "Status" },
  { key: "start", label: "Start" },
  { key: "end", label: "End" },
];

/** Pembatas kolom: 5px area seret di tepi kanan header. */
function Grip({
  onResize,
  onReset,
}: {
  onResize: (event: React.PointerEvent) => void;
  onReset: () => void;
}) {
  return (
    <div
      className="absolute inset-y-0 right-0 z-10 w-[5px] cursor-col-resize hover:bg-[var(--color-mark)]"
      title="Seret untuk mengubah lebar kolom Task · klik ganda untuk mengembalikan"
      onPointerDown={onResize}
      onDoubleClick={onReset}
    />
  );
}

export default function Grid({
  rows,
  scale,
  scrollRef,
  onRequestDelete,
  isEmpty,
}: Props) {
  const tasks = useStore((s) => s.tasks);
  const showDuration = useStore((s) => s.showDuration);
  const editing = useStore((s) => s.editing);
  const selection = useStore((s) => s.selection);
  const setEditing = useStore((s) => s.setEditing);
  const select = useStore((s) => s.select);
  const dropRow = useStore((s) => s.dropRow);
  const addSiblingAfter = useStore((s) => s.addSiblingAfter);

  const listRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  // Cermin dari rowDrag untuk dibaca saat pointer dilepas. Membaca lewat
  // fungsi updater setState tidak boleh: React menjalankannya saat render,
  // sehingga menulis ke store di sana berarti mengubah komponen lain di
  // tengah render Grid.
  const rowDragRef = useRef<RowDrag | null>(null);
  const { begin: beginBarDrag } = useBarDrag(scrollRef);

  const timelineWidth = scale.days * scale.dayWidth;
  const today = todayISO();
  const todayX = xForDate(scale, today);
  const ordered = useMemo(() => rows.map((r) => r.task.id), [rows]);
  const selectionSet = useMemo(() => new Set(selection), [selection]);

  const setVar = useCallback((key: ColKey, px: number) => {
    paneRef.current?.style.setProperty(cssVar(key), `${px}px`);
  }, []);

  const readVar = useCallback((key: ColKey) => {
    const raw = paneRef.current?.style.getPropertyValue(cssVar(key));
    return raw ? parseFloat(raw) : COL[key];
  }, []);

  // Lebar kolom disimpan di localStorage, bukan database: ini preferensi
  // tampilan, bukan data pekerjaan. Dibaca setelah mount supaya render server
  // dan render klien pertama tetap sama.
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? "{}",
      ) as Partial<Record<ColKey, number>>;
      if (typeof saved.title === "number") setVar("title", saved.title);
    } catch {
      // localStorage bisa ditolak browser; lebar bawaan sudah cukup.
    }
  }, [setVar]);

  // Kolom Durasi disembunyikan dengan lebar 0 agar --col-left ikut menyusut.
  useEffect(() => {
    setVar("duration", showDuration ? readVar("duration") || COL.duration : 0);
  }, [readVar, setVar, showDuration]);

  /** Seret pembatas kolom. Selama seret hanya variabel CSS yang berubah —
   *  tanpa render ulang, jadi 200+ baris tetap lancar. */
  const startResize = useCallback(
    (event: React.PointerEvent) => {
      const key: ColKey = "title";
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startW = readVar(key);
      document.body.style.cursor = "col-resize";

      const move = (e: PointerEvent) => {
        const next = Math.max(
          COL_MIN[key],
          Math.min(COL_MAX, startW + e.clientX - startX),
        );
        setVar(key, next);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        try {
          const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
          saved[key] = readVar(key);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        } catch {
          // tidak apa-apa: lebarnya tetap berlaku sampai halaman ditutup
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [readVar, setVar],
  );

  /** Klik ganda pada pembatas mengembalikan kolom ke lebar bawaan. */
  const resetWidth = useCallback(() => {
      const key: ColKey = "title";
      setVar(key, COL[key]);
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
        delete saved[key];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch {
        // abaikan
      }
  }, [setVar]);

  const gridStyle = useMemo<React.CSSProperties>(() => {
    const dw = scale.dayWidth;
    const layers: string[] = [];
    const positions: string[] = [];
    if (scale.unit !== "month") {
      // Tembus pandang, bukan warna pekat: arsiran ini menumpang di atas warna
      // baris, dan warna baris bisa berubah (terpilih, induk, ditandai AI).
      // Dengan warna pekat, kolom akhir pekan menimpanya — baris terpilih jadi
      // biru yang terpotong-potong abu tiap Sabtu-Minggu.
      layers.push(
        `repeating-linear-gradient(to right, transparent 0 ${5 * dw}px, color-mix(in srgb, var(--color-ink) 6%, transparent) ${5 * dw}px ${7 * dw}px)`,
      );
      positions.push("0 0");
    }
    if (dw >= 12) {
      layers.push(
        `repeating-linear-gradient(to right, var(--color-line) 0 1px, transparent 1px ${dw}px)`,
      );
      positions.push("0 0");
    }
    layers.push(
      `repeating-linear-gradient(to right, var(--color-line-strong) 0 1px, transparent 1px ${7 * dw}px)`,
    );
    positions.push("0 0");
    return {
      backgroundImage: layers.join(","),
      backgroundPosition: positions.join(","),
    };
  }, [scale]);

  const fields = useMemo<CellRef["field"][]>(
    () =>
      showDuration
        ? ["title", "progress", "start", "end", "duration"]
        : ["title", "progress", "start", "end"],
    [showDuration],
  );

  const navigate = useCallback(
    (id: string, field: CellRef["field"], dir: 1 | -1) => {
      const fieldIndex = fields.indexOf(field) + dir;
      const rowIndex = ordered.indexOf(id);
      if (fieldIndex >= 0 && fieldIndex < fields.length)
        return setEditing({ id, field: fields[fieldIndex] });
      const nextRow = ordered[rowIndex + dir];
      if (!nextRow) return setEditing(null);
      setEditing({
        id: nextRow,
        field: dir === 1 ? fields[0] : fields[fields.length - 1],
      });
    },
    [fields, ordered, setEditing],
  );

  const onSelect = useCallback(
    (event: React.MouseEvent, id: string) => {
      if (event.shiftKey) select(id, "range", ordered);
      else if (event.metaKey || event.ctrlKey) select(id, "toggle");
      else if (!selectionSet.has(id) || selection.length > 1) select(id);
    },
    [ordered, select, selection.length, selectionSet],
  );

  /**
   * Proyeksi drag baris: hanya posisi vertikal yang dibaca. Kedalaman dikunci
   * pada kedalaman asal baris, sehingga menyeret hanya mengubah urutan dan
   * tidak pernah memindahkan tingkat — untuk itu ada indent/outdent yang
   * eksplisit. Posisi yang tidak punya induk sah di kedalaman itu ditolak.
   */
  const onRowDragStart = useCallback(
    (event: React.PointerEvent, id: string) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const subtree = new Set(subtreeIds(tasks, id));
      const baseDepth = rows.find((r) => r.task.id === id)?.depth ?? 0;

      const move = (e: PointerEvent) => {
        const box = listRef.current?.getBoundingClientRect();
        if (!box) return;
        const slot = Math.max(
          0,
          Math.min(rows.length, Math.round((e.clientY - box.top) / ROW_H)),
        );

        let prev: Row | null = null;
        for (let i = slot - 1; i >= 0; i--)
          if (!subtree.has(rows[i].task.id)) {
            prev = rows[i];
            break;
          }
        let next: Row | null = null;
        for (let i = slot; i < rows.length; i++)
          if (!subtree.has(rows[i].task.id)) {
            next = rows[i];
            break;
          }

        const depth = baseDepth;

        // Tingkat dikunci: cari induk pada kedalaman itu di titik sisip ini.
        let parentId: string | null = null;
        let valid = true;
        if (depth > 0) {
          if (!prev || prev.depth < depth - 1) {
            valid = false;
          } else {
            let cursor: Row | null = prev;
            let i = rows.indexOf(prev);
            while (cursor && cursor.depth !== depth - 1) {
              i -= 1;
              cursor = i >= 0 ? rows[i] : null;
            }
            parentId = cursor?.task.id ?? null;
            valid = parentId !== null;
          }
        }

        // Saudara terdekat sebelum titik sisip menentukan indeks pastinya.
        let preceding: string | null = null;
        if (prev) {
          let i = rows.indexOf(prev);
          while (i >= 0) {
            const candidate = rows[i];
            if (!subtree.has(candidate.task.id) && candidate.depth === depth) {
              preceding = candidate.task.id;
              break;
            }
            if (candidate.depth < depth) break;
            i -= 1;
          }
        }
        const siblings = childrenOf(tasks, parentId).filter((t) => t.id !== id);
        const index = preceding
          ? siblings.findIndex((s) => s.id === preceding) + 1
          : 0;

        const projection = { id, slot, depth, parentId, index, valid };
        rowDragRef.current = projection;
        setRowDrag(projection);
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const dropped = rowDragRef.current;
        rowDragRef.current = null;
        setRowDrag(null);
        if (dropped?.valid)
          dropRow(dropped.id, dropped.parentId, dropped.index);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [dropRow, rows, tasks],
  );

  return (
    <div
      ref={scrollRef}
      className="scroll-pane relative flex-1 overflow-auto"
      // Kanvas, bukan putih: di bawah baris terakhir tidak boleh ada balok
      // putih besar yang warnanya berbeda dari toolbar di atasnya.
      style={{ background: "var(--color-canvas)" }}
    >
      <div className="min-w-max" ref={paneRef} style={initialVars(showDuration)}>
        {/* Header */}
        <div className="sticky top-0 z-20 flex">
          <div
            data-left-pane
            className="sticky left-0 z-30 flex border-b border-[var(--color-line-strong)]"
            style={{
              width: "var(--col-left)",
              height: 40,
              background: "var(--color-raised)",
            }}
          >
            <div
              className="cell shrink-0 text-[11px] text-[var(--color-faint)]"
              style={{ width: widthOf("action") }}
            >
              Action
            </div>
            <div
              className="cell shrink-0 border-l border-[var(--color-line)] text-[11px] text-[var(--color-faint)]"
              style={{ width: widthOf("wbs") }}
            >
              #
            </div>
            {HEADERS.map((h) => (
              <div
                key={h.key}
                className="cell relative shrink-0 justify-between border-l border-[var(--color-line)] text-[11px] text-[var(--color-ink-soft)]"
                style={{ width: widthOf(h.key) }}
              >
                <span className="min-w-0 flex-1 truncate">{h.label}</span>
                {/* Hanya Task yang bisa diubah lebarnya — judul pekerjaan
                    panjangnya tidak terduga, sedangkan kolom lain isinya
                    seragam dan sudah pas. */}
                {h.key === "title" && (
                  <Grip onResize={startResize} onReset={resetWidth} />
                )}
              </div>
            ))}
            {showDuration && (
              <div
                className="cell shrink-0 justify-end border-l border-[var(--color-line)] text-[11px] text-[var(--color-ink-soft)]"
                style={{ width: widthOf("duration") }}
              >
                Durasi
              </div>
            )}
          </div>
          <div style={{ background: "var(--color-raised)" }}>
            <TimelineHeader scale={scale} width={timelineWidth} todayX={todayX} />
          </div>
        </div>

        {/* Baris */}
        <div ref={listRef} className="relative">
          {rows.map((row) => (
            <TaskRow
              key={row.task.id}
              row={row}
              scale={scale}
              timelineWidth={timelineWidth}
              gridStyle={gridStyle}
              showDuration={showDuration}
              selected={selectionSet.has(row.task.id)}
              editing={editing}
              onEdit={setEditing}
              onNavigate={navigate}
              onEnterRow={(id) => addSiblingAfter(id)}
              onSelect={onSelect}
              onRowDragStart={onRowDragStart}
              onRequestDelete={onRequestDelete}
              onBarDrag={(e, id, mode) => beginBarDrag(e, id, mode, scale)}
            />
          ))}

          {rowDrag && (
            <div
              className="pointer-events-none absolute z-40 h-0.5"
              style={{
                top: rowDrag.slot * ROW_H - 1,
                left: `calc(var(--col-action) + var(--col-wbs) + ${
                  rowDrag.depth * INDENT
                }px)`,
                width: `calc(var(--col-left) - var(--col-action) - var(--col-wbs) - ${
                  rowDrag.depth * INDENT
                }px)`,
                background: rowDrag.valid
                  ? "var(--color-mark)"
                  : "var(--color-blocked)",
              }}
            >
              <div
                className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full"
                style={{
                  background: rowDrag.valid
                    ? "var(--color-mark)"
                    : "var(--color-blocked)",
                }}
              />
            </div>
          )}
        </div>

        {/* Satu-satunya jalan masuk lewat mouse saat database benar-benar
            kosong: tanpa baris, tidak ada ⤷ maupun ⤓ untuk di-hover.
            Daftar yang kosong karena filter tidak dihitung di sini. */}
        {isEmpty && (
          <div className="row flex" style={{ height: ROW_H }}>
            <div
              className="sticky left-0 z-10 flex items-center border-b border-[var(--color-line)] px-2"
              style={{ width: "var(--col-left)", background: "var(--color-surface)" }}
            >
              <button
                className="text-[12px] text-[var(--color-faint)] hover:text-[var(--color-mark)]"
                onClick={() => addSiblingAfter(null)}
              >
                + tambah task pertama
              </button>
            </div>
            <div
              className="shrink-0 border-b border-[var(--color-line)]"
              style={{ width: timelineWidth, ...gridStyle }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
