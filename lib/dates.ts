import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  format,
  isValid,
  parse,
  parseISO,
  endOfMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { id as localeId } from "date-fns/locale";

export type ISODate = string; // YYYY-MM-DD

export const toISO = (d: Date): ISODate => format(d, "yyyy-MM-dd");
export const fromISO = (s: ISODate): Date => parseISO(s);
export const todayISO = (): ISODate => toISO(new Date());

export const shiftISO = (s: ISODate, days: number): ISODate =>
  toISO(addDays(fromISO(s), days));

export const diffDays = (a: ISODate, b: ISODate): number =>
  differenceInCalendarDays(fromISO(b), fromISO(a));

/** Durasi inklusif: start == end berarti 1 hari. */
export const durationOf = (start: ISODate, end: ISODate): number =>
  diffDays(start, end) + 1;

export const minISO = (a: ISODate, b: ISODate): ISODate => (a < b ? a : b);
export const maxISO = (a: ISODate, b: ISODate): ISODate => (a > b ? a : b);

export const formatShort = (s: ISODate): string =>
  format(fromISO(s), "d MMM", { locale: localeId });

export const formatLong = (s: ISODate): string =>
  format(fromISO(s), "d MMMM yyyy", { locale: localeId });

/** "Senin", "Selasa", ... */
export const formatWeekday = (s: ISODate): string =>
  format(fromISO(s), "EEEE", { locale: localeId });

export const isWeekend = (s: ISODate): boolean => {
  const d = fromISO(s).getDay();
  return d === 0 || d === 6;
};

export const weekStartISO = (s: ISODate): ISODate =>
  toISO(startOfWeek(fromISO(s), { weekStartsOn: 1 }));

export const monthStartISO = (s: ISODate): ISODate =>
  toISO(startOfMonth(fromISO(s)));

export const monthEndISO = (s: ISODate): ISODate => toISO(endOfMonth(fromISO(s)));

export type RangeKind = "today" | "week" | "month";

/** Batas [awal, akhir] inklusif untuk filter periode (§5.6). */
export function rangeBounds(
  kind: RangeKind,
  today: ISODate,
): [ISODate, ISODate] {
  if (kind === "today") return [today, today];
  if (kind === "week") {
    const start = weekStartISO(today);
    return [start, shiftISO(start, 6)];
  }
  return [monthStartISO(today), monthEndISO(today)];
}

const RELATIVE_WORDS: Record<string, number> = {
  "hari ini": 0,
  today: 0,
  kemarin: -1,
  besok: 1,
  lusa: 2,
};

const WEEKDAYS = [
  "minggu",
  "senin",
  "selasa",
  "rabu",
  "kamis",
  "jumat",
  "sabtu",
];

const ABSOLUTE_FORMATS = [
  "yyyy-MM-dd",
  "dd/MM/yyyy",
  "dd/MM",
  "d/M",
  "d MMM yyyy",
  "d MMM",
  "d MMMM yyyy",
  "d MMMM",
];

/**
 * Parsing input sel tanggal (§5.5.6 PRD).
 * Menerima absolut ("2026-09-10", "10/09"), relatif ("besok", "senin"),
 * dan offset dari nilai sekarang ("+3d", "-1w", "+2m").
 * Mengembalikan null bila tidak dikenali — pemanggil membatalkan edit.
 */
export function parseDateInput(raw: string, current: ISODate): ISODate | null {
  const input = raw.trim().toLowerCase();
  if (!input) return null;

  if (input in RELATIVE_WORDS) return shiftISO(todayISO(), RELATIVE_WORDS[input]);

  const offset = input.match(/^([+-])\s*(\d+)\s*([dhwmb])$/);
  if (offset) {
    const sign = offset[1] === "-" ? -1 : 1;
    const n = sign * Number(offset[2]);
    const base = fromISO(current);
    const unit = offset[3];
    if (unit === "d" || unit === "h") return toISO(addDays(base, n));
    if (unit === "w") return toISO(addWeeks(base, n));
    return toISO(addMonths(base, n));
  }

  const weekday = WEEKDAYS.indexOf(input);
  if (weekday >= 0) {
    // Hari terdekat ke depan yang cocok, hari ini termasuk.
    const start = new Date();
    for (let i = 0; i < 7; i++) {
      const c = addDays(start, i);
      if (c.getDay() === weekday) return toISO(c);
    }
  }

  const ref = fromISO(current);
  for (const fmt of ABSOLUTE_FORMATS) {
    const parsed = parse(input, fmt, ref, { locale: localeId });
    if (isValid(parsed)) return toISO(parsed);
  }
  return null;
}

/** Parsing sel Duration: "5", "5d", "2w". Mengembalikan jumlah hari (>= 1). */
export function parseDurationInput(raw: string): number | null {
  const input = raw.trim().toLowerCase();
  const m = input.match(/^(\d+)\s*([dhw])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1) return null;
  return m[2] === "w" ? n * 7 : n;
}
