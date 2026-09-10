import type { NextConfig } from "next";

const config: NextConfig = {
  // Halaman diekspor jadi berkas statis di out/ lalu disajikan proses utama
  // Electron lewat skema app://. Tidak ada server Next yang hidup.
  output: "export",
};

export default config;
