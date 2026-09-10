import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectRepository } from "../lib/repository";

let failures = 0;
function check(label: string, ok: boolean) {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
}

const fixture = mkdtempSync(path.join(tmpdir(), "zenowork-repository-"));
const secondFixture = mkdtempSync(path.join(tmpdir(), "zenowork-repository-"));
const dataDir = mkdtempSync(path.join(tmpdir(), "zenowork-repository-db-"));
const runGit = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const git = (...args: string[]) => runGit(fixture, ...args);
const gitSecond = (...args: string[]) => runGit(secondFixture, ...args);

async function main() {
  process.env.ZENO_DATA_DIR = dataDir;
  try {
    git("init", "-q");
    git("config", "user.name", "ZenoWork Test");
    git("config", "user.email", "test@localhost");
    writeFileSync(path.join(fixture, "app.ts"), "export const ready = false;\n");
    writeFileSync(path.join(fixture, ".env"), "PASSWORD=INITIAL_SECRET\n");
    writeFileSync(path.join(fixture, "package-lock.json"), '{"lockfileVersion":3}\n');
    git("add", ".");
    git("commit", "-qm", "feat: initial app");
    gitSecond("init", "-q");
    gitSecond("config", "user.name", "ZenoWork Test");
    gitSecond("config", "user.email", "test@localhost");
    writeFileSync(path.join(secondFixture, "backend.ts"), "export const api = true;\n");
    gitSecond("add", ".");
    gitSecond("commit", "-qm", "feat: initial backend");

    const first = await inspectRepository(fixture);
    const previous = {
      taskId: "parent",
      ...first.snapshot,
      checkedAt: "2026-09-10T00:00:00.000Z",
    };

    writeFileSync(
      path.join(fixture, "app.ts"),
      'export const ready = true;\nexport const apiKey = "sk-this-must-never-leak-123456";\n',
    );
    writeFileSync(path.join(fixture, ".env"), "PASSWORD=DO_NOT_LEAK_VALUE\n");
    writeFileSync(path.join(fixture, "package-lock.json"), '{"lockfileVersion":4,"secret":"LOCK_LEAK"}\n');
    writeFileSync(path.join(fixture, "staged.ts"), "export const staged = true;\n");
    git("add", "staged.ts");
    writeFileSync(path.join(fixture, "notes.txt"), "UNTRACKED_PRIVATE_CONTENT\n");

    const inspected = await inspectRepository(fixture, previous);
    check("mendeteksi staged", inspected.summary.stagedFiles === 1);
    check("mendeteksi unstaged", inspected.summary.unstagedFiles === 3);
    check("mendeteksi untracked", inspected.summary.untrackedFiles === 1);
    check("mendeteksi perubahan sejak cek terakhir", inspected.summary.changedSinceLastCheck === true);
    check("membaca diff source aman", inspected.context.includes("Diff belum di-stage"));
    check("menyamarkan token di source", inspected.context.includes("[REDACTED"));
    check("nilai token tidak bocor", !inspected.context.includes("sk-this-must-never-leak-123456"));
    check("isi .env tidak dibaca", !inspected.context.includes("DO_NOT_LEAK_VALUE"));
    check("isi lockfile tidak dibaca", !inspected.context.includes("LOCK_LEAK"));
    check("isi untracked tidak dibaca", !inspected.context.includes("UNTRACKED_PRIVATE_CONTENT"));

    const db = await import("../lib/db");
    const tree = await import("../lib/tree");
    const chat = await import("../lib/chat");
    const parent = tree.makeTask({
      title: "Program utama",
      repositoryPath: fixture,
    });
    const child = tree.makeTask({
      title: "Implementasi",
      parentId: parent.id,
    });
    db.insertTasks([parent, child]);
    const context = await chat.gitContextFor([
      { role: "user", content: "cek git di 1.1" },
    ]);
    check("sub-task mewarisi repo induk", context.includes("tautan berasal dari 1"));
    check("cek AI menyimpan snapshot induk", db.getRepositoryScan(parent.id) !== null);

    const draft = tree.makeTask({
      title: "Task live belum disimpan",
      repositoryPath: fixture,
    });
    const liveContext = await chat.gitContextFor(
      [{ role: "user", content: "cek git di 1" }],
      [draft],
    );
    check(
      "AI membaca repo dari snapshot editor sebelum simpan",
      liveContext.includes("Repository untuk WBS 1"),
    );
    const followUpContext = await chat.gitContextFor([
      { role: "user", content: "cek git di 1.1" },
      { role: "assistant", content: "Konteks Git sudah dibaca." },
      { role: "user", content: "loh emng belum terhubung ya?" },
    ]);
    check(
      "follow-up terhubung tetap membaca konteks Git sebelumnya",
      followUpContext.includes("Repository untuk WBS 1.1"),
    );

    const backend = tree.makeTask({
      title: "Backend service",
      repositoryPath: secondFixture,
      order: 1,
    });
    const multiContext = await chat.gitContextFor(
      [{ role: "user", content: "cek git kesana apakah task sudah sesuai terbaru?" }],
      [parent, child, backend],
    );
    check(
      "cek git tanpa WBS membaca repository terhubung yang jumlahnya wajar",
      multiContext.includes("Repository terhubung ke WBS 1") &&
        multiContext.includes("Repository terhubung ke WBS 2"),
    );
    db.closeDb();
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(secondFixture, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }

  if (failures) {
    console.error(`\n${failures} pemeriksaan repository GAGAL.`);
    process.exit(1);
  }
  console.log("\nSemua pemeriksaan repository lolos.");
}

void main();
