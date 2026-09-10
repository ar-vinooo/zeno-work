import type { Anthropic } from "@anthropic-ai/sdk";
import { formatLong, formatWeekday, rangeBounds, todayISO } from "./dates";
import type { Status } from "./types";

/**
 * Tanggal hari ini sebagai blok tersendiri.
 *
 * Model tidak tahu hari ini tanggal berapa — tebakannya berasal dari data
 * latihan dan hampir selalu meleset. Satu baris yang terselip di antara
 * ratusan baris outline gampang terlewat, jadi konteks waktunya dipisah,
 * dinyatakan otoritatif, dan sekalian membawa batas minggu & bulan berjalan
 * supaya "minggu ini" tidak perlu dihitung sendiri oleh model.
 */
export function dateContext(): string {
  const today = todayISO();
  const [weekStart, weekEnd] = rangeBounds("week", today);
  const [monthStart, monthEnd] = rangeBounds("month", today);
  return `KONTEKS WAKTU — otoritatif, pakai ini dan abaikan dugaanmu sendiri soal tanggal.
Hari ini: ${formatWeekday(today)}, ${formatLong(today)} (${today}).
Minggu ini: ${weekStart} sampai ${weekEnd} (Senin–Minggu).
Bulan ini: ${monthStart} sampai ${monthEnd}.
Semua kata relatif — "hari ini", "besok", "minggu ini", "bulan depan", "akhir bulan" — dihitung dari tanggal di atas. Tanggal yang kamu usulkan selalu YYYY-MM-DD.`;
}

/** Satu baris baru. `children` menampung sub-task langsung di tempat. */
export interface AiNewTask {
  title: string;
  start?: string;
  end?: string;
  progress?: number;
  status?: Status;
  children?: AiNewTask[];
}

export interface AiUpdate {
  wbs: string;
  title?: string;
  start?: string;
  end?: string;
  progress?: number;
  status?: Status;
}

/**
 * Semua operasi berbentuk jamak. Alasannya bukan sekadar hemat token:
 * menyusun sub-task lewat `children` membuat anak tidak perlu menyebut nomor
 * WBS induknya — dan itu satu-satunya cara membuat pohon bertingkat dalam
 * satu giliran, karena baris yang baru dibuat belum punya nomor.
 */
export type AiOperation =
  | {
      op: "add_tasks";
      tasks: AiNewTask[];
      parent_wbs?: string;
      after_wbs?: string;
    }
  | { op: "update_tasks"; updates: AiUpdate[] }
  | { op: "delete_tasks"; wbs: string[] };

/** Batas kewarasan supaya satu giliran tidak menulis ribuan baris. */
export const MAX_TASKS_PER_CALL = 200;

const DATE = { type: "string" as const, description: "Tanggal YYYY-MM-DD" };
const PROGRESS = {
  type: "integer" as const,
  description: "Persen penyelesaian, 0 sampai 100",
};
const STATUS = {
  type: "string" as const,
  enum: ["todo", "in_progress", "blocked", "done"],
};

// Kedalaman ditulis eksplisit sampai tiga tingkat, bukan lewat $ref rekursif:
// aplikasi ini memang membatasi tiga tingkat, dan skema eksplisit lebih aman
// diterima API daripada referensi ke diri sendiri.
const leaf = {
  type: "object" as const,
  required: ["title"],
  properties: {
    title: { type: "string" as const },
    start: DATE,
    end: DATE,
    progress: PROGRESS,
    status: STATUS,
  },
};
const level2 = {
  ...leaf,
  properties: {
    ...leaf.properties,
    children: {
      type: "array" as const,
      description: "Sub-task tingkat ketiga",
      items: leaf,
    },
  },
};
const level1 = {
  ...leaf,
  properties: {
    ...leaf.properties,
    children: {
      type: "array" as const,
      description: "Sub-task tingkat berikutnya",
      items: level2,
    },
  },
};

/**
 * Tool BACA. Dijalankan langsung di proses utama lalu hasilnya dikembalikan ke model,
 * sehingga ia bisa menelusuri dulu sebelum mengusulkan apa pun. Aman dieksekusi
 * tanpa persetujuan karena tidak mengubah apa-apa.
 */
