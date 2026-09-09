import { NextResponse } from "next/server";
import { listTasks, replaceAll, insertTasks } from "@/lib/db";
import { isTask, sanitizeImport } from "@/lib/validate";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const tasks = listTasks();
  return NextResponse.json(
    { version: 1, exportedAt: new Date().toISOString(), tasks },
    {
      headers: {
        "Content-Disposition": `attachment; filename="zeno-work-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
      },
    },
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    tasks?: unknown;
    mode?: "replace" | "merge";
  };
  if (!Array.isArray(body.tasks))
    return NextResponse.json({ error: "tasks harus array" }, { status: 400 });

  const incoming = sanitizeImport((body.tasks as unknown[]).filter(isTask) as Task[]);
  if (incoming.length === 0)
    return NextResponse.json({ error: "tidak ada task valid" }, { status: 400 });

  if (body.mode === "merge") {
    const existing = new Set(listTasks().map((t) => t.id));
    insertTasks(incoming.filter((t) => !existing.has(t.id)));
  } else {
    replaceAll(incoming);
  }
  return NextResponse.json({ ok: true, count: incoming.length });
}
