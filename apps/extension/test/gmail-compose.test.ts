import { describe, expect, it } from "vitest";
import { addressOf } from "../src/approval-inbox.ts";
import { MAX_COMPOSE_URL_CHARS, composeOrPaste, gmailAccountOf, gmailComposeUrl } from "../src/gmail-compose.ts";

describe("Gmail draft links", () => {
  it("builds an encoded draft link in the right account", () => {
    const url = new URL(gmailComposeUrl({ account: 2, to: "priya@example.test", subject: "Plan & review", body: "a\nb?c=d" }));
    expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/u/2/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: "cm", fs: "1", to: "priya@example.test", su: "Plan & review", body: "a\nb?c=d" });
    expect(gmailAccountOf("https://mail.google.com/mail/u/1/#inbox/abc")).toBe(1);
    expect(gmailAccountOf("https://evil.test/mail/u/3/")).toBe(0);
    expect(gmailAccountOf(undefined)).toBe(0);
  });

  it("puts a short block in the draft and a long one on the clipboard (D6)", () => {
    const short = composeOrPaste({ subject: "s", intro: "Hi", block: "BLOCK", pasteHint: "[paste here]" });
    expect(short.paste).toBeNull();
    expect(new URL(short.url).searchParams.get("body")).toBe("Hi\n\nBLOCK\n");
    const block = "x".repeat(MAX_COMPOSE_URL_CHARS);
    const long = composeOrPaste({ subject: "s", intro: "Hi", block, pasteHint: "[paste here]" });
    expect(long.paste).toBe(block);
    expect(long.url.length).toBeLessThan(MAX_COMPOSE_URL_CHARS);
    expect(new URL(long.url).searchParams.get("body")).toBe("Hi\n\n[paste here]\n");
  });

  it("extracts only a plain address from a sender line", () => {
    expect(addressOf("Priya Example <priya@example.test>")).toBe("priya@example.test");
    expect(addressOf("priya@example.test")).toBe("priya@example.test");
    expect(addressOf("Priya <not an address>")).toBe("");
    expect(addressOf('"Evil" <a@b.test>, other@c.test')).toBe("");
  });
});
