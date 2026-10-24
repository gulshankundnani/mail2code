import { describe, expect, it } from "vitest";
import { HandoffCreateSchema, LIMITS, PLAN_JSON_SCHEMA, PlanDecisionSchema, RequestSchema } from "../src/index.ts";

const handoff = () => ({
  idempotencyKey: "a".repeat(64),
  scope: "message" as const,
  threadId: "thread-123",
  threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-123",
  messages: [{ messageId: "msg-1", subject: "Fix login", from: "Ada <ada@example.test>", date: "2026-10-01", bodyText: "Please fix it." }],
  projectId: "proj_1",
  title: "Fix login",
  instructions: "",
  priority: "normal" as const,
  dueAt: null,
});

describe("HandoffCreateSchema", () => {
  it("accepts a well-formed handoff", () => {
    expect(HandoffCreateSchema.safeParse(handoff()).success).toBe(true);
  });

  it("rejects non-Gmail thread URLs", () => {
    expect(HandoffCreateSchema.safeParse({ ...handoff(), threadUrl: "https://evil.test/x" }).success).toBe(false);
  });

  it("rejects path-like project ids", () => {
    expect(HandoffCreateSchema.safeParse({ ...handoff(), projectId: "../etc" }).success).toBe(false);
  });

  it("rejects multiple messages for message scope", () => {
    const h = handoff();
    h.messages.push({ ...h.messages[0]!, messageId: "msg-2" });
    expect(HandoffCreateSchema.safeParse(h).success).toBe(false);
  });

  it("rejects oversized bodies", () => {
    const h = handoff();
    h.messages[0]!.bodyText = "x".repeat(LIMITS.maxMessageBodyChars + 1);
    expect(HandoffCreateSchema.safeParse(h).success).toBe(false);
  });
});

describe("RequestSchema", () => {
  it("rejects unknown request types and protocol versions", () => {
    expect(RequestSchema.safeParse({ v: 1, requestId: "r1", type: "task.implement", payload: {} }).success).toBe(false);
    expect(RequestSchema.safeParse({ v: 2, requestId: "r1", type: "task.list", payload: {} }).success).toBe(false);
  });

  it("requires plan hash and nonce on decisions", () => {
    expect(PlanDecisionSchema.safeParse({ taskId: "t1", planVersion: 1, decision: "approve" }).success).toBe(false);
  });
});

describe("PLAN_JSON_SCHEMA", () => {
  it("exposes every plan field to Claude's structured output", () => {
    expect(Object.keys((PLAN_JSON_SCHEMA as { properties: object }).properties).sort()).toEqual(
      ["assumptions", "commands", "externalDependencies", "filesLikelyToChange", "objective", "openQuestions", "risks", "steps", "tests"].sort(),
    );
  });
});
