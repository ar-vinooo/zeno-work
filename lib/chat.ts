import Anthropic from "@anthropic-ai/sdk";
import {
  CLI_OUTPUT_CONTRACT,
  READ_TOOLS,
  SYSTEM_INSTRUCTIONS,
  TOOLS,
  dateContext,
  type AiOperation,
} from "./ai";
import { runReadTool } from "./ai-query";
import { runClaudeCli, runCodexCli, stripFence } from "./ai-cli";
import { readSettings } from "./settings";
import { durationOf, todayISO } from "./dates";
import { isOverdue } from "./derive";
import { listTasks } from "./db";
import { buildOutline } from "./rollup";
import { STATUS_LABEL } from "./types";

/**
 * Asisten AI. Berjalan di proses utama Electron, bukan di renderer: kunci API
 * dan CLI tidak boleh pernah tersentuh halaman.
 *
 * Kegagalan dilempar sebagai Error biasa — jembatan IPC yang mengubahnya jadi
 * pesan yang ditampilkan di panel chat.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatReply {
  text: string;
  operations: AiOperation[];
  costUsd?: number;
}

/**
 * Parameter penalaran berbeda per keluarga model, dan salah pasang bukan
 * sekadar kurang optimal — Haiku 4.5 menolak `output_config.effort` dengan
 * 400, dan tidak mengenal thinking adaptif.
 */
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Haiku 4.5 tidak mengenal effort — sisanya menerima low..max. */
const effortFor = (model: string, effort: string): Effort | undefined =>
  model.startsWith("claude-haiku") ||
  !["low", "medium", "high", "xhigh", "max"].includes(effort)
    ? undefined
    : (effort as Effort);

function reasoningParams(model: string, effort: string) {
  if (model.startsWith("claude-haiku")) return {};
  const level = effortFor(model, effort);
  return {
    thinking: { type: "adaptive" as const },
    ...(level ? { output_config: { effort: level } } : {}),
  };
}

/** Ringkasan pohon yang dikirim ke model — satu baris per task. */
function outlineText(): string {
  const outline = buildOutline(listTasks(), { column: "manual", dir: "asc" });
  const today = todayISO();

  // Daftar isi tingkat 1 ditaruh di depan. Modelnya memang bisa menyimpulkan
  // ini sendiri dari 290 baris di bawah, tapi pertanyaan "task ini masuk ke
  // bagian mana" jadi jauh lebih murah dan lebih tepat kalau peta besarnya
  // sudah terbaca lebih dulu.
  const sections = outline.roots
    .map((n) => {
      const subs = n.children.length;
      return `${n.wbs}. ${n.task.title} — ${subs ? `${subs} sub-bagian` : "tanpa sub-task"}, ${n.eff.progress}%, ${n.eff.start}..${n.eff.end}`;
    })
    .join("\n");
  const lines = outline.all.map((n) => {
    const flags = [
      n.derived ? "induk" : null,
      isOverdue(n.eff, today) ? "OVERDUE" : null,
    ].filter(Boolean);
    return `${n.wbs}\t${n.task.title}\t${n.eff.progress}%\t${n.eff.start}..${n.eff.end}\t${durationOf(n.eff.start, n.eff.end)}h\t${STATUS_LABEL[n.eff.status]}${flags.length ? `\t[${flags.join(",")}]` : ""}`;
  });
  return `Hari ini: ${today}
Jumlah baris: ${outline.all.length} (${outline.roots.length} bagian di tingkat 1)

Bagian tingkat 1:
${sections}

Daftar lengkap (wbs, judul, progres, mulai..selesai, durasi, status):
${lines.join("\n")}`;
}

interface CliReply {
  reply?: string;
  operations?: AiOperation[];
}

