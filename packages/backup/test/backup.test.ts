import { describe, expect, it } from "vitest";
import { planHash } from "@inbox-handoff/task-core";
import {
  BackupError,
  CURRENT_SCHEMA_VERSION,
  EXPORT_FORMAT,
  ImportStrategyError,
  PassphraseError,
  dataChecksum,
  decryptText,
  encryptText,
  parseBackupText,
  previewImport,
  selectImport,
  validateExport,
  type ExportData,
  type ExportFile,
  type ExportTask,
} from "../src/index.ts";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const A1 = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-10-24T12:00:00.000Z";
const FAST = 100_000; // minimum accepted iterations, to keep tests quick

function task(id: string, over: Partial<ExportTask> = {}): ExportTask {
  return {
    id,
    title: `Task ${id.slice(0, 4)}`,
    status: "AwaitingApproval",
    blockReason: null,
    priority: "normal",
    dueAt: null,
    repositoryRef: "https://github.com/example/app",
    instructions: "",
    scope: "message",
    threadId: "thread-f:1",
    threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-f:1",
    sources: [{ messageId: `msg-${id.slice(0, 4)}`, subject: "Subject", from: "Ada <ada@example.test>", date: "Oct 1", addedAt: NOW }],
    idempotencyKey: id.replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    createdAt: NOW,
    updatedAt: NOW,
    lastRefreshAt: null,
    contextChangedAt: null,
    handoff: { preparedAt: null, openedAt: null, destination: null },
    ...over,
  };
}

async function data(): Promise<ExportData> {
  return {
    tasks: [task(T1), task(T2, { status: "InProgress" })],
    plans: [{ id: P1, taskId: T1, version: 1, hash: await planHash({ taskId: T1, version: 1, text: "Plan" }), text: "Plan", source: "pasted", recordedAt: NOW }],
    approvals: [],
    events: [{ taskId: T1, at: NOW, type: "task.captured", data: { scope: "message", messageCount: 1 } }],
    settings: { retentionDays: 30 },
  };
}

async function file(d?: ExportData): Promise<ExportFile> {
  const dd = d ?? (await data());
  return { format: EXPORT_FORMAT, schemaVersion: CURRENT_SCHEMA_VERSION, appVersion: "0.0.0", exportedAt: NOW, includesEmailContent: false, data: dd, checksum: { algorithm: "SHA-256", value: await dataChecksum(dd) } };
}

const roundTrip = async (f: unknown) => {
  const parsed = parseBackupText(JSON.stringify(f));
  if (parsed.kind !== "plain") throw new Error("expected plain");
  return validateExport(parsed.raw);
};

