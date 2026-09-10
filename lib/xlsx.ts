import ExcelJS from "exceljs";
import { listTasks } from "./db";
import { BAR, LEVEL_BAND, toArgb } from "./palette";
import { buildOutline } from "./rollup";
import type { TaskNode } from "./types";

/**
 * Export XLSX format DTDI: tabel WBS + Gantt mingguan.
 *
 * Lembarnya meniru laporan yang dipakai DTDI — empat kolom kiri (Task,
 * Progress, Start, End) lalu grid waktu tiga baris kepala: tahun, bulan,
 * dan empat kolom minggu per bulan.
 *
 * Warnanya diambil dari lembar Excel yang sudah ada dan dipakai juga oleh
 * tabel di layar. Lihat lib/palette.ts.
 */

/* ---------------------------------------------------------------- minggu */

/**
 * Minggu sebagai blok tanggal tetap, sama seperti scripts/import-outline.ts:
 * W1 = 1–7, W2 = 8–14, W3 = 15–21, W4 = 22–akhir bulan.
 *
 * Bedanya hanya di ujung: pengimpor mengenal W5 (29–akhir bulan), sedangkan
 * lembar ini cuma punya empat kolom per bulan, jadi tanggal 29+ ikut W4.
 * Kalau tidak disamakan, label "W5" akan muncul di kolom Start/End tapi tidak
 * punya kolom di grid.
 */
const WEEKS_PER_MONTH = 4;
const weekOfDay = (day: number) => Math.min(WEEKS_PER_MONTH, Math.ceil(day / 7));

const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

const parseYmd = (iso: string): Ymd => ({
  year: Number(iso.slice(0, 4)),
  month: Number(iso.slice(5, 7)),
  day: Number(iso.slice(8, 10)),
});

/** Bulan sebagai angka tunggal supaya selisihnya bisa dihitung. */
const monthIndex = (d: Ymd) => d.year * 12 + (d.month - 1);

/** "W1 07-25" — bentuk yang sama dengan sumber data. */
const weekLabel = (iso: string): string => {
  const d = parseYmd(iso);
  const mm = String(d.month).padStart(2, "0");
  const yy = String(d.year % 100).padStart(2, "0");
  return `W${weekOfDay(d.day)} ${mm}-${yy}`;
};

/* ----------------------------------------------------------------- gaya */

const INK = "FF7F7F7F";
const thin = { style: "thin" as const, color: { argb: INK } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };

const solid = (argb: string) =>
  ({ type: "pattern", pattern: "solid", fgColor: { argb } }) as const;

/** Latar baris per tingkat; tingkat 3 ke bawah dibiarkan putih. */
const BAND = [toArgb(LEVEL_BAND[0]), toArgb(LEVEL_BAND[1]), null] as const;
const bandOf = (depth: number) => BAND[Math.min(depth, BAND.length - 1)];

/* ---------------------------------------------------------------- kolom */

const COL_TASK = 1;
const COL_PROGRESS = 2;
const COL_START = 3;
const COL_END = 4;
const COL_TIMELINE = 5;

const HEAD_YEAR = 1;
const HEAD_MONTH = 2;
const HEAD_WEEK = 3;
const FIRST_DATA_ROW = 4;

/** Nama berkas yang ditawarkan di dialog simpan. */
export const xlsxFileName = () =>
  `zenowork-dtdi-${new Date().toISOString().slice(0, 10)}.xlsx`;

