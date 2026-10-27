import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { parseBackupText, previewImport, selectImport, validateExport, type ExportFile } from "@mail2code/backup";
import type { TaskCreate } from "@mail2code/protocol";
import { buildExportFile, toExportData, toImportOperation } from "../src/backup/mapping.ts";
import { TaskRepo } from "../src/db/task-repo.ts";

const repos: TaskRepo[] = [];
afterEach(() => repos.splice(0).forEach((r) => r.close()));

// Each call is a separate "computer": its own IndexedDB.
async function machine() {
  let t = 1_800_000_000_000;
  const r = await TaskRepo.open(new IDBFactory(), { now: () => (t += 1000) });
  repos.push(r);
  return r;
}

const input = (key: string, over: Partial<TaskCreate> = {}): TaskCreate => ({
  idempotencyKey: key.repeat(64).slice(0, 64),
  scope: "message",
  threadId: "thread-f:5",
  threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-f:5",
  messages: [{ messageId: `msg-${key}`, subject: "Deploy fix", from: "Ada <ada@example.test>", date: "Oct 1", bodyText: `CONFIDENTIAL body ${key}` }],
  repositoryRef: "https://github.com/example/app",
  title: `Task ${key}`,
  instructions: "",
  priority: "normal",
  dueAt: null,
  ...over,
});

async function inProgressTask(r: TaskRepo, key: string) {
  const { task } = await r.createTask(input(key));
  await r.markBriefPrepared(task.id);
  await r.markHandoffOpened(task.id, "https://claude.ai/code");
  await r.transition(task.id, "Planning", "user_action");
  const plan = await r.recordPlan(task.id, { text: "1. Patch\n2. Test", source: "pasted" });
  await r.decide({ taskId: task.id, planVersion: plan.version, planHash: plan.hash, decision: "approve" });
  await r.reportStarted(task.id);
  return task.id;
}

async function exportFrom(r: TaskRepo, includeEmailContent = false, taskIds?: Set<string>): Promise<string> {
  return JSON.stringify(await buildExportFile(toExportData(await r.dump(), { includeEmailContent, ...(taskIds ? { taskIds } : {}) })));
}

async function importInto(r: TaskRepo, text: string, strategy: "restore" | "merge" | "replace", resolution: "keep-existing" | "use-imported" = "keep-existing") {
  const parsed = parseBackupText(text);
  if (parsed.kind !== "plain") throw new Error("expected plain");
  const { file } = await validateExport(parsed.raw);
  const existing = toExportData(await r.dump(), { includeEmailContent: false });
  const preview = previewImport(file, existing);
  const selection = selectImport(preview, strategy, resolution);
  await r.applyImport(toImportOperation(file, selection, Date.now()));
  return { file, preview, selection };
}

describe("export", () => {
  it("excludes stored email text unless asked, and only contains documented fields", async () => {
    const a = await machine();
    await inProgressTask(a, "a");
    const plain = await exportFrom(a);
    expect(plain).not.toContain("CONFIDENTIAL");
    expect(JSON.parse(plain).includesEmailContent).toBe(false);
    for (const forbidden of ["origin", "seq", "closedAt", "purgedAt", "draft"]) expect(plain).not.toContain(`"${forbidden}"`);
    const withEmail = await exportFrom(a, true);
    expect(withEmail).toContain("CONFIDENTIAL body a");
    expect(JSON.parse(withEmail).includesEmailContent).toBe(true);
  });

  it("can export selected tasks only", async () => {
    const a = await machine();
    const id = await inProgressTask(a, "a");
    await a.createTask(input("b"));
    const f = JSON.parse(await exportFrom(a, false, new Set([id]))) as ExportFile;
    expect(f.data.tasks.map((t) => t.title)).toEqual(["Task a"]);
    expect(f.data.events.every((e) => e.taskId === id)).toBe(true);
  });
});

