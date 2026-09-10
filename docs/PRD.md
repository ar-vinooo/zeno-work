# PRD — ZenoWork

**Product Requirement Document**
Versi: 0.2 (draft)
Tanggal: 2026-09-08
Pemilik: Arvino (zeno)
Status: Draft — belum ada implementasi

Perubahan dari v0.1: task berubah dari daftar datar menjadi **struktur
bertingkat (WBS)** dengan penomoran otomatis `1`, `1.1`, `1.1.1`, `2`. Lihat
§4.2, §5.2, dan §5.3.

---

## 1. Ringkasan

ZenoWork adalah aplikasi manajemen pekerjaan personal berbasis
**tabel bertingkat + timeline**.

Inti produknya: satu tabel berisi daftar pekerjaan yang **tersusun hierarkis dan
bernomor otomatis** (`1`, `1.1`, `1.1.1`, `2`), di mana tiap baris punya progres
dan rentang tanggal, dan rentang itu digambar sebagai bar di timeline kalender
di sisi kanan tabel (gaya Gantt ringan). Urutan dan susunan baris sepenuhnya
diatur lewat UI — drag untuk memindah, indent/outdent untuk mengubah tingkat.

Aplikasi ini **single-user, dipakai sendiri**. Tidak ada login, tidak ada akun,
tidak ada sharing, tidak ada multi-tenant.

### Masalah yang diselesaikan

Todo-list datar kehilangan dua dimensi sekaligus: **waktu** (kapan mulai, kapan
selesai, apakah telat) dan **struktur** (pekerjaan besar terdiri dari pekerjaan
kecil). Sebaliknya tool project management penuh terlalu berat, butuh akun, dan
memaksa konsep tim yang tidak dipakai.

### Solusi

Satu layar: tabel WBS yang bisa diedit langsung + timeline yang menampilkan bar
tiap task pada rentang tanggalnya, dengan progres induk yang otomatis dihitung
dari anak-anaknya.

---

## 2. Tujuan & Non-Tujuan

### Tujuan

| # | Tujuan | Ukuran keberhasilan |
|---|--------|---------------------|
| G1 | Lihat semua pekerjaan aktif dan posisinya di waktu dalam satu layar | Tidak perlu pindah view untuk tahu apa yang jalan minggu ini |
| G2 | Pecah pekerjaan besar jadi sub-pekerjaan tanpa berpindah layar | Buat anak task cukup satu tombol indent |
| G3 | Tambah & edit task secepat mengetik di spreadsheet | Task baru selesai dibuat < 10 detik, tanpa modal wajib |
| G4 | Tahu apa yang telat dan apa yang mendekati deadline | Task lewat `end` dan progres < 100% ditandai otomatis |
| G5 | Struktur tidak pernah rusak karena sorting | Sorting apa pun tetap mempertahankan hubungan induk–anak |
| G6 | Data aman & portabel | Bisa export/import penuh termasuk hierarki; data tidak hilang saat restart |

### Non-Tujuan (eksplisit TIDAK dibuat)

- Autentikasi, registrasi, reset password, session, role/permission.
- Kolaborasi: assignee orang lain, komentar, mention, notifikasi ke user lain.
- Real-time sync multi-user / multi-device (lihat §10 sebagai kemungkinan lanjutan).
- Time tracking otomatis (start/stop timer), timesheet, invoicing.
- Integrasi pihak ketiga (Google Calendar, Slack, GitHub) di versi awal.
- Mobile app native. Web responsive sudah cukup.

---

## 3. Pengguna & Skenario

**Persona tunggal:** pemilik aplikasi. Developer, mengerjakan beberapa proyek
paralel, butuh gambaran cepat beban kerja per minggu.

### Skenario utama

1. **Perencanaan.** Tulis pekerjaan besar sebagai baris `2`, lalu tulis
   langkah-langkahnya di bawahnya dan tekan indent — otomatis jadi `2.1`, `2.2`.
2. **Update progres.** Centang/isi progres di anak task; progres induk `2` naik
   sendiri tanpa disentuh.
3. **Rombak urutan.** Prioritas berubah — drag blok `3` ke atas blok `2`. Semua
   anak ikut pindah dan penomoran menyesuaikan jadi `2` dan `3`.
4. **Fokus.** Collapse semua induk untuk melihat gambaran besar saja; expand
   satu yang sedang dikerjakan.
5. **Review akhir bulan.** Filter status = Done, rentang bulan lalu, lihat apa
   saja yang kelar dan mana yang meleset dari estimasi.

---

## 4. Konsep Data

### 4.1 Entitas: Task

Entitas utama, dan satu-satunya yang wajib ada di v1.

| Field | Tipe | Wajib | Default | Keterangan |
|-------|------|:-----:|---------|------------|
| `id` | string (uuid) | ✅ | generated | Identitas internal |
| `parentId` | string \| null | ✅ | `null` | Induk. `null` = task tingkat teratas |
| `order` | integer | ✅ | auto | Urutan **di antara saudara sekandung** (sesama anak dari `parentId` yang sama) |
| `title` | string | ✅ | — | Nama pekerjaan. Kolom **Task** |
| `progress` | integer 0–100 | ✅ | `0` | Persen. Kolom **Progress**. Diabaikan bila punya anak (lihat §4.3) |
| `start` | date (YYYY-MM-DD) | ✅ | hari ini | Kolom **Start** |
| `end` | date (YYYY-MM-DD) | ✅ | `start` | Kolom **End**. Harus ≥ `start` |
| `status` | enum | ✅ | `todo` | `todo` \| `in_progress` \| `blocked` \| `done` |
| `priority` | enum | ➖ | `medium` | `low` \| `medium` \| `high` |
| `collapsed` | boolean | ✅ | `false` | Anak-anaknya disembunyikan di tabel |
| `rollup` | boolean | ✅ | `true` | Bila `true`, progres & tanggal dihitung dari anak. Bila `false`, induk diisi manual |
| `projectId` | string \| null | ➖ | `null` | Relasi ke Project (opsional) |
| `notes` | string (markdown) | ➖ | `""` | Catatan bebas |
| `createdAt` | datetime | ✅ | now | — |
| `updatedAt` | datetime | ✅ | now | — |

