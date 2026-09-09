import App from "@/components/App";
import { getMeta, insertTasks, listTasks, setMeta, snapshotDaily } from "@/lib/db";
import { seedTasks } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default function Page() {
  let tasks = listTasks();

  // Contoh isi hanya untuk database yang BENAR-BENAR baru. Tabel kosong
  // karena penggunanya menghapus semuanya harus tetap kosong — dulu di sini
  // cuma dicek `tasks.length === 0`, sehingga menghapus seluruh baris lalu
  // memuat ulang halaman membuat data contoh muncul kembali seolah data
  // sendiri kembali, padahal yang asli sudah hilang.
  if (!getMeta("seeded")) {
    if (tasks.length === 0) {
      insertTasks(seedTasks());
      tasks = listTasks();
    }
    setMeta("seeded", new Date().toISOString());
  }

  snapshotDaily();
  return <App initialTasks={tasks} />;
}
