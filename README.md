# ZenoWork

ZenoWork adalah aplikasi desktop untuk mengelola pekerjaan personal dengan gaya
WBS, timeline, dan kalender. Semua data berjalan lokal di komputer kamu:
tanpa login, tanpa server, dan tanpa memindahkan daftar pekerjaan ke layanan
cloud.

Cocok untuk kamu yang ingin memecah pekerjaan besar menjadi sub-task, melihat
jadwalnya di satu garis waktu, lalu menyimpan perubahan hanya ketika sudah
yakin.

## Kenapa ZenoWork?

- **WBS bertingkat**: task otomatis bernomor seperti `1`, `1.1`, `1.1.1`, dan
  tetap rapi saat baris dipindah, disisipkan, atau dihapus.
- **Timeline interaktif**: geser bar untuk memindahkan jadwal, tarik ujung bar
  untuk mengubah durasi, dan lihat garis hari ini sebagai patokan.
- **Kalender bulanan**: lihat pekerjaan berdasarkan tanggal, buka daftar task
  yang menumpuk dalam satu hari, dan lompat cepat ke hari ini.
- **Edit cepat ala spreadsheet**: Enter untuk simpan sel, Esc untuk batal, Tab
  untuk pindah kolom.
- **Simpan eksplisit**: perubahan ditahan dulu di memori. Data permanen baru
  berubah ketika tombol **Simpan** ditekan.
- **Undo dan redo**: satu drag atau satu edit menjadi satu langkah yang bisa
  dibatalkan.
- **Backup portabel**: export/import JSON untuk pindah perangkat, plus export
  CSV, Markdown, dan XLSX.
- **Asisten AI lokal-terkendali**: AI membaca snapshot task untuk memberi usulan,
  tetapi database tetap hanya berubah saat kamu menyimpan.
- **Konteks Git read-only**: hubungkan task ke repository lokal agar AI bisa
  membaca status branch/diff secara terbatas tanpa menulis ke repo.

## Cara Install

Ambil installer terbaru dari halaman **Releases** repository ini.

- **macOS**: gunakan file `.dmg`, lalu seret `ZenoWork.app` ke Applications.
- **Windows**: gunakan installer `.exe` atau versi portable bila tersedia.

Build macOS dari GitHub Actions saat ini tidak ditandatangani dengan sertifikat
Apple Developer ID. Jika macOS menolak membuka aplikasi pertama kali, lepaskan
quarantine sekali:

```bash
xattr -dr com.apple.quarantine /Applications/ZenoWork.app
```

## Cara Pakai

1. Buka ZenoWork dari aplikasi desktop.
2. Tambah task baru dengan tombol tambah atau pintasan `N`.
3. Buat sub-task dengan `Shift+N`, tombol sub-task, atau indent.
4. Isi judul, tanggal mulai, tanggal selesai, progress, status, dan prioritas.
5. Geser bar timeline untuk mengatur jadwal secara visual.
6. Pakai tab **Kalender** untuk melihat pekerjaan per tanggal.
7. Tekan **Simpan** atau `Cmd/Ctrl+S` ketika perubahan sudah benar.

ZenoWork sengaja tidak bisa dipakai dari browser biasa. Renderer berjalan di
dalam Electron dan berkomunikasi dengan database lewat IPC desktop.

## Fitur Utama

### Tabel WBS

Tabel utama dirancang seperti lembar kerja proyek: ringkas, cepat diedit, dan
tetap menjaga struktur hierarki. Parent task menghitung sendiri rentang tanggal,
progress, dan status dari sub-task-nya, sehingga baris ringkasan tidak perlu
diisi manual.

### Timeline

Timeline menampilkan setiap task sebagai bar horizontal. Kamu bisa:

- menggeser jadwal tanpa mengubah durasi,
- menarik ujung kiri/kanan untuk mengubah tanggal,
- memindahkan seluruh sub-tree saat parent digeser,
- zoom ke Hari, Minggu, atau Bulan,
- melihat weekend dan posisi hari ini.

### Kalender

View kalender membantu melihat task yang aktif pada tanggal tertentu. Opsi
**Hanya task daun** membuat kalender lebih fokus ke pekerjaan yang benar-benar
dikerjakan, bukan parent ringkasan.

### AI Assistant

Panel Asisten bisa membaca task yang sedang tampil, termasuk perubahan yang
belum disimpan, lalu menyusun usulan perubahan. ZenoWork tetap menjaga kontrol
di tangan pengguna: AI tidak menulis langsung ke SQLite.

Mode yang tersedia:

- API key Anthropic,
- Claude CLI,
- Codex CLI.

Kunci API disimpan lokal di database aplikasi dan tidak pernah dikirim balik ke
renderer setelah tersimpan.

