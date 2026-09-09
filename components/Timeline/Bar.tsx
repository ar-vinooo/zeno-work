"use client";

import { durationOf, formatShort } from "@/lib/dates";
import { isOverdue } from "@/lib/derive";
import { widthForRange, xForDate, type Scale } from "@/lib/schedule";
import type { DragMode } from "@/lib/store";
import type { Effective, Row } from "@/lib/types";

interface Props {
  row: Row;
  scale: Scale;
  /** Nilai tersimpan — dipakai menggambar bayangan posisi asal saat drag. */
  eff: Effective;
  /** Nilai yang ditampilkan (sudah termasuk pratinjau drag). */
  display: Effective;
  previewing: boolean;
  showTooltip: boolean;
  deltaDays: number;
  onBegin: (event: React.PointerEvent, mode: DragMode) => void;
}

/**
 * Dua warna saja, sama seperti lembar XLSX: yang pekat untuk bagian yang
 * sudah jalan, yang muda untuk sisa rentangnya. Status tidak mengubah warna
 * bar — yang terhambat tetap ditandai garis merah di tepinya.
 */
const SOLID = "var(--color-bar)";
const TRACK = "var(--color-bar-track)";

export default function Bar({
  row,
  scale,
  eff,
  display,
  previewing,
  showTooltip,
  deltaDays,
  onBegin,
}: Props) {
  const left = xForDate(scale, display.start);
  const width = Math.max(scale.dayWidth, widthForRange(scale, display.start, display.end));
  const overdue = isOverdue(display);
  const summary = row.derived;
  const base = SOLID;
  const days = durationOf(display.start, display.end);

  return (
    <>
      {previewing && (
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-[3px] border border-dashed border-[var(--color-line-strong)] opacity-70"
          style={{
            left: xForDate(scale, eff.start),
            width: Math.max(scale.dayWidth, widthForRange(scale, eff.start, eff.end)),
            height: summary ? 8 : 15,
          }}
        />
      )}

      <div
        className={`group absolute top-1/2 -translate-y-1/2 ${
          summary ? "cursor-grab" : "cursor-grab"
        }`}
        style={{ left, width, height: summary ? 9 : 15 }}
        onPointerDown={(e) => onBegin(e, "move")}
        title={`${formatShort(display.start)} – ${formatShort(display.end)} · ${days} hari`}
      >
        {summary ? (
          // Bar ringkasan: pipih dengan kaki di kedua ujung (§5.4).
          <div className="relative h-full w-full">
            <div
              className="absolute inset-x-0 top-0 h-[5px] rounded-[1px] opacity-90"
              style={{ background: base }}
            >
              <div
                className="h-full rounded-[1px]"
                style={{
                  width: `${display.progress}%`,
                  background: "var(--color-ink)",
                  opacity: 0.55,
                }}
              />
            </div>
            <div
              className="absolute left-0 top-[4px] h-[5px] w-[2px]"
              style={{ background: base }}
            />
            <div
              className="absolute right-0 top-[4px] h-[5px] w-[2px]"
              style={{ background: base }}
            />
          </div>
        ) : (
          <div
            className="relative h-full w-full overflow-hidden rounded-[3px]"
            style={{
              // Dulu di sini `opacity: 0.35`. Opacity ikut menipiskan isian
              // progres di dalamnya, jadi keduanya jadi satu warna dan
              // persentasenya tidak pernah terlihat.
              background: TRACK,
              boxShadow: overdue ? "0 0 0 1px var(--color-blocked)" : undefined,
            }}
          >
            <div
              className="h-full"
              style={{ width: `${display.progress}%`, background: base }}
            />
          </div>
        )}

        {/* Zona ubah durasi. Untuk induk ber-roll-up panjang bar adalah hasil
            hitungan anak, jadi ujungnya tidak bisa ditarik. */}
        <div
          className={`absolute inset-y-0 left-0 w-2 ${
            summary ? "cursor-not-allowed" : "cursor-col-resize"
          }`}
          onPointerDown={(e) => onBegin(e, "start")}
          title={summary ? "Durasi induk mengikuti sub-task" : "Ubah tanggal mulai"}
        />
        <div
          className={`absolute inset-y-0 right-0 w-2 ${
            summary ? "cursor-not-allowed" : "cursor-col-resize"
          }`}
          onPointerDown={(e) => onBegin(e, "end")}
          title={summary ? "Durasi induk mengikuti sub-task" : "Ubah tanggal selesai"}
        />
      </div>

      {showTooltip && (
        <div
          className="pointer-events-none absolute z-30 -translate-y-full whitespace-nowrap rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] shadow-sm num"
          style={{ left, top: -2 }}
        >
          {formatShort(display.start)} → {formatShort(display.end)} · {days} hari
          {deltaDays !== 0 && (
            <span className="text-[var(--color-mark)]">
              {" "}
              · {deltaDays > 0 ? "+" : ""}
              {deltaDays} hari
            </span>
          )}
        </div>
      )}
    </>
  );
}
