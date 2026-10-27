// Backward compatibility: the committed v1 backups must keep importing in
// every future version. If this fails after a format change, add a migration
// (validate.ts MIGRATIONS) — don't regenerate the fixtures.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PassphraseError, decryptText, parseBackupText, validateExport } from "../src/index.ts";

const DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "backups");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");
const FIXTURE_PASSPHRASE = "synthetic fixture passphrase"; // see scripts/make-backup-fixtures.mjs

describe("golden v1 backups", () => {
  it("the plain v1 backup validates without warnings", async () => {
    const parsed = parseBackupText(read("v1-plain.json"));
    expect(parsed.kind).toBe("plain");
    if (parsed.kind !== "plain") return;
    const { file, warnings } = await validateExport(parsed.raw);
    expect(warnings).toEqual([]);
    // Upgraded on import to the current format; nothing in it is signed.
    expect(file.schemaVersion).toBe(2);
    expect(file.data.approvers).toEqual([]);
    expect(file.data.tasks.every((t) => t.requiredApprover === null)).toBe(true);
    expect(file.data.approvals.every((a) => a.signedBy === null)).toBe(true);
    expect(file.data.tasks.map((t) => t.status)).toEqual(["AwaitingApproval", "InProgress", "Completed"]);
    expect(file.data.plans).toHaveLength(2);
    expect(file.data.approvals).toHaveLength(1);
    expect(file.data.settings.retentionDays).toBe(90);
  });

  it("the encrypted v1 backup decrypts (600,000 iterations) to the same content", async () => {
    const parsed = parseBackupText(read("v1-encrypted.json"));
    expect(parsed.kind).toBe("encrypted");
    if (parsed.kind !== "encrypted") return;
    expect(parsed.file.kdf.iterations).toBe(600_000);
    const plaintext = await decryptText(parsed.file, FIXTURE_PASSPHRASE);
    expect(JSON.parse(plaintext)).toEqual(JSON.parse(read("v1-plain.json")));
    await expect(decryptText(parsed.file, "not the passphrase")).rejects.toBeInstanceOf(PassphraseError);
  });
});

describe("golden v2 backups", () => {
  it("the plain v2 backup validates with its approver and signed decision", async () => {
    const parsed = parseBackupText(read("v2-plain.json"));
    if (parsed.kind !== "plain") throw new Error("expected plain");
    const { file, warnings } = await validateExport(parsed.raw);
    expect(warnings).toEqual([]);
    expect(file.schemaVersion).toBe(2);
    expect(file.data.approvers).toHaveLength(1);
    const fp = file.data.approvers[0]!.fingerprint;
    expect(file.data.tasks.find((t) => t.status === "InProgress")?.requiredApprover).toBe(fp);
    expect(file.data.approvals[0]?.signedBy).toEqual({ fingerprint: fp, name: "Priya Example" });
  });

  it("the encrypted v2 backup decrypts to the same content", async () => {
    const parsed = parseBackupText(read("v2-encrypted.json"));
    if (parsed.kind !== "encrypted") throw new Error("expected encrypted");
    expect(JSON.parse(await decryptText(parsed.file, FIXTURE_PASSPHRASE))).toEqual(JSON.parse(read("v2-plain.json")));
  });

  it("refuses an approver whose key doesn't match its fingerprint", async () => {
    const parsed = parseBackupText(read("v2-plain.json"));
    if (parsed.kind !== "plain") throw new Error("expected plain");
    const raw = structuredClone(parsed.raw) as { data: { approvers: { fingerprint: string }[] }; checksum: { value: string } };
    raw.data.approvers[0]!.fingerprint = "f".repeat(64);
    const { dataChecksum } = await import("../src/index.ts");
    raw.checksum.value = await dataChecksum(raw.data as never);
    await expect(validateExport(raw as never)).rejects.toMatchObject({ code: "broken_references" });
  });
});
