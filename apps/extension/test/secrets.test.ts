import { describe, expect, it } from "vitest";
import { REDACTED, findSecrets, mergeFindings, redactSecrets } from "../src/secrets.ts";

// Synthetic, non-working values shaped like real credentials.
const SAMPLES = {
  anthropic: "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  aws: "AKIAABCDEFGHIJKLMNOP",
  github: `ghp_${"a".repeat(36)}`,
  slack: "xoxb-1234567890-abcdefghij",
  google: `AIza${"B".repeat(35)}`,
  stripe: `sk_live_${"c".repeat(24)}`,
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
};

describe("findSecrets", () => {
  it("detects common credential formats without returning their values", () => {
    for (const [kind, value] of Object.entries(SAMPLES)) {
      const found = findSecrets(`Here you go: ${value} thanks`);
      expect(found.map((f) => f.kind), kind).toEqual([kind]);
      expect(JSON.stringify(found)).not.toContain(value);
    }
  });

  it("detects private keys, passwords in URLs and password assignments", () => {
    const text = [
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----",
      "db: postgres://admin:S3cretPass@db.example.test:5432/app",
      "password: hunter2hunter2",
      "API_KEY=abcdef123456",
    ].join("\n");
    expect(findSecrets(text).map((f) => f.kind).sort()).toEqual(["assignment", "private-key", "url-credentials"].sort());
    expect(findSecrets(text).find((f) => f.kind === "assignment")?.count).toBe(2);
  });

  it("ignores ordinary text and code", () => {
    expect(findSecrets("Please fix the password reset page. The secret to success is tests. Token ring networks are old.")).toEqual([]);
    expect(findSecrets("Password: reset it from the settings page")).toEqual([]);
    expect(findSecrets("function f(passphrase: string, secret: number)")).toEqual([]);
    expect(findSecrets("Visit https://github.com/example/app and AKIA is just letters")).toEqual([]);
  });
});

describe("redactSecrets", () => {
  it("replaces credentials and keeps the surrounding context", () => {
    const out = redactSecrets(`key ${SAMPLES.anthropic}, password: hunter2hunter2, url https://bob:pa55word@example.test/x`);
    expect(out).toBe(`key ${REDACTED}, password: ${REDACTED}, url https://bob:${REDACTED}@example.test/x`);
  });

  it("removes whole private key blocks", () => {
    expect(redactSecrets("a\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\nb")).toBe(`a\n${REDACTED}\nb`);
  });

  it("leaves text without secrets unchanged", () => {
    const text = "Ship version 2.0 on Friday. Contact ada@example.test.";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("mergeFindings", () => {
  it("sums counts per kind", () => {
    expect(mergeFindings([[{ kind: "aws", label: "AWS access key", count: 1 }], [{ kind: "aws", label: "AWS access key", count: 2 }]])).toEqual([
      { kind: "aws", label: "AWS access key", count: 3 },
    ]);
  });
});
