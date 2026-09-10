import App from "@/components/App";

/**
 * Cangkang kosong. Seluruh data dibaca halaman lewat IPC setelah jendela
 * hidup — halaman ini di-export sebagai HTML statis dan tidak pernah
 * menyentuh database.
 */
export default function Page() {
  return <App />;
}