**Catatan penting:** nomor WBS (`1.1.1`) **tidak disimpan**. Yang disimpan hanya
`parentId` + `order`; nomor dihitung ulang setiap render. Ini mencegah nomor
basi setelah baris dipindah atau dihapus.

**Field turunan (dihitung, tidak disimpan):**

| Turunan | Rumus |
|---------|-------|
| `wbs` | Nomor hierarkis, mis. `"2.1.3"` — lihat §4.2 |
| `depth` | Jumlah leluhur. Root = 0 |
| `hasChildren` | Punya minimal satu anak |
| `duration` | Jumlah hari `start`–`end`, inklusif |
| `isOverdue` | `end < hari ini` **dan** progres efektif < 100 |
| `isActive` | `start ≤ hari ini ≤ end` |
| `daysLeft` | Selisih hari dari hari ini ke `end` |

### 4.2 Penomoran WBS

Nomor dibentuk dari posisi baris dalam pohon, mengikuti `order` tiap tingkat:

```
1        Persiapan
1.1        Setup repo
1.2        Skema database
1.2.1        Desain tabel
1.2.2        Migrasi awal
2        Implementasi
2.1        Tabel pekerjaan
2.2        Timeline
3        Rilis
```

Aturan:

- Nomor tingkat pertama mulai dari `1`, berurutan tanpa lompatan.
- Anak mewarisi prefiks induk lalu menambah indeksnya sendiri: anak kedua dari
  `2.1` adalah `2.1.2`.
- Nomor **selalu dihitung ulang** setelah pindah, indent, outdent, sisip, atau
  hapus. Tidak pernah ada nomor bolong.
- Kedalaman tidak dibatasi secara teknis; UI dirancang nyaman sampai **5
  tingkat** (indent 16px per tingkat).
- Nomor ditampilkan di kolom paling kiri, non-editable, warna redup.

### 4.3 Aturan hierarki & roll-up

**Task induk (punya anak) dengan `rollup = true` — perilaku default:**

| Field | Nilai |
|-------|-------|
| `progress` | Rata-rata progres anak **berbobot durasi**: `Σ(progress_anak × duration_anak) / Σ(duration_anak)` |
| `start` | `min(start semua anak)` |
| `end` | `max(end semua anak)` |
| `status` | `done` bila semua anak `done`; `blocked` bila ada anak `blocked`; `in_progress` bila ada anak yang bukan `todo`; selain itu `todo` |

Sel-sel tersebut ditampilkan **read-only dan diberi gaya redup** di tabel,
dengan tooltip "dihitung dari sub-task". Roll-up bersifat rekursif: kakek
menghitung dari anak, yang menghitung dari cucu.

**Melepas roll-up.** Klik ikon di sel, atau set `rollup = false`, membuat induk
kembali bisa diisi manual (berguna untuk deadline induk yang lebih ketat dari
gabungan anak). Saat ini terjadi, timeline menandai selisihnya bila tanggal
induk tidak mencakup semua anak.

**Aturan struktural:**

- Sebuah task tidak boleh menjadi keturunan dirinya sendiri (siklus ditolak
  saat drag maupun saat import).
- **Setiap** penghapusan lewat konfirmasi, termasuk baris tanpa sub-task.
  Dialognya dua tombol saja — **Batal** dan **Hapus** — dan menghapus induk
  berarti menghapus seluruh keturunannya. Pilihan "naikkan anak satu tingkat"
  sempat ada tapi dibuang: tiga tombol membuat keputusan yang seharusnya
  sepele jadi lambat, dan hasil yang sama bisa dicapai dengan outdent anak
  lebih dulu. Salah hapus dibatalkan dengan satu kali undo.
- Memindahkan induk selalu ikut memindahkan seluruh sub-pohonnya sebagai satu
  blok.
- `collapsed` hanya memengaruhi tampilan, tidak pernah memengaruhi perhitungan
  roll-up.

### 4.4 Entitas: Project (opsional, v1.1)

Pengelompokan lintas-pohon. Ringan saja.

| Field | Tipe | Keterangan |
|-------|------|------------|
| `id` | string (uuid) | — |
| `name` | string | Nama proyek |
| `color` | string (hex) | Warna bar di timeline |
| `archived` | boolean | Sembunyikan dari view default |

Project berbeda dari induk WBS: project adalah label/warna, induk WBS adalah
posisi struktural. Sebuah task mewarisi `projectId` induknya bila tidak diisi.

### 4.5 Aturan validasi

- `title` tidak boleh string kosong setelah trim.
- `end` ≥ `start`. Bila user set `end` lebih awal dari `start`, `start` ikut
  digeser (perilaku spreadsheet, bukan error popup).
