export const ROW_H = 32;
export const INDENT = 16;

export type ColKey =
  | "action"
  | "wbs"
  | "title"
  | "progress"
  | "status"
  | "start"
  | "end"
  | "duration";

/** Lebar bawaan tiap kolom, dalam px. */
export const COL: Record<ColKey, number> = {
  // Pas mengikuti isi: 5 tombol × 12px + 4 sela × 4px + padding sel 12px.
  // Tombol tetap mengambil ruang saat transparan agar tabel tidak bergeser.
  action: 88,
  wbs: 92,
  title: 236,
  progress: 92,
  status: 78,
  start: 82,
  end: 82,
  duration: 56,
};

/** Batas bawah supaya kolom tidak bisa diseret sampai isinya tak terbaca. */
export const COL_MIN: Record<ColKey, number> = {
  action: 88,
  wbs: 56,
  title: 120,
  progress: 72,
  status: 56,
  start: 72,
  end: 72,
  duration: 48,
};

export const COL_MAX = 720;

export const cssVar = (key: ColKey) => `--col-${key}`;
export const widthOf = (key: ColKey) => `var(${cssVar(key)})`;

/**
 * Lebar panel kiri sebagai ekspresi CSS, bukan angka: dengan begitu menyeret
 * satu kolom cukup mengubah satu variabel, dan seluruh baris ikut menyesuaikan
 * tanpa React me-render ulang 200+ baris tiap frame.
 */
export const LEFT_WIDTH =
  "calc(var(--col-action) + var(--col-wbs) + var(--col-title) + var(--col-progress) + var(--col-status) + var(--col-start) + var(--col-end) + var(--col-duration))";

export const STORAGE_KEY = "zenowork.columns";

export function initialVars(showDuration: boolean): React.CSSProperties {
  const vars: Record<string, string> = { "--col-left": LEFT_WIDTH };
  for (const key of Object.keys(COL) as ColKey[])
    vars[cssVar(key)] =
      key === "duration" && !showDuration ? "0px" : `${COL[key]}px`;
  return vars as React.CSSProperties;
}
