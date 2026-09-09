import { NextResponse } from "next/server";
import { publicSettings, writeSettings, type Settings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(publicSettings());
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<Settings>;
  const patch: Partial<Settings> = {};

  if (
    body.aiProvider === "api" ||
    body.aiProvider === "claude-cli" ||
    body.aiProvider === "codex-cli"
  )
    patch.aiProvider = body.aiProvider;
  for (const key of [
    "anthropicModel",
    "anthropicWorkspaceId",
    "anthropicEffort",
    "claudeCliPath",
    "codexCliPath",
    "codexModel",
    "codexEffort",
  ] as const)
    if (typeof body[key] === "string") patch[key] = body[key].trim();

  // Kunci hanya ditulis bila field-nya benar-benar dikirim. String kosong
  // berarti "hapus", bukan "biarkan" — supaya menghapus kunci tetap mungkin.
  if (typeof body.anthropicApiKey === "string")
    patch.anthropicApiKey = body.anthropicApiKey.trim();

  writeSettings(patch);
  return NextResponse.json(publicSettings());
}
