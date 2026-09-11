"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/animate-ui/components/radix/radio-group";
import { zeno } from "@/lib/bridge";
import { useStore } from "@/lib/store";
import type { AiProvider, PublicSettings } from "@/lib/settings";

const MODELS = [
  { id: "claude-opus-5", label: "Opus 5 — paling teliti ($5/$25 per 1J token)" },
  { id: "claude-sonnet-5", label: "Sonnet 5 — seimbang ($2/$10)" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 — paling murah ($1/$5)" },
];

/** Model codex yang tampil di picker CLI-nya (visibility "list"). */
const CODEX_MODELS = [
  { id: "", label: "Bawaan codex (ikut ~/.codex/config.toml)" },
  { id: "gpt-6-astra", label: "GPT-6-Astra — paling mampu" },
  { id: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6-Luna" },
  { id: "gpt-5.5", label: "GPT-5.5" },
];

const CLAUDE_EFFORTS = [
  { id: "low", label: "Low — cepat, penalaran ringan" },
  { id: "medium", label: "Medium — seimbang" },
  { id: "high", label: "High — untuk soal rumit" },
  { id: "xhigh", label: "XHigh" },
  { id: "max", label: "Max — paling dalam, paling lambat" },
];

const CODEX_EFFORTS = [
  { id: "", label: "Bawaan model" },
  { id: "low", label: "Low — cepat, penalaran ringan" },
  { id: "medium", label: "Medium — seimbang" },
  { id: "high", label: "High — untuk soal rumit" },
  { id: "xhigh", label: "XHigh" },
  { id: "max", label: "Max — paling dalam, paling lambat" },
];

const field =
  "h-8 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[12px] outline-none focus:border-[var(--color-mark)]";
const label = "mb-1 block text-[11px] font-medium text-[var(--color-ink-soft)]";

export default function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);

  const [data, setData] = useState<PublicSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote(null);
    setApiKey("");
    void zeno()
      .settings.get()
      .then(setData)
      .catch(() => setNote("Gagal memuat setelan."));
  }, [open]);

  const patch = (next: Partial<PublicSettings>) =>
    setData((d) => (d ? { ...d, ...next } : d));

  const save = async () => {
    if (!data) return;
    setBusy(true);
    setNote(null);
    try {
      const fresh = await zeno().settings.set({
        aiProvider: data.aiProvider,
        anthropicModel: data.anthropicModel,
        anthropicWorkspaceId: data.anthropicWorkspaceId,
        anthropicEffort: data.anthropicEffort,
        claudeCliPath: data.claudeCliPath,
        codexCliPath: data.codexCliPath,
        codexModel: data.codexModel,
        codexEffort: data.codexEffort,
        // Hanya dikirim bila kamu benar-benar mengetik sesuatu; kunci lama
        // tidak pernah dikirim balik ke halaman, jadi tidak bisa tertimpa
        // kosong tanpa sengaja.
        ...(apiKey ? { anthropicApiKey: apiKey } : {}),
      });
      setData(fresh);
      setApiKey("");
      setNote("Tersimpan. Berlaku langsung, tidak perlu restart.");
    } catch {
      setNote("Gagal menyimpan setelan.");
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setBusy(true);
    setData(await zeno().settings.set({ anthropicApiKey: "" }));
    setBusy(false);
    setNote("Kunci API dihapus.");
  };

  const cli = data?.aiProvider === "claude-cli";
  const codex = data?.aiProvider === "codex-cli";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Setelan</DialogTitle>
        </DialogHeader>

        {!data ? (
          <div className="text-[12px] text-[var(--color-faint)]">memuat…</div>
        ) : (
          <div className="space-y-3">
            <div>
              <span className={label}>Sumber jawaban Asisten</span>
              <RadioGroup
                className="grid grid-cols-3 gap-1.5"
                value={data.aiProvider}
                onValueChange={(value) => patch({ aiProvider: value as AiProvider })}
              >
                {(
                  [
                    ["api", "Kunci API", "Tagihan per token"],
                    ["claude-cli", "Claude CLI", "Ikut langganan, lebih lambat"],
                    ["codex-cli", "Codex CLI", "Ikut langganan ChatGPT"],
                  ] as [AiProvider, string, string][]
                ).map(([id, title, hint]) => (
                  <label
                    key={id}
                    className={`rounded-md border px-2 py-1.5 text-left text-[12px] ${
                      data.aiProvider === id
                        ? "border-[var(--color-mark)] bg-[var(--color-mark-soft)]"
                        : "border-[var(--color-line)]"
                    }`}
                  >
                    <RadioGroupItem value={id} className="sr-only" />
                    <div className="font-medium">{title}</div>
                    <div className="text-[10px] text-[var(--color-ink-soft)]">
                      {hint}
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            {/* Urutan sama di semua mode: Model → penalaran → kredensial. */}
            <div>
              <span className={label}>Model</span>
              {codex ? (
                <select
                  className={`${field} cursor-pointer`}
                  value={data.codexModel}
                  onChange={(e) => patch({ codexModel: e.target.value })}
                >
                  {CODEX_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {data.codexModel !== "" &&
                    !CODEX_MODELS.some((m) => m.id === data.codexModel) && (
                      <option value={data.codexModel}>{data.codexModel}</option>
                    )}
                </select>
              ) : (
                <select
                  className={`${field} cursor-pointer`}
                  value={data.anthropicModel}
                  onChange={(e) => patch({ anthropicModel: e.target.value })}
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {!MODELS.some((m) => m.id === data.anthropicModel) && (
                    <option value={data.anthropicModel}>
                      {data.anthropicModel}
                    </option>
                  )}
                </select>
              )}
            </div>

            <div>
              <span className={label}>Tingkat penalaran</span>
              {codex ? (
                <>
                  <select
                    className={`${field} cursor-pointer`}
                    value={data.codexEffort}
                    onChange={(e) => patch({ codexEffort: e.target.value })}
                  >
                    {CODEX_EFFORTS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-[var(--color-ink-soft)]">
                    Dikirim sebagai{" "}
                    <span className="num">-c model_reasoning_effort</span>. Makin
                    tinggi makin lama menjawab.
                  </p>
                </>
              ) : (
                <>
                  <select
                    className={`${field} cursor-pointer`}
                    value={data.anthropicEffort}
                    disabled={data.anthropicModel.startsWith("claude-haiku")}
                    onChange={(e) => patch({ anthropicEffort: e.target.value })}
                  >
                    {CLAUDE_EFFORTS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-[var(--color-ink-soft)]">
                    {data.anthropicModel.startsWith("claude-haiku")
                      ? "Haiku 4.5 tidak mengenal tingkat penalaran, jadi setelan ini diabaikan."
                      : "Mode Kunci API mengirimnya sebagai output_config.effort, mode CLI sebagai --effort."}
                  </p>
                </>
              )}
            </div>

            {codex ? (
              <div>
                <span className={label}>Lokasi perintah codex</span>
                <input
                  className={`${field} num`}
                  value={data.codexCliPath}
                  placeholder="codex"
                  onChange={(e) => patch({ codexCliPath: e.target.value })}
                />
                <p className="mt-1 text-[10px] text-[var(--color-ink-soft)]">
                  Dijalankan sebagai <span className="num">codex exec</span>{" "}
                  dengan sandbox read-only di direktori sementara. Proses jalan di
                  mesin ini — hanya untuk pemakaian lokal. Login sekali lewat{" "}
                  <span className="num">codex login</span>.
                </p>
              </div>
            ) : cli ? (
              <div>
                <span className={label}>Lokasi perintah claude</span>
                <input
                  className={`${field} num`}
                  value={data.claudeCliPath}
                  placeholder="claude"
                  onChange={(e) => patch({ claudeCliPath: e.target.value })}
                />
                <p className="mt-1 text-[10px] text-[var(--color-ink-soft)]">
                  Kosongkan bila <span className="num">claude</span> sudah ada di
                  PATH. Mode ini menjalankan proses di mesin ini — hanya untuk
                  pemakaian lokal.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <span className={label}>
                    Kunci API{" "}
                    {data.hasApiKey && (
                      <span className="num font-normal text-[var(--color-done)]">
                        tersimpan {data.apiKeyHint}
                      </span>
                    )}
                  </span>
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      className={`${field} num`}
                      value={apiKey}
                      placeholder={
                        data.hasApiKey ? "isi untuk mengganti" : "sk-ant-..."
                      }
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    {data.hasApiKey && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 text-[11px]"
                        disabled={busy}
                        onClick={() => void clearKey()}
                      >
                        Hapus
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--color-ink-soft)]">
                    Disimpan apa adanya di database aplikasi dan tidak pernah
                    dikirim balik ke halaman — hanya proses utama yang
                    menyentuhnya. Berkasnya di luar repo, tapi jangan dibagikan.
                  </p>
                </div>

                <div>
                  <span className={label}>Workspace ID (opsional)</span>
                  <input
                    className={`${field} num`}
                    value={data.anthropicWorkspaceId}
                    placeholder="hanya bila kunci tidak terikat workspace"
                    onChange={(e) =>
                      patch({ anthropicWorkspaceId: e.target.value })
                    }
                  />
                </div>
              </>
            )}

            {data.fromEnv.length > 0 && (
              <p className="rounded border border-[var(--color-line)] px-2 py-1.5 text-[10px] text-[var(--color-ink-soft)]">
                Sebagian nilai masih diambil dari <span className="num">.env</span>{" "}
                ({data.fromEnv.join(", ")}). Menyimpan di sini akan
                menggantikannya.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="sm:flex-wrap">
          {note && (
            <span className="mr-auto self-center text-[11px] text-[var(--color-ink-soft)]">
              {note}
            </span>
          )}
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Tutup
          </Button>
          <Button disabled={busy || !data} onClick={() => void save()}>
            {busy ? "Menyimpan…" : "Simpan setelan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