- `progress` di-clamp ke 0–100.
- Set `status = done` pada task **daun** → `progress` otomatis 100. Pada task
  **induk** → seluruh keturunannya ikut jadi `done`/100 (dengan konfirmasi).
- Set `progress = 100` → `status` otomatis `done` (kecuali status `blocked`).
- `order` unik di antara saudara sekandung; dinormalisasi ulang (0,1,2,…)
  setelah setiap operasi pemindahan.

---

## 5. Fitur

### 5.1 Tabel Pekerjaan (P0 — inti)

Tabel utama dengan kolom sesuai kebutuhan:

```
| #      | Task              | Progress | Start      | End        | ← Date Range →      |
|--------|-------------------|----------|------------|------------|---------------------|
| 1    ▾ | Persiapan         |    78%   | 2026-09-01 | 2026-09-08 | ▬▬▬▬▬▬▬▬            |  ← roll-up
| 1.1    |   Setup repo      |   100%   | 2026-09-01 | 2026-09-02 | ██                  |
| 1.2  ▾ |   Skema database  |    60%   | 2026-09-03 | 2026-09-08 |    ▬▬▬▬▬▬           |  ← roll-up
| 1.2.1  |     Desain tabel  |   100%   | 2026-09-03 | 2026-09-05 |    ███              |
| 1.2.2  |     Migrasi awal  |    20%   | 2026-09-06 | 2026-09-08 |       █░░           |
| 2    ▸ | Implementasi      |     0%   | 2026-09-09 | 2026-09-20 | ▬▬▬▬▬▬▬▬▬▬▬▬        |  ← collapsed
| 3      | Rilis             |     0%   | 2026-09-21 | 2026-09-22 |              ░░     |
| + tambah task…                                                                        |
```

Perilaku:

- **Kolom `#`** menampilkan nomor WBS + tombol expand/collapse pada baris yang
  punya anak. Non-editable.
- **Indentasi visual** pada kolom Task menunjukkan tingkat, diperkuat garis
  vertikal tipis penghubung induk–anak.
- **Inline editing.** Klik sel → langsung edit. Enter simpan, Esc batal,
  Tab pindah sel berikutnya.
- **Baris tambah cepat.** Baris kosong permanen di bawah; mengetik di situ
  membuat task baru **pada tingkat yang sama dengan baris terakhir**.
- **Enter di akhir baris** membuat saudara baru tepat di bawahnya, tingkat sama.
- **Kolom Progress** ditampilkan sebagai progress bar + angka. Bisa diedit
  dengan mengetik angka atau drag bar. Untuk induk ber-roll-up: read-only.
- **Kolom Start/End** memakai date picker, tapi juga menerima ketikan
  (`2026-09-10`, `10/09`, `besok`, `+3d`) — lihat §5.5.6. Nilainya terikat dua
  arah dengan bar di timeline.
- **Kolom Duration** (opsional, bisa disembunyikan). Menampilkan jumlah hari;
  mengeditnya menggeser `end` sambil menahan `start`.
- **Multi-select** baris (shift-click) untuk aksi massal: hapus, ubah status,
  geser tanggal, indent/outdent bersama.

### 5.2 Menyusun hierarki lewat UI (P0 — inti)

Semua penyusunan dilakukan langsung di tabel, tanpa dialog.

| Aksi | Cara | Hasil |
|------|------|-------|
| **Indent** | `Tab` (baris terpilih) atau `Cmd+]` atau drag ke kanan | Baris jadi anak dari saudara di atasnya. Nomor `2` → `1.3` |
| **Outdent** | `Shift+Tab` atau `Cmd+[` atau drag ke kiri | Baris naik satu tingkat, jadi saudara dari mantan induknya |
| **Pindah** | Drag handle baris, atau `Cmd+↑` / `Cmd+↓` | Sub-pohon ikut pindah utuh |
| **Expand/Collapse** | Klik `▾`/`▸`, atau `←`/`→` pada baris terpilih | Sembunyikan/tampilkan keturunan |
| **Collapse semua** | `Cmd+Shift+[` | Hanya tingkat teratas terlihat |
| **Expand semua** | `Cmd+Shift+]` | Seluruh pohon terbuka |

Aturan drag & drop:

- Saat drag, muncul **garis sisip** yang menunjukkan posisi tujuan; posisi
  horizontal kursor menentukan tingkat (kiri = outdent, kanan = indent).
- Drop ke dalam keturunan sendiri ditolak — garis sisip berubah merah.
- Baris pertama di tingkatnya tidak bisa di-indent (tidak ada calon induk di
  atasnya) — tombol/aksi dinonaktifkan, bukan error.
- Indent otomatis mengaktifkan `rollup` pada induk baru bila induk itu belum
  punya anak sebelumnya.

### 5.3 Sorting (P0 — inti)

Sorting **tidak pernah meratakan pohon**. Klik header kolom (Task, Progress,
Start, End, Status, Priority) mengurutkan **saudara sekandung di dalam
induknya masing-masing**, secara rekursif. Blok `1.x` tetap berada di bawah `1`.

Dua mode, di-toggle dari header tabel:

| Mode | Perilaku |
|------|----------|
| **Manual** (default) | Urutan mengikuti `order` hasil drag. Header sorting mati |
| **Terurut** | Urutan tampilan mengikuti kolom yang dipilih; `order` tersimpan **tidak diubah**. Nomor WBS ikut menyesuaikan tampilan |