export async function buildTimelineWorkbook(): Promise<Buffer> {
  const outline = buildOutline(listTasks(), { column: "manual", dir: "asc" });
  const nodes = outline.all;

  const wb = new ExcelJS.Workbook();
  wb.creator = "ZenoWork";
  wb.created = new Date();

  const ws = wb.addWorksheet("Timeline", {
    views: [
      {
        state: "frozen",
        xSplit: COL_END,
        ySplit: HEAD_WEEK,
      },
    ],
  });

  ws.getColumn(COL_TASK).width = 58;
  ws.getColumn(COL_PROGRESS).width = 11;
  ws.getColumn(COL_START).width = 11;
  ws.getColumn(COL_END).width = 11;

  if (nodes.length === 0) {
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  /* Rentang waktu = gabungan seluruh baris, dibulatkan ke bulan penuh. */
  let firstMonth = Infinity;
  let lastMonth = -Infinity;
  for (const node of nodes) {
    firstMonth = Math.min(firstMonth, monthIndex(parseYmd(node.eff.start)));
    lastMonth = Math.max(lastMonth, monthIndex(parseYmd(node.eff.end)));
  }
  const monthCount = lastMonth - firstMonth + 1;
  const weekCount = monthCount * WEEKS_PER_MONTH;

  /** Posisi kolom sebuah tanggal di grid. */
  const weekColumn = (iso: string): number => {
    const d = parseYmd(iso);
    const offset = monthIndex(d) - firstMonth;
    return COL_TIMELINE + offset * WEEKS_PER_MONTH + (weekOfDay(d.day) - 1);
  };

  for (let i = 0; i < weekCount; i++) {
    ws.getColumn(COL_TIMELINE + i).width = 3.1;
  }

  /* ------------------------------------------------------- baris kepala */

  const labels: Array<[number, string]> = [
    [COL_TASK, "TASK"],
    [COL_PROGRESS, "PROGRESS"],
    [COL_START, "START"],
    [COL_END, "END"],
  ];
  for (const [col, text] of labels) {
    ws.mergeCells(HEAD_YEAR, col, HEAD_WEEK, col);
    const cell = ws.getCell(HEAD_YEAR, col);
    cell.value = text;
    cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BOX;
  }

  // Garis dan label bulan/minggu dulu; penggabungan sel tahun menyusul,
  // karena merge menghapus format sel yang ditelannya.
  for (let i = 0; i < monthCount; i++) {
    const month = (firstMonth + i) % 12;
    const left = COL_TIMELINE + i * WEEKS_PER_MONTH;

    for (let w = 0; w < WEEKS_PER_MONTH; w++) {
      const week = ws.getCell(HEAD_WEEK, left + w);
      week.value = w + 1;
      week.font = { bold: true, size: 9 };
      week.alignment = { horizontal: "center", vertical: "middle" };
      week.border = BOX;
      ws.getCell(HEAD_MONTH, left + w).border = BOX;
      ws.getCell(HEAD_YEAR, left + w).border = BOX;
    }

    ws.mergeCells(HEAD_MONTH, left, HEAD_MONTH, left + WEEKS_PER_MONTH - 1);
    const head = ws.getCell(HEAD_MONTH, left);
    head.value = MONTHS_ID[month];
    head.font = { bold: true };
    head.alignment = { horizontal: "center", vertical: "middle" };
    head.border = BOX;
  }

  // Satu sel tahun per rentetan bulan dengan tahun yang sama.
  let groupStart = 0;
  for (let i = 0; i <= monthCount; i++) {
    const year = Math.floor((firstMonth + i) / 12);
    const prevYear = Math.floor((firstMonth + groupStart) / 12);
    if (i < monthCount && year === prevYear) continue;

    const from = COL_TIMELINE + groupStart * WEEKS_PER_MONTH;
    const to = COL_TIMELINE + i * WEEKS_PER_MONTH - 1;
    if (to > from) ws.mergeCells(HEAD_YEAR, from, HEAD_YEAR, to);
    const cell = ws.getCell(HEAD_YEAR, from);
    cell.value = prevYear;
    cell.numFmt = "0";
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BOX;
    groupStart = i;
  }

  /* --------------------------------------------------------- baris data */

  nodes.forEach((node: TaskNode, i) => {
    const r = FIRST_DATA_ROW + i;
    const row = ws.getRow(r);
    const fillBand = bandOf(node.depth);
    const bold = node.depth < 2;

    const task = row.getCell(COL_TASK);
    task.value = `${node.wbs}. ${node.task.title}`;
    task.alignment = { vertical: "middle" };

    const progress = row.getCell(COL_PROGRESS);
    progress.value = node.eff.progress / 100;
    progress.numFmt = "0%";
    progress.alignment = { horizontal: "right", vertical: "middle" };

    const start = row.getCell(COL_START);
    start.value = weekLabel(node.eff.start);
    const end = row.getCell(COL_END);
    end.value = weekLabel(node.eff.end);
    for (const cell of [start, end]) {
      cell.alignment = { horizontal: "center", vertical: "middle" };
    }

    for (const cell of [task, progress, start, end]) {
      cell.font = { bold };
      cell.border = BOX;
      if (fillBand) cell.fill = solid(fillBand);
    }

    // Sel tidak bisa diisi separuh seperti bar di layar, jadi bagian pekat
    // dipakai sebagai penanda minggu berakhir dan sisanya versi mudanya.
    const from = weekColumn(node.eff.start);
    const to = weekColumn(node.eff.end);
    for (let c = COL_TIMELINE; c < COL_TIMELINE + weekCount; c++) {
      const cell = row.getCell(c);
      cell.border = BOX;
      // Bilah menang atas warna baris; di luar bilah, grid ikut warna baris.
      const inBar = c >= from && c <= to;
      const fill = inBar ? toArgb(c === to ? BAR.solid : BAR.track) : fillBand;
      if (fill) cell.fill = solid(fill);
    }
  });

  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
