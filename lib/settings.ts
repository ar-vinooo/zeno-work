import { getMeta, setMeta } from "./db";

export type AiProvider = "api" | "claude-cli" | "codex-cli";

const PROVIDERS: AiProvider[] = ["api", "claude-cli", "codex-cli"];

export interface Settings {
  aiProvider: AiProvider;
  anthropicModel: string;
  anthropicWorkspaceId: string;
  anthropicApiKey: string;
  /** low|medium|high|xhigh|max. Dipakai mode Kunci API maupun Claude CLI. */
  anthropicEffort: string;
  claudeCliPath: string;
  codexCliPath: string;
  /** Kosong = pakai model bawaan codex CLI. */
  codexModel: string;
  /** low|medium|high|xhigh|max|ultra. Kosong = bawaan model. */
  codexEffort: string;
}

/** Bagian setelan yang berupa teks biasa — sisanya ditangani sendiri. */
const TEXT_KEYS = [
  "aiProvider",
  "anthropicModel",
  "anthropicWorkspaceId",
  "anthropicApiKey",
  "anthropicEffort",
  "claudeCliPath",
  "codexCliPath",
  "codexModel",
  "codexEffort",
] as const;

type TextKey = (typeof TEXT_KEYS)[number];

/** Yang boleh dilihat halaman. Kunci API sengaja tidak pernah ikut. */
export interface PublicSettings {
  aiProvider: AiProvider;
  anthropicModel: string;
  anthropicWorkspaceId: string;
  anthropicEffort: string;
  claudeCliPath: string;
  codexCliPath: string;
  codexModel: string;
  codexEffort: string;
  hasApiKey: boolean;
  /** Empat karakter terakhir saja, sekadar penanda kunci mana yang tersimpan. */
  apiKeyHint: string;
  /** Nilai ini berasal dari .env karena belum pernah diatur lewat setelan. */
  fromEnv: string[];
}

const META_KEY = "settings";

/**
 * Nilai awal dari .env untuk setelan lama. Setelan codex sengaja TIDAK ada di
 * sini: pengaturannya lewat panel Setelan dan tersimpan di database.
 */
const ENV_FALLBACK: Partial<Record<TextKey, string | undefined>> = {
  aiProvider: process.env.AI_PROVIDER,
  anthropicModel: process.env.ANTHROPIC_MODEL,
  anthropicWorkspaceId: process.env.ANTHROPIC_WORKSPACE_ID,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  claudeCliPath: process.env.CLAUDE_CLI_PATH,
};

const DEFAULTS: Settings = {
  aiProvider: "api",
  anthropicModel: "claude-opus-5",
  anthropicWorkspaceId: "",
  anthropicApiKey: "",
  anthropicEffort: "medium",
  claudeCliPath: "claude",
  codexCliPath: "codex",
  codexModel: "",
  codexEffort: "",
};

function stored(): Partial<Settings> {
  try {
    const raw = getMeta(META_KEY);
    return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

/**
 * Urutan sumber: setelan tersimpan → .env → bawaan.
 *
 * Setelan menang atas .env supaya panel setelan benar-benar berkuasa; .env
 * tetap berguna sebagai nilai awal dan untuk hal yang tidak bisa diubah saat
 * berjalan, seperti PORT.
 */
export function readSettings(): Settings {
  const saved = stored();
  const pick = (key: TextKey) =>
    (saved[key] ?? ENV_FALLBACK[key] ?? DEFAULTS[key]) as string;
  return {
    aiProvider: (PROVIDERS as string[]).includes(pick("aiProvider"))
      ? (pick("aiProvider") as AiProvider)
      : "api",
    anthropicModel: pick("anthropicModel"),
    anthropicWorkspaceId: pick("anthropicWorkspaceId"),
    anthropicApiKey: pick("anthropicApiKey"),
    anthropicEffort: pick("anthropicEffort"),
    claudeCliPath: pick("claudeCliPath"),
    codexCliPath: pick("codexCliPath"),
    codexModel: pick("codexModel"),
    codexEffort: pick("codexEffort"),
  };
}

export function publicSettings(): PublicSettings {
  const s = readSettings();
  const saved = stored();
  const fromEnv = TEXT_KEYS.filter(
    (k) => saved[k] === undefined && ENV_FALLBACK[k],
  );
  return {
    aiProvider: s.aiProvider,
    anthropicModel: s.anthropicModel,
    anthropicWorkspaceId: s.anthropicWorkspaceId,
    anthropicEffort: s.anthropicEffort,
    claudeCliPath: s.claudeCliPath,
    codexCliPath: s.codexCliPath,
    codexModel: s.codexModel,
    codexEffort: s.codexEffort,
    hasApiKey: s.anthropicApiKey.length > 0,
    apiKeyHint: s.anthropicApiKey ? `…${s.anthropicApiKey.slice(-4)}` : "",
    fromEnv,
  };
}

export function writeSettings(patch: Partial<Settings>): void {
  const saved = stored();
  const next: Partial<Settings> = { ...saved };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key as keyof Settings];
    else next[key as keyof Settings] = value as never;
  }
  setMeta(META_KEY, JSON.stringify(next));
}