Di mode Terurut tersedia tombol **"Jadikan urutan manual"** yang menulis urutan
hasil sort ke `order` secara permanen, lalu kembali ke mode Manual. Tanpa itu,
mematikan sorting mengembalikan susunan drag semula.

Sorting sekunder: klik header kedua sambil `Shift`.

### 5.4 Timeline / Date Range (P0 — inti)

Kolom paling kanan yang lebar, berisi grid tanggal horizontal.

- Tiap task **daun** digambar sebagai **bar** dari `start` sampai `end`, terisi
  sebagian sesuai `progress` (bagian solid = selesai, transparan = sisa).
- Tiap task **induk** digambar sebagai **bar ringkasan** — lebih tipis, dengan
  ujung menyiku (bracket), membentang dari anak paling awal ke anak paling
  akhir. Isinya mencerminkan progres roll-up.
- Induk yang **collapsed** tetap menampilkan bar ringkasannya, sehingga gambaran
  besar tidak hilang saat pohon ditutup.
- Warna bar mengikuti `project.color`, atau `status` bila tanpa project.
- **Garis "hari ini"** vertikal menyilang seluruh timeline.
- Bar yang overdue diberi border/warna peringatan.
- **Zoom:** Hari / Minggu / Bulan. Default: Minggu (menampilkan ±6 minggu).
- **Scroll horizontal** independen dari tabel kiri; kolom kiri sticky.
- **Bar bisa di-drag** untuk menggeser dan mengubah durasi jadwal — dijelaskan
  terpisah di §5.5 karena ini interaksi inti, bukan pelengkap.

### 5.5 Mengatur jadwal: kolom dan timeline saling terhubung (P0 — inti)

Tanggal sebuah task bisa diatur lewat **dua jalur yang setara**, dan keduanya
menulis ke field yang sama (`start` dan `end`) — tidak ada state terpisah, tidak
ada tombol sinkronisasi:

| Jalur | Cocok untuk |
|-------|-------------|
| **Ketik di kolom Start/End** | Tanggal yang sudah pasti, mis. deadline dari luar |
| **Drag bar di kolom Date Range** | Menata jadwal secara visual, melihat tabrakan antar-task |

Konsekuensinya: mengetik di sel **langsung menggeser bar**, dan menggeser bar
**langsung mengubah angka di sel** — termasuk saat drag masih berlangsung,
bukan hanya setelah dilepas.

#### 5.5.1 Tiga zona drag pada satu bar

```
        ╭───────────────────────────────╮
        │◀▎        (badan bar)        ▕▶│
        ╰───────────────────────────────╯
         ▲              ▲              ▲
    handle kiri    geser utuh    handle kanan
    ubah start     start & end   ubah end
    end tetap      geser bareng  start tetap
```

| Zona | Aksi | Efek |
|------|------|------|
| **Badan bar** | Drag horizontal | `start` dan `end` bergeser bersama. **Durasi tetap** |
| **Ujung kiri** (lebar hit-area 8px) | Drag | Hanya `start` berubah. `end` tetap. Durasi ikut berubah |
| **Ujung kanan** | Drag | Hanya `end` berubah. `start` tetap. Durasi ikut berubah |

Kursor berubah sesuai zona (`grab` di badan, `col-resize` di ujung), dan handle
baru terlihat saat pointer berada di atas bar — supaya bar tetap bersih saat
tidak sedang diatur.

#### 5.5.2 Perilaku selama drag

- **Snapping ke hari.** Bar selalu jatuh tepat di batas hari, berapa pun level
  zoom-nya. Tahan `Alt` untuk snap ke batas **minggu**.
- **Pratinjau langsung.** Bar asli tetap di tempat dengan gaya redup, bar
  bayangan mengikuti kursor. Sel Start/End di tabel ikut berubah real-time.
- **Tooltip mengikuti kursor** menampilkan tanggal baru dan selisihnya:
  `10 Sep → 17 Sep · 8 hari · +3 hari`.
- **Durasi minimum 1 hari.** Menarik handle kiri melewati `end` berhenti di
  situ, tidak membalik jadi rentang negatif.
- **Auto-scroll** saat kursor mendekati tepi timeline, sehingga bar bisa
  dipindah jauh melewati layar tanpa melepas drag.
- **`Esc` saat drag membatalkan** — bar kembali ke posisi semula.
- **Commit saat dilepas.** Satu operasi drag = satu penulisan DB = **satu
  langkah undo**, bukan satu langkah per hari yang dilewati.
- Indikator overdue dan angka progres dihitung ulang begitu drag dilepas.

#### 5.5.3 Drag pada induk (roll-up)

Aturan di §5.4 versi sebelumnya direvisi — memindahkan induk sekarang bermakna:

| Aksi pada bar induk ber-roll-up | Hasil |
|----------------------------------|-------|
| **Geser badan bar** | Seluruh sub-pohon ikut bergeser dengan selisih hari yang sama. Jarak antar-anak tetap terjaga |
| **Tarik ujung bar** | Dinonaktifkan — kursor jadi `not-allowed` dengan tooltip "durasi induk mengikuti sub-task". Panjang induk adalah hasil, bukan input |

Untuk induk dengan `rollup = false`, kedua aksi berlaku normal dan anak tidak
ikut bergeser; bila rentang induk jadi tidak mencakup anaknya, timeline menandai
selisih itu dengan garis putus-putus.

#### 5.5.4 Drag banyak baris sekaligus

