import { describe, expect, it } from "vitest";
import {
  APPROVER_CARD_FORMAT,
  ApprovalFileError,
  ApproverCardSchema,
  MAX_UNSEALED_BYTES,
  SealError,
  findSealedBlocks,
  parseApprovalFile,
  seal,
  unseal,
} from "../src/index.ts";

const card = {
  format: APPROVER_CARD_FORMAT,
  version: 1,
  name: "Priya Example",
  email: "priya@example.test",
  publicKey: "A".repeat(124),
  fingerprint: "a".repeat(64),
};

describe("sealed blocks", () => {
  it("round-trips JSON through a compressed, wrapped block", async () => {
    const json = JSON.stringify({ hello: "world", text: "Plan: edit src/auth.ts\n".repeat(200) });
    const block = await seal("request", json);
    expect(block.startsWith("-----BEGIN MAIL2CODE APPROVAL REQUEST-----\n")).toBe(true);
    expect(block.split("\n").every((l) => l.length <= 76 || l.startsWith("-----"))).toBe(true);
    expect(block.length).toBeLessThan(json.length / 4);
    expect(await unseal("request", block)).toBe(json);
  });

  it("tolerates quoting and extra whitespace added by mail clients, and finds blocks in text", async () => {
    const block = await seal("response", '{"a":1}');
    const quoted = `Thanks!\n\n> Earlier text\n${block
      .split("\n")
      .map((l) => `> ${l}  `)
      .join("\n")}\n`;
    const found = findSealedBlocks(quoted);
    expect(found.map((f) => f.kind)).toEqual(["response"]);
    expect(await unseal("response", found[0]!.text)).toBe('{"a":1}');
  });

  it("refuses the wrong kind, damaged data and oversized output", async () => {
    const block = await seal("request", '{"a":1}');
    await expect(unseal("response", block)).rejects.toBeInstanceOf(SealError);
    await expect(unseal("request", block.replace(/\n[A-Za-z0-9+/]/, "\n!"))).rejects.toMatchObject({ code: "damaged" });
    await expect(unseal("request", block.replace(/\n([A-Za-z0-9+/]{10})/, "\nAAAAAAAAAA"))).rejects.toBeInstanceOf(SealError);
    // A tiny block that would inflate past the limit (a "zip bomb").
    const bomb = await seal("request", " ".repeat(MAX_UNSEALED_BYTES + 10));
    expect(bomb.length).toBeLessThan(5_000);
    await expect(unseal("request", bomb)).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("approval files", () => {
  it("parses a valid card and names the kind of a wrong file", () => {
    expect(parseApprovalFile(JSON.stringify(card), ApproverCardSchema, APPROVER_CARD_FORMAT)).toMatchObject({ name: "Priya Example" });
    expect(() => parseApprovalFile("not json", ApproverCardSchema, APPROVER_CARD_FORMAT)).toThrow(ApprovalFileError);
    expect(() => parseApprovalFile(JSON.stringify({ ...card, format: "mail2code-approval-request" }), ApproverCardSchema, APPROVER_CARD_FORMAT)).toThrow(
      "This file is an approval request, not an approver card.",
    );
    expect(() => parseApprovalFile(JSON.stringify({ ...card, extra: 1 }), ApproverCardSchema, APPROVER_CARD_FORMAT)).toThrow("damaged or was changed");
    expect(() => parseApprovalFile(JSON.stringify({ ...card, email: "not an email" }), ApproverCardSchema, APPROVER_CARD_FORMAT)).toThrow(ApprovalFileError);
  });
});

describe("progress update blocks", () => {
  it("seal and are found like the other kinds", async () => {
    const block = await seal("update", '{"u":1}');
    expect(block).toContain("-----BEGIN MAIL2CODE PROGRESS UPDATE-----");
    expect(findSealedBlocks(`Status: done\n${block}`).map((b) => b.kind)).toEqual(["update"]);
    expect(await unseal("update", block)).toBe('{"u":1}');
    await expect(unseal("request", block)).rejects.toThrow("approval request");
  });
});