describe("plain JSON export", () => {
  it("round-trips without warnings", async () => {
    const f = await file();
    const { file: back, warnings } = await roundTrip(f);
    expect(back).toEqual(f);
    expect(warnings).toEqual([]);
  });

  it("rejects non-JSON, non-backups and newer versions", async () => {
    expect(() => parseBackupText("not json")).toThrow(BackupError);
    expect(() => parseBackupText(JSON.stringify({ hello: 1 }))).toThrow(/isn't an Inbox Handoff backup/);
    expect(() => parseBackupText("[]")).toThrow(BackupError);
    await expect(roundTrip({ ...(await file()), schemaVersion: 99 })).rejects.toMatchObject({ code: "newer_version" });
  });

  it("rejects oversized files", () => {
    expect(() => parseBackupText(" ".repeat(50 * 1024 * 1024 + 1))).toThrow(/larger than 50 MB/);
  });

  it("detects corruption with the checksum", async () => {
    const f = await file();
    f.data.tasks[0]!.title = "Changed after export";
    await expect(roundTrip(f)).rejects.toMatchObject({ code: "checksum_mismatch" });
  });

  it("rejects unknown fields and malformed records (strict schema)", async () => {
    const d = await data();
    const f = await file(d);
    (f.data.tasks[0] as Record<string, unknown>).oauthToken = "secret";
    await expect(roundTrip(f)).rejects.toMatchObject({ code: "invalid_structure" });
    const bad = await file({ ...d, tasks: [task(T1, { threadUrl: "https://evil.test/x" })] });
    await expect(roundTrip(bad)).rejects.toMatchObject({ code: "invalid_structure" });
  });

  it("rejects broken references and duplicate ids even with a valid checksum", async () => {
    const d = await data();
    await expect(roundTrip(await file({ ...d, events: [...d.events, { taskId: "99999999-9999-4999-8999-999999999999", at: NOW, type: "note", data: {} }] }))).rejects.toMatchObject({
      code: "broken_references",
    });
    await expect(roundTrip(await file({ ...d, tasks: [task(T1), task(T1)] }))).rejects.toMatchObject({ code: "broken_references" });
    const approval = { id: A1, taskId: T2, planId: P1, planVersion: 1, planHash: d.plans[0]!.hash, decision: "approve" as const, comment: null, decidedAt: NOW, supersededAt: null };
    await expect(roundTrip(await file({ ...d, approvals: [approval] }))).rejects.toMatchObject({ code: "broken_references" });
  });

  it("warns about plans whose text doesn't match their fingerprint", async () => {
    const d = await data();
    d.plans[0]!.text = "Plan, edited";
    const { warnings } = await roundTrip(await file(d));
    expect(warnings[0]).toMatch(/doesn't match its fingerprint/);
  });
});

describe("encryption", () => {
  it("round-trips with the right passphrase and stores no key or passphrase", async () => {
    const plaintext = JSON.stringify(await file());
    const enc = await encryptText(plaintext, "correct horse battery", FAST);
    const text = JSON.stringify(enc);
    expect(text).not.toContain("correct horse battery");
    expect(text).not.toContain("Task 1111");
    const parsed = parseBackupText(text);
    expect(parsed.kind).toBe("encrypted");
    if (parsed.kind === "encrypted") expect(await decryptText(parsed.file, "correct horse battery")).toBe(plaintext);
  });

  it("uses a fresh salt and IV every time", async () => {
    const a = await encryptText("same", "correct horse battery", FAST);
    const b = await encryptText("same", "correct horse battery", FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails with a wrong passphrase, a changed ciphertext or changed parameters", async () => {
    const enc = await encryptText("secret data", "correct horse battery", FAST);
    await expect(decryptText(enc, "wrong horse battery")).rejects.toBeInstanceOf(PassphraseError);
    const flipped = enc.ciphertext.startsWith("A") ? `B${enc.ciphertext.slice(1)}` : `A${enc.ciphertext.slice(1)}`;
    await expect(decryptText({ ...enc, ciphertext: flipped }, "correct horse battery")).rejects.toBeInstanceOf(PassphraseError);
    await expect(decryptText({ ...enc, kdf: { ...enc.kdf, iterations: FAST + 1 } }, "correct horse battery")).rejects.toBeInstanceOf(PassphraseError);
  });

  it("requires a passphrase of at least 12 characters", async () => {
    await expect(encryptText("x", "short", FAST)).rejects.toThrow(/at least 12/);
  });

  it("refuses crafted files with extreme key-derivation settings", () => {
    const enc = { format: "inbox-handoff-encrypted-export", version: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 1e9, salt: "AAAAAAAAAAAAAAAAAAAAAA==" }, cipher: { name: "AES-GCM", iv: "AAAAAAAAAAAAAAAA" }, ciphertext: "AAAA" };
    expect(() => parseBackupText(JSON.stringify(enc))).toThrow(/unsupported settings/);
  });
});

describe("import planning", () => {
  const empty: ExportData = { tasks: [], plans: [], approvals: [], events: [], settings: { retentionDays: 30 } };

  it("classifies new, identical, conflicting and duplicate tasks", async () => {
    const f = await file();
    const existing: ExportData = {
      ...empty,
      tasks: [task(T1), task("55555555-5555-4555-8555-555555555555", { idempotencyKey: f.data.tasks[1]!.idempotencyKey, title: "Mine" })],
    };
    const p = previewImport(f, existing);
    expect(p.tasks.map((t) => t.kind)).toEqual(["identical", "duplicate-key"]);
    const changed = previewImport(f, { ...empty, tasks: [task(T1, { title: "Edited here" })] });
    expect(changed.tasks.map((t) => t.kind)).toEqual(["conflict", "new"]);
    expect(changed.counts).toMatchObject({ total: 2, new: 1, conflict: 1 });
  });

  it("restore only works into an empty installation", async () => {
    const f = await file();
    expect(selectImport(previewImport(f, empty), "restore").writeTaskIds).toEqual([T1, T2]);
    expect(() => selectImport(previewImport(f, { ...empty, tasks: [task("66666666-6666-4666-8666-666666666666")] }), "restore")).toThrow(ImportStrategyError);
  });

  it("merge never overwrites unless the user chose 'use imported' for conflicts", async () => {
    const f = await file();
    const p = previewImport(f, { ...empty, tasks: [task(T1, { title: "Edited here" })] });
    const keep = selectImport(p, "merge", "keep-existing");
    expect(keep).toMatchObject({ replaceAll: false, deleteTaskIds: [], writeTaskIds: [T2], applySettings: false });
    expect(keep.skipped[0]?.reason).toBe("kept the version in this browser");
    const use = selectImport(p, "merge", "use-imported");
    expect(use.deleteTaskIds).toEqual([T1]);
    expect(use.writeTaskIds).toEqual([T1, T2]);
  });

  it("replace writes everything and replaces all existing data", async () => {
    const f = await file();
    const sel = selectImport(previewImport(f, { ...empty, tasks: [task("77777777-7777-4777-8777-777777777777")] }), "replace");
    expect(sel).toMatchObject({ replaceAll: true, writeTaskIds: [T1, T2], applySettings: true });
  });
});
