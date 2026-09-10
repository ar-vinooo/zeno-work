"use client";

import type { ZenoApi } from "@/electron/api";

/**
 * Akses halaman ke proses utama.
 *
 * Diambil saat dipanggil, bukan disimpan sebagai konstanta modul: preload
 * mengisi `window.zeno` sebelum skrip halaman jalan, tapi modul ini ikut
 * dievaluasi juga saat `next build` merender halaman di Node, di mana
 * `window` sama sekali tidak ada.
 */
export function zeno(): ZenoApi {
  const api = (globalThis as { zeno?: ZenoApi }).zeno;
  if (!api)
    throw new Error(
      "Jembatan desktop tidak tersedia. Buka ZenoWork lewat aplikasinya, bukan lewat browser.",
    );
  return api;
}
