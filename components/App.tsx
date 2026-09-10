"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalendarView from "./Calendar/CalendarView";
import Grid from "./Grid";
import Toolbar, { type WorkspaceView } from "./Toolbar/Toolbar";
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
import { zeno } from "@/lib/bridge";
import { computeRows } from "@/lib/rows";
import { makeScale, xForDate } from "@/lib/schedule";
import { useShortcutText } from "@/lib/shortcuts";
import { useStore } from "@/lib/store";
import { useThemeMode } from "@/lib/theme";
import { childrenOf, subtreeIds, topMost } from "@/lib/tree";

const PAD = { day: 7, week: 31, month: 180 } as const;

export default function App() {
  const hydrate = useStore((s) => s.hydrate);
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const [loadError, setLoadError] = useState<string | null>(null);
  const filters = useStore((s) => s.filters);
  const focusRootId = useStore((s) => s.focusRootId);
  const zoom = useStore((s) => s.zoom);
  const store = useStore;

  const selection = useStore((s) => s.selection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  const lastCentered = useRef<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [view, setView] = useState<WorkspaceView>("table");
  const [calendarTodayToken, setCalendarTodayToken] = useState(0);
  const shortcut = useShortcutText();
  const undoShortcut = shortcut(["mod", "Z"]);
  useThemeMode();

  // Muatan pertama dari proses utama. Sampai ini selesai tabelnya belum
  // digambar sama sekali — lebih baik daripada memperlihatkan tabel kosong
  // yang tak bisa dibedakan dari "datamu memang habis".
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await zeno().tasks.load();
        if (!cancelled) hydrate(rows);
      } catch (error) {
        if (!cancelled)
          setLoadError(
            error instanceof Error ? error.message : "Gagal memuat data.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  const { rows, matchedNodes, stats, outline } = useMemo(
    () => computeRows(tasks, filters, focusRootId),
    [tasks, filters, focusRootId],
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

  const jumpToday = useCallback(() => {
    if (view === "calendar") setCalendarTodayToken((token) => token + 1);
    else centerOn(todayISO(), true);
  }, [centerOn, view]);

  // Sekali saat pertama dibuka: posisikan timeline di sekitar hari ini.
  useEffect(() => {
    if (view !== "table") {
      centered.current = false;
      return;
    }
    if (centered.current || !scrollRef.current || tasks.length === 0) return;
    centered.current = true;
    centerOn(todayISO(), false);
  }, [centerOn, tasks.length, view]);

  /**
   * Memilih baris menggeser timeline ke tanggal mulainya. Rentang datamu
   * membentang 14 bulan, jadi bar baris yang baru dipilih hampir selalu di
   * luar layar. Kalau ternyata sudah terlihat nyaman di tengah, biarkan —
   * menggeser tiap klik justru bikin pusing.
   */
  useEffect(() => {
    if (view !== "table") return;
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
  }, [selection, outline, scale, centerOn, leftPaneWidth, view]);

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
      if (view === "table" && mod && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        if (e.shiftKey) return s.setAllCollapsed(e.key === "[");
        return e.key === "]" ? s.indentSelected() : s.outdentSelected();
      }
      if (
        view === "table" &&
        mod &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        e.preventDefault();
        return s.nudgeVertical(e.key === "ArrowUp" ? -1 : 1);
      }
      if (view === "table" && e.key === "Tab" && s.selection.length) {
        e.preventDefault();
        return e.shiftKey ? s.outdentSelected() : s.indentSelected();
      }
      if (view === "table" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (!rows.length) return;
        e.preventDefault();
        const next = rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) s.select(next.task.id);
        return;
      }
      if (
        view === "table" &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        selected
      ) {
        const row = rows[index];
        if (!row || row.children.length === 0) return;
        const wantCollapsed = e.key === "ArrowLeft";
        if (row.task.collapsed !== wantCollapsed) s.toggleCollapse(selected);
        return;
      }
      if (e.key === "Enter" && selected) {
        e.preventDefault();
        if (view === "calendar") setView("table");
        return s.setEditing({ id: selected, field: "title" });
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        return runDelete();
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        if (view === "calendar") setView("table");
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
  }, [confirmDelete, runDelete, jumpToday, rows, store, view]);

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

  if (!hydrated)
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-[var(--color-ink-soft)]">
        {loadError ?? "Memuat…"}
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        stats={stats}
        onJumpToday={jumpToday}
        view={view}
        onViewChange={setView}
      />
      <div className="flex min-h-0 flex-1">
        {view === "table" ? (
          <Grid
            rows={rows}
            scale={scale}
            scrollRef={scrollRef}
            onRequestDelete={requestDelete}
            isEmpty={tasks.length === 0}
          />
        ) : (
          <CalendarView
            nodes={matchedNodes}
            todayToken={calendarTodayToken}
            onOpenTable={() => setView("table")}
          />
        )}
        <ChatPanel />
      </div>

      <SettingsDialog />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent
          // Default Radix mengarahkan fokus ke Batal. Untuk dialog hapus ini,
          // tombol Hapus sengaja menjadi fokus awal agar Enter mengonfirmasi
          // aksi yang baru saja diminta; Esc tetap membatalkan.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const content = event.currentTarget as HTMLElement | null;
            content
              ?.querySelector<HTMLElement>('[data-slot="alert-dialog-action"]')
              ?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget.rows > 1
                ? `Hapus ${deleteTarget.rows} baris?`
                : `Hapus "${deleteTarget.title}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget.hasChildren
                ? `${deleteTarget.descendants} sub-task di bawahnya ikut terhapus. Bisa dibatalkan dengan ${undoShortcut}.`
                : `Bisa dibatalkan dengan ${undoShortcut}.`}
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
