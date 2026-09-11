export type Status = "todo" | "in_progress" | "blocked" | "done";
export type Priority = "low" | "medium" | "high";

export type EvidenceAssetKind = "file" | "link";

export interface EvidenceAsset {
  id: string;
  kind: EvidenceAssetKind;
  label: string;
  /** kind "link" = URL apa adanya. kind "file" = path relatif ke data/evidence. */
  href: string;
  mime: string;
  bytes: number;
}

/** Satu entri catatan/bukti bertanggal milik sebuah task. */
export interface EvidenceEntry {
  id: string;
  at: string; // YYYY-MM-DD
  body: string;
  assets: EvidenceAsset[];
  createdAt: string;
  updatedAt: string;
}

/** Baris seperti tersimpan di DB. Nomor WBS TIDAK ada di sini — lihat lib/tree.ts. */
export interface Task {
  id: string;
  parentId: string | null;
  /** Urutan di antara saudara sekandung. Dinormalisasi 0..n setelah tiap pemindahan. */
  order: number;
  title: string;
  progress: number;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  status: Status;
  priority: Priority;
  collapsed: boolean;
  /** true = progres & tanggal induk dihitung dari anak (§4.3 PRD). */
  rollup: boolean;
  notes: string;
  /** Log catatan/bukti. Disimpan sebagai JSON di satu kolom TEXT. */
  evidence: EvidenceEntry[];
  /** Folder Git lokal milik task ini. Anak mewarisi milik induk saat kosong. */
  repositoryPath: string;
  createdAt: string;
  updatedAt: string;
}

/** Nilai efektif setelah roll-up. Untuk daun = nilai tersimpan apa adanya. */
export interface Effective {
  progress: number;
  start: string;
  end: string;
  status: Status;
}

export interface TaskNode {
  task: Task;
  children: TaskNode[];
  depth: number;
  /** "1", "1.2", "1.2.3" — selalu dihitung ulang, tidak pernah disimpan. */
  wbs: string;
  eff: Effective;
  /** Induk ber-roll-up: sel Progress/Start/End read-only. */
  derived: boolean;
}

/** Satu baris yang benar-benar digambar di tabel. */
export interface Row extends TaskNode {
  /** Hanya tampil sebagai konteks leluhur dari hasil filter (§5.6). */
  contextOnly: boolean;
}

/** Perubahan parsial yang dikirim ke API sebagai satu transaksi. */
export type Patch = { id: string } & Partial<Omit<Task, "id">>;

/**
 * Rentang tanggal cepat di toolbar. "all" = tanpa batas periode.
 * Akhiran "-onward" = dari awal periode itu ke depan, tanpa batas akhir.
 */
export type DateRange =
  | "all"
  | "today"
  | "week"
  | "month"
  | "today-onward"
  | "week-onward"
  | "month-onward"
  /** Sejak tanggal yang kamu pilih sendiri, tanpa batas akhir. */
  | "from";

export interface Filters {
  query: string;
  range: DateRange;
  /** Dipakai hanya saat range === "from". ISO, kosong = belum dipilih. */
  fromDate: string;
  status: Status[];
  priority: Priority[];
  hideDone: boolean;
  overdueOnly: boolean;
  activeOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  query: "",
  range: "all",
  fromDate: "",
  status: [],
  priority: [],
  hideDone: false,
  overdueOnly: false,
  activeOnly: false,
};

export const STATUS_LABEL: Record<Status, string> = {
  todo: "Todo",
  in_progress: "Jalan",
  blocked: "Blocked",
  done: "Done",
};

export const RANGE_LABEL: Record<DateRange, string> = {
  all: "Semua",
  today: "Hari ini",
  week: "Minggu ini",
  month: "Bulan ini",
  "today-onward": "Hari ini ke depan",
  "week-onward": "Minggu ini ke depan",
  "month-onward": "Bulan ini ke depan",
  from: "Dari tanggal",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
};
