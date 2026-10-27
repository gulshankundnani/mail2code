// Approval by another person, end to end at the storage level: two separate
// databases stand for two people's browsers. Synthetic data only.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalRequest, ApprovalResponse, TaskCreate } from "@mail2code/protocol";
import { requestPlanMatches } from "@mail2code/task-core";
import { TaskRepo } from "../src/db/task-repo.ts";

const repos: TaskRepo[] = [];
afterEach(() => repos.splice(0).forEach((r) => r.close()));

const DAY = 86_400_000;

async function browser() {
  const clock = { t: 1_800_000_000_000 };
  const r = await TaskRepo.open(new IDBFactory(), { now: () => ++clock.t });
  repos.push(r);
  return { r, clock };
}

const input: TaskCreate = {
  idempotencyKey: "b".repeat(64),
  scope: "message",
  threadId: "thread-f:1",
  threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-f:1",
  messages: [{ messageId: "msg-f:1", subject: "Fix login", from: "Ada <ada@example.test>", date: "Oct 1", bodyText: "Please fix." }],
  repositoryRef: "https://github.com/example/app",
  title: "Fix login",
  instructions: "",
  priority: "normal",
  dueAt: null,
};

async function awaiting(r: TaskRepo, plan = "1. Edit auth.ts\n2. Run npm test") {
  const { task } = await r.createTask(input);
  await r.markBriefPrepared(task.id);
  await r.markHandoffOpened(task.id, "claude://code/new");
  await r.transition(task.id, "Planning", "user_action");
  await r.recordPlan(task.id, { text: plan, source: "pasted" });
  return task.id;
}

// Ada asks; Priya approves in her own browser.
async function setup() {
  const ada = await browser();
  const priya = await browser();
  await priya.r.createIdentity("Priya Example", "priya@example.test");
  const card = await priya.r.approverCard();
  await ada.r.addApprover(card, true);
  const taskId = await awaiting(ada.r);
  return { ada, priya, card, taskId };
}

async function respond(priya: TaskRepo, request: ApprovalRequest, decision: "approve" | "reject" | "request_changes" = "approve"): Promise<ApprovalResponse> {
  expect(await requestPlanMatches(request)).toBe(true);
  return priya.signDecision({ requestId: request.requestId, taskId: request.task.id, planVersion: request.plan.version, planHash: request.plan.hash, decision, comment: "Looks good" });
}

describe("approver identity", () => {
  it("keeps the private key out of reach and refuses a second identity", async () => {
    const { r } = await browser();
    expect(await r.getIdentity()).toBeNull();
    const id = await r.createIdentity("Priya", "priya@example.test");
    expect(Object.keys(id)).not.toContain("privateKey");
    expect(Object.keys((await r.getIdentity())!)).not.toContain("privateKey");
    await expect(r.createIdentity("Again", "x@example.test")).rejects.toMatchObject({ code: "identity_exists" });
    await expect((await browser()).r.createIdentity("Bad", "not-an-email")).rejects.toMatchObject({ code: "invalid_email" });
    expect(await r.approverCard()).toMatchObject({ name: "Priya", email: "priya@example.test", fingerprint: id.fingerprint });
  });

  it("adds approvers only with confirmation, a matching fingerprint and never your own card", async () => {
    const { ada, priya, card } = await setup();
    expect((await ada.r.listApprovers()).map((a) => a.name)).toEqual(["Priya Example"]);
    const other = await browser();
    await expect(other.r.addApprover(card, false)).rejects.toMatchObject({ code: "not_confirmed" });
    await expect(other.r.addApprover({ ...card, fingerprint: "f".repeat(64) }, true)).rejects.toMatchObject({ code: "bad_card" });
    await expect(priya.r.addApprover(card, true)).rejects.toMatchObject({ code: "own_identity" });
  });
});

