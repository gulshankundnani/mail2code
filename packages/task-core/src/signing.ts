// Approval by another person: approver identities, signatures, and the checks
// a signed approval response must pass before it is recorded.
//
// Cryptography comes from the platform's Web Crypto API only:
//   ECDSA on P-256 with SHA-256. The private key is created non-extractable
//   in the approver's own browser and can't be exported or copied out.
//   The signed bytes are canonical JSON tagged with RESPONSE_DOMAIN, so a
//   signature can't be reused for any other kind of data.
import {
  canonicalJson,
  type ApprovalRequest,
  type ApprovalResponse,
  type ApprovalResponsePayload,
  type ProgressUpdate,
  type ProgressUpdatePayload,
  type TaskStatus,
} from "@mail2code/protocol";
import type { PlanRecord, Verdict } from "./approval.ts";
import { planHash } from "./plan-hash.ts";

// Written structurally so the same code type-checks in browsers and Node.
export type KeyHandle = Parameters<typeof crypto.subtle.sign>[1];

const KEY_ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" } as const;
export const RESPONSE_DOMAIN = "mail2code/approval-response/v1";
export const UPDATE_DOMAIN = "mail2code/progress-update/v1";

export interface ApproverIdentity {
  name: string;
  email: string;
  publicKey: string; // SPKI, base64
  fingerprint: string;
  privateKey: KeyHandle; // non-extractable
  createdAt: number;
}

// A person whose approvals this browser accepts. Trusted only after the user
// confirmed the fingerprint with that person directly.
export interface TrustedApprover {
  fingerprint: string;
  name: string;
  email: string;
  publicKey: string;
  addedAt: number;
  confirmedAt: number | null;
  source: "card" | "backup";
}

// A key pair with no identity attached: the requester key that signs progress
// updates. Created automatically the first time a request is sent.
export interface SigningKey {
  publicKey: string;
  fingerprint: string;
  privateKey: KeyHandle; // non-extractable
}

// The approver's record of a plan they signed, kept current by the
// requester's signed progress updates.
export interface GivenApproval {
  requestId: string;
  taskId: string;
  taskTitle: string;
  requesterName: string;
  requesterEmail: string;
  requesterKey: string;
  planVersion: number;
  planHash: string;
  planText: string;
  decision: ApprovalResponsePayload["decision"];
  comment: string | null;
  signedAt: number;
  // Latest reported status and every update received, oldest first.
  status: TaskStatus | null;
  lastSeq: number;
  updates: { seq: number; status: TaskStatus; note: string | null; planVersion: number; sentAt: string; receivedAt: number }[];
}