async function viaCli(
  messages: ChatMessage[],
  provider: "claude-cli" | "codex-cli",
): Promise<ChatReply> {
  const settings = readSettings();

  // CLI dipanggil sekali per giliran tanpa state, jadi konteks dan riwayat
  // percakapan dikirim ulang sebagai satu prompt.
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Pengguna" : "Kamu"}: ${m.content}`)
    .join("\n\n");
  const prompt = `${dateContext()}\n\n${outlineText()}\n\n---\n\n${transcript}`;

  const system = `${SYSTEM_INSTRUCTIONS}\n${CLI_OUTPUT_CONTRACT}`;

  const result =
    provider === "codex-cli"
      ? await runCodexCli(
          system,
          prompt,
          settings.codexModel || undefined,
          settings.codexCliPath,
          settings.codexEffort || undefined,
        )
      : await runClaudeCli(
          system,
          prompt,
          settings.anthropicModel,
          settings.claudeCliPath,
          effortFor(settings.anthropicModel, settings.anthropicEffort),
        );

  let parsed: CliReply;
  try {
    parsed = JSON.parse(stripFence(result.text)) as CliReply;
  } catch {
    // Model tidak mematuhi bentuk JSON — tampilkan teksnya apa adanya
    // daripada menggagalkan seluruh giliran.
    return { text: result.text, operations: [] };
  }
  return {
    text: parsed.reply ?? "",
    operations: Array.isArray(parsed.operations) ? parsed.operations : [],
    costUsd: result.costUsd,
  };
}

export async function runChat(messages: ChatMessage[]): Promise<ChatReply> {
  if (messages.length === 0) throw new Error("Tidak ada pesan");

  const settings = readSettings();
  if (settings.aiProvider === "claude-cli" || settings.aiProvider === "codex-cli")
    return viaCli(messages, settings.aiProvider);

  if (!settings.anthropicApiKey)
    throw new Error(
      "Kunci API belum diisi. Buka Setelan (ikon gerigi) untuk mengisinya.",
    );

  // Kunci API yang tidak terikat workspace wajib menyertakan header ini,
  // kalau tidak permintaannya ditolak 400.
  const workspace = settings.anthropicWorkspaceId;
  const client = new Anthropic({
    apiKey: settings.anthropicApiKey,
    ...(workspace
      ? { defaultHeaders: { "anthropic-workspace-id": workspace } }
      : {}),
  });

  // Urutan penting untuk cache: yang stabil dulu, yang berubah tiap hari
  // ditaruh setelah breakpoint terakhir.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_INSTRUCTIONS },
    {
      type: "text",
      text: outlineText(),
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: dateContext() },
  ];
  const READ_NAMES = new Set(READ_TOOLS.map((t) => t.name));
  const MAX_ROUNDS = 4;

  try {
    const conversation: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const operations: AiOperation[] = [];
    let text = "";

    /**
     * Loop hanya berputar untuk tool BACA. Tool tulis tidak pernah dijalankan
     * — hasilnya dikumpulkan sebagai usulan, dan modelnya diberi tahu bahwa
     * usulan itu sudah dicatat supaya ia tidak mengulanginya.
     */
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await client.messages.create({
        model: settings.anthropicModel,
        max_tokens: 16000,
        ...reasoningParams(settings.anthropicModel, settings.anthropicEffort),
        system,
        tools: [...READ_TOOLS, ...TOOLS],
        messages: conversation,
      });

      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      const calls = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (calls.length === 0) break;

      const results: Anthropic.ToolResultBlockParam[] = calls.map((call) => {
        if (READ_NAMES.has(call.name))
          return {
            type: "tool_result",
            tool_use_id: call.id,
            content: runReadTool(call.name, call.input),
          };
        operations.push({
          op: call.name,
          ...(call.input as object),
        } as AiOperation);
        return {
          type: "tool_result",
          tool_use_id: call.id,
          content:
            "Usulan dicatat dan akan ditampilkan ke pengguna untuk disetujui. Jangan mengulanginya.",
        };
      });

      // Tidak ada penelusuran lagi: sisanya usulan, giliran ini cukup.
      if (!calls.some((c) => READ_NAMES.has(c.name))) break;

      conversation.push({ role: "assistant", content: response.content });
      conversation.push({ role: "user", content: results });
    }

    return { text, operations };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError)
      throw new Error("Kunci API ditolak. Periksa kuncinya di Setelan.");
    if (err instanceof Anthropic.RateLimitError)
      throw new Error("Kena batas laju. Coba lagi sebentar.");
    if (err instanceof Anthropic.APIError) {
      const hint = /workspace/i.test(err.message)
        ? " Kunci API ini tidak terikat ke workspace. Isi Workspace ID di Setelan, atau buat kunci baru yang sudah terikat workspace."
        : "";
      throw new Error(`Gagal memanggil Claude (${err.status}): ${err.message}${hint}`);
    }
    throw err;
  }
}
