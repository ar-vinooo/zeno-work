"use client";

import { addDays, format, startOfMonth } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { fromISO, shiftISO, toISO } from "@/lib/dates";
import { xForDate, type Scale } from "@/lib/schedule";

interface Props {
  scale: Scale;
  width: number;
  todayX: number;
}

/** Dua baris: label bulan di atas, penanda hari/minggu di bawah. */
export default function TimelineHeader({ scale, width, todayX }: Props) {
  const months: { label: string; x: number; w: number }[] = [];
  const end = shiftISO(scale.origin, scale.days);
  let cursor = toISO(startOfMonth(fromISO(scale.origin)));
  while (cursor < end) {
    const next = toISO(addDays(startOfMonth(addDays(fromISO(cursor), 32)), 0));
    const from = cursor < scale.origin ? scale.origin : cursor;
    const to = next < end ? next : end;
    const x = xForDate(scale, from);
    months.push({
      label: format(fromISO(from), "MMMM yyyy", { locale: localeId }),
      x,
      w: xForDate(scale, to) - x,
    });
    cursor = next;
  }

  const step = scale.unit === "day" ? 1 : scale.unit === "week" ? 1 : 7;
  const ticks: { label: string; x: number }[] = [];
  for (let i = 0; i < scale.days; i += step) {
    const date = shiftISO(scale.origin, i);
    ticks.push({
      label:
        scale.unit === "month"
          ? format(fromISO(date), "d/M")
          : format(fromISO(date), "d"),
      x: xForDate(scale, date),
    });
  }

  return (
    <div className="relative shrink-0" style={{ width, height: 40 }}>
      <div className="relative h-5 border-b border-[var(--color-line)]">
        {months.map((m) => (
          <div
            key={m.x}
            className="absolute top-0 h-5 truncate border-l border-[var(--color-line-strong)] px-1.5 text-[11px] leading-5 text-[var(--color-ink-soft)]"
            style={{ left: m.x, width: m.w }}
          >
            {m.label}
          </div>
        ))}
      </div>
      <div className="relative h-5">
        {ticks.map((t) => (
          <div
            key={t.x}
            className="num absolute top-0 text-center text-[9px] leading-5 text-[var(--color-faint)]"
            style={{ left: t.x, width: scale.dayWidth * step }}
          >
            {scale.dayWidth >= 12 || scale.unit === "month" ? t.label : ""}
          </div>
        ))}
        <div
          className="absolute inset-y-0 w-px"
          style={{ left: todayX, background: "var(--color-mark)" }}
        />
      </div>
    </div>
  );
}
