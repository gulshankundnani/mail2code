// Compatibility with data written by earlier builds and with the golden v1
// backup. Synthetic data only.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { parseBackupText, previewImport, selectImport, validateExport } from "@mail2code/backup";
import { buildExportFile, toExportData, toImportOperation } from "../src/backup/mapping.ts";
import { TaskRepo } from "../src/db/task-repo.ts";

const DAY = 24 * 60 * 60 * 1000;
const repos: TaskRepo[] = [];
afterEach(() => repos.splice(0).forEach((r) => r.close()));

async function repo() {
  const clock = { t: 1_800_000_000_000 };
  const r = await TaskRepo.open(new IDBFactory(), { now: () => (clock.t += 1) });
  repos.push(r);
  return { r, clock };
}

function put(r: TaskRepo, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = r.db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Exactly the shapes the Phase 2 build wrote: no contextChangedAt, no
// source addedAt, snapshot with retainedUntil and no closedAt/purgedAt.
const PHASE2_ID = "d4d4d4d4-0000-4000-8000-000000000001";
const phase2Task = {
  id: PHASE2_ID,
  title: "Task saved by the Phase 2 build",
  status: "Planning",
  blockReason: null,
  priority: "normal",
  dueAt: null,
  repositoryRef: "",
  instructions: "",
  scope: "message",
  threadId: "thread-f:old",
  threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-f:old",
  sources: [{ messageId: "msg-old-1", subject: "Old", from: "Ada <ada@example.test>", date: "Oct 1" }],
  idempotencyKey: "e".repeat(64),
  origin: "local",
  createdAt: 1_799_000_000_000,
  updatedAt: 1_799_000_000_000,
  lastRefreshAt: null,
  handoff: { preparedAt: 1_799_000_000_000, openedAt: 1_799_000_000_000, destination: "https://claude.ai/new" },
};
const phase2Snapshot = { taskId: PHASE2_ID, messages: [{ messageId: "msg-old-1", bodyText: "old body" }], retainedUntil: null };

describe("records written by the Phase 2 build", () => {
  it("export, refresh, close and purge keep working", async () => {
    const { r, clock } = await repo();
    await put(r, "tasks", phase2Task);
    await put(r, "snapshots", phase2Snapshot);

    // Export validates against the v1 format.
    const text = JSON.stringify(await buildExportFile(toExportData(await r.dump(), { includeEmailContent: true })));
    const parsed = parseBackupText(text);
    if (parsed.kind !== "plain") throw new Error("expected plain");
    const { file, warnings } = await validateExport(parsed.raw);
    expect(warnings).toEqual([]);
    expect(file.data.tasks[0]).toMatchObject({ contextChangedAt: null, sources: [{ addedAt: null }] });

    // Context refresh appends to the old snapshot.
    const capture = {
      threadId: "thread-f:old",
      threadUrl: phase2Task.threadUrl,
      subject: "Old",
      messages: [{ messageId: "msg-old-2", from: "Lin <lin@example.test>", date: "Oct 2", bodyText: "new body", truncated: false }],
      collapsedCount: 0,
      capturedAt: "2026-10-24T12:00:00.000Z",
    };
    expect((await r.refreshContext(PHASE2_ID, capture, ["msg-old-2"])).added).toEqual(["msg-old-2"]);

    // Closing starts the retention clock; purge then works.
    expect(await r.purgeExpired()).toBe(0);
    await r.transition(PHASE2_ID, "Cancelled", "user_action");
    clock.t += 31 * DAY;
    expect(await r.purgeExpired()).toBe(1);
    expect((await r.getSnapshot(PHASE2_ID))?.messages).toEqual([]);
  });
});

describe("golden v1 backup", () => {
  it("restores into an empty installation with all safety rules applied", async () => {
    const text = readFileSync(join(import.meta.dirname, "..", "..", "..", "fixtures", "backups", "v1-plain.json"), "utf8");
    const parsed = parseBackupText(text);
    if (parsed.kind !== "plain") throw new Error("expected plain");
    const { file } = await validateExport(parsed.raw);
    const { r } = await repo();
    const sel = selectImport(previewImport(file, toExportData(await r.dump(), { includeEmailContent: false })), "restore");
    await r.applyImport(toImportOperation(file, sel, Date.now()));

    const tasks = await r.listTasks();
    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));
    expect(byTitle["Fix login (awaiting approval)"]?.status).toBe("AwaitingApproval");
    expect(byTitle["Release 2.0 (in progress)"]).toMatchObject({ status: "Blocked", blockReason: "imported_requires_review", origin: "imported" });
    expect(byTitle["Update README (completed, with email text)"]?.status).toBe("Completed");
    const progressId = byTitle["Release 2.0 (in progress)"]!.id;
    expect((await r.getApprovals(progressId)).every((a) => a.origin === "imported" && a.supersededAt !== null)).toBe(true);
    await expect(r.reportStarted(progressId)).rejects.toBeInstanceOf(Error);
    expect(await r.getRetentionDays()).toBe(90);
    const done = byTitle["Update README (completed, with email text)"]!;
    expect((await r.getSnapshot(done.id))?.messages[0]?.bodyText).toContain("Please update the README");
    expect(await r.retentionDeadline(done.id)).not.toBeNull();
  });
});
