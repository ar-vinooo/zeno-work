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
import {
  getRepositoryScan,
  listTasks,
  saveRepositoryScan,
} from "./db";
import { buildOutline } from "./rollup";
import { STATUS_LABEL } from "./types";
import { inspectRepository } from "./repository";
import { isTask } from "./validate";
import type { Task } from "./types";

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

function chatTasks(snapshot?: unknown): Task[] {
  if (!Array.isArray(snapshot)) return listTasks();
  return snapshot.filter(isTask);
}

/** Peta awal yang ringan. Detailnya dibuka model lewat tree_search/find_tasks. */
function initialTreeText(tasks: Task[]): string {
  const outline = buildOutline(tasks);
  const sections = outline.roots
    .map((n) => {
      const subs = n.children.length;
      return `${n.wbs}. ${n.task.title} — ${subs ? `${subs} sub-bagian` : "tanpa sub-task"}, ${n.eff.progress}%, ${n.eff.start}..${n.eff.end}`;
    })
    .join("\n");
  return `PETA AWAL WBS dari live editor.
Jumlah baris: ${outline.all.length} (${outline.roots.length} bagian tingkat 1).
Untuk detail, pakai tree_search dulu, lalu find_tasks atau get_subtree pada WBS yang relevan.

Bagian tingkat 1:
${sections || "(kosong)"}`;
}

/** Daftar lengkap untuk mode CLI, karena CLI belum punya tool-call interaktif. */
function fullOutlineText(tasks: Task[]): string {
  const outline = buildOutline(tasks);
  const today = todayISO();
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
      n.task.repositoryPath ? "Git" : null,
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

const GIT_INTENT = /\b(git|repo|repository|commit|commitan|branch|kode)\b/i;
const GIT_FOLLOWUP = /\b(terhubung|terkirim|connected|connect|kait|dikaitkan|sana|kesana|situ|itu|tersebut)\b/i;

/**
 * Temukan repo dari nomor WBS dalam pesan terakhir. Tautan langsung menang;
 * bila kosong, naik ke induk sampai menemukan repo yang diwariskan.
 */
export async function gitContextFor(
  messages: ChatMessage[],
  tasks: Task[] = listTasks(),
): Promise<string> {
  const latest = [...messages].reverse().find((message) => message.role === "user")
    ?.content ?? "";
  const recent = messages.slice(-6).map((message) => message.content).join("\n");
  if (!GIT_INTENT.test(latest) && !(GIT_FOLLOWUP.test(latest) && GIT_INTENT.test(recent)))
    return "";

  const outline = buildOutline(tasks);
  const byWbs = new Map(outline.all.map((node) => [node.wbs, node]));
  const savedIds = new Set(listTasks().map((task) => task.id));
  const saveScanIfPersisted = (taskId: string, scan: Parameters<typeof saveRepositoryScan>[0]) => {
    if (savedIds.has(taskId)) saveRepositoryScan(scan);
  };
  const extractWbs = (text: string) =>
    [
      ...new Set(
        [...text.matchAll(/\b\d+(?:\.\d+){0,2}\b/g)]
          .map((match) => match[0])
          .filter((wbs) => byWbs.has(wbs)),
      ),
    ];
  let mentioned = extractWbs(latest);
  if (mentioned.length === 0 && GIT_FOLLOWUP.test(latest)) mentioned = extractWbs(recent);

  const inherited = (wbs: string) => {
    let node = byWbs.get(wbs);
    while (node) {
      const path = node.task.repositoryPath.trim();
      if (path) return { path, ownerWbs: node.wbs };
      node = node.task.parentId ? outline.byId.get(node.task.parentId) : undefined;
    }
    return null;
  };

  const directBindings = outline.all
    .filter((node) => node.task.repositoryPath.trim())
    .map((node) => ({
      id: node.task.id,
      wbs: node.wbs,
      title: node.task.title,
      path: node.task.repositoryPath.trim(),
    }));

  const titleTokens = (text: string) =>
    text
      .toLowerCase()
      .replace(/\bfe\b/g, "frontend")
      .replace(/\bbe\b/g, "backend")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3);
  if (mentioned.length === 0) {
    const tokens = new Set(titleTokens(latest));
    if (tokens.size) {
      const byTitle = directBindings
        .filter((binding) =>
          titleTokens(binding.title).some((token) => tokens.has(token)),
        )
        .map((binding) => binding.wbs);
      mentioned = [...new Set(byTitle)];
    }
  }

  if (mentioned.length === 0) {
    const byPath = new Map<string, typeof directBindings>();
    for (const binding of directBindings)
      byPath.set(binding.path, [...(byPath.get(binding.path) ?? []), binding]);
    const paths = [...byPath.keys()];
    if (paths.length === 0)
      return "KONTEKS GIT: belum ada task yang ditautkan ke repository. Minta pengguna menautkannya lewat ikon Git pada baris task.";
    if (paths.length > 3)
      return `KONTEKS GIT: ada ${paths.length} repository terhubung. Minta pengguna menyebut nomor WBS yang ingin diperiksa.\n${directBindings
        .map((binding) => `${binding.wbs}\t${binding.title}\t${binding.path}`)
        .join("\n")}`;
    if (paths.length > 1) {
      const contexts = await Promise.all(
        paths.map(async (path) => {
          const bindings = byPath.get(path)!;
          const binding = bindings[0];
          const previous = getRepositoryScan(binding.id);
          const inspection = await inspectRepository(path, previous);
          saveScanIfPersisted(binding.id, {
            taskId: binding.id,
            ...inspection.snapshot,
            checkedAt: new Date().toISOString(),
          });
          return `Repository terhubung ke WBS ${bindings
            .map((item) => `${item.wbs} (${item.title})`)
            .join(", ")}:\n\n${inspection.context}`;
        }),
      );
      return contexts.join("\n\n---\n\n");
    }
    const binding = directBindings.find((item) => item.path === paths[0])!;
    const previous = getRepositoryScan(binding.id);
    const inspection = await inspectRepository(binding.path, previous);
    saveScanIfPersisted(binding.id, {
      taskId: binding.id,
      ...inspection.snapshot,
      checkedAt: new Date().toISOString(),
    });
    const context = inspection.context;
    return `Repository dipilih dari tautan WBS ${binding.wbs} (${binding.title}).\n\n${context}`;
  }

  const missing: string[] = [];
  const selected = new Map<
    string,
    { ownerId: string; ownerWbs: string; requestedWbs: string[] }
  >();
  for (const wbs of mentioned) {
    const found = inherited(wbs);
    if (!found) {
      missing.push(wbs);
      continue;
    }
    const current = selected.get(found.path);
    if (current) current.requestedWbs.push(wbs);
    else
      selected.set(found.path, {
        ownerId: byWbs.get(found.ownerWbs)!.task.id,
        ownerWbs: found.ownerWbs,
        requestedWbs: [wbs],
      });
  }

  const contexts = await Promise.all(
    [...selected.entries()].map(async ([path, info]) => {
      const previous = getRepositoryScan(info.ownerId);
      const inspection = await inspectRepository(path, previous);
      saveScanIfPersisted(info.ownerId, {
        taskId: info.ownerId,
        ...inspection.snapshot,
        checkedAt: new Date().toISOString(),
      });
      return `Repository untuk WBS ${info.requestedWbs.join(", ")} (tautan berasal dari ${info.ownerWbs}):\n\n${inspection.context}`;
    }),
  );
  if (missing.length)
    contexts.push(
      `WBS ${missing.join(", ")} belum memiliki repository sendiri maupun warisan dari induknya.`,
    );
  return contexts.join("\n\n---\n\n");
}

