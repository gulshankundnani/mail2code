import { describe, expect, it } from "vitest";
import { LIMITS, PlanDecisionSchema, RecordedPlanInputSchema, TaskCreateSchema, canonicalJson, idempotencyMaterial } from "../src/index.ts";

const task = () => ({
  idempotencyKey: "a".repeat(64),
  scope: "message" as const,
  threadId: "thread-123",
  threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-123",
  messages: [{ messageId: "msg-1", subject: "Fix login", from: "Ada <ada@example.test>", date: "2026-10-01", bodyText: "Please fix it." }],
  repositoryRef: "https://github.com/example/app",
  title: "Fix login",
  instructions: "",
  priority: "normal" as const,
  dueAt: null,
});

describe("TaskCreateSchema", () => {
  it("accepts a well-formed task, with or without a repository reference", () => {
    expect(TaskCreateSchema.safeParse(task()).success).toBe(true);
    expect(TaskCreateSchema.safeParse({ ...task(), repositoryRef: "" }).success).toBe(true);
  });

  it("rejects non-Gmail thread URLs", () => {
    expect(TaskCreateSchema.safeParse({ ...task(), threadUrl: "https://evil.test/x" }).success).toBe(false);
  });

  it("rejects multiple messages for message scope", () => {
    const t = task();
    t.messages.push({ ...t.messages[0]!, messageId: "msg-2" });
    expect(TaskCreateSchema.safeParse(t).success).toBe(false);
  });

  it("rejects oversized bodies and repository references", () => {
    const t = task();
    t.messages[0]!.bodyText = "x".repeat(LIMITS.maxMessageBodyChars + 1);
    expect(TaskCreateSchema.safeParse(t).success).toBe(false);
    expect(TaskCreateSchema.safeParse({ ...task(), repositoryRef: "x".repeat(LIMITS.maxRepositoryRefChars + 1) }).success).toBe(false);
  });
});

describe("PlanDecisionSchema", () => {
  it("requires the plan version and hash being decided on", () => {
    expect(PlanDecisionSchema.safeParse({ taskId: crypto.randomUUID(), decision: "approve" }).success).toBe(false);
  });
});

describe("RecordedPlanInputSchema", () => {
  it("rejects empty plans", () => {
    expect(RecordedPlanInputSchema.safeParse({ text: "   ", source: "pasted" }).success).toBe(false);
  });
});

describe("canonical JSON", () => {
  it("is independent of key order and message id order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const a = idempotencyMaterial({ threadId: "t", messageIds: ["2", "1"], repositoryRef: "r", instructions: "" });
    const b = idempotencyMaterial({ threadId: "t", messageIds: ["1", "2"], repositoryRef: "r", instructions: "" });
    expect(a).toBe(b);
  });
});