Baris yang dipilih (shift-click / cmd-click) bergeser bersama dengan selisih
hari yang sama saat salah satu barnya di-drag. Berguna untuk memundurkan satu
fase penuh sekaligus. Bila di antara pilihan ada induk beserta anaknya,
pergeseran diterapkan **sekali saja** pada induk — anak tidak digeser dua kali.

#### 5.5.5 Setara lewat keyboard

Semua yang bisa dilakukan dengan drag harus bisa dilakukan tanpa mouse:

| Tombol | Aksi |
|--------|------|
| `Alt+←` / `Alt+→` | Geser `start` **dan** `end` mundur/maju 1 hari |
| `Alt+Shift+←` / `Alt+Shift+→` | Ubah `end` saja — perpendek/perpanjang 1 hari |
| `Alt+Cmd+←` / `Alt+Cmd+→` | Ubah `start` saja |
| Tahan `Ctrl` bersama kombinasi di atas | Loncat 1 minggu, bukan 1 hari (`Shift` sudah dipakai untuk "end saja") |

#### 5.5.6 Mengetik di kolom Start/End

Sel tanggal menerima lebih dari sekadar format baku, agar penjadwalan cepat
tidak selalu butuh date picker:

Sel tanggal punya dua cara masuk yang setara: **klik sekali membuka kalender**
(shadcn Calendar / react-day-picker, minggu dimulai Senin, locale Indonesia),
sementara kolom teksnya tetap bisa diketik. Keduanya menulis ke field yang sama,
jadi tidak ada mode yang perlu dipilih lebih dulu.

| Ketikan | Arti |
|---------|------|
| `2026-09-10`, `10/09`, `10 sep` | Tanggal absolut |
| `hari ini`, `besok`, `senin` | Tanggal relatif |
| `+3d`, `-1w`, `+2m` | Geser dari nilai sel saat ini |
| `3d` **di kolom Duration** (opsional, §5.1) | Set `end` = `start` + 3 hari |

Menggeser `start` lewat sel **tidak** ikut menggeser `end` (durasi berubah).
Bila ingin menggeser jadwal utuh, itulah gunanya drag badan bar atau `Alt+←/→`.

### 5.6 Filter & Grouping (P1)

- Filter: status, priority, project, rentang tanggal, teks pencarian judul.
- **Hasil filter tetap hierarkis:** bila sebuah anak lolos filter, seluruh
  leluhurnya ikut ditampilkan sebagai konteks (diberi gaya redup dan ditandai
  "hanya konteks").
- Toggle cepat: "Hanya yang aktif", "Sembunyikan Done", "Overdue saja",
  "Hanya tingkat 1".
- Group by: project / status / tidak sama sekali. Saat grouping aktif, hierarki
  WBS ditampilkan di dalam tiap grup.
- Preset view tersimpan (mis. "Minggu ini", "Backlog").

### 5.7 Ringkasan (P1)

Bar tipis di atas tabel:

- Jumlah task per status (menghitung daun saja, agar induk tidak dobel).
- Berapa yang overdue.
- Rata-rata progres task aktif.
- Beban minggu ini (jumlah task yang rentangnya menyentuh minggu berjalan).

### 5.8 Data & Portabilitas (P0)

- **Simpan eksplisit.** Mengetik, menyeret, menghapus, dan menyusun ulang
  hanya mengubah salinan di memori. Begitu ada yang berubah, tombol **Simpan**
  muncul di kanan atas beserta jumlah baris yang terdampak; `⌘S` melakukan hal
  yang sama. Tidak ada yang ditulis ke database sebelum itu ditekan.
  Keputusan ini menggantikan autosave: menyusun ulang WBS sering menghasilkan
  keadaan setengah jadi, dan menuliskannya seketika membuat "coba dulu, batalkan
  kalau jelek" jadi berisiko.
- **Penjaga saat menutup.** Menutup tab dengan perubahan yang belum disimpan
  memunculkan konfirmasi bawaan browser.
- Indikator di kanan atas selalu menyatakan salah satu dari: **Tersimpan**,
  **Simpan N**, atau **Menyimpan…**
- **Export** ke JSON (bersarang, mempertahankan hierarki penuh), CSV (datar,
  dengan kolom `wbs` dan `parentId` agar bisa direkonstruksi), dan Markdown
  (daftar bernomor bertingkat, untuk ditempel di catatan).
- **Import** dari JSON hasil export, dengan mode `replace` atau `merge`;
  validasi siklus dan `parentId` yatim sebelum ditulis.
- **Backup otomatis** file snapshot harian, simpan 7 terakhir.
- **Undo/Redo** minimal 20 langkah (Cmd+Z / Cmd+Shift+Z). Satu operasi drag
  sub-pohon = satu langkah undo, bukan per baris.

### 5.9 Kalender (P2)

View alternatif berbentuk kalender bulanan; task muncul sebagai chip pada
tanggal-tanggal dalam rentangnya, dengan prefiks nomor WBS. Opsi "hanya
tampilkan task daun" agar tidak dobel dengan induknya.

---

## 6. Antarmuka

