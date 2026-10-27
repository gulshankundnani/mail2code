import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import type { CapturedConversation, TaskCreate } from "@mail2code/protocol";
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

const input = (over: Partial<TaskCreate> = {}): TaskCreate => ({
  idempotencyKey: "d".repeat(64),
  scope: "message",
  threadId: "thread-f:9",
  threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-f:9",
  messages: [{ messageId: "msg-1", subject: "Release", from: "Ada <ada@example.test>", date: "Oct 1", bodyText: "Ship 2.0 on Friday." }],
  repositoryRef: "",
  title: "Release",
  instructions: "",
  priority: "normal",
  dueAt: null,
  ...over,
});

const capture = (ids: string[], threadId = "thread-f:9"): CapturedConversation => ({
  threadId,
  threadUrl: `https://mail.google.com/mail/u/0/#inbox/${threadId}`,
  subject: "Release",
  messages: ids.map((id) => ({ messageId: id, from: "Lin <lin@example.test>", date: "Oct 2", bodyText: `body of ${id}`, truncated: false })),
  collapsedCount: 0,
  capturedAt: "2026-10-24T12:00:00.000Z",
});

async function approved(r: TaskRepo) {
  const { task } = await r.createTask(input());
  await r.markBriefPrepared(task.id);
  await r.markHandoffOpened(task.id, "https://claude.ai/new");
  await r.transition(task.id, "Planning", "user_action");
  const plan = await r.recordPlan(task.id, { text: "1. Bump version", source: "pasted" });
  await r.decide({ taskId: task.id, planVersion: plan.version, planHash: plan.hash, decision: "approve" });
  return task.id;
}

describe("context refresh", () => {
  it("adds only messages the task doesn't have, and records the refresh", async () => {
    const { r } = await repo();
    const { task } = await r.createTask(input());
    const res = await r.refreshContext(task.id, capture(["msg-1", "msg-2", "msg-3"]), ["msg-1", "msg-2"]);
    expect(res).toEqual({ added: ["msg-2"], blocked: false });
    const t = await r.getTask(task.id);
    expect(t?.sources.map((s) => s.messageId)).toEqual(["msg-1", "msg-2"]);
    expect(t?.lastRefreshAt).not.toBeNull();
    expect(t?.contextChangedAt).not.toBeNull();
    expect((await r.getSnapshot(task.id))?.messages.map((m) => m.bodyText)).toEqual(["Ship 2.0 on Friday.", "body of msg-2"]);
    expect((await r.getEvents(task.id)).at(-1)).toMatchObject({ type: "context.refreshed", data: { added: ["msg-2"] } });
  });

  it("a refresh with nothing new changes no requirements", async () => {
    const { r } = await repo();
    const { task } = await r.createTask(input());
    expect(await r.refreshContext(task.id, capture(["msg-1"]), ["msg-1"])).toEqual({ added: [], blocked: false });
    expect((await r.getTask(task.id))?.contextChangedAt).toBeNull();
  });

  it("new messages block an approved task for review and never approve anything", async () => {
    const { r } = await repo();
    const taskId = await approved(r);
    const res = await r.refreshContext(taskId, capture(["msg-2"]), ["msg-2"]);
    expect(res.blocked).toBe(true);
    const t = await r.getTask(taskId);
    expect(t?.status).toBe("Blocked");
    expect(t?.blockReason).toBe("context_changed");
    expect((await r.getApprovals(taskId)).every((a) => a.supersededAt !== null)).toBe(true);
    // The old approval still exists but no longer counts.
    await expect(r.reportStarted(taskId)).rejects.toMatchObject({ code: "approval_superseded" });
  });

  it("refuses captures from another conversation and refreshes of finished tasks", async () => {
    const { r } = await repo();
    const { task } = await r.createTask(input());
    await expect(r.refreshContext(task.id, capture(["x"], "thread-f:other"), ["x"])).rejects.toMatchObject({ code: "wrong_thread" });
    await r.transition(task.id, "Cancelled", "user_action");
    await expect(r.refreshContext(task.id, capture(["msg-2"]), ["msg-2"])).rejects.toMatchObject({ code: "task_closed" });
  });
});