export const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "find_tasks",
    description:
      "Cari baris berdasarkan kata pada judul dan/atau saringan. Pakai ini untuk menelusuri sebelum memutuskan, mis. mencari apakah sudah ada pekerjaan sejenis, atau melihat mana yang overdue di satu bagian. Bisa dibatasi ke satu cabang lewat scope_wbs.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Kata kunci pada judul" },
        scope_wbs: {
          type: "string",
          description: 'Batasi ke dalam cabang ini, mis. "5" atau "5.7"',
        },
        status: STATUS,
        overdue: { type: "boolean", description: "Hanya yang lewat tenggat" },
        depth: { type: "integer", description: "Batasi tingkat: 1, 2, atau 3" },
        limit: { type: "integer", description: "Maksimal hasil, bawaan 40" },
      },
    },
  },
  {
    name: "get_subtree",
    description:
      "Tampilkan isi satu cabang beserta sub-task di bawahnya. Pakai untuk menyelami satu bagian sebelum menentukan penempatan.",
    input_schema: {
      type: "object",
      required: ["wbs"],
      properties: {
        wbs: { type: "string", description: 'Nomor bagian, mis. "5" atau "5.7"' },
        depth: {
          type: "integer",
          description: "Berapa tingkat ke bawah, bawaan 2",
        },
      },
    },
  },
];

/** Tool TULIS. Tidak pernah dijalankan sendiri — hanya dikumpulkan jadi usulan. */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "add_tasks",
    description:
      "Tambah satu atau BANYAK baris sekaligus. Selalu pakai tool ini untuk menambah, walau cuma satu baris. Susun sub-task lewat properti children — jangan membuat induk lalu memanggil tool lagi untuk anaknya, karena baris baru belum punya nomor WBS. parent_wbs menaruh semuanya di dalam baris itu; after_wbs menaruhnya setingkat setelah baris itu; tanpa keduanya, ditaruh di tingkat 1 paling bawah.",
    input_schema: {
      type: "object",
      required: ["tasks"],
      properties: {
        tasks: { type: "array", items: level1 },
        parent_wbs: { type: "string", description: 'Nomor WBS induk, mis. "5.7"' },
        after_wbs: { type: "string", description: "Nomor WBS baris acuan" },
      },
    },
  },
  {
    name: "update_tasks",
    description:
      "Ubah satu atau BANYAK baris sekaligus. Sertakan hanya field yang ingin diubah pada tiap entri. Baris induk tidak bisa diubah tanggal/progres/statusnya karena dihitung dari sub-task.",
    input_schema: {
      type: "object",
      required: ["updates"],
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            required: ["wbs"],
            properties: {
              wbs: { type: "string" },
              title: { type: "string" },
              start: DATE,
              end: DATE,
              progress: PROGRESS,
              status: STATUS,
            },
          },
        },
      },
    },
  },
  {
    name: "delete_tasks",
    description:
      "Hapus satu atau banyak baris beserta seluruh sub-task di bawahnya. Gunakan hanya bila pengguna memintanya dengan jelas.",
    input_schema: {
      type: "object",
      required: ["wbs"],
      properties: {
        wbs: { type: "array", items: { type: "string" }, description: "Daftar nomor WBS" },
      },
    },
  },
];

