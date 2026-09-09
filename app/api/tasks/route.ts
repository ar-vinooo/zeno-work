import { NextResponse } from "next/server";
import { applyPatches, deleteTasks, insertTasks, listTasks } from "@/lib/db";
import { applyRules, isTask } from "@/lib/validate";
import type { Patch, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tasks: listTasks() });
}

/**
 * Satu endpoint sinkronisasi untuk semua mutasi.
 *
 * Klien bekerja optimistis di memori lalu mengirim selisihnya. Urutan
 * penerapan tidak boleh dibalik:
 *   1. creates  — baris baru harus ada sebelum ada patch yang menunjuknya
 *   2. patches  — termasuk melepas anak dari induk yang akan dihapus
 *   3. deletes  — kalau ini duluan, ON DELETE CASCADE ikut membawa anak yang
 *                 sebenarnya cuma mau dinaikkan satu tingkat
 */
export async function PUT(request: Request) {
  const body = (await request.json()) as {
    creates?: unknown[];
    patches?: Patch[];
    deleteIds?: string[];
  };

  const creates = (body.creates ?? []).filter(isTask) as Task[];
  if (creates.length) insertTasks(creates);

  const patches = body.patches ?? [];
  if (patches.length) {
    const current = new Map(listTasks().map((t) => [t.id, t]));
    applyPatches(
      patches
        .filter((p) => current.has(p.id))
        .map((p) => applyRules(current.get(p.id)!, p)),
    );
  }

  if (body.deleteIds?.length) deleteTasks(body.deleteIds);

  return NextResponse.json({ ok: true });
}
