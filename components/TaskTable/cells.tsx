"use client";

import { useEffect, useRef, useState } from "react";

interface EditableProps {
  value: string;
  editing: boolean;
  align?: "left" | "right";
  placeholder?: string;
  className?: string;
  onStart: () => void;
  onCommit: (raw: string) => void;
  onCancel: () => void;
  onNavigate: (dir: 1 | -1) => void;
  onEnter?: () => void;
  render?: () => React.ReactNode;
  readOnly?: boolean;
  title?: string;
}

/**
 * Sel spreadsheet: klik untuk edit di tempat, Enter simpan, Esc batal,
 * Tab pindah sel. Tidak pernah membuka modal (§5.1 PRD).
 */
export function Editable({
  value,
  editing,
  align = "left",
  placeholder,
  className = "",
  onStart,
  onCommit,
  onCancel,
  onNavigate,
  onEnter,
  render,
  readOnly,
  title,
}: EditableProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      requestAnimationFrame(() => ref.current?.select());
    }
  }, [editing, value]);

  if (editing && !readOnly)
    return (
      <input
        ref={ref}
        className={`bare num ${align === "right" ? "text-right" : ""} ${className}`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(draft);
            onEnter?.();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else if (e.key === "Tab") {
            e.preventDefault();
            onCommit(draft);
            onNavigate(e.shiftKey ? -1 : 1);
          }
        }}
      />
    );

  return (
    <div
      className={`w-full truncate ${align === "right" ? "text-right" : ""} ${
        readOnly ? "cursor-not-allowed" : "cursor-text"
      } ${className}`}
      title={title}
      onMouseDown={(e) => {
        if (readOnly || e.detail > 1) return;
      }}
      onClick={() => !readOnly && onStart()}
    >
      {render ? render() : value || <span className="text-[var(--color-faint)]">{placeholder}</span>}
    </div>
  );
}

interface ProgressProps {
  value: number;
  readOnly: boolean;
  onChange: (value: number) => void;
  children: React.ReactNode;
}

/** Bar mini yang juga bisa di-drag untuk menyetel persen. */
export function ProgressTrack({ value, readOnly, onChange, children }: ProgressProps) {
  const ref = useRef<HTMLDivElement>(null);

  const setFromEvent = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const pct = Math.round(((clientX - box.left) / box.width) * 100);
    onChange(Math.max(0, Math.min(100, pct)));
  };

  return (
    <div
      ref={ref}
      className={`relative h-[7px] w-full overflow-hidden rounded-full ${
        readOnly ? "" : "cursor-ew-resize"
      }`}
      // Alur digelapkan dari warna baris, bukan diberi warna tetap: baris bisa
      // putih, bisa pita induk, bisa biru saat terpilih. Warna tetap membuat
      // alur 0% hilang di baris putih dan justru lebih terang dari baris induk.
      style={{ background: "color-mix(in srgb, var(--color-ink) 10%, transparent)" }}
      onPointerDown={(e) => {
        if (readOnly || e.button !== 0) return;
        e.preventDefault();
        setFromEvent(e.clientX);
        const move = (ev: PointerEvent) => setFromEvent(ev.clientX);
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${value}%`,
          // Hijau begitu penuh, dan hijaunya PERSIS hijau bar Gantt — dua bar
          // itu berdiri di baris yang sama, jadi keduanya harus warna yang
          // sama. Isian pakai --color-bar; teks dan titik pakai --color-done
          // yang lebih gelap, karena keduanya butuh kontras untuk terbaca.
          background: value >= 100 ? "var(--color-bar)" : "var(--color-bar-fill)",
          // Baris induk tidak lagi diberi warna berbeda — yang menandainya
          // read-only adalah teks persen yang redup dan kursornya.
          opacity: readOnly ? 0.55 : 1,
        }}
      />
      {children}
    </div>
  );
}