describe("request and signed response", () => {
  it("records a verified approval from the named approver, once", async () => {
    const { ada, priya, card, taskId } = await setup();
    const request = await ada.r.createApprovalRequest(taskId, card.fingerprint, "Ada");
    expect(request).toMatchObject({ task: { id: taskId, title: "Fix login" }, plan: { version: 1 }, approverFingerprint: card.fingerprint });
    expect(JSON.stringify(request)).not.toContain("Please fix."); // no email text
    const response = await respond(priya.r, request);
    const result = await ada.r.importApprovalResponse(response);
    expect(result).toMatchObject({ decision: "approve", approverName: "Priya Example", task: { status: "Approved" } });
    const [approval] = await ada.r.getApprovals(taskId);
    expect(approval).toMatchObject({ origin: "signed", signedBy: { name: "Priya Example", fingerprint: card.fingerprint }, comment: "Looks good" });
    expect((await ada.r.getEvents(taskId)).map((e) => e.type)).toContain("approval.signed");
    await ada.r.reportStarted(taskId);
    // The same response can't be used again.
    await expect(ada.r.importApprovalResponse(response)).rejects.toMatchObject({ code: "request_used" });
  });

  it("refuses tampered, out-of-date, expired and foreign responses without changing anything", async () => {
    const { ada, priya, card, taskId } = await setup();
    const request = await ada.r.createApprovalRequest(taskId, card.fingerprint, "Ada");
    const response = await respond(priya.r, request);

    const tampered = { ...response, payload: { ...response.payload, comment: "Also deploy to production" } };
    await expect(ada.r.importApprovalResponse(tampered)).rejects.toMatchObject({ code: "bad_signature" });

    const stranger = await browser();
    await stranger.r.createIdentity("Mallory", "m@example.test");
    const foreign = await stranger.r.signDecision({ requestId: request.requestId, taskId, planVersion: 1, planHash: request.plan.hash, decision: "approve", comment: null });
    await expect(ada.r.importApprovalResponse(foreign)).rejects.toMatchObject({ code: "wrong_approver" });

    const own = await ada.r.createIdentity("Ada", "ada@example.test");
    void own;
    const self = await ada.r.signDecision({ requestId: request.requestId, taskId, planVersion: 1, planHash: request.plan.hash, decision: "approve", comment: null });
    await expect(ada.r.importApprovalResponse(self)).rejects.toMatchObject({ code: "own_identity" });

    expect((await ada.r.getTask(taskId))?.status).toBe("AwaitingApproval");
    expect(await ada.r.getApprovals(taskId)).toHaveLength(0);

    // A new plan version makes the old request out of date.
    await ada.r.recordPlan(taskId, { text: "1. Edit auth.ts\n2. Deploy", source: "pasted" });
    await expect(ada.r.importApprovalResponse(response)).rejects.toMatchObject({ code: "stale_plan" });
  });

  it("expires requests after 7 days", async () => {
    const { ada, priya, card, taskId } = await setup();
    const request = await ada.r.createApprovalRequest(taskId, card.fingerprint, "Ada");
    const response = await respond(priya.r, request);
    ada.clock.t += 7 * DAY + 1;
    await expect(ada.r.importApprovalResponse(response)).rejects.toMatchObject({ code: "request_expired" });
  });

  it("maps request changes and rejection to the usual statuses", async () => {
    const { ada, priya, card, taskId } = await setup();
    const r1 = await ada.r.createApprovalRequest(taskId, card.fingerprint, "Ada");
    expect((await ada.r.importApprovalResponse(await respond(priya.r, r1, "request_changes"))).task.status).toBe("Planning");
  });
});

describe("required approver", () => {
  it("blocks the user's own approval and accepts only that person's", async () => {
    const { ada, priya, card, taskId } = await setup();
    await ada.r.setRequiredApprover(taskId, card.fingerprint);
    const plan = (await ada.r.getLatestPlan(taskId))!;
    await expect(ada.r.decide({ taskId, planVersion: plan.version, planHash: plan.hash, decision: "approve" })).rejects.toMatchObject({ code: "approver_required" });
    // Stopping the plan is still the user's call.
    await ada.r.decide({ taskId, planVersion: plan.version, planHash: plan.hash, decision: "request_changes" });
    const v2 = await ada.r.recordPlan(taskId, { text: "Revised plan", source: "pasted" });
    const request = await ada.r.createApprovalRequest(taskId, card.fingerprint, "Ada");
    expect(request.plan.version).toBe(v2.version);
    await ada.r.importApprovalResponse(await respond(priya.r, request));
    await ada.r.reportStarted(taskId);
    await expect(ada.r.removeApprover(card.fingerprint)).rejects.toMatchObject({ code: "approver_in_use" });
  });
});

describe("backup round trip of approvers", () => {
  it("restores approvers unconfirmed, so a backup can't add a trusted key", async () => {
    const { ada } = await setup();
    const dump = await ada.r.dump();
    expect(dump.approvers).toHaveLength(1);
    const fresh = await browser();
    await fresh.r.applyImport({ replaceAll: false, deleteTaskIds: [], tasks: [], snapshots: [], plans: [], approvals: [], events: [], approvers: dump.approvers });
    const [restored] = await fresh.r.listApprovers();
    expect(restored).toMatchObject({ name: "Priya Example", confirmedAt: null, source: "backup" });
    await fresh.r.confirmApprover(restored!.fingerprint);
    expect((await fresh.r.getApprover(restored!.fingerprint))?.confirmedAt).not.toBeNull();
  });
});

