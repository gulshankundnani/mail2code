// Generates golden backup fixtures for the CURRENT format version in
// fixtures/backups/ (v<N>-plain.json, v<N>-encrypted.json). These files are
// committed and must keep importing in every future version (see
// packages/backup/test/golden.test.ts). Existing files are never
// overwritten: older versions stay exactly as they were written.
// Synthetic data only. Requires Node 24+ (imports TypeScript sources directly).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { CURRENT_SCHEMA_VERSION, EXPORT_FORMAT, dataChecksum, encryptText } from "../packages/backup/src/index.ts";
import { createApproverIdentity, planHash } from "../packages/task-core/src/index.ts";

const base = `fixtures/backups/v${CURRENT_SCHEMA_VERSION}`;
if (existsSync(`${base}-plain.json`) || existsSync(`${base}-encrypted.json`)) {
  console.error(`✗ ${base}-*.json already exist. Golden files are never regenerated.`);
  process.exit(1);
}

export const FIXTURE_PASSPHRASE = "synthetic fixture passphrase";

const T_AWAIT = "a1a1a1a1-0000-4000-8000-000000000001";
const T_PROGRESS = "a1a1a1a1-0000-4000-8000-000000000002";
const T_DONE = "a1a1a1a1-0000-4000-8000-000000000003";
const P_AWAIT = "b2b2b2b2-0000-4000-8000-000000000001";
const P_PROGRESS = "b2b2b2b2-0000-4000-8000-000000000002";
const A_PROGRESS = "c3c3c3c3-0000-4000-8000-000000000001";
const at = (d, h = 12) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const task = (id, over) => ({
  id,
  title: "Synthetic task",
  status: "Captured",
  blockReason: null,
  priority: "normal",
  dueAt: null,
  repositoryRef: "https://github.com/example/app",
  instructions: "",
  scope: "message",
  threadId: `thread-f:${id.slice(-1)}`,
  threadUrl: `https://mail.google.com/mail/u/0/#inbox/thread-f:${id.slice(-1)}`,
  sources: [{ messageId: `msg-f:${id.slice(-1)}1`, subject: "Synthetic subject", from: "Ada <ada@example.test>", date: "Oct 1, 2026", addedAt: at(1) }],
  idempotencyKey: id.replaceAll("-", "").padEnd(64, "f"),
  createdAt: at(1),
  updatedAt: at(2),
  lastRefreshAt: null,
  contextChangedAt: null,
  handoff: { preparedAt: null, openedAt: null, destination: null },
  requiredApprover: null,
  ...over,
});

// A synthetic approver (v2): public key only; the private key is discarded.
const approver = await createApproverIdentity("Priya Example", "priya@example.test", Date.parse(at(1)));

const planText1 = "Objective: reject empty passwords.\nSteps: edit src/auth.ts; add a test.";
const planText2 = "Objective: bump the version.\nSteps: edit package.json; run npm test.";

const data = {
  tasks: [
    task(T_AWAIT, { title: "Fix login (awaiting approval)", status: "AwaitingApproval", handoff: { preparedAt: at(2, 9), openedAt: at(2, 10), destination: "https://claude.ai/code" } }),
    task(T_PROGRESS, { title: "Release 2.0 (in progress)", status: "InProgress", priority: "high", dueAt: at(31, 23), requiredApprover: approver.fingerprint }),
    task(T_DONE, {
      title: "Update README (completed, with email text)",
      status: "Completed",
      scope: "thread",
      emailContent: [{ messageId: "msg-f:31", bodyText: "Please update the README. Contact: ops@example.test" }],
    }),
  ],
  plans: [
    { id: P_AWAIT, taskId: T_AWAIT, version: 1, hash: await planHash({ taskId: T_AWAIT, version: 1, text: planText1 }), text: planText1, source: "pasted", recordedAt: at(3) },
    { id: P_PROGRESS, taskId: T_PROGRESS, version: 1, hash: await planHash({ taskId: T_PROGRESS, version: 1, text: planText2 }), text: planText2, source: "pasted", recordedAt: at(3) },
  ],
  approvals: [
    {
      id: A_PROGRESS,
      taskId: T_PROGRESS,
      planId: P_PROGRESS,
      planVersion: 1,
      planHash: await planHash({ taskId: T_PROGRESS, version: 1, text: planText2 }),
      decision: "approve",
      comment: "Looks good",
      decidedAt: at(4),
      supersededAt: null,
      signedBy: { fingerprint: approver.fingerprint, name: approver.name },
    },
  ],
  events: [
    { taskId: T_AWAIT, at: at(1), type: "task.captured", data: { scope: "message", messageCount: 1 } },
    { taskId: T_PROGRESS, at: at(1), type: "task.captured", data: { scope: "message", messageCount: 1 } },
    { taskId: T_PROGRESS, at: at(5), type: "note", data: { text: "Started on a branch" } },
    { taskId: T_DONE, at: at(1), type: "task.captured", data: { scope: "thread", messageCount: 1 } },
  ],
  settings: { retentionDays: 90 },
  approvers: [{ fingerprint: approver.fingerprint, name: approver.name, email: approver.email, publicKey: approver.publicKey, addedAt: at(2) }],
};

const file = {
  format: EXPORT_FORMAT,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  appVersion: "0.0.0",
  exportedAt: at(24),
  includesEmailContent: true,
  data,
  checksum: { algorithm: "SHA-256", value: await dataChecksum(data) },
};

const plain = JSON.stringify(file, null, 2);
mkdirSync("fixtures/backups", { recursive: true });
writeFileSync(`${base}-plain.json`, `${plain}\n`);
writeFileSync(`${base}-encrypted.json`, `${JSON.stringify(await encryptText(plain, FIXTURE_PASSPHRASE), null, 2)}\n`);
console.log(`✓ Wrote ${base}-plain.json and ${base}-encrypted.json`);
