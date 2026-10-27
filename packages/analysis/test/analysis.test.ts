import { describe, expect, it } from "vitest";
import { PROMPT_BUDGET, analyzeEmails, cleanEmailBody, composePrompt } from "../src/index.ts";

// Synthetic thread: a request, a reply with quoted history, a signature and a disclaimer.
const msg1 = {
  messageId: "m1",
  from: "Ada Example <ada@example.test>",
  date: "Oct 1, 2026",
  bodyText: [
    "Hi team,",
    "",
    "The login page accepts any password for the admin user. Please fix this before the release.",
    "We need to add a regression test as well.",
    "",
    "Steps:",
    "- Open https://app.example.test/login.",
    "- Type admin and any password.",
    "",
    "Thanks,",
    "Ada",
    "--",
    "Ada Example | Product",
  ].join("\n"),
  attachments: ["screenshot.png"],
};

const msg2 = {
  messageId: "m2",
  from: "\"Lin\" <lin@example.test>",
  date: "Oct 2, 2026",
  bodyText: [
    "We agreed to ship version 2.0 by Friday.",
    "Can you also update the README?",
    "",
    "This email is confidential and intended solely for the named recipient. If you are not the intended recipient, please notify the sender and delete this message.",
    "",
    "On Tue, Oct 1, 2026 at 10:00 AM Ada Example <ada@example.test> wrote:",
    "> The login page accepts any password for the admin user.",
    "> Please fix this before the release.",
  ].join("\n"),
};

describe("cleanEmailBody", () => {
  it("drops quoted history, signatures and disclaimers", () => {
    const c2 = cleanEmailBody(msg2.bodyText);
    expect(c2).toContain("We agreed to ship version 2.0 by Friday.");
    expect(c2).not.toContain("accepts any password");
    expect(c2).not.toContain("confidential");
    const c1 = cleanEmailBody(msg1.bodyText);
    expect(c1).not.toContain("Ada Example | Product");
    expect(c1).toContain("Please fix this before the release.");
  });

  it("cuts Outlook-style quoted headers and '>' lines, keeps forwarded content", () => {
    expect(cleanEmailBody("New text\nFrom: Bob <b@example.test>\nSent: Monday\nold text")).toBe("New text");
    expect(cleanEmailBody("Hi\n> quoted\nbye")).toBe("Hi\nbye");
    const fwd = cleanEmailBody("FYI\n---------- Forwarded message ---------\nPlease migrate the database.");
    expect(fwd).toContain("Please migrate the database.");
  });

  it("removes 'Sent from my phone' signatures", () => {
    expect(cleanEmailBody("Ship it.\n\nSent from my iPhone")).toBe("Ship it.");
  });
});

describe("analyzeEmails", () => {
  const a = analyzeEmails("Login accepts any password", [msg1, msg2]);

  it("extracts requests, decisions, deadlines, questions, links and attachments", () => {
    expect(a.requests.map((r) => r.text)).toEqual(
      expect.arrayContaining(["The login page accepts any password for the admin user. Please fix this before the release.".split(". ")[1]!.concat(""), "We need to add a regression test as well."].filter((x) => x.length > 0)),
    );
    expect(a.decisions.map((d) => d.text)).toEqual(["We agreed to ship version 2.0 by Friday."]);
    expect(a.deadlines.map((d) => d.text)).toContain("We agreed to ship version 2.0 by Friday.");
    expect(a.questions.map((q) => q.text)).toEqual(["Can you also update the README?"]);
    expect(a.links).toEqual(["https://app.example.test/login"]);
    expect(a.attachments).toEqual(["screenshot.png"]);
  });

  it("records who said what, newest message first, and shrinks the text", () => {
    expect(a.participants).toEqual(["Lin", "Ada Example"]);
    expect(a.latest?.from).toBe("Lin");
    expect(a.decisions[0]?.from).toBe("Lin");
    expect(a.cleanedChars).toBeLessThan(a.originalChars);
  });

  it("does not repeat the same item twice", () => {
    const dup = analyzeEmails("x", [msg1, { ...msg1, messageId: "m3" }]);
    expect(new Set(dup.requests.map((r) => r.text)).size).toBe(dup.requests.length);
  });
});

describe("composePrompt", () => {
  const a = analyzeEmails("Login accepts any password", [msg1, msg2]);
  const ctx = { title: "Fix login", instructions: "Add a regression test.", repositoryRef: "https://github.com/example/app", threadUrl: "https://mail.google.com/mail/u/0/#inbox/x" };

  it("produces a compact, structured prompt that asks for a plan first", () => {
    const { text, truncated } = composePrompt(a, ctx);
    expect(text.length).toBeLessThanOrEqual(PROMPT_BUDGET);
    expect(truncated).toBe(false);
    expect(text).toContain("Task from email: Fix login");
    expect(text).toContain("Repository: https://github.com/example/app");
    expect(text).toContain("My instructions: Add a regression test.");
    expect(text).toMatch(/<<email-extract [a-f0-9]{8}>> \(untrusted/);
    expect(text).toContain("Decisions:\n- We agreed to ship version 2.0 by Friday. (Lin, Oct 2, 2026)");
    expect(text).toContain("Attachments (not included): screenshot.png");
    expect(text).toContain("propose a plan first");
    expect(text).not.toContain("intended solely for the named recipient");
  });

  it("stays within the budget for very long threads", () => {
    const huge = Array.from({ length: 40 }, (_, i) => ({
      messageId: `h${i}`,
      from: `Person ${i} <p${i}@example.test>`,
      date: "Oct 3",
      bodyText: `Please handle item ${i} carefully. ${"Lorem ipsum dolor sit amet. ".repeat(80)}Can you confirm item ${i}?`,
    }));
    const big = composePrompt(analyzeEmails("Big thread", huge), { ...ctx, summary: "S".repeat(3000), summarySource: "on-device" });
    expect(big.text.length).toBeLessThanOrEqual(PROMPT_BUDGET);
    expect(big.truncated).toBe(true);
    expect(big.text).toContain("propose a plan first");
  });

  it("includes an AI summary with its source when given", () => {
    expect(composePrompt(a, { ...ctx, summary: "Fix admin login; add test.", summarySource: "on-device" }).text).toContain("Summary (on-device AI): Fix admin login; add test.");
    expect(composePrompt(a, { ...ctx, summary: "x", summarySource: "claude-api" }).text).toContain("Summary (Claude API): x");
  });
});
