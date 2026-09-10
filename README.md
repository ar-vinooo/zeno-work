# ZenoWork

Manajemen pekerjaan personal: tabel WBS bertingkat + timeline yang bisa di-drag.
Aplikasi desktop single-user, jalan lokal, **tanpa login dan tanpa server**.

Spesifikasi lengkap ada di [docs/PRD.md](docs/PRD.md).

## Menjalankan

```bash
npm install
npm run desktop:dev     # jendela ZenoWork + hot reload
```

Memerlukan Node.js 22.13 atau lebih baru.

ZenoWork tidak bisa dibuka lewat browser. Semua datanya lewat jembatan IPC yang
hanya ada di dalam jendela Electron; membuka halamannya di Chrome cuma
memunculkan pesan bahwa jembatannya tidak ada.

Database SQLite dibuat otomatis saat pertama dijalankan dan diisi contoh susunan
kerja supaya layar pertama tidak kosong. Database dan backup disimpan permanen
di folder data aplikasi sistem (`~/Library/Application Support/ZenoWork/data` di
macOS atau `%APPDATA%\\ZenoWork\\data` di Windows), sehingga upgrade aplikasi
tidak menimpa data pekerjaan.

```bash
npm test             # logika pohon, roll-up, filter
npm run test:desktop # uji asap Renderer → IPC → Main pada aplikasi sungguhan
npm run typecheck    # halaman dan proses utama, dua-duanya
```

## Arsitektur

Satu arah, tanpa jaringan lokal:

```
Renderer  halaman statis hasil `next build`, disajikan lewat skema app://
   │      window.zeno.tasks.sync(diff)
   ▼
preload   contextBridge dalam sandbox — satu-satunya pintu
   │      ipcRenderer.invoke("tasks:sync", diff)
   ▼
Main      lib/sync.ts → lib/db.ts (node:sqlite), lib/chat.ts, lib/xlsx.ts
```

Halaman tidak punya akses ke berkas, database, kunci API, maupun jaringan
keluar. Daftar salurannya ada di [electron/api.ts](electron/api.ts) dan berupa
union literal, jadi salah ketik nama saluran gagal saat kompilasi — bukan saat
dipakai.

| Saluran | Isi |
|---------|-----|
| `tasks:load` / `tasks:sync` | Baca seluruh tabel / kirim selisih (creates → patches → deletes) |
| `settings:get` / `settings:set` | Setelan AI. Kunci API tidak pernah dikirim balik ke halaman |
| `backup:save` / `backup:restore` | Export & import JSON lewat dialog sistem |
| `export:xlsx` / `export:text` | Lembar Gantt DTDI, CSV, Markdown |
| `chat:send` | Asisten AI — kunci API dan CLI hanya tersentuh di proses utama |
| `repository:choose` | Pilih folder Git lokal untuk konteks AI read-only |

Chat mengirim snapshot task yang sedang tampil di editor, termasuk perubahan
yang belum disimpan. AI memakai snapshot itu untuk membaca, mencari, dan
menyusun usulan; database tetap hanya berubah lewat `tasks:sync` saat pengguna
menekan **Simpan**.
Mode API hanya diberi peta awal tingkat 1 lalu menelusuri detail dengan
`tree_search`, `find_tasks`, dan `get_subtree`; mode CLI tetap menerima outline
lengkap karena belum punya tool-call interaktif.

### Repository sebagai sumber task AI

Pada setiap baris task, klik ikon Git untuk memilih repository. Ikon yang aktif
membuka ringkasan branch, HEAD, jumlah perubahan, waktu pemeriksaan AI terakhir,
serta tombol **Ganti**, **Cek sekarang**, dan **Lepas**. Pengaitan ini menjadi
bagian dari data task dan baru permanen setelah tombol **Simpan** ditekan.
Sub-task yang tidak punya repo sendiri otomatis memakai repo milik induknya.

Ketika pengguna berkata “cek Git di 5.7”, ZenoWork mencari repo pada WBS `5.7`,
lalu naik ke induknya bila belum ada. Aplikasi mengambil branch/status, commit
baru sejak pemeriksaan sebelumnya, nama berkas berubah, serta potongan diff
staged/unstaged yang dibatasi. `.env`, credential/key, lockfile, binary, file
besar, dan isi file untracked tidak dibaca; pola secret umum juga disamarkan.
ZenoWork tidak dapat menulis, stage, ataupun commit ke repository. AI memakai
bukti ini untuk membuat usulan task WBS yang tetap harus disimpan pengguna.

## Membangun

```bash
npm run desktop:pack          # ZenoWork.app tanpa installer
npm run desktop:dist:mac      # DMG + ZIP macOS di release/
npm run desktop:dist:win      # installer + portable EXE Windows
```

Setelah dipaket, isinya bisa diuji apa adanya:

```bash
npx tsx scripts/smoke-desktop.ts --packaged
```

### Release ke GitHub

Windows app tidak bisa dibangun dari macOS tanpa Wine, jadi rilis dikerjakan
GitHub Actions: tiap sistem dibangun di runner-nya sendiri lalu dilampirkan ke
satu Release yang sama.

