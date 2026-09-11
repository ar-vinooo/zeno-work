"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, addMonths, addYears } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/animate-ui/components/radix/popover";
import { formatLong, fromISO, parseDateInput, todayISO, toISO } from "@/lib/dates";

type Seg = "y" | "m" | "d";
const SEGS: Seg[] = ["y", "m", "d"];
const LEN: Record<Seg, number> = { y: 4, m: 2, d: 2 };

interface Props {
  /** Nilai yang ditampilkan, sudah termasuk pratinjau drag. */
  value: string;
  editing: boolean;
  readOnly: boolean;
  overdue: boolean;
  onStart: () => void;
  onEnd: () => void;
  onChange: (iso: string) => void;
  onNavigate: (dir: 1 | -1) => void;
}

const split = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return { y, m, d };
};

/** Rakit kembali tiga segmen jadi tanggal sah; null bila belum lengkap/valid. */
function assemble(parts: Record<Seg, string>): string | null {
  if (parts.y.length !== 4 || !parts.m || !parts.d) return null;
  const year = Number(parts.y);
  const month = Number(parts.m);
  const day = Number(parts.d);
  if (!year || month < 1 || month > 12 || day < 1) return null;
  const lastDay = new Date(year, month, 0).getDate();
  if (day > lastDay) return null;
  return `${parts.y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Sel tanggal bersegmen: tahun, bulan, dan hari masing-masing bisa diklik dan
 * diubah sendiri, dengan "-" sebagai teks tetap yang tidak bisa dihapus.
 * Kalender tetap terbuka di bawahnya untuk memilih secara visual.
 */
export default function DateCell({
  value,
  editing,
  readOnly,
  overdue,
  onStart,
  onEnd,
  onChange,
  onNavigate,
}: Props) {
  const refs = {
    y: useRef<HTMLInputElement>(null),
    m: useRef<HTMLInputElement>(null),
    d: useRef<HTMLInputElement>(null),
  };
  const [draft, setDraft] = useState(() => split(value));
  const [focusSeg, setFocusSeg] = useState<Seg>("d");

  useEffect(() => {
    if (!editing) return;
    setDraft(split(value));
    // Segmen yang diklik yang mendapat fokus, bukan selalu yang pertama.
    requestAnimationFrame(() => refs[focusSeg].current?.select());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, value]);

  const commit = (next: Record<Seg, string>) => {
    const iso = assemble(next);
    if (iso && iso !== value) onChange(iso);
    return iso;
  };

  /** Panah atas/bawah menggeser segmen yang sedang aktif. */
  const step = (seg: Seg, delta: number) => {
    const base = fromISO(value);
    const shifted =
      seg === "y"
        ? addYears(base, delta)
        : seg === "m"
          ? addMonths(base, delta)
          : addDays(base, delta);
    const iso = toISO(shifted);
    setDraft(split(iso));
    onChange(iso);
  };

  const focusSegment = (seg: Seg) => {
    setFocusSeg(seg);
    refs[seg].current?.select();
  };

  if (readOnly)
    return (
      <span
        className="num w-full cursor-not-allowed truncate text-[var(--color-faint)]"
        title="Tanggal baris induk dihitung dari sub-task-nya. Buka sub-task (▸) lalu ubah tanggalnya di sana."
      >
        {value}
      </span>
    );

  // Mode tampil: tiga span ringan, bukan tiga input, supaya 268 baris tidak
  // memuat ribuan elemen form sekaligus.
  if (!editing) {
    const parts = split(value);
    const start = (seg: Seg) => (event: React.MouseEvent) => {
      event.stopPropagation();
      setFocusSeg(seg);
      onStart();
    };
    return (
      <div
        className={`num flex w-full cursor-pointer items-center ${
          overdue ? "text-[var(--color-blocked)]" : ""
        }`}
        title={formatLong(value)}
      >
        <span
          className="rounded-[2px] px-px hover:bg-[var(--color-raised)]"
          onClick={start("y")}
        >
          {parts.y}
        </span>
        <span className="text-[var(--color-faint)]">-</span>
        <span
          className="rounded-[2px] px-px hover:bg-[var(--color-raised)]"
          onClick={start("m")}
        >
          {parts.m}
        </span>
        <span className="text-[var(--color-faint)]">-</span>
        <span
          className="rounded-[2px] px-px hover:bg-[var(--color-raised)]"
          onClick={start("d")}
        >
          {parts.d}
        </span>
      </div>
    );
  }

  const segmentInput = (seg: Seg) => (
    <input
      ref={refs[seg]}
      className="bare num rounded-[2px] px-px text-center focus:bg-[var(--color-mark)] focus:text-white"
      style={{ width: seg === "y" ? "4ch" : "2ch" }}
      value={draft[seg]}
      inputMode="numeric"
      onFocus={() => setFocusSeg(seg)}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(-LEN[seg]);
        const next = { ...draft, [seg]: digits };
        setDraft(next);
        if (digits.length === LEN[seg]) {
          commit(next);
          // Penuh → lanjut sendiri ke segmen berikutnya.
          const at = SEGS.indexOf(seg);
          if (at < SEGS.length - 1) focusSegment(SEGS[at + 1]);
        }
      }}
      onKeyDown={(e) => {
        const at = SEGS.indexOf(seg);
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          return step(seg, e.key === "ArrowUp" ? 1 : -1);
        }
        if (e.key === "ArrowRight" && at < SEGS.length - 1) {
          e.preventDefault();
          return focusSegment(SEGS[at + 1]);
        }
        if (e.key === "ArrowLeft" && at > 0) {
          e.preventDefault();
          return focusSegment(SEGS[at - 1]);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          commit(draft);
          return onEnd();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setDraft(split(value));
          return onEnd();
        }
        if (e.key === "Tab") {
          const next = at + (e.shiftKey ? -1 : 1);
          if (next >= 0 && next < SEGS.length) {
            e.preventDefault();
            commit(draft);
            return focusSegment(SEGS[next]);
          }
          e.preventDefault();
          commit(draft);
          onNavigate(e.shiftKey ? -1 : 1);
        }
      }}
    />
  );

  return (
    // Popover sengaja tidak mengatur buka-tutupnya sendiri: yang menentukan
    // hanya `editing` milik sel. Kalau Radix ikut memutuskan, memindahkan
    // fokus ke segmen (yang berada di luar popover) langsung dianggap
    // interaksi luar dan sel tertutup pada frame yang sama.
    <Popover open>
      <PopoverAnchor asChild>
        <div
          className="flex w-full items-center"
          onBlur={(e) => {
            // Tutup hanya bila fokus benar-benar keluar dari sel ini.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            commit(draft);
            onEnd();
          }}
        >
          {segmentInput("y")}
          <span className="text-[var(--color-faint)]">-</span>
          {segmentInput("m")}
          <span className="text-[var(--color-faint)]">-</span>
          {segmentInput("d")}
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.preventDefault()}
      >
        <Calendar
          mode="single"
          locale={localeId}
          weekStartsOn={1}
          selected={fromISO(value)}
          defaultMonth={fromISO(value)}
          onSelect={(date) => {
            if (!date) return;
            onChange(toISO(date));
            onEnd();
          }}
        />
        <div className="flex gap-1.5 border-t border-[var(--color-line)] p-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => {
              onChange(todayISO());
              onEnd();
            }}
          >
            Hari ini
          </Button>
          <input
            className="h-6 min-w-0 flex-1 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 text-[11px] outline-none focus:border-[var(--color-mark)]"
            placeholder="atau ketik: besok, senin, +3d, 10/09"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const parsed = parseDateInput(e.currentTarget.value, value);
              if (parsed) onChange(parsed);
              onEnd();
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
