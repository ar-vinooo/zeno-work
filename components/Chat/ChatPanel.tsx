"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/animate-ui/components/buttons/button";
import { zeno } from "@/lib/bridge";
import { useStore } from "@/lib/store";
import type { AiOperation } from "@/lib/ai";
import type { ChatMessage } from "@/lib/chat";

interface Turn {
  role: "user" | "assistant";
  text: string;
  /** Ringkasan perubahan yang diterapkan dari giliran ini. */
  applied?: string[];
}

/** Bentuk pesan yang dikirim lewat IPC — sengaja minimal, bukan tipe SDK. */
type WireMessage = ChatMessage;

const WIDTH_KEY = "zenowork.chat-width";
const WIDTH_DEFAULT = 340;
const WIDTH_MIN = 260;
const WIDTH_MAX = 720;

const CONTOH = [
  "Tambah sub-task 'Uji coba' di 15.6",
  "Set progres 5.7 jadi 80%",
  "Cek Git di 5.7 lalu buatkan task tindak lanjut dari update terbaru",
  "Mana saja yang overdue?",
];

export default function ChatPanel() {
  const open = useStore((s) => s.chatOpen);
  const toggleChat = useStore((s) => s.toggleChat);
  const applyAiOperations = useStore((s) => s.applyAiOperations);
  const tasks = useStore((s) => s.tasks);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Lebar panel disimpan di browser dan ditulis langsung ke elemennya saat
  // diseret — bukan lewat state — supaya menyeret tidak me-render ulang
  // daftar percakapan tiap frame.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(saved) && saved >= WIDTH_MIN)
        panelRef.current.style.width = `${Math.min(saved, WIDTH_MAX)}px`;
    } catch {
      // localStorage bisa ditolak browser; lebar bawaan sudah cukup.
    }
  }, [open]);

  const startResize = (event: React.PointerEvent) => {
    if (event.button !== 0 || !panelRef.current) return;
    event.preventDefault();
    const startX = event.clientX;
    const startW = panelRef.current.offsetWidth;
    document.body.style.cursor = "col-resize";

    const move = (e: PointerEvent) => {
      // Panel menempel di kanan: menyeret ke kiri berarti melebarkan.
      const next = Math.max(
        WIDTH_MIN,
        Math.min(WIDTH_MAX, startW - (e.clientX - startX)),
      );
      if (panelRef.current) panelRef.current.style.width = `${next}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      try {
        if (panelRef.current)
          localStorage.setItem(WIDTH_KEY, String(panelRef.current.offsetWidth));
      } catch {
        // lebarnya tetap berlaku sampai halaman ditutup
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resetWidth = () => {
    if (panelRef.current) panelRef.current.style.width = `${WIDTH_DEFAULT}px`;
    try {
      localStorage.removeItem(WIDTH_KEY);
    } catch {
      // abaikan
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  if (!open) return null;

  const send = async (prompt: string) => {
    const text = prompt.trim();
    if (!text || busy) return;
    setDraft("");
    setError(null);
    setBusy(true);

    const history: WireMessage[] = [
      ...turns.map((t) => ({ role: t.role, content: t.text })),
      { role: "user" as const, content: text },
    ];
    setTurns((prev) => [...prev, { role: "user", text }]);

    try {
      const data = await zeno().chat.send(history, tasks);

      const applied = data.operations?.length
        ? applyAiOperations(data.operations)
        : undefined;
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.text || (applied?.length ? "Selesai." : "(tidak ada jawaban)"),
          applied,
        },
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      ref={panelRef}
      className="relative flex shrink-0 flex-col border-l border-[var(--color-line)]"
      style={{ width: WIDTH_DEFAULT, background: "var(--color-surface)" }}
    >
      <div
        className="absolute inset-y-0 left-0 z-10 w-[5px] cursor-col-resize hover:bg-[var(--color-mark)]"
        title="Seret untuk mengubah lebar panel · klik ganda untuk mengembalikan"
        onPointerDown={startResize}
        onDoubleClick={resetWidth}
      />
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-line)] px-3">
        <Sparkles className="size-3.5 text-[var(--color-mark)]" />
        <span className="text-[12px] font-semibold">Asisten</span>
        <button
          className="ml-auto text-[var(--color-faint)] hover:text-[var(--color-ink)]"
          onClick={toggleChat}
          title="Tutup"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="scroll-pane flex-1 space-y-3 overflow-y-auto p-3 text-[12px]">
        {turns.length === 0 && (
          <div className="space-y-2 text-[var(--color-ink-soft)]">
            <p>
              Suruh aku menambah, mengubah, atau menghapus baris. Perubahannya
              masuk sebagai <b>usulan</b> — kamu yang menekan Simpan.
            </p>
            <div className="space-y-1">
              {CONTOH.map((c) => (
                <button
                  key={c}
                  className="block w-full rounded border border-[var(--color-line)] px-2 py-1 text-left text-[11px] hover:border-[var(--color-mark)]"
                  onClick={() => void send(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[92%] rounded-lg px-2.5 py-1.5 text-left ${
                turn.role === "user"
                  ? "whitespace-pre-wrap bg-[var(--color-raised)]"
                  : "md border border-[var(--color-line)]"
              }`}
            >
              {/* Pesan pengguna ditampilkan apa adanya; hanya jawaban model
                  yang dirender sebagai markdown. react-markdown tidak
                  merender HTML mentah, jadi teks dari model tidak bisa
                  menyuntikkan markup. */}
              {turn.role === "user" ? (
                turn.text
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ children, ...props }) => (
                      <a {...props} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {turn.text}
                </ReactMarkdown>
              )}
              {turn.applied && turn.applied.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-[var(--color-line)] pt-1.5 text-[11px] text-[var(--color-ink-soft)]">
                  {turn.applied.map((line, j) => (
                    <div key={j} className="num">
                      {line}
                    </div>
                  ))}
                  <div className="pt-0.5 text-[var(--color-mark)]">
                    Belum tersimpan — tekan Simpan bila sudah cocok.
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="text-[11px] text-[var(--color-faint)]">berpikir…</div>
        )}
        {error && (
          <div className="rounded border border-[var(--color-blocked)] px-2 py-1.5 text-[11px] text-[var(--color-blocked)]">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex shrink-0 items-end gap-1.5 border-t border-[var(--color-line)] p-2">
        <textarea
          rows={2}
          value={draft}
          disabled={busy}
          placeholder="Tulis perintah… (Enter kirim, ⇧Enter baris baru)"
          className="flex-1 resize-none rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--color-mark)]"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <Button
          size="icon"
          className="size-8"
          disabled={busy || !draft.trim()}
          onClick={() => void send(draft)}
        >
          <Send className="size-3.5" />
        </Button>
      </div>
    </aside>
  );
}
