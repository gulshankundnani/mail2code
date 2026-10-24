import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TASK_STATUSES, type TaskStatus } from "@inbox-handoff/protocol";
import { IllegalTransitionError, STATUS_LABELS, assertTransition, canTransition, type TransitionCause } from "../src/index.ts";

const CAUSES: TransitionCause[] = ["user_action", "user_approval", "system"];

describe("state machine", () => {
  it("allows the browser-handoff path", () => {
    const path: [TaskStatus, TransitionCause][] = [
      ["ReadyForHandoff", "user_action"],
      ["HandoffOpened", "user_action"],
      ["Planning", "user_action"],
      ["AwaitingApproval", "user_action"],
      ["Approved", "user_approval"],
      ["InProgress", "user_action"],
      ["Completed", "user_action"],
    ];
    let s: TaskStatus = "Captured";
    for (const [to, cause] of path) {
      assertTransition(s, to, cause);
      s = to;
    }
  });

  it("only user_approval reaches Approved, and only from AwaitingApproval", () => {
    for (const from of TASK_STATUSES)
      for (const cause of CAUSES) expect(canTransition(from, "Approved", cause)).toBe(from === "AwaitingApproval" && cause === "user_approval");
  });

  it("InProgress is reachable only from Approved", () => {
    for (const from of TASK_STATUSES) for (const cause of CAUSES) if (canTransition(from, "InProgress", cause)) expect(from).toBe("Approved");
  });

  it("system causes (import, recovery) can only block", () => {
    for (const from of TASK_STATUSES)
      for (const to of TASK_STATUSES) if (canTransition(from, to, "system")) expect(to).toBe("Blocked");
  });

  it("blocked tasks go back through review", () => {
    expect(canTransition("Blocked", "InProgress", "user_action")).toBe(false);
    expect(canTransition("Blocked", "Approved", "user_approval")).toBe(false);
  });

  it("throws a typed error on illegal transitions", () => {
    expect(() => assertTransition("Captured", "InProgress", "user_action")).toThrow(IllegalTransitionError);
  });

  it("labels user-reported states honestly", () => {
    expect(STATUS_LABELS.InProgress).toMatch(/reported by you, not verified/);
    expect(STATUS_LABELS.Completed).toMatch(/reported by you/);
  });

  it("property: no event sequence reaches InProgress without an approval immediately before", () => {
    const step = fc.record({ to: fc.constantFrom(...TASK_STATUSES), cause: fc.constantFrom(...CAUSES) });
    fc.assert(
      fc.property(fc.array(step, { maxLength: 60 }), (steps) => {
        let s: TaskStatus = "Captured";
        let approved = false;
        for (const { to, cause } of steps) {
          if (!canTransition(s, to, cause)) continue;
          if (to === "InProgress" && !(approved && s === "Approved")) return false;
          approved = to === "Approved" ? cause === "user_approval" : to === "InProgress" ? approved : false;
          s = to;
        }
        return true;
      }),
      { numRuns: 2_000 },
    );
  });
});
