"use client";

import { isValidElement, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Bawaan mermaid `useMaxWidth: true` menyetel lebar & tinggi SVG ke 100% lalu
 * meregangkannya mengikuti ruang yang tersedia — diagram sekecil apa pun akan
 * memenuhi lebar wadahnya. `false` membuatnya memakai ukuran aslinya saja.
 */
const FIT = { useMaxWidth: false } as const;

/** Tema mermaid ikut kelas `dark` yang dipasang lib/theme.ts pada <html>. */
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/**
 * mermaid diimpor dinamis: paketnya besar dan hanya dibutuhkan saat sebuah
 * catatan benar-benar memuat diagram, jadi tidak ikut bundel awal.
 */
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dark = useIsDark();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          // Keluaran mermaid disisipkan sebagai HTML; 'strict' menyalakan
          // pembersihan DOMPurify miliknya sendiri.
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          fontFamily: "inherit",
          // Bawaan mermaid 16px, sementara tipografi aplikasi ini 11–12px.
          // Ukuran simpul dihitung dari ukuran teks, jadi menurunkannya di
          // sini yang benar-benar mengecilkan diagram — bukan menyusutkan
          // gambar jadi kecil lewat CSS.
          fontSize: 10,
          // Jarak dan padding bawaan dihitung untuk halaman dokumentasi yang
          // lapang. Di dalam modal, ruang kosong inilah yang paling banyak
          // memakan tempat, bukan simpulnya sendiri.
          flowchart: {
            ...FIT,
            diagramPadding: 4,
            nodeSpacing: 24,
            rankSpacing: 28,
            padding: 6,
          },
          sequence: {
            ...FIT,
            actorFontSize: 11,
            noteFontSize: 10,
            messageFontSize: 10,
            actorMargin: 40,
            boxMargin: 6,
            diagramMarginX: 8,
            diagramMarginY: 8,
          },
          class: FIT,
          state: FIT,
          er: FIT,
          gantt: FIT,
          journey: FIT,
          pie: FIT,
          timeline: FIT,
          mindmap: FIT,
          gitGraph: FIT,
        });
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        const rendered = await mermaid.render(id, code);
        if (!alive) return;
        setSvg(rendered.svg);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setSvg(null);
        setError(e instanceof Error ? e.message : "Diagram gagal dirender.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, dark]);

  // Sintaks yang salah tidak boleh menelan isi tulisan — sumbernya tetap
  // ditampilkan supaya bisa diperbaiki.
  if (error)
    return (
      <div className="my-2 rounded border border-[var(--color-blocked)] p-2">
        <div className="mb-1 text-[11px] text-[var(--color-blocked)]">
          Diagram tidak bisa dirender: {error}
        </div>
        <pre className="overflow-x-auto text-[11px]">{code}</pre>
      </div>
    );

  if (!svg)
    return (
      <div className="my-2 text-[11px] text-[var(--color-faint)]">
        memuat diagram…
      </div>
    );

  return (
    <div className="mermaid-box" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

/** Ambil sumber mermaid dari <pre><code class="language-mermaid">, bila itu isinya. */
function mermaidSource(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child))
    return null;
  if (!child.props.className?.includes("language-mermaid")) return null;
  return String(child.props.children ?? "").replace(/\n$/, "");
}

/**
 * react-markdown tidak merender HTML mentah, jadi teks dari model maupun
 * catatan yang diketik sendiri tidak bisa menyuntikkan markup.
 * Styling datang dari kelas global `.md` di app/globals.css — pemanggil yang
 * memasangnya pada elemen pembungkus.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children: inner, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {inner}
          </a>
        ),
        // Diagram menggantikan seluruh <pre>, bukan hanya <code> di dalamnya —
        // kalau tidak, latar abu blok kode ikut membingkai diagramnya.
        pre: ({ children: inner, ...props }) => {
          const source = mermaidSource(inner);
          return source !== null ? (
            <MermaidBlock code={source} />
          ) : (
            <pre {...props}>{inner}</pre>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