describe("retention", () => {
  it("defaults to 30 days and validates the setting", async () => {
    const { r } = await repo();
    expect(await r.getRetentionDays()).toBe(30);
    await r.setRetentionDays(7);
    expect(await r.getRetentionDays()).toBe(7);
    await r.setRetentionDays(null);
    expect(await r.getRetentionDays()).toBeNull();
    await expect(r.setRetentionDays(12 as never)).rejects.toThrow();
  });

  it("deletes stored email text after the task has been closed for the retention period", async () => {
    const { r, clock } = await repo();
    const { task } = await r.createTask(input());
    await r.transition(task.id, "Cancelled", "user_action");
    expect(await r.retentionDeadline(task.id)).not.toBeNull();
    clock.t += 29 * DAY;
    expect(await r.purgeExpired()).toBe(0);
    clock.t += 2 * DAY;
    expect(await r.purgeExpired()).toBe(1);
    const snap = await r.getSnapshot(task.id);
    expect(snap?.messages).toEqual([]);
    expect(snap?.purgedAt).not.toBeNull();
    // The task, its Gmail link and history are kept.
    expect((await r.getTask(task.id))?.threadUrl).toContain("mail.google.com");
    expect((await r.getEvents(task.id)).at(-1)).toMatchObject({ type: "context.purged", data: { reason: "retention", messageCount: 1 } });
  });

  it("never purges open tasks, and retrying a closed task stops the countdown", async () => {
    const { r, clock } = await repo();
    const { task } = await r.createTask(input());
    clock.t += 100 * DAY;
    expect(await r.purgeExpired()).toBe(0);
    await r.markBriefPrepared(task.id);
    await r.markHandoffOpened(task.id, "https://claude.ai/new");
    await r.transition(task.id, "Planning", "user_action");
    await r.transition(task.id, "Failed", "user_action");
    await r.markBriefPrepared(task.id); // retry: Failed -> ReadyForHandoff
    clock.t += 100 * DAY;
    expect(await r.purgeExpired()).toBe(0);
    expect(await r.retentionDeadline(task.id)).toBeNull();
  });

  it("'keep until deleted' disables purging; a shorter setting applies to already-closed tasks", async () => {
    const { r, clock } = await repo();
    const { task } = await r.createTask(input());
    await r.transition(task.id, "Cancelled", "user_action");
    await r.setRetentionDays(null);
    clock.t += 365 * DAY;
    expect(await r.purgeExpired()).toBe(0);
    await r.setRetentionDays(7);
    expect(await r.purgeExpired()).toBe(1);
  });

  it("lets the user delete stored email text immediately", async () => {
    const { r } = await repo();
    const { task } = await r.createTask(input());
    await r.purgeSnapshot(task.id);
    expect((await r.getSnapshot(task.id))?.messages).toEqual([]);
    expect((await r.getEvents(task.id)).at(-1)).toMatchObject({ type: "context.purged", data: { reason: "user" } });
  });
});

describe("deleteTask", () => {
  it("removes the task and everything recorded about it, leaving other tasks alone", async () => {
    const { r } = await repo();
    const taskId = await approved(r);
    const other = (await r.createTask(input({ idempotencyKey: "e".repeat(64) }))).task.id;
    await r.deleteTask(taskId);
    expect(await r.getTask(taskId)).toBeNull();
    expect(await r.getSnapshot(taskId)).toBeNull();
    expect(await r.getPlans(taskId)).toEqual([]);
    expect(await r.getApprovals(taskId)).toEqual([]);
    expect(await r.getEvents(taskId)).toEqual([]);
    expect(await r.getTask(other)).not.toBeNull();
    expect(await r.getEvents(other)).toHaveLength(1);
  });
});
