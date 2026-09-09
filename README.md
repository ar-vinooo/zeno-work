# ZenoWork

Manajemen pekerjaan personal: tabel WBS bertingkat + timeline yang bisa di-drag.
Single-user, jalan lokal, **tanpa login**.

Spesifikasi lengkap ada di [docs/PRD.md](docs/PRD.md).

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:3939
```

Database SQLite dibuat otomatis di `data/zeno-work.db` saat pertama dijalankan,
dan diisi contoh susunan kerja supaya layar pertama tidak kosong.

```bash
npm test         # pemeriksaan logika pohon, roll-up, sorting, filter
npm run build    # build produksi
npm run typecheck
```

## Yang sudah jalan

- Tabel WBS bernomor otomatis (`1`, `1.1`, `1.1.1`, `2`), dihitung ulang setiap
  baris dipindah, disisipkan, atau dihapus.
- Edit inline ala spreadsheet: Enter simpan, Esc batal, Tab pindah sel.
- Indent/outdent, drag baris dengan indikator tingkat, expand/collapse.
- Roll-up otomatis: progres induk berbobot durasi, rentang tanggal gabungan
  anak, status diturunkan. Sel induk read-only.
- Timeline: bar per task, bar ringkasan untuk induk, garis hari ini, weekend
  diarsir, zoom Hari/Minggu/Bulan.
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
lib/db.ts        SQLite, semua tulisan dalam transaksi
```
