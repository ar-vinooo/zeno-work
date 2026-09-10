import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Menjalankan Claude Code CLI sebagai penyedia jawaban, alternatif dari API key.
 *
 * Berguna untuk pemakaian lokal: kalau CLI-nya sudah login, pemakaiannya masuk
 * ke langganan yang sama, bukan tagihan per token yang terpisah.
 *
 * Catatan keamanan: ini menjalankan proses di mesin yang menjalankan aplikasi.
 * Aman selama aplikasinya lokal seperti sekarang, dan TIDAK boleh diaktifkan
 * bila suatu saat aplikasinya di-hosting. Karena itu prompt dikirim lewat
 * stdin (bukan argumen), shell tidak pernah dipakai, dan semua tool CLI-nya
 * dimatikan supaya ia tidak bisa menyentuh berkas.
 */

const DISALLOWED = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit",
].join(",");

export interface CliResult {
  text: string;
  raw: string;
  costUsd?: number;
}

interface ClaudeCliJson {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
}

/**
 * Env untuk proses anak, dengan kredensial API sengaja dibuang.
 *
 * Server ini memuat .env, jadi tanpa pembersihan ini CLI mewarisi
 * ANTHROPIC_API_KEY dan memakainya — padahal seluruh alasan memilih mode CLI
 * adalah memakai sesi login CLI-nya sendiri. Kalau kuncinya tidak terikat
 * workspace, warisan itu bahkan bikin gagal dengan 400.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_WORKSPACE_ID;
  return env;
}

function run(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // shell: false — input pengguna tidak pernah melewati penafsir shell.
    const child = spawn(command, args, { shell: false, env: childEnv() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} tidak merespons dalam ${timeoutMs / 1000} detik`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Gagal menjalankan "${command}": ${err.message}. Pastikan CLI-nya terpasang dan ada di PATH.`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

export async function runClaudeCli(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
  cliPath?: string,
  effort?: string,
  timeoutMs = 180_000,
): Promise<CliResult> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--system-prompt",
    systemPrompt,
    "--disallowedTools",
    DISALLOWED,
  ];
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);

  const { code, stdout, stderr } = await run(
    cliPath || "claude",
    args,
    userPrompt,
    timeoutMs,
  );

  let parsed: ClaudeCliJson;
  try {
    parsed = JSON.parse(stdout) as ClaudeCliJson;
  } catch {
    throw new Error(
      `Keluaran claude CLI tidak bisa dibaca (exit ${code}). ${stderr.slice(0, 300) || stdout.slice(0, 300)}`,
    );
  }
  if (parsed.is_error || parsed.subtype !== "success") {
    const detail = parsed.result ?? stderr.slice(0, 300);
    if (/401|authentication|not logged in|invalid api key|credit balance/i.test(detail))
      throw new Error(
        `claude CLI belum terautentikasi. Jalankan "claude" di terminal lalu login, atau pindah ke mode Kunci API di Setelan. Pesan asli: ${detail}`,
      );
    throw new Error(`claude CLI gagal: ${detail}`);
  }

  return {
    text: parsed.result ?? "",
    raw: stdout,
    costUsd: parsed.total_cost_usd,
  };
}

/**
 * Menjalankan Codex CLI (`codex exec`) sebagai penyedia jawaban.
 *
 * Beda dengan claude CLI dalam dua hal yang menentukan bentuk pemanggilan:
 * tidak ada flag system prompt — jadi instruksi sistem ditempel di depan
 * prompt — dan tidak ada daftar tool untuk dimatikan, jadi pembatasannya
 * lewat sandbox `read-only` plus direktori kerja sementara yang kosong,
 * supaya isi proyek tidak ikut terbaca.
 */
export async function runCodexCli(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
  cliPath?: string,
  effort?: string,
  timeoutMs = 180_000,
): Promise<CliResult> {
  const workdir = await mkdtemp(join(tmpdir(), "zeno-codex-"));
  const outFile = join(workdir, "last-message.txt");

  const args = [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "--cd",
    workdir,
    "--output-last-message",
    outFile,
  ];
  if (model) args.push("--model", model);
  // Tingkat penalaran hanya bisa lewat override config, tidak ada flag khusus.
  if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
  // "-" memaksa prompt dibaca dari stdin, bukan dari argumen.
  args.push("-");

  try {
    const { code, stdout, stderr } = await run(
      cliPath || "codex",
      args,
      `${systemPrompt}\n\n---\n\n${userPrompt}`,
      timeoutMs,
    );

    // Pesan terakhir ditulis ke berkas; stdout hanya jejak proses.
    const text = await readFile(outFile, "utf8").catch(() => "");
    if (!text.trim()) {
      const detail = (stderr || stdout).slice(0, 300);
      if (/401|unauthorized|not logged in|login|authentic/i.test(detail))
        throw new Error(
          `codex CLI belum terautentikasi. Jalankan "codex login" di terminal, atau pindah ke mode lain di Setelan. Pesan asli: ${detail}`,
        );
      throw new Error(`codex CLI gagal (exit ${code}): ${detail || "keluaran kosong"}`);
    }

    return { text: text.trim(), raw: stdout };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Buang pembungkus ```json ... ``` yang sering ditambahkan model. */
export function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (fenced ? fenced[1] : text).trim();
}
