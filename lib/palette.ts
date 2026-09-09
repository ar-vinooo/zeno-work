/**
 * Empat warna, diambil apa adanya dari lembar Excel DTDI yang sudah dipakai.
 * Tidak ada warna kelima — lembar itu memang cuma memakai empat ini.
 *
 * Status tidak ikut menentukan warna bar, sama seperti di lembar aslinya.
 * Yang membedakan maju-tidaknya sebuah task adalah seberapa panjang bagian
 * pekatnya, bukan warnanya.
 *
 * Nilai-nilai ini juga tertulis sebagai token di app/globals.css. Keduanya
 * harus sama, dan scripts/check-tree.ts memeriksanya tiap `npm test`.
 */

export interface Tone {
  /** Bagian pekat: isian progres di layar, sel minggu terakhir di Excel. */
  solid: string;
  /** Rentang bar — hijau muda. */
  track: string;
}

export const BAR: Tone = { solid: "#8ed973", track: "#daf2d0" };

/** Latar baris induk; baris tingkat 3 dibiarkan putih. */
export const LEVEL_BAND = ["#d9d9d9", "#f2f2f2"] as const;

/** Token CSS mode terang yang harus sama isinya dengan nilai di atas. */
export const PALETTE_TOKENS: Record<string, string> = {
  "--color-level-1": LEVEL_BAND[0],
  "--color-level-2": LEVEL_BAND[1],
  "--color-bar": BAR.solid,
  "--color-bar-track": BAR.track,
};

/** "#8ed973" → "FF8ED973", bentuk yang diminta ExcelJS. */
export const toArgb = (hex: string): string => `FF${hex.slice(1).toUpperCase()}`;
