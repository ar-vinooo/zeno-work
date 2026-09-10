import type { PublicSettings, Settings } from "../lib/settings";
import type { ChatMessage, ChatReply } from "../lib/chat";
import type { SyncDiff } from "../lib/sync";
import type { Task } from "../lib/types";

/**
 * Kontrak antara halaman dan proses utama.
 *
 * Renderer TIDAK punya akses ke database, berkas, kunci API, maupun jaringan
 * keluar. Semua itu tinggal di proses utama dan hanya bisa disentuh lewat
 * daftar saluran di bawah.
 *
 * `Channel` sengaja berupa union literal, bukan konstanta yang diimpor:
 * preload berjalan dalam sandbox dan tidak boleh me-require berkas lain, jadi
 * nama salurannya ditulis ulang di sana. Union ini yang menjaga kedua sisi
 * tetap sama — salah ketik satu huruf pun gagal saat kompilasi.
 */
export type Channel =
  | "tasks:load"
  | "tasks:sync"
  | "settings:get"
  | "settings:set"
  | "backup:save"
  | "backup:restore"
  | "export:xlsx"
  | "export:text"
  | "chat:send";

/** Hasil dialog simpan. `saved: false` berarti pengguna menekan Batal. */
export interface SaveResult {
  saved: boolean;
  path?: string;
}

/**
 * Balasan mentah setiap saluran. Kegagalan dikirim sebagai data, bukan
 * exception, supaya pesan aslinya sampai utuh — `ipcRenderer.invoke` yang
 * melempar akan membungkus pesannya dengan teks "Error invoking remote
 * method". Preload yang membukanya kembali menjadi Error biasa.
 */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ZenoApi {
  tasks: {
    /** Seluruh isi tabel. Penyemaian awal & snapshot harian sudah dilakukan saat aplikasi hidup. */
    load(): Promise<Task[]>;
    /** Kirim selisih terhadap kondisi tersimpan. Mengembalikan jumlah baris yang tersentuh. */
    sync(diff: SyncDiff): Promise<number>;
  };
  settings: {
    get(): Promise<PublicSettings>;
    set(patch: Partial<Settings>): Promise<PublicSettings>;
  };
  backup: {
    /** Tulis backup JSON lewat dialog simpan. */
    save(): Promise<SaveResult>;
    /** Ganti seluruh task dengan isi backup. Mengembalikan jumlah task yang masuk. */
    restore(tasks: unknown): Promise<number>;
  };
  exports: {
    xlsx(): Promise<SaveResult>;
    /** CSV / Markdown: isinya sudah dirakit di halaman, main tinggal menyimpan. */
    text(fileName: string, content: string): Promise<SaveResult>;
  };
  chat: {
    send(messages: ChatMessage[]): Promise<ChatReply>;
  };
}