### 6.1 Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ZenoWork        [ Tabel | Kalender ]   [Filter▾] [Manual|Terurut▾] [Mgg▾] │
├────────────────────────────────────────────────────────────────────────────┤
│  12 aktif · 3 overdue · 61% rata-rata progres · 8 task minggu ini          │
├──────────────────────────────┬─────────────────────────────────────────────┤
│ #     Task        Prog  St E │  Sep 2026                                   │
│                              │  1  2  3  4  5  6  7  8  9 10 11 12 13 14   │
│ ──────────────────────────── │ ─────────────────────│(today)──────────────  │
│ 1  ▾ Persiapan      78%      │  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬                              │
│ 1.1    Setup repo  100%      │  ███                                         │
│ 1.2  ▾ Skema DB     60%      │        ██████▓▓▓▓                            │
│ 1.2.1    Desain    100%      │        ██████                                │
│ 1.2.2    Migrasi    20%      │                ▓░░░░                         │
│ 2  ▸ Implementasi    0%      │                      ▬▬▬▬▬▬▬▬▬▬▬             │
│ + tambah task…               │                                              │
└──────────────────────────────┴─────────────────────────────────────────────┘
   ▾/▸ expand-collapse    ▬ bar ringkasan induk    █ selesai    ░ sisa
```

### 6.2 Prinsip desain

- **Keyboard dulu.** Semua aksi utama punya shortcut; mouse opsional.
- **Tanpa modal untuk aksi rutin.** Buat/edit/hapus/indent terjadi di tempat.
- **Hierarki terbaca sekali lihat.** Nomor + indentasi + garis penghubung, tiga
  penanda sekaligus, karena indentasi saja mudah terlewat di baris ramping.
- **Dark mode & light mode**, ikut preferensi sistem.
- **Density tinggi.** Baris ramping, informasi padat — ini alat kerja.
- Tidak ada onboarding, tur, atau empty-state bertele-tele.

### 6.3 Shortcut

| Tombol | Aksi |
|--------|------|
| `N` | Task baru (saudara dari baris terpilih) |
| `Shift+N` | Task baru sebagai **anak** dari baris terpilih |
| `Enter` | Simpan sel / buat saudara baru di bawah |
| `Esc` | Batal edit / keluar ke mode pilih baris |
| `Tab` / `Shift+Tab` | Mode edit: sel berikutnya/sebelumnya. Mode pilih baris: **indent / outdent** |
| `Cmd+]` / `Cmd+[` | Indent / outdent (selalu, tanpa bergantung mode) |
| `Cmd+↑` / `Cmd+↓` | Pindahkan baris (beserta sub-pohonnya) naik/turun |
| `←` / `→` | Collapse / expand baris terpilih |
| `Cmd+Shift+[` / `Cmd+Shift+]` | Collapse semua / expand semua |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / Redo |
| `Cmd+F` | Fokus pencarian |
| `Cmd+K` | Command palette |
| `Alt+←` / `Alt+→` | Geser jadwal (start & end) 1 hari mundur / maju |
| `Alt+Shift+←` / `Alt+Shift+→` | Ubah `end` saja (perpendek / perpanjang) |
| `Alt+Cmd+←` / `Alt+Cmd+→` | Ubah `start` saja |
| `Shift+←` / `Shift+→` | Geser tampilan timeline mundur / maju |
| `T` | Lompat ke hari ini |
| `Del` | Hapus baris terpilih (konfirmasi bila punya anak) |

---

## 7. Teknis

### 7.1 Stack (usulan)

| Lapis | Pilihan | Alasan |
|-------|---------|--------|
| Shell | Electron: main + preload + renderer | Berkas, SQLite, dan kunci API tinggal di proses utama; halaman memintanya lewat IPC dan tidak pernah menyentuhnya sendiri |
| Framework | Next.js (App Router, `output: "export"`) + TypeScript | Halaman dibangun jadi HTML/JS statis; tidak ada server yang hidup saat aplikasi jalan |
| UI | React + Tailwind CSS v4 | Cepat menyusun tabel padat |
| Chrome UI | Animate UI (registry shadcn) | Dropdown, dialog, tooltip, tabs. **Tidak dipakai di dalam baris tabel atau bar timeline** — satu komponen Motion per baris membuat scroll dan drag terasa berat |
| State | Zustand (atau React state + reducer) | Ringan, cukup untuk single-user |
| Drag & drop | Pointer Events sendiri | Drag baris dan drag bar butuh proyeksi tingkat dan snapping harian yang spesifik; library generik tetap harus dilawan |
| Tanggal | date-fns | Ringan, tree-shakeable |
| Penyimpanan | SQLite lokal via `node:sqlite` | Data tahan lama, satu file, sinkron, dan kompatibel di Node.js maupun Electron tanpa binary ABI tambahan |
| Timeline | Custom (div + CSS grid) | Library Gantt umumnya berat & sulit disesuaikan |

**Alternatif yang dibuang:** menyimpan di IndexedDB supaya halaman bisa berdiri
sendiri. Trade-off-nya terlalu mahal — data terikat ke profil browser dan hilang
begitu data situs dibersihkan.

> Keputusan PRD ini: **SQLite lokal di proses utama**, karena datanya kerjaan
> sendiri yang sayang kalau hilang.

### 7.2 Model penyimpanan hierarki

Pakai **adjacency list** (`parentId` + `order`), bukan nested set atau
materialized path.

Alasan: operasi yang paling sering terjadi di app ini adalah **memindahkan
sub-pohon**, dan pada adjacency list itu hanya mengubah satu baris (`parentId`
induk yang dipindah) plus normalisasi `order` di dua tingkat yang terdampak.
Nested set akan menulis ulang hampir seluruh tabel setiap kali drag. Jumlah data
di sini kecil (≤ 2.000 baris), jadi seluruh pohon dimuat sekali ke memori dan
dirangkai di klien — tidak ada recursive CTE yang perlu dioptimalkan.

```sql
CREATE TABLE tasks (
  "id"        TEXT PRIMARY KEY,
  "parentId"  TEXT REFERENCES tasks("id") ON DELETE CASCADE,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "title"     TEXT    NOT NULL DEFAULT '',
  "progress"  INTEGER NOT NULL DEFAULT 0,
  "start"     TEXT    NOT NULL,          -- YYYY-MM-DD
  "end"       TEXT    NOT NULL,
  "status"    TEXT    NOT NULL DEFAULT 'todo',
  "priority"  TEXT    NOT NULL DEFAULT 'medium',
  "collapsed" INTEGER NOT NULL DEFAULT 0,
  "rollup"    INTEGER NOT NULL DEFAULT 1,
  "notes"     TEXT    NOT NULL DEFAULT '',
  "createdAt" TEXT    NOT NULL,
  "updatedAt" TEXT    NOT NULL
);
CREATE INDEX idx_tasks_parent ON tasks("parentId", "order");
```

### 7.3 Arsitektur

Satu arah, tanpa jaringan: **Renderer → IPC → Main**. Halaman tidak punya akses
ke berkas, database, kunci API, maupun jaringan keluar — semuanya di proses
utama, dan satu-satunya pintu adalah daftar saluran di `electron/api.ts`.

```
Renderer (out/, disajikan lewat app://)
  │  window.zeno.tasks.sync(diff)
  ▼
preload  (contextBridge, sandbox, hanya boleh require "electron")
  │  ipcRenderer.invoke("tasks:sync", diff)
  ▼
Main     → lib/sync.ts → lib/db.ts (node:sqlite)
```

```
electron/
  api.ts                  → kontrak IPC: daftar saluran + bentuk datanya
  preload.ts              → memasang window.zeno lewat contextBridge
  ipc.ts                  → handler tiap saluran, dialog simpan/buka
  main.ts                 → daur hidup app, jendela, penyaji app://
app/
  page.tsx                → cangkang statis; datanya diminta lewat IPC
components/
  TaskTable/              → tabel, sel editable, baris tambah cepat
    OutlineCell.tsx       → nomor WBS + tombol expand/collapse
    RowDragLayer.tsx      → garis sisip + indikator tingkat saat drag
  Timeline/               → grid tanggal, bar daun, bar ringkasan induk
    Bar.tsx               → badan + dua handle resize, zona hit-area
    useBarDrag.ts         → drag/resize: snapping, pratinjau, Esc, auto-scroll
  Toolbar/                → filter, sorting, zoom, pencarian, ringkasan
lib/
  bridge.ts               → akses halaman ke window.zeno (satu-satunya jalan)
  sync.ts                 → creates → patches → deletes, urutannya mengikat
  chat.ts                 → asisten AI; hanya hidup di proses utama
  xlsx.ts                 → lembar Gantt DTDI
  tree.ts                 → buildTree, flatten, computeWbs, move, indent,
                            outdent, isDescendant, normalizeOrder
  rollup.ts               → progres/tanggal/status induk, rekursif & memoized
  derive.ts               → duration, isOverdue, isActive, daysLeft
  schedule.ts             → pxToDate/dateToPx, snapping, geser sub-pohon,
                            clamp durasi minimum
  dates.ts                → parsing input tanggal ("besok", "+3d")
  sort.ts                 → sorting per tingkat yang mempertahankan hierarki
scripts/
  check-tree.ts           → pemeriksaan pohon, roll-up, sorting, filter
  smoke-desktop.ts        → uji asap Renderer → IPC → Main pada app sungguhan
docs/
  PRD.md
```

`lib/tree.ts` dan `lib/rollup.ts` adalah fungsi murni tanpa dependensi React
atau DB — keduanya bagian paling rawan bug dan harus punya unit test sendiri.

### 7.4 Non-fungsional

- Buka app sampai tabel tampil: **< 1 detik** untuk 500 task.
- Edit sel terasa instan (**optimistic update**, tulis ke DB di belakang).
- Roll-up dihitung ulang secara memoized: mengubah satu daun hanya
  memicu perhitungan ulang pada rantai leluhurnya, bukan seluruh pohon.
- Skala target: sampai **2.000 task** tanpa virtualisasi; di atas itu pakai
  virtual scrolling atas pohon yang sudah di-flatten.
- Tidak ada telemetri. Satu-satunya panggilan keluar adalah ke Claude saat
  Asisten dipakai, dan itu terjadi di proses utama — halaman sendiri dikunci
  CSP `connect-src 'self'`.
- Jalan offline sepenuhnya (kecuali Asisten).

---

## 8. Rencana Rilis

### v0.1 — Fondasi + hierarki (P0)
- Skema DB (adjacency list) + CRUD task.
- Tabel dengan kolom #, Task, Progress, Start, End.
- Nomor WBS otomatis, indentasi, expand/collapse.
- Indent/outdent lewat keyboard, drag reorder sub-pohon.
- Roll-up progres & tanggal ke induk.
- Inline editing + baris tambah cepat + persistensi otomatis.

### v0.2 — Timeline (P0)
- Kolom Date Range dengan bar per task daun.
- Bar ringkasan untuk induk, tetap tampil saat collapsed.
- Garis hari ini, zoom Hari/Minggu/Bulan, scroll horizontal.
- Penanda overdue.
- **Drag bar** (geser) dan **drag ujung bar** (ubah durasi), dengan snapping
  harian, pratinjau langsung, batal via `Esc`, dan sinkron dua arah ke kolom
  Start/End.
- Geser induk ber-roll-up memindahkan seluruh sub-pohon.

### v0.3 — Kerja sehari-hari (P1)
- Sorting per tingkat (mode Manual/Terurut) + "jadikan urutan manual".
- Status & priority, filter hierarkis, pencarian.
- Drag banyak baris sekaligus; pintasan keyboard `Alt+←/→` untuk menggeser
  jadwal tanpa mouse.
- Kolom Duration opsional + parsing tanggal relatif (`besok`, `+3d`).
- Bar ringkasan statistik.
- Undo/redo (satu operasi pohon = satu langkah).

### v0.4 — Ketahanan data (P1)
- Export/import JSON bersarang, CSV datar, Markdown bertingkat.
- Backup snapshot harian.
- Project + warna, grouping.
- Lepas roll-up (`rollup = false`) + penanda selisih induk–anak.

### v0.5 — Tambahan (P2)
- View kalender bulanan.
- Preset view tersimpan.
- Command palette.

---

## 9. Risiko

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Logika pohon (indent/outdent/move) rawan bug halus | Data berantakan, siklus, baris yatim | `lib/tree.ts` fungsi murni + unit test menyeluruh sebelum dipakai UI |
| Sorting merusak hierarki | Kepercayaan ke app hilang | Sorting hanya di dalam saudara sekandung; mode Terurut tidak menulis `order` |
| Roll-up bertabrakan dengan input manual | User bingung kenapa angkanya berubah sendiri | Sel roll-up read-only + redup + tooltip; ada jalan keluar eksplisit (`rollup = false`) |
| Timeline + pohon dalam = layar terlalu ramai | Sulit dibaca | Collapse default untuk pohon > 3 tingkat; bar ringkasan lebih tipis dari bar daun |
| Drag tidak sengaja mengubah jadwal | Tanggal berubah tanpa disadari | Ambang gerak 4px sebelum drag dianggap mulai; `Esc` membatalkan; satu drag = satu langkah undo |
| Bentrok antara drag bar dan scroll timeline | Interaksi terasa kacau | Drag horizontal pada bar = ubah jadwal; scroll timeline lewat wheel/trackpad, `Shift+←/→`, atau drag pada area kosong |

---

## 10. Pertanyaan Terbuka

1. **Dependensi antar-task** (task B mulai setelah A selesai) — berguna, tapi
   menambah kompleksitas besar di timeline. Ditunda sampai terbukti perlu.
   *(Catatan: hierarki ≠ dependensi. `1.1` sebelum `1.2` hanya urutan tampilan,
   bukan constraint jadwal.)*
2. **Bobot roll-up.** Default berbobot durasi. Perlukah opsi rata-rata sederhana
   atau bobot manual per anak?
3. **Batas kedalaman.** Dibiarkan bebas, atau dikunci di 5 tingkat agar UI
   tidak pernah rusak?
4. **Recurring task** (mis. "review mingguan tiap Senin") — masuk v1 atau tidak?
5. **Sync antar-device.** Kalau nanti perlu, opsi paling murah: taruh file
   SQLite di folder yang disinkronkan (iCloud/Dropbox) — cukup selama tidak
   dibuka di dua tempat bersamaan.
6. **Hari kerja vs hari kalender.** Apakah `duration` menghitung weekend?
   Usulan: default hitung semua hari, dengan opsi menandai weekend abu-abu.

---

## 11. Kriteria Selesai (v1)

Aplikasi dianggap selesai untuk pemakaian harian bila:

- [ ] Bisa membuat, mengedit, dan menghapus task tanpa meninggalkan tabel.
- [ ] Kolom #, Task, Progress, Start, End, dan Date Range semuanya berfungsi.
- [ ] Nomor WBS `1`, `1.1`, `1.1.1`, `2` benar dan langsung menyesuaikan setelah
      baris dipindah, disisipkan, atau dihapus.
- [ ] Indent, outdent, drag reorder, dan expand/collapse bekerja lewat mouse
      maupun keyboard.
- [ ] Memindahkan induk memindahkan seluruh sub-pohonnya, dan tidak pernah bisa
      menghasilkan siklus.
- [ ] Progres dan tanggal induk terhitung otomatis dari anak-anaknya.
- [ ] Sorting lewat header tidak pernah merusak hubungan induk–anak.
- [ ] Bar timeline akurat mencerminkan rentang dan progres, termasuk bar
      ringkasan induk.
- [ ] Jadwal bisa diatur dari dua arah: mengetik di kolom Start/End menggeser
      bar, dan menggeser bar mengubah angka di kolom Start/End.
- [ ] Drag badan bar menggeser tanggal tanpa mengubah durasi; drag ujung bar
      mengubah durasi tanpa menggeser ujung satunya.
- [ ] Menggeser bar induk memindahkan seluruh sub-pohonnya dengan selisih hari
      yang sama.
- [ ] Satu operasi drag bisa dibatalkan dengan satu kali undo.
- [ ] Task overdue terlihat jelas tanpa harus dicari.
- [ ] Data bertahan setelah restart aplikasi.
- [ ] Bisa export dan import kembali tanpa kehilangan hierarki.
- [ ] Tidak ada layar login di mana pun.
