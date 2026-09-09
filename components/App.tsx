"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Grid from "./Grid";
import Toolbar from "./Toolbar/Toolbar";
import ChatPanel from "./Chat/ChatPanel";
import SettingsDialog from "./Settings/SettingsDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/animate-ui/components/radix/alert-dialog";
import { buttonVariants } from "@/components/animate-ui/components/buttons/button";
import { diffDays, maxISO, minISO, shiftISO, todayISO, weekStartISO } from "@/lib/dates";
import { computeRows } from "@/lib/rows";
import { makeScale, xForDate } from "@/lib/schedule";
import { useStore } from "@/lib/store";
import { childrenOf, subtreeIds, topMost } from "@/lib/tree";
import type { Task } from "@/lib/types";

const PAD = { day: 10, week: 21, month: 60 } as const;

export default function App({ initialTasks }: { initialTasks: Task[] }) {
  const hydrate = useStore((s) => s.hydrate);
  const storeTasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  // Sebelum store terisi (render server dan render klien pertama) pakai data
  // dari server, supaya baris sudah tergambar tanpa kedipan kosong.
  const tasks = hydrated ? storeTasks : initialTasks;
  const sort = useStore((s) => s.sort);
  const filters = useStore((s) => s.filters);
  const zoom = useStore((s) => s.zoom);
  const store = useStore;

  const selection = useStore((s) => s.selection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  const lastCentered = useRef<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    hydrate(initialTasks);
  }, [hydrate, initialTasks]);

  const { rows, stats, outline } = useMemo(
    () => computeRows(tasks, sort, filters),
    [tasks, sort, filters],
  );

  const scale = useMemo(() => {
    const today = todayISO();
    let min = today;
    let max = today;
    for (const t of tasks) {
      min = minISO(min, t.start);
      max = maxISO(max, t.end);
    }
    const pad = PAD[zoom];
    const origin = weekStartISO(shiftISO(min, -pad));
    const span = diffDays(origin, shiftISO(max, pad)) + 1;
    return makeScale(zoom, origin, Math.ceil(span / 7) * 7);
  }, [tasks, zoom]);

  /**
   * Lebar panel kiri yang menempel. Bagian timeline yang benar-benar terlihat
   * adalah sisa lebarnya, jadi titik tengah harus dihitung dari sisa itu —
   * bukan dari lebar penuh, kalau tidak posisinya meleset sekitar 300px.
   */
  const leftPaneWidth = useCallback(
    () =>
      scrollRef.current?.querySelector<HTMLElement>("[data-left-pane]")
        ?.offsetWidth ?? 0,
    [],
  );

  const centerOn = useCallback(
    (date: string, smooth: boolean) => {
      const pane = scrollRef.current;
      if (!pane) return;
      const visible = pane.clientWidth - leftPaneWidth();
      const left = Math.max(0, xForDate(scale, date) - visible / 2);
      if (smooth) pane.scrollTo({ left, behavior: "smooth" });
      else pane.scrollLeft = left;
    },
    [leftPaneWidth, scale],
  );

  const jumpToday = useCallback(
    () => centerOn(todayISO(), true),
    [centerOn],
  );

  // Sekali saat pertama dibuka: posisikan timeline di sekitar hari ini.
  useEffect(() => {
    if (centered.current || !scrollRef.current || tasks.length === 0) return;
    centered.current = true;
    centerOn(todayISO(), false);
  }, [centerOn, tasks.length]);

  /**
   * Memilih baris menggeser timeline ke tanggal mulainya. Rentang datamu
   * membentang 14 bulan, jadi bar baris yang baru dipilih hampir selalu di
   * luar layar. Kalau ternyata sudah terlihat nyaman di tengah, biarkan —
   * menggeser tiap klik justru bikin pusing.
   */
  useEffect(() => {
    const id = selection[0];
    if (!id || id === lastCentered.current) return;
    lastCentered.current = id;
    const node = outline.byId.get(id);
    const pane = scrollRef.current;
    if (!node || !pane) return;

    const x = xForDate(scale, node.eff.start);
    const paneLeft = leftPaneWidth();
    const screenX = x - pane.scrollLeft;
    const visible = pane.clientWidth - paneLeft;
    const margin = visible * 0.2;
    if (screenX > margin && screenX < visible - margin) return;
    centerOn(node.eff.start, true);
  }, [selection, outline, scale, centerOn, leftPaneWidth]);

  // Ringkasan baris yang akan dihapus, dipakai di teks dialog.
  const deleteTarget = useMemo(() => {
    const roots = topMost(tasks, selection);
    const withKids = roots.filter((id) => childrenOf(tasks, id).length > 0);
    const descendants = roots.reduce(
      (sum, id) => sum + subtreeIds(tasks, id).length - 1,
      0,
    );
    const first = tasks.find((t) => t.id === roots[0]);
    return {
      rows: roots.length,
      descendants,
      hasChildren: withKids.length > 0,
      title: first?.title || "Tanpa judul",
    };
  }, [selection, tasks]);

  /** Satu-satunya jalur hapus: dipakai tombol × di gutter maupun tombol Del. */
  const runDelete = useCallback(() => {
    // Menghapus selalu lewat konfirmasi, termasuk baris tanpa sub-task.
    if (store.getState().selection.length === 0) return;
    setConfirmDelete(true);
  }, [store]);

  const requestDelete = useCallback(
    (id: string) => {
      store.getState().select(id);
      runDelete();
    },
    [runDelete, store],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmDelete) return;
      const s = store.getState();
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.isContentEditable);

      if (e.key === "Escape") {
        if (s.editing) s.setEditing(null);
        else s.clearSelection();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      // Diperiksa sebelum penjaga `typing`: menyimpan harus tetap bisa
      // dilakukan saat kursor sedang berada di dalam sel yang diedit.
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void s.save();
        return;
      }
      if (typing) return;

      const selected = s.selection[0];
      const index = rows.findIndex((r) => r.task.id === selected);

      // Menggeser jadwal tanpa mouse (§5.5.5). Ctrl = loncat satu minggu.
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (!s.selection.length) return;
        e.preventDefault();
        const step = (e.key === "ArrowRight" ? 1 : -1) * (e.ctrlKey ? 7 : 1);
        const mode = e.shiftKey ? "end" : e.metaKey ? "start" : "move";
        s.dragSchedule(s.selection, mode, step);
        return;
      }

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        return e.shiftKey ? s.redo() : s.undo();
      }
      if (mod && e.key === "f") {
        e.preventDefault();
        document.getElementById("zeno-search")?.focus();
        return;
      }
      if (mod && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        if (e.shiftKey) return s.setAllCollapsed(e.key === "[");
        return e.key === "]" ? s.indentSelected() : s.outdentSelected();
      }
      if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        return s.nudgeVertical(e.key === "ArrowUp" ? -1 : 1);
      }
      if (e.key === "Tab" && s.selection.length) {
        e.preventDefault();
        return e.shiftKey ? s.outdentSelected() : s.indentSelected();
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (!rows.length) return;
        e.preventDefault();
        const next = rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) s.select(next.task.id);
        return;
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selected) {
        const row = rows[index];
        if (!row || row.children.length === 0) return;
        const wantCollapsed = e.key === "ArrowLeft";
        if (row.task.collapsed !== wantCollapsed) s.toggleCollapse(selected);
        return;
      }
      if (e.key === "Enter" && selected) {
        e.preventDefault();
        return s.setEditing({ id: selected, field: "title" });
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        return runDelete();
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        if (e.shiftKey && selected) return void s.addChildOf(selected);
        return void s.addSiblingAfter(selected ?? rows[rows.length - 1]?.task.id ?? null);
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        jumpToday();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, runDelete, jumpToday, rows, store]);

  // Perubahan hanya di memori; menutup tab tanpa menyimpan berarti hilang.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (store.getState().pending === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [store]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar stats={stats} onJumpToday={jumpToday} />
      <div className="flex min-h-0 flex-1">
        <Grid
        rows={rows}
        scale={scale}
        scrollRef={scrollRef}
        onRequestDelete={requestDelete}
          isEmpty={tasks.length === 0}
        />
        <ChatPanel />
      </div>

      <SettingsDialog />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget.rows > 1
                ? `Hapus ${deleteTarget.rows} baris?`
                : `Hapus "${deleteTarget.title}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget.hasChildren
                ? `${deleteTarget.descendants} sub-task di bawahnya ikut terhapus. Bisa dibatalkan dengan ⌘Z.`
                : "Bisa dibatalkan dengan ⌘Z."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:flex-wrap">
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => store.getState().removeSelected("cascade")}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