```bash
npm version minor                      # naikkan versi + bikin tag v0.x.0
git push origin main --follow-tags     # tag inilah yang memicu build
```

Tag `v*` menjalankan [.github/workflows/release.yml](.github/workflows/release.yml)
— macOS (DMG + ZIP, arm64 dan x64) serta Windows (installer NSIS + portable
EXE). Versi di tag harus sama dengan `version` di `package.json`; `npm version`
sudah menjaganya sejalan.

Aplikasi macOS-nya **tidak ditandatangani** — runner GitHub tidak punya
sertifikat Apple. Saat pertama dibuka macOS akan menolaknya. Lepaskan
karantinanya sekali:

```bash
xattr -dr com.apple.quarantine /Applications/ZenoWork.app
```

Jalankan perintah distribusi pada sistem targetnya agar runtime native yang
terpaket sesuai: macOS untuk DMG/ZIP, Windows x64 untuk installer/portable EXE.

Untuk pindah instalasi atau sistem operasi, pilih **Export JSON (backup data)**
di aplikasi lama, lalu **Import JSON (pulihkan data)** di aplikasi baru. Import
meminta konfirmasi sebelum mengganti seluruh task. Setelan AI dan kunci API
tidak ikut diekspor, sehingga harus diatur kembali di perangkat baru.

## Yang sudah jalan

- Tabel WBS bernomor otomatis (`1`, `1.1`, `1.1.1`, `2`), dihitung ulang setiap
  baris dipindah, disisipkan, atau dihapus.
- Edit inline ala spreadsheet: Enter simpan, Esc batal, Tab pindah sel.
- Indent/outdent, drag baris dengan indikator tingkat, expand/collapse.
- Roll-up otomatis: progres induk berbobot durasi, rentang tanggal gabungan
  anak, status diturunkan. Sel induk read-only.
- Timeline: bar per task, bar ringkasan untuk induk, garis hari ini, weekend
  diarsir, zoom Hari/Minggu/Bulan.
- View kalender bulanan: task tampil di setiap tanggal dalam rentangnya,
  navigasi bulan, sinkron dengan filter dan selection, serta opsi hanya task daun.
- **Simpan eksplisit**: perubahan ditahan di memori; tombol **Simpan N**
  muncul di kanan atas saat ada yang berubah, atau tekan `⌘S`. Menutup jendela
  dengan perubahan yang belum disimpan akan dikonfirmasi dulu.
- **Sel tanggal**: klik kolom Start/End membuka kalender; kolom teksnya tetap
  menerima ketikan (`besok`, `senin`, `+3d`, `10/09`).
- **Drag jadwal**: badan bar menggeser tanggal (durasi tetap), ujung bar
  mengubah durasi. Kolom Start/End ikut berubah real-time. `Esc` membatalkan.
  Menggeser bar induk memindahkan seluruh sub-pohonnya.
- Urutan baris **hanya manual** — diatur lewat drag, indent/outdent, dan
  `⌘↑`/`⌘↓`. Tidak ada pengurutan per kolom.
- Filter dengan leluhur tetap tampil sebagai konteks.
- Undo/redo (satu drag = satu langkah). Export JSON/CSV/Markdown/XLSX dan
  import JSON, semuanya lewat dialog simpan bawaan sistem.

## Pintasan

| Tombol | Aksi |
|--------|------|
| `N` / `⇧N` | Task baru sebagai saudara / anak |
| `Tab` / `⇧Tab` | Indent / outdent baris terpilih |
| `⌘]` / `⌘[` | Indent / outdent |
| `⌘↑` / `⌘↓` | Pindahkan baris beserta sub-pohonnya |
| `←` / `→` | Tutup / buka sub-task |
| `⇧⌘[` / `⇧⌘]` | Tutup semua / buka semua |
| `⌥←` / `⌥→` | Geser jadwal 1 hari |
| `⌥⇧←` / `⌥⇧→` | Ubah tanggal selesai saja |
| `⌥⌘←` / `⌥⌘→` | Ubah tanggal mulai saja |
| tahan `Ctrl` | Loncat 1 minggu, bukan 1 hari |
| `⌘S` | Simpan perubahan |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘F` | Fokus pencarian |
| `T` | Lompat ke hari ini |
| `Del` | Hapus baris terpilih |

## Struktur

```
lib/tree.ts      operasi pohon murni (pindah, indent, outdent, hapus)
lib/rollup.ts    rangkai pohon, hitung nomor WBS dan nilai roll-up
lib/rows.ts      baris yang digambar: hierarki → collapse → filter
lib/schedule.ts  geometri timeline (tanggal ↔ px, snapping)
lib/store.ts     state klien, undo/redo, sinkronisasi selisih lewat IPC
lib/bridge.ts    akses halaman ke window.zeno
lib/sync.ts      penerapan selisih di sisi main; urutannya mengikat
lib/db.ts        SQLite bawaan Node, semua tulisan dalam transaksi
electron/        kontrak IPC, preload, handler, proses utama
```