### Repository Git

Setiap task bisa dihubungkan ke folder repository Git lokal. Saat diminta, AI
dapat membaca status branch, HEAD, daftar file berubah, dan potongan diff yang
dibatasi. ZenoWork tidak melakukan `git add`, `commit`, `push`, atau operasi
tulis lain.

## Backup dan Pindah Perangkat

Gunakan menu export/import di aplikasi:

- **Export JSON** untuk backup penuh task dan hierarki.
- **Import JSON** untuk memulihkan data di instalasi lain.
- **Export CSV/Markdown/XLSX** untuk laporan atau dokumentasi.

Import JSON meminta konfirmasi karena dapat mengganti daftar task yang sedang
ada. Setelan AI dan kunci API tidak ikut diekspor, jadi perlu diatur ulang di
perangkat baru.

Data aplikasi disimpan di folder data sistem:

- macOS: `~/Library/Application Support/ZenoWork/data`
- Windows: `%APPDATA%\ZenoWork\data`

## Pintasan Keyboard

| Tombol | Aksi |
| --- | --- |
| `N` / `Shift+N` | Task baru sebagai saudara / anak |
| `Tab` / `Shift+Tab` | Indent / outdent baris terpilih |
| `Cmd+]` / `Cmd+[` | Indent / outdent |
| `Cmd+Up` / `Cmd+Down` | Pindahkan baris beserta sub-task |
| `Left` / `Right` | Tutup / buka sub-task |
| `Shift+Cmd+[` / `Shift+Cmd+]` | Tutup semua / buka semua |
| `Option+Left` / `Option+Right` | Geser jadwal 1 hari |
| `Option+Shift+Left` / `Option+Shift+Right` | Ubah tanggal selesai |
| `Option+Cmd+Left` / `Option+Cmd+Right` | Ubah tanggal mulai |
| tahan `Ctrl` | Loncat 1 minggu saat menggeser jadwal |
| `Cmd+S` | Simpan perubahan |
| `Cmd+Z` / `Shift+Cmd+Z` | Undo / redo |
| `Cmd+F` | Fokus pencarian |
| `T` | Lompat ke hari ini |
| `Delete` | Hapus baris terpilih |

Di Windows/Linux, gunakan `Ctrl` untuk pintasan yang memakai `Cmd`.

## Development

ZenoWork dibangun dengan Next.js static export, React, Electron, SQLite bawaan
Node, dan Animate UI.

Prasyarat:

- Node.js `>=22.13.0`
- npm

Jalankan mode development:

```bash
npm install
npm run desktop:dev
```

Perintah yang sering dipakai:

```bash
npm run typecheck
npm test
npm run test:desktop
```

## Build Desktop

```bash
npm run desktop:pack          # ZenoWork.app tanpa installer
npm run desktop:dist:mac      # DMG + ZIP macOS di release/
npm run desktop:dist:win      # installer + portable EXE Windows
```

Untuk build lokal tanpa signing macOS:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist:mac
```

Setelah dipaket, aplikasi bisa diuji dengan:

```bash
npx tsx scripts/smoke-desktop.ts --packaged
```

## Release

Release otomatis berjalan dari GitHub Actions ketika tag `v*` dipush.

```bash
npm version minor
git push origin main --follow-tags
```

Workflow [.github/workflows/release.yml](.github/workflows/release.yml)
membangun macOS dan Windows di runner masing-masing, lalu mengunggah semua aset
ke satu GitHub Release.

## Arsitektur Singkat

```text
Renderer  Next.js static export, disajikan lewat skema app://
   |
   | window.zeno.tasks.sync(diff)
   v
Preload   contextBridge dalam sandbox
   |
   | ipcRenderer.invoke("tasks:sync", diff)
   v
Main      lib/sync.ts -> lib/db.ts, lib/chat.ts, lib/xlsx.ts
```

Halaman tidak punya akses langsung ke berkas, database, kunci API, atau jaringan
keluar. Semua akses desktop melewati kontrak IPC di
[electron/api.ts](electron/api.ts).

Struktur kode utama:

```text
components/       UI aplikasi: tabel, timeline, kalender, toolbar, chat
components/animate-ui/
                  komponen Animate UI yang dipakai aplikasi
electron/         main process, preload, dan handler IPC
lib/tree.ts       operasi pohon WBS
lib/rollup.ts     nomor WBS, status, tanggal, dan progress roll-up
lib/rows.ts       hasil baris setelah collapse/filter
lib/schedule.ts   geometri timeline
lib/store.ts      state renderer, undo/redo, pending changes
lib/db.ts         SQLite lokal
lib/sync.ts       penerapan diff ke database
```

Spesifikasi produk lebih lengkap ada di [docs/PRD.md](docs/PRD.md).
