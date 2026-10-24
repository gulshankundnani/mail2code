import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TASK_STATUSES, type TaskStatus } from "@inbox-handoff/protocol";
import { IllegalTransitionError, assertTransition, canTransition, type TransitionCause } from "../src/index.ts";

const CAUSES: TransitionCause[] = ["user_action", "user_approval", "planner", "executor", "system_recovery", "context_refresh"];

describe("state machine", () => {
  it("allows the happy path", () => {
    const path: [TaskStatus, TransitionCause][] = [
      ["ReadyForPlanning", "user_action"],
      ["Planning", "planner"],
      ["AwaitingApproval", "planner"],
      ["Approved", "user_approval"],
      ["InProgress", "executor"],
      ["Completed", "executor"],
    ];
    let s: TaskStatus = "Captured";
    for (const [to, cause] of path) {
      assertTransition(s, to, cause);
      s = to;
    }
  });

  it("only user_approval can reach Approved, and only from AwaitingApproval", () => {
    for (const from of TASK_STATUSES)
      for (const cause of CAUSES)
        expect(canTransition(from, "Approved", cause)).toBe(from === "AwaitingApproval" && cause === "user_approval");
  });

  it("only the executor can reach InProgress, and only from Approved", () => {
    for (const from of TASK_STATUSES)
      for (const cause of CAUSES) expect(canTransition(from, "InProgress", cause)).toBe(from === "Approved" && cause === "executor");
  });

  it("background causes never move a task toward execution", () => {
    for (const from of TASK_STATUSES)
      for (const cause of ["system_recovery", "context_refresh"] as const) {
        expect(canTransition(from, "Approved", cause)).toBe(false);
        expect(canTransition(from, "InProgress", cause)).toBe(false);
      }
  });

  it("blocked tasks must go back through review", () => {
    expect(canTransition("Blocked", "InProgress", "executor")).toBe(false);
    expect(canTransition("Blocked", "Approved", "user_approval")).toBe(false);
    expect(canTransition("Blocked", "AwaitingApproval", "user_action")).toBe(true);
  });

  it("throws a typed error on illegal transitions", () => {
    expect(() => assertTransition("Captured", "InProgress", "executor")).toThrow(IllegalTransitionError);
  });

  it("property: no event sequence reaches InProgress without passing user_approval then executor", () => {
    const step = fc.record({ to: fc.constantFrom(...TASK_STATUSES), cause: fc.constantFrom(...CAUSES) });
    fc.assert(
      fc.property(fc.array(step, { maxLength: 60 }), (steps) => {
        let s: TaskStatus = "Captured";
        let approvedByUser = false;
        for (const { to, cause } of steps) {
          if (!canTransition(s, to, cause)) continue;
          if (to === "Approved") approvedByUser = cause === "user_approval";
          else if (to !== "InProgress") approvedByUser = false;
          if (to === "InProgress" && !(approvedByUser && s === "Approved" && cause === "executor")) return false;
          s = to;
        }
        return true;
      }),
      { numRuns: 2_000 },
    );
  });
});
