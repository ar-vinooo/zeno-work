import { diffDays, shiftISO, weekStartISO } from "./dates";
import type { ISODate } from "./dates";

export type ZoomUnit = "day" | "week" | "month";

/** Lebar satu hari dalam px per level zoom. */
export const DAY_WIDTH: Record<ZoomUnit, number> = {
  day: 34,
  week: 16,
  month: 5,
};

export interface Scale {
  unit: ZoomUnit;
  dayWidth: number;
  /** Tanggal paling kiri pada grid. */
  origin: ISODate;
  days: number;
}

export function makeScale(unit: ZoomUnit, origin: ISODate, days: number): Scale {
  return { unit, dayWidth: DAY_WIDTH[unit], origin, days };
}

export const xForDate = (scale: Scale, date: ISODate): number =>
  diffDays(scale.origin, date) * scale.dayWidth;

/** Lebar bar inklusif: start == end menghasilkan satu petak hari. */
export const widthForRange = (
  scale: Scale,
  start: ISODate,
  end: ISODate,
): number => (diffDays(start, end) + 1) * scale.dayWidth;

/** px → jumlah hari, dibulatkan ke petak hari terdekat (snapping §5.5.2). */
export const daysForDx = (scale: Scale, dx: number): number =>
  Math.round(dx / scale.dayWidth);

/** Snap ke awal minggu terdekat — dipakai saat menahan Alt. */
export function snapToWeek(date: ISODate): ISODate {
  const start = weekStartISO(date);
  return diffDays(start, date) >= 4 ? shiftISO(start, 7) : start;
}
