// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapturedConversation } from "@mail2code/protocol";
import { findApproval, openApprovalCard } from "../src/card/approval-card.ts";
import { CARD_ATTR } from "../src/card/card.ts";

const REQUEST = "-----BEGIN MAIL2CODE APPROVAL REQUEST-----\nAAAA\n-----END MAIL2CODE APPROVAL REQUEST-----";
const RESPONSE = "-----BEGIN MAIL2CODE APPROVAL RESPONSE-----\nBBBB\n-----END MAIL2CODE APPROVAL RESPONSE-----";

const conv = (messages: { from: string; bodyText: string }[]): CapturedConversation => ({
  threadId: "thread-f:1",
  threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-f:1",
  subject: "[Mail2Code] Approval request",
  messages: messages.map((m, i) => ({ messageId: `msg-f:${i}`, date: "Oct 1", truncated: false, ...m })),
  collapsedCount: 0,
  capturedAt: "2026-10-26T12:00:00.000Z",
});

afterEach(() => document.querySelectorAll(`[${CARD_ATTR}]`).forEach((n) => n.remove()));

describe("findApproval", () => {
  it("takes the newest message's own block, not the quoted request below it", () => {
    const found = findApproval(conv([
      { from: "Ada <ada@example.test>", bodyText: `Please approve.\n${REQUEST}` },
      { from: "Priya <priya@example.test>", bodyText: `Approved.\n${RESPONSE}\n\nOn Oct 1 Ada wrote:\n> ${REQUEST.replaceAll("\n", "\n> ")}` },
    ]));
    expect(found).toMatchObject({ kind: "response", from: "Priya <priya@example.test>" });
    expect(found?.block).toBe(RESPONSE);
    expect(findApproval(conv([{ from: "Ada", bodyText: "Just an ordinary email." }]))).toBeNull();
  });
});

describe("approval card", () => {
  it("hands the block over only on a real click and closes", async () => {
    const sent: unknown[] = [];
    const sendToClaude = vi.fn();
    const deps = { sendMessage: async (m: unknown) => (sent.push(m), { ok: true as const, value: null }), sendToClaude, account: 1, requireTrustedEvents: false };
    const { root } = openApprovalCard(document, { kind: "request", block: REQUEST, from: "Ada <ada@example.test>" }, deps);
    expect(root.querySelector("h2")?.textContent).toBe("Approval request");
    (root.getElementById("ap-open") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sent).toEqual([{ kind: "approval.block", item: { kind: "request", block: REQUEST, from: "Ada <ada@example.test>", account: 1 } }]));
    expect(document.querySelectorAll(`[${CARD_ATTR}]`)).toHaveLength(0);
  });

  it("ignores synthetic clicks, shows errors, and can switch to Send to Claude", async () => {
    const sendToClaude = vi.fn();
    const sent: unknown[] = [];
    const trusted = openApprovalCard(document, { kind: "response", block: RESPONSE, from: "Priya" }, { sendMessage: async (m) => (sent.push(m), undefined), sendToClaude, account: 0 });
    (trusted.root.getElementById("ap-open") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(0);
    trusted.close();

    const { root } = openApprovalCard(document, { kind: "response", block: RESPONSE, from: "Priya" }, {
      sendMessage: async () => ({ ok: false as const, error: "This approval response can't be read." }),
      sendToClaude,
      account: 0,
      requireTrustedEvents: false,
    });
    (root.getElementById("ap-open") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector("[role=status]")?.textContent).toBe("This approval response can't be read."));
    (root.querySelector("nav button") as HTMLButtonElement).click();
    expect(sendToClaude).toHaveBeenCalledOnce();
  });
});
