"use client";

import { useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns3,
  Crosshair,
  Download,
  Filter,
  Monitor,
  Moon,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Sun,
  TableProperties,
  Undo2,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/animate-ui/components/buttons/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { zeno } from "@/lib/bridge";
import { useStore } from "@/lib/store";
import { buildOutline } from "@/lib/rollup";
import { durationOf, todayISO } from "@/lib/dates";
import { useShortcutText } from "@/lib/shortcuts";
import { nextThemeMode, useThemeMode } from "@/lib/theme";
import {
  RANGE_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type DateRange,
  type Status,
} from "@/lib/types";
import type { Stats } from "@/lib/rows";
import type { ZoomUnit } from "@/lib/schedule";

/** Rentang tertutup, lalu rentang terbuka ke depan — dipisah di menunya. */
const RANGES: DateRange[] = ["all", "today", "week", "month"];
const ONWARD_RANGES: DateRange[] = [
  "today-onward",
  "week-onward",
  "month-onward",
];

const ZOOMS: { value: ZoomUnit; label: string }[] = [
  { value: "day", label: "Hari" },
  { value: "week", label: "Minggu" },
  { value: "month", label: "Bulan" },
];

export type WorkspaceView = "table" | "calendar";

/**
 * Semua export lewat proses utama: dialog simpan bawaan sistem, lalu berkas
 * ditulis di sana. Halaman tidak menyimpan berkas sendiri — di jendela
 * desktop tidak ada folder unduhan yang jelas untuk dituju.
 */
function saveFile(run: () => Promise<unknown>) {
  void (async () => {
    try {
      await run();
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Gagal menyimpan berkas.",
      );
    }
  })();
}