export const SYSTEM_INSTRUCTIONS = `Kamu asisten di dalam ZenoWork, aplikasi manajemen pekerjaan personal berbasis WBS bertingkat dan timeline.

Tugasmu membantu pengguna menyusun daftar pekerjaannya: menambah baris, mengubah judul/tanggal/progres/status, dan menghapus bila diminta.

Aturan yang harus dipatuhi:
- Panggil tool untuk setiap perubahan. Jangan pernah mengaku sudah mengubah sesuatu tanpa memanggil tool.
- Tool-nya jamak: kumpulkan semua penambahan ke SATU panggilan add_tasks, semua perubahan ke SATU update_tasks. Jangan memanggil tool berkali-kali untuk hal sejenis.
- Untuk membuat struktur bertingkat, susun lewat properti "children" di dalam satu panggilan. Baris yang baru dibuat belum punya nomor WBS, jadi tidak bisa dirujuk lewat parent_wbs di panggilan lain.
- Semua perubahanmu hanya USULAN. Perubahan itu masuk sebagai perubahan tertunda yang harus disetujui pengguna lewat tombol Simpan. Jangan bilang sesuatu "sudah tersimpan".
- Baris induk (yang punya sub-task) tanggal, progres, dan statusnya dihitung otomatis dari anak-anaknya. Jangan coba mengubahnya; ubah sub-task-nya.
- Kedalaman maksimal 3 tingkat (n.n.n). Jangan membuat tingkat keempat.
- MENELUSURI. Kamu punya find_tasks dan get_subtree untuk memeriksa isi daftar sebelum memutuskan. Keduanya hanya membaca, jadi pakai sesukamu — terutama untuk memastikan pekerjaan serupa belum ada, atau melihat isi sebuah bagian sampai tingkat terdalam. Jangan menebak bila bisa diperiksa.
- MENENTUKAN TEMPAT. Bila pengguna menambah pekerjaan tanpa menyebut lokasinya, jangan langsung menaruhnya di tingkat 1. Telusuri dulu daftar yang ada, turun sampai tingkat terdalam, lalu nilai: apakah ini bagian dari pekerjaan yang sudah ada, atau berdiri sendiri?
  - Kalau cocok masuk ke suatu baris, pakai parent_wbs baris itu dan SEBUTKAN alasannya secara singkat, mis. "aku taruh di 5.3 Data Pegawai karena satu urusan dengan hak akses".
  - Kalau tidak ada yang cocok, buat sebagai bagian baru di tingkat 1 dan katakan bahwa memang tidak ada yang relevan.
  - Kalau ada DUA tempat yang sama masuk akalnya, jangan pilih diam-diam. Sebutkan pilihannya beserta pertimbangannya, lalu tanya — tanpa memanggil tool.
- Bila permintaan pengguna ambigu — misalnya tidak jelas baris mana yang dimaksud — tanyakan dulu, jangan menebak lalu mengubah banyak baris.
- Jawab singkat dalam bahasa Indonesia. Sebutkan apa yang kamu usulkan, bukan cara kerjanya.
- Bila pengguna hanya bertanya (misalnya "mana yang overdue?"), jawab saja tanpa memanggil tool.`;


/**
 * CLI tidak punya antarmuka tool seperti API, jadi usulannya diminta sebagai
 * JSON di dalam teks jawaban. Bentuknya sengaja sama persis dengan AiOperation
 * supaya sisa alurnya — pemeriksaan nilai dan penerapan — tidak perlu bercabang.
 */
export const CLI_OUTPUT_CONTRACT = `
Kamu dijalankan lewat CLI, jadi kamu TIDAK punya tool. Balas dengan SATU objek JSON saja, tanpa blok kode, tanpa teks lain di luarnya:

{"reply": "jawabanmu untuk pengguna (boleh markdown)", "operations": []}

Isi "operations" hanya bila pengguna meminta perubahan. Bentuk tiap operasi:

- Menambah (selalu pakai ini, walau cuma satu baris; sub-task lewat children, JANGAN pakai nomor WBS untuk baris yang baru dibuat):
  {"op":"add_tasks","parent_wbs":"5.7","after_wbs":"5.7","tasks":[
    {"title":"...","start":"2026-09-10","end":"2026-09-12","progress":0,"status":"todo",
     "children":[{"title":"..."}]}
  ]}
  parent_wbs / after_wbs / start / end / progress / status semuanya opsional.

- Mengubah (boleh banyak sekaligus, sertakan hanya field yang diubah):
  {"op":"update_tasks","updates":[{"wbs":"5.7","progress":80}]}

- Menghapus (beserta sub-task-nya):
  {"op":"delete_tasks","wbs":["5.7","5.8"]}

status hanya boleh: todo, in_progress, blocked, done. Tanggal wajib YYYY-MM-DD.
Maksimal tiga tingkat. Bila pengguna hanya bertanya, kosongkan "operations".`;