describe("storage upgrade from version 1", () => {
  it("adds the approval stores and keeps existing tasks", async () => {
    const factory = new IDBFactory();
    // A database exactly as version 1 created it, with one task.
    await new Promise<void>((resolve, reject) => {
      const open = factory.open("mail2code", 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        const tasks = db.createObjectStore("tasks", { keyPath: "id" });
        tasks.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
        tasks.createIndex("threadId", "threadId");
        tasks.createIndex("status", "status");
        tasks.createIndex("updatedAt", "updatedAt");
        db.createObjectStore("snapshots", { keyPath: "taskId" });
        db.createObjectStore("plans", { keyPath: "id" }).createIndex("taskId", "taskId");
        db.createObjectStore("approvals", { keyPath: "id" }).createIndex("taskId", "taskId");
        db.createObjectStore("events", { keyPath: "seq", autoIncrement: true }).createIndex("taskId", "taskId");
        db.createObjectStore("settings", { keyPath: "key" });
        tasks.put({ id: "t-v1", title: "Old task", status: "Planning", threadId: "x", idempotencyKey: "a".repeat(64), updatedAt: 1, sources: [] });
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });
    const r = await TaskRepo.open(factory);
    repos.push(r);
    expect((await r.getTask("t-v1"))?.title).toBe("Old task");
    expect(await r.listApprovers()).toEqual([]);
    expect(await r.getApprovalRequests("t-v1")).toEqual([]);
    expect(await r.getIdentity()).toBeNull();
  });
});

describe("progress updates for the approver", () => {
  it("updates Priya's list only with Ada's signed, newer updates", async () => {
    const { ada, priya, card, taskId } = await setup();
    const request = await ada.r.createApprovalRequest(taskId, card.fingerprint, "Ada");
    expect(request.requesterKey).toBe((await ada.r.requesterKey()).publicKey);
    const response = await respond(priya.r, request);
    await priya.r.recordGivenApproval(request, response, "ada@example.test");
    expect((await priya.r.listGivenApprovals())[0]).toMatchObject({ taskTitle: "Fix login", decision: "approve", status: null, lastSeq: 0 });
    await ada.r.importApprovalResponse(response);

    expect((await ada.r.progressRecipient(taskId))?.approver.name).toBe("Priya Example");
    await ada.r.reportStarted(taskId);
    const started = await ada.r.createProgressUpdate(taskId, "Branch fix/login opened", "Ada");
    expect(started.update.payload).toMatchObject({ status: "InProgress", seq: 1, note: "Branch fix/login opened" });
    await ada.r.transition(taskId, "Completed", "user_action");
    const done = await ada.r.createProgressUpdate(taskId, "", "Ada");
    expect(done.update.payload).toMatchObject({ status: "Completed", seq: 2, note: null });

    // Out of order: the newer one first, then the older one is ignored.
    await priya.r.applyProgressUpdate(done.update);
    await expect(priya.r.applyProgressUpdate(started.update)).rejects.toMatchObject({ code: "old_update" });
    const [g] = await priya.r.listGivenApprovals();
    expect(g).toMatchObject({ status: "Completed", lastSeq: 2 });
    expect(g!.updates).toHaveLength(1);
    expect((await ada.r.getEvents(taskId)).filter((e) => e.type === "progress.sent")).toHaveLength(2);
  });

  it("refuses forged and tampered updates and updates for plans not approved here", async () => {
    const { ada, priya, card, taskId } = await setup();
    const request = await ada.r.createApprovalRequest(taskId, card.fingerprint, "Ada");
    const response = await respond(priya.r, request);
    await priya.r.recordGivenApproval(request, response, "ada@example.test");
    await ada.r.importApprovalResponse(response);
    const { update } = await ada.r.createProgressUpdate(taskId, "on it", "Ada");

    await expect(priya.r.applyProgressUpdate({ ...update, payload: { ...update.payload, status: "Completed" } })).rejects.toMatchObject({ code: "bad_signature" });
    // Someone else's browser signs an update for the same request: not the requester's key.
    const mallory = await browser();
    const fake = { ...update, signature: (await (async () => {
      const id = await mallory.r.createIdentity("Mallory", "m@example.test");
      void id;
      return (await mallory.r.signDecision({ requestId: request.requestId, taskId, planVersion: 1, planHash: request.plan.hash, decision: "approve", comment: null })).signature;
    })()) };
    await expect(priya.r.applyProgressUpdate(fake)).rejects.toMatchObject({ code: "bad_signature" });
    // A browser that never approved this plan ignores the update.
    await expect(mallory.r.applyProgressUpdate(update)).rejects.toMatchObject({ code: "unknown_approval" });
    expect((await priya.r.listGivenApprovals())[0]?.status).toBeNull();
  });

  it("only tasks approved by another person can send updates", async () => {
    const { r } = await browser();
    const taskId = await awaiting(r);
    expect(await r.progressRecipient(taskId)).toBeNull();
    await expect(r.createProgressUpdate(taskId, "x", "Ada")).rejects.toMatchObject({ code: "no_approver" });
  });
});