export default function Toolbar({
  stats,
  onJumpToday,
  view,
  onViewChange,
}: {
  stats: Stats;
  onJumpToday: () => void;
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}) {
  const tasks = useStore((s) => s.tasks);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const resetFilters = useStore((s) => s.resetFilters);
  const focusRootId = useStore((s) => s.focusRootId);
  const setFocusRoot = useStore((s) => s.setFocusRoot);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const setAllCollapsed = useStore((s) => s.setAllCollapsed);
  const showDuration = useStore((s) => s.showDuration);
  const toggleDurationColumn = useStore((s) => s.toggleDurationColumn);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const saving = useStore((s) => s.saving);
  const error = useStore((s) => s.error);
  const pending = useStore((s) => s.pending);
  const save = useStore((s) => s.save);
  const discard = useStore((s) => s.discard);
  const refresh = useStore((s) => s.refresh);

  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const shortcut = useShortcutText();
  const theme = useThemeMode();
  const saveShortcut = shortcut(["mod", "S"]);
  const undoShortcut = shortcut(["mod", "Z"]);
  const redoShortcut = shortcut(["shift", "mod", "Z"]);
  const collapseShortcut = shortcut(["shift", "mod", "["]);
  const expandShortcut = shortcut(["shift", "mod", "]"]);

  // Filter tidak boleh menjadi keadaan tersembunyi di dalam dropdown. Saat
  // hasil tabel berubah, ringkasan ini tetap terlihat di toolbar agar jelas
  // mengapa sebagian task tidak sedang ditampilkan.
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (filters.range !== "all") {
      labels.push(
        filters.range === "from" && filters.fromDate
          ? `Sejak ${filters.fromDate}`
          : RANGE_LABEL[filters.range],
      );
    }
    if (filters.activeOnly) labels.push("Hanya aktif");
    if (filters.hideDone) labels.push("Done disembunyikan");
    if (filters.overdueOnly) labels.push("Overdue saja");
    if (filters.status.length)
      labels.push(`Status: ${filters.status.map((s) => STATUS_LABEL[s]).join(", ")}`);
    if (filters.priority.length)
      labels.push(
        `Prioritas: ${filters.priority.map((p) => PRIORITY_LABEL[p]).join(", ")}`,
      );
    return labels;
  }, [filters]);

  const focusNode = useMemo(
    () =>
      focusRootId ? buildOutline(tasks).byId.get(focusRootId) ?? null : null,
    [focusRootId, tasks],
  );

  const exportCsv = () => {
    const outline = buildOutline(tasks);
    const head = "wbs,task,progress,start,end,durasi,status,parentId,id";
    const lines = outline.all.map((n) =>
      [
        n.wbs,
        `"${n.task.title.replace(/"/g, '""')}"`,
        n.eff.progress,
        n.eff.start,
        n.eff.end,
        durationOf(n.eff.start, n.eff.end),
        n.eff.status,
        n.task.parentId ?? "",
        n.task.id,
      ].join(","),
    );
    saveFile(() => zeno().exports.text("zeno-work.csv", [head, ...lines].join("\n")));
  };

  const exportMarkdown = () => {
    const outline = buildOutline(tasks);
    const lines = outline.all.map(
      (n) =>
        `${"  ".repeat(n.depth)}- **${n.wbs}** ${n.task.title} — ${n.eff.progress}% · ${n.eff.start} → ${n.eff.end}`,
    );
    saveFile(() => zeno().exports.text("zeno-work.md", lines.join("\n")));
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { tasks?: unknown };
      if (
        !window.confirm(
          "Import akan mengganti seluruh task saat ini. Lanjutkan?",
        )
      )
        return;
      const count = await zeno().backup.restore(parsed.tasks ?? parsed);
      await refresh();
      window.alert(`Import selesai. ${count} task berhasil dipulihkan.`);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "File JSON tidak valid.",
      );
    }
  };

  const ThemeIcon =
    theme.mode === "dark" ? Moon : theme.mode === "light" ? Sun : Monitor;
  const themeLabel =
    theme.mode === "dark"
      ? "Tema: Dark (klik untuk System)"
      : theme.mode === "light"
        ? "Tema: Light (klik untuk Dark)"
        : "Tema: System (klik untuk Light)";

  const iconButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled?: boolean,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClick}
          disabled={disabled}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <header className="shrink-0 border-b border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex h-11 items-center gap-2 px-3">

        <Tabs
          value={view}
          onValueChange={(value) => onViewChange(value as WorkspaceView)}
        >
          <TabsList className="h-7 p-0.5">
            <TabsTrigger value="table" className="h-6 gap-1 px-2 text-[11px]">
              <TableProperties className="size-3" />
              Tabel
            </TabsTrigger>
            <TabsTrigger value="calendar" className="h-6 gap-1 px-2 text-[11px]">
              <CalendarDays className="size-3" />
              Kalender
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-faint)]" />
          <input
            id="zeno-search"
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            placeholder="Cari task atau nomor…"
            className="h-7 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] pl-7 pr-2 text-[12px] outline-none focus:border-[var(--color-mark)]"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px]">
              <Filter className="size-3.5" />
              Filter
              {filters.range !== "all" && (
                <span className="rounded bg-[var(--color-mark)]/15 px-1 text-[10px] text-[var(--color-mark)]">
                  {filters.range === "from" && filters.fromDate
                    ? `Sejak ${filters.fromDate}`
                    : RANGE_LABEL[filters.range]}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Periode</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.range}
              onValueChange={(v) => setFilters({ range: v as DateRange })}
            >
              {RANGES.map((r) => (
                <DropdownMenuRadioItem key={r} value={r}>
                  {RANGE_LABEL[r]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuLabel>Sejak periode itu ke depan</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.range}
              onValueChange={(v) =>
                setFilters(
                  // Memilih "Dari tanggal" tanpa tanggal tidak berarti apa-apa,
                  // jadi hari ini dipakai sebagai titik awal sampai diubah.
                  v === "from" && !filters.fromDate
                    ? { range: "from", fromDate: todayISO() }
                    : { range: v as DateRange },
                )
              }
            >
              {ONWARD_RANGES.map((r) => (
                <DropdownMenuRadioItem key={r} value={r}>
                  {RANGE_LABEL[r]}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value="from">
                {RANGE_LABEL.from}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {/* Kotak tanggalnya menutup menu kalau tidak dicegah. Mengetik di
                sini sekaligus memilih rentangnya — dua klik jadi satu. */}
            <DropdownMenuItem
              className="focus:bg-transparent"
              onSelect={(e) => e.preventDefault()}
            >
              <input
                type="date"
                aria-label="Tampilkan sejak tanggal"
                value={filters.fromDate}
                onChange={(e) =>
                  setFilters({ fromDate: e.target.value, range: "from" })
                }
                className="h-7 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[12px] outline-none focus:border-[var(--color-mark)]"
              />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Tampilkan</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={filters.activeOnly}
              onCheckedChange={(v) => setFilters({ activeOnly: !!v })}
            >
              Hanya yang aktif
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.hideDone}
              onCheckedChange={(v) => setFilters({ hideDone: !!v })}
            >
              Sembunyikan Done
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.overdueOnly}
              onCheckedChange={(v) => setFilters({ overdueOnly: !!v })}
            >
              Overdue saja
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={filters.status.includes(s)}
                onCheckedChange={(v) =>
                  setFilters({
                    status: v
                      ? [...filters.status, s]
                      : filters.status.filter((x) => x !== s),
                  })
                }
              >
                {STATUS_LABEL[s]}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={resetFilters}>Reset filter</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {focusNode && (
          <div
            className="flex min-w-0 items-center gap-1 rounded bg-[var(--color-mark)]/15 px-1.5 py-0.5 text-[11px] text-[var(--color-mark)]"
            title="Fokus cabang menampilkan task ini dan seluruh sub-task, termasuk yang Done. Filter biasa ditangguhkan."
          >
            <Crosshair className="size-3 shrink-0" />
            <span className="truncate">
              Fokus: {focusNode.wbs} {focusNode.task.title}
            </span>
            <button
              type="button"
              className="shrink-0 text-[13px] leading-none hover:text-[var(--color-blocked)]"
              title="Keluar dari Fokus Cabang"
              aria-label="Keluar dari Fokus Cabang"
              onClick={() => setFocusRoot(null)}
            >
              ×
            </button>
          </div>
        )}

        {activeFilterLabels.length > 0 && (
          <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto text-[11px]"
            aria-label={`Filter aktif: ${activeFilterLabels.join(", ")}`}
          >
            {activeFilterLabels.map((label) => (
              <span
                key={label}
                className="shrink-0 rounded bg-[var(--color-mark)]/10 px-1.5 py-0.5 text-[var(--color-mark)]"
              >
                {label}
              </span>
            ))}
            <button
              type="button"
              className="shrink-0 text-[var(--color-faint)] hover:text-[var(--color-blocked)]"
              title="Reset semua filter"
              aria-label="Reset semua filter"
              onClick={resetFilters}
            >
              ×
            </button>
          </div>
        )}


        <div className="ml-auto flex items-center gap-1.5">
          {error && (
            <span className="text-[11px] text-[var(--color-blocked)]">{error}</span>
          )}

          {/* Perubahan hanya ada di memori sampai tombol ini ditekan. */}
          {pending > 0 ? (
            <>
              {/* Jalan keluar kalau suntingannya sudah telanjur jauh. Tetap
                  lewat konfirmasi, dan tetap bisa dibatalkan dengan shortcut undo. */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-[12px]"
                disabled={saving > 0}
                title="Kembalikan ke kondisi terakhir yang tersimpan"
                onClick={() => setConfirmDiscard(true)}
              >
                <RotateCcw className="size-3.5" />
                Buang
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-[12px]"
                disabled={saving > 0}
                onClick={() => void save()}
              >
                <Save className="size-3.5" />
                {saving > 0 ? "Menyimpan…" : `Simpan ${pending}`}
                <span className="opacity-60">{saveShortcut}</span>
              </Button>
            </>
          ) : (
            <span className="text-[11px] text-[var(--color-faint)]">
              Tersimpan
            </span>
          )}

          {iconButton(`Undo (${undoShortcut})`, <Undo2 className="size-3.5" />, undo, !canUndo)}
          {iconButton(`Redo (${redoShortcut})`, <Redo2 className="size-3.5" />, redo, !canRedo)}
          {view === "table" && (
            <>
              {iconButton(
                `Tutup semua (${collapseShortcut})`,
                <ChevronsDownUp className="size-3.5" />,
                () => setAllCollapsed(true),
              )}
              {iconButton(
                `Buka semua (${expandShortcut})`,
                <ChevronsUpDown className="size-3.5" />,
                () => setAllCollapsed(false),
              )}
              {iconButton(
                showDuration ? "Sembunyikan kolom durasi" : "Tampilkan kolom durasi",
                <Columns3 className="size-3.5" />,
                toggleDurationColumn,
              )}
            </>
          )}
          {iconButton("Lompat ke hari ini (T)", <Crosshair className="size-3.5" />, onJumpToday)}
          {iconButton(
            "Asisten AI",
            <Sparkles className="size-3.5" />,
            useStore.getState().toggleChat,
          )}
          {iconButton(themeLabel, <ThemeIcon className="size-3.5" />, () =>
            theme.setMode(nextThemeMode(theme.mode)),
          )}
          {iconButton("Setelan", <Settings className="size-3.5" />, () =>
            useStore.getState().setSettingsOpen(true),
          )}

          {view === "table" && (
            <Tabs value={zoom} onValueChange={(v) => setZoom(v as ZoomUnit)}>
              <TabsList className="h-7 p-0.5">
                {ZOOMS.map((z) => (
                  <TabsTrigger key={z.value} value={z.value} className="h-6 px-2 text-[11px]">
                    {z.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Import atau export data"
                title="Import atau export data"
              >
                <Download className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => saveFile(() => zeno().backup.save())}
              >
                Export JSON (backup data)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv}>Export CSV</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => saveFile(() => zeno().exports.xlsx())}
              >
                Export XLSX (DTDI)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportMarkdown}>
                Export Markdown
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => fileRef.current?.click()}>
                <Upload className="size-3.5" />
                Import JSON (pulihkan data)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex h-7 items-center gap-4 border-t border-[var(--color-line)] px-3 text-[11px] text-[var(--color-ink-soft)]">
        <span>{stats.leaves} task</span>
        <span>{stats.byStatus.in_progress} jalan</span>
        <span>{stats.byStatus.done} selesai</span>
        <span
          className={stats.overdue > 0 ? "text-[var(--color-blocked)]" : undefined}
        >
          {stats.overdue} overdue
        </span>
        <span>
          {stats.avgProgress}% {focusRootId ? "progres fokus" : "rata-rata progres aktif"}
        </span>
        <span>{stats.thisWeek} task minggu ini</span>
      </div>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Buang {pending} perubahan yang belum disimpan?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tabel kembali ke kondisi terakhir yang tersimpan di database.
              Bisa dibatalkan dengan {undoShortcut} selama aplikasi belum ditutup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:flex-wrap">
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={discard}
            >
              Buang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
