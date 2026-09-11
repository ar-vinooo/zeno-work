"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  CalendarRange,
  Check,
  ExternalLink,
  Link2,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import {
  Progress,
  ProgressIndicator,
} from "@/components/animate-ui/components/radix/progress";
import { Button } from "@/components/animate-ui/components/buttons/button";
import Markdown from "@/components/Markdown";
import { zeno } from "@/lib/bridge";
import { durationOf, todayISO } from "@/lib/dates";
import { isOverdue } from "@/lib/derive";
import { buildOutline } from "@/lib/rollup";
import { useStore } from "@/lib/store";
import { newId } from "@/lib/tree";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type EvidenceAsset,
  type EvidenceEntry,
  type Status,
} from "@/lib/types";

const statusStyle: Record<Status, CSSProperties> = {
  todo: {
    background: "var(--color-todo-soft)",
    color: "var(--color-todo-ink)",
  },
  in_progress: {
    background: "var(--color-progress-soft)",
    color: "var(--color-progress-ink)",
  },
  blocked: {
    background: "var(--color-blocked-soft)",
    color: "var(--color-blocked-ink)",
  },
  done: {
    background: "var(--color-done-soft)",
    color: "var(--color-done-ink)",
  },
};

const field =
  "h-8 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[12px] outline-none focus:border-[var(--color-mark)]";
const label = "mb-1 block text-[11px] font-medium text-[var(--color-ink-soft)]";
const area =
  "w-full resize-none rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--color-mark)]";

const formatBytes = (n: number) =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${Math.round(n / 1024)} KB`
      : `${n} B`;

/**
 * Gambar dibaca lewat IPC lalu dibungkus jadi blob: — CSP halaman sudah
 * mengizinkan blob:, jadi tidak perlu protocol handler baru untuk file://.
 */
function ImagePreview({ asset }: { asset: EvidenceAsset }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let current: string | null = null;
    void zeno()
      .evidence.read(asset.href)
      .then((bytes) => {
        if (revoked) return;
        current = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
        setUrl(current);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [asset.href, asset.mime]);

  if (failed)
    return (
      <div className="mt-1 text-[11px] text-[var(--color-blocked)]">
        Berkas tidak ditemukan lagi di folder data.
      </div>
    );
  if (!url)
    return (
      <div className="mt-1 text-[11px] text-[var(--color-faint)]">memuat…</div>
    );
  return (
    <img
      src={url}
      alt={asset.label}
      className="mt-1 max-h-48 rounded border border-[var(--color-line)]"
    />
  );
}

/**
 * Teks markdown yang tampil sudah ter-render dan berubah jadi textarea saat
 * diklik — pola yang sama dengan sel tabel. Draft-nya dipegang pemanggil, agar
 * menutup dialog dengan Esc tetap bisa memaksa commit.
 */
function MarkdownField({
  value,
  draft,
  placeholder,
  rows = 3,
  onStart,
  onDraft,
  onCommit,
}: {
  value: string;
  draft: string | null;
  placeholder: string;
  rows?: number;
  onStart: () => void;
  onDraft: (text: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const floor = useRef<number | null>(null);

  // Tumbuh mengikuti isi. Tanpa ini menulis diagram atau catatan panjang
  // terasa seperti mengintip lewat celah tiga baris.
  //
  // Batas bawahnya diukur sekali dari tinggi bawaan `rows`: menyetel
  // style.height mengalahkan atribut itu, jadi tanpa lantai ini field yang
  // masih kosong justru menciut jadi satu baris.
  useEffect(() => {
    const el = ref.current;
    if (!el || draft === null) return;
    if (floor.current === null) floor.current = el.clientHeight;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, floor.current)}px`;
  }, [draft]);

  if (draft !== null)
    return (
      <textarea
        ref={ref}
        autoFocus
        rows={rows}
        className={`${area} max-h-[50vh] overflow-y-auto`}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={onCommit}
      />
    );

  // Sengaja TIDAK memakai onFocus: Radix memindahkan fokus ke elemen pertama
  // saat dialog dibuka, dan itu akan langsung menukar tampilan ter-render
  // menjadi textarea sebelum sempat terbaca. Enter/Spasi yang menggantikannya
  // untuk pengguna keyboard.
  return (
    <div
      role="button"
      tabIndex={0}
      className="md md-doc min-h-8 cursor-text rounded border border-transparent px-2 py-1.5 text-[12px] hover:border-[var(--color-line)] hover:bg-[var(--color-raised)]"
      onClick={onStart}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onStart();
        }
      }}
    >
      {value ? (
        <Markdown>{value}</Markdown>
      ) : (
        <span className="text-[var(--color-faint)]">{placeholder}</span>
      )}
    </div>
  );
}

