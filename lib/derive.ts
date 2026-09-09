import { diffDays, durationOf, todayISO } from "./dates";
import type { Effective } from "./types";

export const duration = (eff: Effective) => durationOf(eff.start, eff.end);

/** Lewat tanggal akhir dan belum 100% (§4.1 PRD). */
export const isOverdue = (eff: Effective, today = todayISO()) =>
  eff.end < today && eff.progress < 100;

export const isActive = (eff: Effective, today = todayISO()) =>
  eff.start <= today && today <= eff.end;

/** Sisa hari sampai `end`. Negatif berarti sudah lewat. */
export const daysLeft = (eff: Effective, today = todayISO()) =>
  diffDays(today, eff.end);
