import { shiftISO } from "./dates";
import type { SchedulePreview } from "./store";
import type { Effective } from "./types";

/**
 * Nilai yang DITAMPILKAN selama drag berlangsung. Tidak menyentuh state
 * tersimpan — inilah yang membuat kolom Start/End dan bar bergerak bersamaan
 * sebelum perubahan di-commit.
 */
export function applyPreview(
  eff: Effective,
  id: string,
  preview: SchedulePreview | null,
): Effective {
  if (!preview || preview.days === 0 || !preview.ids.includes(id)) return eff;
  const d = preview.days;
  if (preview.mode === "move")
    return { ...eff, start: shiftISO(eff.start, d), end: shiftISO(eff.end, d) };
  if (preview.mode === "start") {
    const start = shiftISO(eff.start, d);
    return { ...eff, start: start > eff.end ? eff.end : start };
  }
  const end = shiftISO(eff.end, d);
  return { ...eff, end: end < eff.start ? eff.start : end };
}
