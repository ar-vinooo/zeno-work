# ZenoWork

Manajemen pekerjaan personal: tabel WBS bertingkat + timeline yang bisa di-drag.
Single-user, jalan lokal, **tanpa login**.

Spesifikasi lengkap ada di [docs/PRD.md](docs/PRD.md).

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:3939
```

Memerlukan Node.js 22.13 atau lebih baru.

Database SQLite dibuat otomatis di `data/zeno-work.db` saat pertama dijalankan,
dan diisi contoh susunan kerja supaya layar pertama tidak kosong.

```bash
npm test         # pemeriksaan logika pohon, roll-up, sorting, filter
npm run build    # build produksi
npm run typecheck
```

## Desktop (Electron)

Versi desktop membuka server Next.js lokal secara internal; pengguna tidak
perlu menjalankan terminal atau membuka browser. Database dan backup disimpan
permanen di folder data aplikasi sistem
(`~/Library/Application Support/ZenoWork/data` di macOS atau
`%APPDATA%\\ZenoWork\\data` di Windows), sehingga upgrade aplikasi tidak
menimpa data pekerjaan.

```bash
npm run desktop:dev           # pengembangan: Next + jendela Electron
npm run desktop:pack          # buat ZenoWork.app tanpa installer
npm run desktop:dist:mac      # buat DMG + ZIP macOS di release/
npm run desktop:dist:win      # buat installer + portable EXE Windows
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
  muncul di kanan atas saat ada yang berubah, atau tekan `⌘S`. Menutup tab
  dengan perubahan yang belum disimpan akan dikonfirmasi dulu.
- **Sel tanggal**: klik kolom Start/End membuka kalender; kolom teksnya tetap
  menerima ketikan (`besok`, `senin`, `+3d`, `10/09`).
- **Drag jadwal**: badan bar menggeser tanggal (durasi tetap), ujung bar
  mengubah durasi. Kolom Start/End ikut berubah real-time. `Esc` membatalkan.
  Menggeser bar induk memindahkan seluruh sub-pohonnya.
- Sorting per tingkat yang tidak pernah merusak hierarki, dengan mode
  Manual / Terurut dan tombol "jadikan urutan manual".
- Filter dengan leluhur tetap tampil sebagai konteks.
- Undo/redo (satu drag = satu langkah), export JSON/CSV/Markdown, import JSON.

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
lib/store.ts     state klien, undo/redo, sinkronisasi selisih ke server
lib/db.ts        SQLite bawaan Node, semua tulisan dalam transaksi
```