// An approval request this browser sent. Each can be answered once.
export interface PendingRequest {
  requestId: string;
  taskId: string;
  planId: string;
  planVersion: number;
  planHash: string;
  approverFingerprint: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  // Sequence number of the last progress update sent for this request.
  updateSeq?: number;
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function fingerprintOf(publicKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromBase64(publicKey));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// "3f2a 9c1e 77b0 …" — the full fingerprint in groups, for reading aloud.
export function formatFingerprint(fingerprint: string): string {
  return (fingerprint.match(/.{1,4}/g) ?? []).join(" ");
}

export async function createSigningKey(): Promise<SigningKey> {
  const pair = (await crypto.subtle.generateKey(KEY_ALG, false, ["sign", "verify"])) as { publicKey: KeyHandle; privateKey: KeyHandle };
  const publicKey = toBase64(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { publicKey, fingerprint: await fingerprintOf(publicKey), privateKey: pair.privateKey };
}

export async function createApproverIdentity(name: string, email: string, now: number): Promise<ApproverIdentity> {
  return { name, email, ...(await createSigningKey()), createdAt: now };
}

// Every signature covers canonical JSON tagged with what is being signed, so
// a signature over one kind of data can never be passed off as another.
const signingInput = (domain: string, payload: object) => new TextEncoder().encode(canonicalJson({ domain, ...payload }));

async function sign(domain: string, privateKey: KeyHandle, payload: object): Promise<string> {
  return toBase64(await crypto.subtle.sign(SIGN_ALG, privateKey, signingInput(domain, payload)));
}

async function verify(domain: string, publicKey: string, payload: object, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", fromBase64(publicKey), KEY_ALG, false, ["verify"]);
    return await crypto.subtle.verify(SIGN_ALG, key, fromBase64(signature), signingInput(domain, payload));
  } catch {
    return false;
  }
}

export const signResponsePayload = (privateKey: KeyHandle, payload: ApprovalResponsePayload) => sign(RESPONSE_DOMAIN, privateKey, payload);
export const verifyResponseSignature = (publicKey: string, payload: ApprovalResponsePayload, signature: string) => verify(RESPONSE_DOMAIN, publicKey, payload, signature);
export const signUpdatePayload = (privateKey: KeyHandle, payload: ProgressUpdatePayload) => sign(UPDATE_DOMAIN, privateKey, payload);
export const verifyUpdateSignature = (publicKey: string, payload: ProgressUpdatePayload, signature: string) => verify(UPDATE_DOMAIN, publicKey, payload, signature);

export type UpdateRejection = "unknown_approval" | "wrong_task" | "bad_signature" | "old_update";

// The approver's side: an update counts only if it's for a plan this browser
// signed, is signed with the requester key from that request, and is newer
// than the last one received.
export async function checkProgressUpdate(update: ProgressUpdate, given: GivenApproval | null): Promise<Verdict<UpdateRejection>> {
  const p = update.payload;
  const no = (reason: UpdateRejection) => ({ ok: false as const, reason });
  if (!given || given.requestId !== p.requestId) return no("unknown_approval");
  if (given.taskId !== p.taskId) return no("wrong_task");
  if (!(await verifyUpdateSignature(given.requesterKey, p, update.signature))) return no("bad_signature");
  if (p.seq <= given.lastSeq) return no("old_update");
  return { ok: true };
}

export function updateRejectionText(reason: UpdateRejection): string {
  switch (reason) {
    case "unknown_approval":
      return "This update is for a plan you didn't approve in this browser.";
    case "wrong_task":
      return "This update is for a different task than the one you approved.";
    case "bad_signature":
      return "The signature doesn't match: the update was changed, or wasn't sent by the person who asked you to approve.";
    case "old_update":
      return "You already have this update or a newer one.";
  }
}

// The approver's side: the plan text in a request must match its fingerprint,
// so what they read is exactly what their signature refers to.
export async function requestPlanMatches(request: ApprovalRequest): Promise<boolean> {
  return (await planHash({ taskId: request.task.id, version: request.plan.version, text: request.plan.text })) === request.plan.hash;
}

export type ResponseRejection =
  | "own_identity"
  | "unknown_request"
  | "request_used"
  | "wrong_task"
  | "wrong_approver"
  | "unknown_approver"
  | "approver_unconfirmed"
  | "bad_signature"
  | "request_expired"
  | "stale_plan"
  | "task_not_awaiting_approval";

// Every check a response must pass. `request` and `approver` are this
// browser's own records, looked up by the ids in the response; any key or
// name inside the response itself is never trusted.
export async function checkApprovalResponse(input: {
  response: ApprovalResponse;
  request: PendingRequest | null;
  approver: TrustedApprover | null;
  ownFingerprint: string | null;
  taskStatus: TaskStatus | null;
  latestPlan: PlanRecord | null;
  now: number;
}): Promise<Verdict<ResponseRejection>> {
  const { response, request, approver, ownFingerprint, taskStatus, latestPlan, now } = input;
  const p = response.payload;
  const no = (reason: ResponseRejection) => ({ ok: false as const, reason });
  if (ownFingerprint !== null && p.approverFingerprint === ownFingerprint) return no("own_identity");
  if (!request || request.requestId !== p.requestId) return no("unknown_request");
  if (request.usedAt !== null) return no("request_used");
  if (p.taskId !== request.taskId) return no("wrong_task");
  if (p.approverFingerprint !== request.approverFingerprint) return no("wrong_approver");
  if (!approver || approver.fingerprint !== p.approverFingerprint) return no("unknown_approver");
  if (approver.confirmedAt === null) return no("approver_unconfirmed");
  if (!(await verifyResponseSignature(approver.publicKey, p, response.signature))) return no("bad_signature");
  if (now > request.expiresAt) return no("request_expired");
  if (p.planVersion !== request.planVersion || p.planHash !== request.planHash) return no("stale_plan");
  if (!latestPlan || latestPlan.id !== request.planId || latestPlan.hash !== request.planHash) return no("stale_plan");
  if (taskStatus !== "AwaitingApproval") return no("task_not_awaiting_approval");
  return { ok: true };
}

export function responseRejectionText(reason: ResponseRejection, approverName = "the approver"): string {
  switch (reason) {
    case "own_identity":
      return "This response was signed by your own approver identity. Someone else has to approve.";
    case "unknown_request":
      return "This response doesn't answer a request sent from this browser.";
    case "request_used":
      return "This request was already answered. Each request can be used once.";
    case "wrong_task":
      return "This response is for a different task.";
    case "wrong_approver":
      return `This response wasn't signed by the person the request was sent to.`;
    case "unknown_approver":
      return "This response was signed by someone who isn't one of your trusted approvers.";
    case "approver_unconfirmed":
      return `Confirm ${approverName}'s fingerprint in Settings → Approvers before importing their responses.`;
    case "bad_signature":
      return "The signature doesn't match. The response was changed or wasn't signed by this approver.";
    case "request_expired":
      return "This request has expired (requests are valid for 7 days). Send a new request.";
    case "stale_plan":
      return "The plan changed after this request was sent. Ask for approval of the current plan.";
    case "task_not_awaiting_approval":
      return "This task isn't waiting for approval any more.";
  }
}