interface CliReply {
  reply?: string;
  operations?: AiOperation[];
}

async function viaCli(
  messages: ChatMessage[],
  provider: "claude-cli" | "codex-cli",
  repoContext: string,
  tasks: Task[],
): Promise<ChatReply> {
  const settings = readSettings();

  // CLI dipanggil sekali per giliran tanpa state, jadi konteks dan riwayat
  // percakapan dikirim ulang sebagai satu prompt.
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Pengguna" : "Kamu"}: ${m.content}`)
    .join("\n\n");
  const prompt = `${dateContext()}\n\n${fullOutlineText(tasks)}${repoContext ? `\n\n${repoContext}` : ""}\n\n---\n\n${transcript}`;

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

export async function runChat(messages: ChatMessage[], taskSnapshot?: unknown): Promise<ChatReply> {
  if (messages.length === 0) throw new Error("Tidak ada pesan");

  const settings = readSettings();
  const tasks = chatTasks(taskSnapshot);
  const repoContext = await gitContextFor(messages, tasks);
  if (settings.aiProvider === "claude-cli" || settings.aiProvider === "codex-cli")
    return viaCli(messages, settings.aiProvider, repoContext, tasks);

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
      text: initialTreeText(tasks),
      cache_control: { type: "ephemeral" },
    },
    ...(repoContext
      ? [{ type: "text" as const, text: repoContext, cache_control: { type: "ephemeral" as const } }]
      : []),
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
            content: runReadTool(call.name, call.input, tasks),
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