describe("migration to another computer", () => {
  it("restores tasks, plans and history; imported approvals never authorize work", async () => {
    const a = await machine();
    const id = await inProgressTask(a, "a");
    const b = await machine();
    await importInto(b, await exportFrom(a), "restore");

    const t = await b.getTask(id);
    expect(t?.origin).toBe("imported");
    expect(t?.status).toBe("Blocked");
    expect(t?.blockReason).toBe("imported_requires_review");
    expect((await b.getPlans(id)).map((p) => p.version)).toEqual([1]);
    const approvals = await b.getApprovals(id);
    expect(approvals).toHaveLength(1);
    expect(approvals.every((x) => x.origin === "imported" && x.supersededAt !== null)).toBe(true);
    expect((await b.getEvents(id)).map((e) => e.type)).toContain("task.imported");
    expect((await b.getSnapshot(id))?.messages).toEqual([]);

    // The old approval can't be used...
    await expect(b.reportStarted(id)).rejects.toBeInstanceOf(Error);
    // ...but a fresh approval on this computer works.
    await b.transition(id, "AwaitingApproval", "user_action");
    const plan = (await b.getLatestPlan(id))!;
    await b.decide({ taskId: id, planVersion: plan.version, planHash: plan.hash, decision: "approve" });
    expect((await b.reportStarted(id)).status).toBe("InProgress");
  });

  it("brings stored email text along only when it was exported", async () => {
    const a = await machine();
    const id = await inProgressTask(a, "a");
    const b = await machine();
    await importInto(b, await exportFrom(a, true), "restore");
    expect((await b.getSnapshot(id))?.messages[0]?.bodyText).toBe("CONFIDENTIAL body a");
  });

  it("restore refuses a non-empty installation", async () => {
    const a = await machine();
    await inProgressTask(a, "a");
    const b = await machine();
    await b.createTask(input("e"));
    await expect(importInto(b, await exportFrom(a), "restore")).rejects.toThrow(/empty installation/);
  });
});

describe("merge and replace", () => {
  it("merge skips identical tasks and keeps local versions of conflicts by default", async () => {
    const a = await machine();
    const id = await inProgressTask(a, "a");
    const text = await exportFrom(a);
    const b = await machine();
    await importInto(b, text, "restore");
    await b.addNote(id, "local change");
    const { preview, selection } = await importInto(b, text, "merge");
    expect(preview.tasks[0]?.kind).toBe("conflict");
    expect(selection.writeTaskIds).toEqual([]);
    expect((await b.getEvents(id)).some((e) => e.type === "note")).toBe(true);
  });

  it("merge with 'use imported' replaces only the conflicting task", async () => {
    const a = await machine();
    const id = await inProgressTask(a, "a");
    const text = await exportFrom(a);
    const b = await machine();
    await importInto(b, text, "restore");
    await b.addNote(id, "local change");
    const other = (await b.createTask(input("c"))).task.id;
    await importInto(b, text, "merge", "use-imported");
    expect((await b.getEvents(id)).some((e) => e.type === "note")).toBe(false);
    expect(await b.getTask(other)).not.toBeNull();
  });

  it("merge skips a task that is the same handoff as a different local task", async () => {
    const a = await machine();
    await a.createTask(input("d"));
    const b = await machine();
    await b.createTask(input("d")); // same messages, repository and instructions, different id
    const { preview, selection } = await importInto(b, await exportFrom(a), "merge");
    expect(preview.tasks[0]?.kind).toBe("duplicate-key");
    expect(selection.writeTaskIds).toEqual([]);
    expect(await b.listTasks()).toHaveLength(1);
  });

  it("replace removes existing tasks and applies the backup's settings", async () => {
    const a = await machine();
    await a.setRetentionDays(90);
    const id = await inProgressTask(a, "a");
    const b = await machine();
    const old = (await b.createTask(input("f"))).task.id;
    await importInto(b, await exportFrom(a), "replace");
    expect(await b.getTask(old)).toBeNull();
    expect(await b.getTask(id)).not.toBeNull();
    expect(await b.getRetentionDays()).toBe(90);
  });

  it("a failing import leaves the existing data untouched", async () => {
    const a = await machine();
    await inProgressTask(a, "a");
    const parsed = parseBackupText(await exportFrom(a));
    if (parsed.kind !== "plain") throw new Error("expected plain");
    const { file } = await validateExport(parsed.raw);
    const b = await machine();
    const keep = (await b.createTask(input("9"))).task.id;
    const selection = selectImport(previewImport(file, toExportData(await b.dump(), { includeEmailContent: false })), "replace");
    const op = toImportOperation(file, selection, Date.now());
    // Force a failure half-way: a second task with the same duplicate key.
    op.tasks.push({ ...op.tasks[0]!, id: "99999999-9999-4999-8999-999999999999" });
    await expect(b.applyImport(op)).rejects.toBeDefined();
    expect(await b.getTask(keep)).not.toBeNull();
    expect(await b.listTasks()).toHaveLength(1);
  });
});
