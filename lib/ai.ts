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

export interface AiMove {
  wbs: string;
  parent_wbs?: string;
  after_wbs?: string;
  before_wbs?: string;
  position?: "first" | "last";
}

export interface AiSplit {
  wbs: string;
  tasks: AiNewTask[];
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
  | { op: "move_tasks"; moves: AiMove[] }
  | { op: "indent_tasks"; wbs: string[] }
  | { op: "outdent_tasks"; wbs: string[] }
  | { op: "split_tasks"; splits: AiSplit[] }
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
    name: "tree_search",
    description:
      "Tampilkan peta WBS bertingkat secara ringkas. Pakai ini sebagai langkah awal untuk melihat struktur, mencari cabang besar, atau memastikan nomor WBS sebelum find_tasks/get_subtree. Bisa cari judul/WBS, dibatasi scope_wbs, dan depth.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Kata kunci judul atau awal WBS, mis. "SSO", "5", atau "5.7"',
        },
        scope_wbs: {
          type: "string",
          description: 'Batasi ke dalam cabang ini, mis. "5" atau "5.7"',
        },
        depth: {
          type: "integer",
          description: "Berapa tingkat ditampilkan relatif dari scope/match. Bawaan 2.",
        },
        limit: { type: "integer", description: "Maksimal baris, bawaan 80" },
      },
    },
  },
  {
    name: "find_tasks",
    description:
      "Cari baris detail berdasarkan kata pada judul, awal WBS, dan/atau saringan. Pakai setelah tree_search untuk membuka kandidat spesifik, mis. mencari apakah sudah ada pekerjaan sejenis, melihat WBS 5.7, atau melihat mana yang overdue di satu bagian. Bisa dibatasi ke satu cabang lewat scope_wbs.",
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
    name: "move_tasks",
    description:
      "Pindahkan atau urutkan ulang satu atau BANYAK baris yang sudah ada. Pakai after_wbs untuk menyisipkan tepat setelah baris lain, before_wbs untuk tepat sebelum baris lain, atau parent_wbs + position first/last untuk masuk ke awal/akhir sebuah induk. Sub-task ikut terbawa.",
    input_schema: {
      type: "object",
      required: ["moves"],
      properties: {
        moves: {
          type: "array",
          items: {
            type: "object",
            required: ["wbs"],
            properties: {
              wbs: { type: "string", description: "WBS baris yang dipindah" },
              parent_wbs: {
                type: "string",
                description: "WBS induk tujuan. Kosongkan bila memakai before_wbs/after_wbs.",
              },
              after_wbs: {
                type: "string",
                description: "Taruh sebagai saudara tepat setelah WBS ini.",
              },
              before_wbs: {
                type: "string",
                description: "Taruh sebagai saudara tepat sebelum WBS ini.",
              },
              position: {
                type: "string",
                enum: ["first", "last"],
                description: "Dipakai bersama parent_wbs; bawaan last.",
              },
            },
          },
        },
      },
    },
  },
  {
    name: "indent_tasks",
    description:
      "Jadikan satu atau BANYAK baris sebagai anak dari saudara tepat di atasnya. Pakai untuk membuat struktur WBS lebih dalam tanpa mengubah isi task.",
    input_schema: {
      type: "object",
      required: ["wbs"],
      properties: {
        wbs: { type: "array", items: { type: "string" }, description: "Daftar nomor WBS" },
      },
    },
  },
  {
    name: "outdent_tasks",
    description:
      "Naikkan satu atau BANYAK baris satu tingkat, ditempatkan tepat setelah induknya. Pakai untuk mengeluarkan task dari parent yang salah.",
    input_schema: {
      type: "object",
      required: ["wbs"],
      properties: {
        wbs: { type: "array", items: { type: "string" }, description: "Daftar nomor WBS" },
      },
    },
  },
  {
    name: "split_tasks",
    description:
      "Pecah satu atau BANYAK task besar menjadi beberapa sub-task baru di bawah task itu. Task induk tetap ada dan tanggal/progres/statusnya akan menjadi roll-up dari anak-anaknya.",
    input_schema: {
      type: "object",
      required: ["splits"],
      properties: {
        splits: {
          type: "array",
          items: {
            type: "object",
            required: ["wbs", "tasks"],
            properties: {
              wbs: { type: "string", description: "WBS task yang ingin dipecah" },
              tasks: { type: "array", items: level2 },
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
- Tool-nya jamak: kumpulkan semua penambahan ke SATU panggilan add_tasks, semua perubahan ke SATU update_tasks, semua pemindahan ke SATU move_tasks. Jangan memanggil tool berkali-kali untuk hal sejenis.
- Untuk membuat struktur bertingkat, susun lewat properti "children" di dalam satu panggilan. Baris yang baru dibuat belum punya nomor WBS, jadi tidak bisa dirujuk lewat parent_wbs di panggilan lain.
- Untuk menyisipkan task baru di tengah daftar, pakai add_tasks dengan after_wbs saja. Untuk memindahkan task yang sudah ada ke tengah daftar, pakai move_tasks dengan after_wbs atau before_wbs.
- Untuk memecah task besar menjadi langkah kecil, pakai split_tasks. Untuk menggeser tingkat struktur, pakai indent_tasks/outdent_tasks. Untuk mengurutkan ulang task existing, pakai move_tasks.
- Semua perubahanmu hanya USULAN. Perubahan itu masuk sebagai perubahan tertunda yang harus disetujui pengguna lewat tombol Simpan. Jangan bilang sesuatu "sudah tersimpan".
- STATUS SIMPAN di konteks sistem adalah sumber kebenaran untuk pertanyaan seperti "sudah tersimpan?", "cek lagi", atau "apakah sudah masuk DB". Jangan menebak dari riwayat chat. Bila status menyatakan cocok dengan database, jawab sudah tersimpan; bila ada perubahan tertunda, jawab belum tersimpan.
- Baris induk (yang punya sub-task) tanggal, progres, dan statusnya dihitung otomatis dari anak-anaknya. Jangan coba mengubahnya; ubah sub-task-nya.
- Kedalaman maksimal 3 tingkat (n.n.n). Jangan membuat tingkat keempat.
- MENELUSURI. Mulai dari tree_search untuk melihat peta WBS ringkas. Setelah tahu kandidat WBS seperti "5" atau "5.7", pakai find_tasks dengan query WBS itu atau get_subtree untuk membaca detail cabang. Semua tool baca aman dieksekusi; jangan menebak bila bisa diperiksa.
- REPOSITORY GIT. Bila prompt memuat KONTEKS REPOSITORY GIT, aplikasi sudah membaca repository lokal secara read-only untukmu. Pakai branch, status, nama berkas berubah, dan commit yang diberikan; jangan bilang kamu tidak punya akses. Bila konteks menyatakan WBS belum punya repository atau ada beberapa pilihan, jelaskan itu dan minta pengguna menautkan repo lewat ikon Git atau menyebut WBS yang dimaksud.
  - Commit baru adalah bukti pekerjaan yang sudah masuk riwayat Git, tetapi hanya usulkan Done/100% bila isi commit jelas menyelesaikan task yang sama.
  - Diff staged atau belum di-stage adalah bukti pekerjaan sedang berlangsung; cocokkan nama file dan hunk dengan task yang sudah ada sebelum mengusulkan progres/status.
  - Bila perubahan Git jelas merupakan pekerjaan baru yang belum ada di WBS, usulkan sub-task baru di cabang repository itu.
  - Bila tidak ada bukti Git untuk suatu task, cukup laporkan; jangan menyimpulkan task belum dikerjakan karena pekerjaan bisa terjadi di luar repository.
  - Jangan menyalin secret atau isi diff panjang ke jawaban. Ringkas bukti dan sebut hash commit atau nama file seperlunya.
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

- Memindahkan / reorder task existing:
  {"op":"move_tasks","moves":[{"wbs":"5.9","after_wbs":"5.7"}]}
  {"op":"move_tasks","moves":[{"wbs":"5.9","parent_wbs":"5.7","position":"last"}]}

- Indent / outdent:
  {"op":"indent_tasks","wbs":["5.8"]}
  {"op":"outdent_tasks","wbs":["5.8.1"]}

- Memecah task menjadi sub-task:
  {"op":"split_tasks","splits":[{"wbs":"5.7","tasks":[{"title":"Analisis kebutuhan"},{"title":"Implementasi"},{"title":"QA"}]}]}

- Menghapus (beserta sub-task-nya):
  {"op":"delete_tasks","wbs":["5.7","5.8"]}

status hanya boleh: todo, in_progress, blocked, done. Tanggal wajib YYYY-MM-DD.
Maksimal tiga tingkat. Bila pengguna hanya bertanya, kosongkan "operations".`;