/** Salinan kerja modal: hanya dua kolom yang memang dimiliki modal ini. */
interface Draft {
  notes: string;
  evidence: EvidenceEntry[];
}

/** Terbaru di atas; entri pada tanggal sama diurut dari yang paling akhir dibuat. */
const byNewest = (a: EvidenceEntry, b: EvidenceEntry) =>
  a.at === b.at ? b.createdAt.localeCompare(a.createdAt) : b.at.localeCompare(a.at);

export default function EvidenceDialog() {
  const taskId = useStore((s) => s.evidenceTaskId);
  const setEvidenceTask = useStore((s) => s.setEvidenceTask);
  const tasks = useStore((s) => s.tasks);

  // Draft lokal seperti sel tabel: mengetik tidak langsung commit, supaya satu
  // catatan tidak memakan puluhan langkah undo.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [bodyDraft, setBodyDraft] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const task = useMemo(
    () => (taskId ? (tasks.find((t) => t.id === taskId) ?? null) : null),
    [tasks, taskId],
  );
  // Nilai yang ditampilkan adalah `eff` hasil roll-up, bukan nilai mentah
  // task — sama dengan yang dilihat di tabel dan Summary.
  const node = useMemo(
    () => (taskId ? (buildOutline(tasks).byId.get(taskId) ?? null) : null),
    [tasks, taskId],
  );

  // Salinan kerja milik modal, seperti SettingsDialog. Mengetik di sini TIDAK
  // menyentuh store, jadi indikator "perubahan tertunda" di toolbar tetap diam
  // sampai tombol Simpan di bawah ditekan.
  const [local, setLocal] = useState<Draft | null>(null);
  useEffect(() => {
    setLocal(
      taskId
        ? (() => {
            const t = useStore.getState().tasks.find((x) => x.id === taskId);
            return t ? { notes: t.notes, evidence: t.evidence } : null;
          })()
        : null,
    );
    setNoteDraft(null);
    setBodyDraft(null);
    setError(null);
    setConfirmClose(false);
  }, [taskId]);

  const entries = useMemo(
    () => [...(local?.evidence ?? [])].sort(byNewest),
    [local],
  );

  const dirty =
    !!task &&
    !!local &&
    (local.notes !== task.notes ||
      JSON.stringify(local.evidence) !== JSON.stringify(task.evidence));

  if (!task || !local) return null;

  const discard = () => setEvidenceTask(null);

  // Esc menutup dialog sebelum textarea sempat kehilangan fokus, jadi commit
  // dilakukan di sini juga — kalau tidak, ketikan terakhir ikut hilang.
  const close = () => {
    const next = commitBody(commitNote(local));
    if (
      next.notes !== task.notes ||
      JSON.stringify(next.evidence) !== JSON.stringify(task.evidence)
    ) {
      setLocal(next);
      setConfirmClose(true);
      return;
    }
    discard();
  };

  const mutate = (fn: (list: EvidenceEntry[]) => EvidenceEntry[]) =>
    setLocal((l) => (l ? { ...l, evidence: fn(l.evidence) } : l));

  const updateEntry = (id: string, patch: Partial<EvidenceEntry>) =>
    mutate((list) =>
      list.map((entry) =>
        entry.id === id
          ? { ...entry, ...patch, updatedAt: new Date().toISOString() }
          : entry,
      ),
    );

  const addEntry = () => {
    const now = new Date().toISOString();
    mutate((list) => [
      ...list,
      {
        id: newId(),
        at: todayISO(),
        body: "",
        assets: [],
        createdAt: now,
        updatedAt: now,
      },
    ]);
  };

  const removeEntry = (id: string) =>
    mutate((list) => list.filter((entry) => entry.id !== id));

  const mapAssets = (
    entryId: string,
    fn: (assets: EvidenceAsset[]) => EvidenceAsset[],
  ) =>
    mutate((list) =>
      list.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              assets: fn(entry.assets),
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    );

  const addLink = (entryId: string) =>
    mapAssets(entryId, (assets) => [
      ...assets,
      { id: newId(), kind: "link", label: "", href: "", mime: "", bytes: 0 },
    ]);

  const patchAsset = (
    entryId: string,
    assetId: string,
    patch: Partial<EvidenceAsset>,
  ) =>
    mapAssets(entryId, (assets) =>
      assets.map((asset) =>
        asset.id === assetId ? { ...asset, ...patch } : asset,
      ),
    );

  const removeAsset = (entryId: string, assetId: string) =>
    mapAssets(entryId, (assets) => assets.filter((a) => a.id !== assetId));

  // Berkasnya disalin ke folder data saat ini juga, tapi entrinya tetap baru
  // tersimpan saat tombol Simpan ditekan. Sisa berkas dari entri yang
  // dibatalkan disapu proses utama saat aplikasi berikutnya hidup.
  const attach = async (entryId: string) => {
    setError(null);
    try {
      const added = await zeno().evidence.attach(task.id);
      if (added.length) mapAssets(entryId, (assets) => [...assets, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal melampirkan berkas.");
    }
  };

  // Dua ini murni: menerima salinan kerja dan mengembalikan yang baru. Bentuk
  // itu dibutuhkan karena Simpan dan Tutup harus melipat draft textarea yang
  // masih terbuka SEBELUM membaca hasilnya, dan setState belum terlihat di
  // tick yang sama.
  const commitNote = (d: Draft): Draft =>
    noteDraft !== null && noteDraft !== d.notes ? { ...d, notes: noteDraft } : d;

  const commitBody = (d: Draft): Draft => {
    if (!bodyDraft) return d;
    return {
      ...d,
      evidence: d.evidence.map((entry) =>
        entry.id === bodyDraft.id && entry.body !== bodyDraft.text
          ? {
              ...entry,
              body: bodyDraft.text,
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    };
  };

  const applyNote = () => {
    setLocal((l) => (l ? commitNote(l) : l));
    setNoteDraft(null);
  };

  const applyBody = () => {
    setLocal((l) => (l ? commitBody(l) : l));
    setBodyDraft(null);
  };

  /** true bila benar-benar tersimpan — pemanggil tidak boleh menutup saat gagal. */
  const saveOne = async (): Promise<boolean> => {
    setError(null);
    const next = commitBody(commitNote(local));
    setLocal(next);
    setNoteDraft(null);
    setBodyDraft(null);
    setBusy(true);
    try {
      await useStore
        .getState()
        .saveEvidence(task.id, next.notes, next.evidence);
      setConfirmClose(false);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="sm:max-w-3xl"
        // Tanpa ini Radix menaruh fokus di field pertama, dan field itu akan
        // langsung membuka mode sunting sehingga markdown-nya tidak pernah
        // sempat terlihat ter-render.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Deskripsi &amp; Bukti</DialogTitle>
          <DialogDescription className="sr-only">
            Deskripsi dan bukti untuk task {node?.wbs}.
          </DialogDescription>

          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-raised)] font-mono text-[13px] font-semibold text-[var(--color-mark)]">
              {node?.wbs}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold leading-5 text-[var(--color-ink)]">
                {task.title || "Tanpa judul"}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {node && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={statusStyle[node.eff.status]}
                  >
                    {STATUS_LABEL[node.eff.status]}
                  </span>
                )}
                {node && isOverdue(node.eff) && (
                  <span className="rounded bg-[var(--color-blocked-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-blocked-ink)]">
                    Overdue
                  </span>
                )}
                <span className="rounded bg-[var(--color-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-soft)]">
                  {PRIORITY_LABEL[task.priority]}
                </span>
              </div>
            </div>
          </div>

          {node && (
            <div className="mt-3">
              <div className="mb-1 flex items-end justify-between">
                <span className="flex items-center gap-1 text-[11px] text-[var(--color-ink-soft)]">
                  <CalendarRange className="size-3" />
                  <span className="num">
                    {node.eff.start} → {node.eff.end}
                  </span>
                  <span className="text-[var(--color-faint)]">
                    · {durationOf(node.eff.start, node.eff.end)} hari
                  </span>
                </span>
                <span className="num text-[16px] font-semibold leading-none text-[var(--color-ink)]">
                  {node.eff.progress}%
                </span>
              </div>
              <Progress
                value={node.eff.progress}
                className="h-1.5 bg-[var(--color-bar-track)]"
              >
                <ProgressIndicator className="bg-[var(--color-bar)]" />
              </Progress>
            </div>
          )}
        </DialogHeader>

        <div className="scroll-pane max-h-[68vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <span className={label}>Deskripsi</span>
            <MarkdownField
              value={local.notes}
              draft={noteDraft}
              rows={6}
              placeholder="Apa isi task ini. Bisa pakai markdown — klik untuk menulis…"
              onStart={() => setNoteDraft(local.notes)}
              onDraft={setNoteDraft}
              onCommit={applyNote}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className={label}>Bukti</span>
              <Button
                variant="outline"
                size="sm"
                type="button"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={addEntry}
              >
                <Plus className="size-3" />
                Tambah entri
              </Button>
            </div>

            {entries.length === 0 ? (
              <div className="rounded-md border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[12px] text-[var(--color-ink-soft)]">
                Belum ada bukti untuk task ini.
                <div className="mt-1 text-[11px] text-[var(--color-faint)]">
                  Tiap entri punya tanggal sendiri, jadi bisa dipakai merekam
                  perkembangan dari waktu ke waktu.
                </div>
              </div>
            ) : (
              // Rel vertikal + titik per entri: log bukti dibaca sebagai
              // kronologi, bukan sebagai daftar kartu yang berdiri sendiri.
              <div className="relative space-y-2 pl-5">
                <span
                  aria-hidden
                  className="absolute bottom-3 left-[7px] top-3 w-px bg-[var(--color-line)]"
                />
                {entries.map((entry) => {
                  const draft = bodyDraft?.id === entry.id ? bodyDraft : null;
                  return (
                    <div
                      key={entry.id}
                      className="relative rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-2"
                    >
                      <span
                        aria-hidden
                        className="absolute -left-[17px] top-3 size-2 rounded-full bg-[var(--color-mark)] ring-2 ring-[var(--background)]"
                      />
                      <div className="mb-1.5 flex items-center gap-2">
                        <input
                          type="date"
                          className={`${field} num w-36`}
                          value={entry.at}
                          onChange={(e) =>
                            e.target.value &&
                            updateEntry(entry.id, { at: e.target.value })
                          }
                        />
                        {entry.at > todayISO() && (
                          <span className="rounded bg-[var(--color-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-faint)]">
                            Terjadwal
                          </span>
                        )}
                        <div className="flex-1" />
                        {entry.assets.length > 0 && (
                          <span className="num shrink-0 text-[10px] text-[var(--color-faint)]">
                            {entry.assets.length} lampiran
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          type="button"
                          className="size-6 text-[var(--color-faint)] hover:text-[var(--color-blocked)]"
                          title="Hapus entri ini"
                          onClick={() => removeEntry(entry.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>

                      <MarkdownField
                        value={entry.body}
                        draft={draft ? draft.text : null}
                        rows={5}
                        placeholder="Apa yang terjadi, apa buktinya. Klik untuk menulis…"
                        onStart={() =>
                          setBodyDraft({ id: entry.id, text: entry.body })
                        }
                        onDraft={(text) => setBodyDraft({ id: entry.id, text })}
                        onCommit={applyBody}
                      />

                      {entry.assets.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {entry.assets.map((asset) => (
                            <div key={asset.id}>
                              <div className="flex items-center gap-1.5">
                                {asset.kind === "file" ? (
                                  <Paperclip className="size-3 shrink-0 text-[var(--color-faint)]" />
                                ) : (
                                  <Link2 className="size-3 shrink-0 text-[var(--color-faint)]" />
                                )}
                                {asset.kind === "file" ? (
                                  <>
                                    <span className="min-w-0 flex-1 truncate text-[12px]">
                                      {asset.label}
                                    </span>
                                    <span className="num shrink-0 text-[11px] text-[var(--color-faint)]">
                                      {formatBytes(asset.bytes)}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      type="button"
                                      className="size-6 shrink-0 text-[var(--color-faint)] hover:text-[var(--color-mark)]"
                                      title="Buka dengan aplikasi bawaan"
                                      onClick={() =>
                                        void zeno()
                                          .evidence.reveal(asset.href)
                                          .catch(() => undefined)
                                      }
                                    >
                                      <ExternalLink className="size-3" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <input
                                      className={`${field} w-32 shrink-0`}
                                      placeholder="Label"
                                      value={asset.label}
                                      onChange={(e) =>
                                        patchAsset(entry.id, asset.id, {
                                          label: e.target.value,
                                        })
                                      }
                                    />
                                    <input
                                      className={`${field} min-w-0 flex-1`}
                                      placeholder="https://…"
                                      value={asset.href}
                                      onChange={(e) =>
                                        patchAsset(entry.id, asset.id, {
                                          href: e.target.value,
                                        })
                                      }
                                    />
                                  </>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  type="button"
                                  className="size-6 shrink-0 text-[var(--color-faint)] hover:text-[var(--color-blocked)]"
                                  title={
                                    asset.kind === "file"
                                      ? "Hapus lampiran dari entri ini"
                                      : "Hapus tautan"
                                  }
                                  onClick={() => removeAsset(entry.id, asset.id)}
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                              </div>
                              {asset.kind === "file" &&
                                asset.mime.startsWith("image/") && (
                                  <ImagePreview asset={asset} />
                                )}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-1.5 flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          className="h-6 gap-1 px-1.5 text-[11px] text-[var(--color-ink-soft)] hover:text-[var(--color-mark)]"
                          onClick={() => addLink(entry.id)}
                        >
                          <Plus className="size-3" />
                          Tautan
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          className="h-6 gap-1 px-1.5 text-[11px] text-[var(--color-ink-soft)] hover:text-[var(--color-mark)]"
                          onClick={() => void attach(entry.id)}
                        >
                          <Paperclip className="size-3" />
                          Berkas
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded border border-[var(--color-blocked)] px-2 py-1.5 text-[11px] text-[var(--color-blocked)]">
            {error}
          </div>
        )}

        {confirmClose ? (
          <div className="flex items-center justify-between gap-3 rounded border border-[var(--color-line)] bg-[var(--color-raised)] px-2 py-1.5">
            <span className="text-[11px] text-[var(--color-ink-soft)]">
              Ada perubahan yang belum disimpan.
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className="h-7 px-2 text-[11px] text-[var(--color-ink-soft)]"
                onClick={discard}
              >
                Buang
              </Button>
              <Button
                variant="accent"
                size="sm"
                type="button"
                className="h-7 gap-1 px-3 text-[11px]"
                disabled={busy}
                onClick={() =>
                  void saveOne().then((ok) => ok && discard())
                }
              >
                <Check className="size-3" />
                {busy ? "menyimpan…" : "Simpan lalu tutup"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-[var(--color-faint)]">
              {dirty
                ? "Belum disimpan. Tombol ini hanya menulis task ini, tidak menyentuh perubahan task lain."
                : "Tersimpan."}
            </span>
            <Button
              variant="accent"
              size="sm"
              type="button"
              className="h-7 gap-1 px-3 text-[11px]"
              disabled={!dirty || busy}
              onClick={() => void saveOne()}
            >
              <Check className="size-3" />
              {busy ? "menyimpan…" : "Simpan task ini"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
