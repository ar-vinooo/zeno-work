import fs from "node:fs";
import path from "node:path";
import { dataDir, listTasks } from "./db";
import { newId } from "./tree";
import type { EvidenceAsset } from "./types";

/**
 * Lampiran bukti disimpan berdampingan dengan zeno-work.db, di luar bundle
 * aplikasi. Itu yang membuatnya selamat saat aplikasi di-upgrade.
 */
export const evidenceDir = () => path.join(dataDir(), "evidence");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const mimeOf = (file: string) =>
  MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** Sisakan nama yang aman dipakai sebagai satu segmen path. */
const safeName = (file: string) =>
  path.basename(file).replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80) || "berkas";

/**
 * Ubah path relatif dari halaman menjadi path absolut, sambil menolak apa pun
 * yang keluar dari folder evidence. Halaman tidak boleh bisa membaca berkas
 * sembarangan hanya dengan mengirim "../../".
 */
function resolveAsset(relPath: string): string {
  if (typeof relPath !== "string" || !relPath.trim())
    throw new Error("Lampiran tidak valid.");
  const root = evidenceDir();
  const full = path.resolve(root, relPath);
  if (full !== root && !full.startsWith(root + path.sep))
    throw new Error("Lampiran tidak valid.");
  return full;
}

/** Salin berkas pilihan pengguna ke folder data dan jadikan aset bukti. */
export function attachFiles(taskId: string, sources: string[]): EvidenceAsset[] {
  if (typeof taskId !== "string" || !taskId.trim())
    throw new Error("Task tidak valid.");
  const folder = path.join(evidenceDir(), safeName(taskId));
  fs.mkdirSync(folder, { recursive: true });

  return sources.map((source) => {
    const name = safeName(source);
    const file = `${newId()}-${name}`;
    const target = path.join(folder, file);
    fs.copyFileSync(source, target);
    return {
      id: newId(),
      kind: "file" as const,
      label: path.basename(source),
      href: `${safeName(taskId)}/${file}`,
      mime: mimeOf(name),
      bytes: fs.statSync(target).size,
    };
  });
}

export function readAsset(relPath: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(resolveAsset(relPath)));
}

export function assetPath(relPath: string): string {
  const full = resolveAsset(relPath);
  if (!fs.existsSync(full)) throw new Error("Berkas lampiran sudah tidak ada.");
  return full;
}

/**
 * Berkas disalin saat dipilih, tapi entri buktinya baru tersimpan saat tombol
 * Simpan ditekan — menekan Discard menyisakan berkas tanpa pemilik. Daripada
 * menunda penyalinan, yatimnya dibersihkan saat aplikasi hidup.
 */
export function sweepOrphans(): number {
  const root = evidenceDir();
  if (!fs.existsSync(root)) return 0;

  const referenced = new Set<string>();
  for (const task of listTasks())
    for (const entry of task.evidence)
      for (const asset of entry.assets)
        if (asset.kind === "file" && asset.href) referenced.add(asset.href);

  let removed = 0;
  for (const folder of fs.readdirSync(root)) {
    const dir = path.join(root, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir))
      if (!referenced.has(`${folder}/${file}`)) {
        fs.rmSync(path.join(dir, file), { force: true });
        removed += 1;
      }
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  return removed;
}
