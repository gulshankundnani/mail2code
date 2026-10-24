import { createHash } from "node:crypto";
import type { HandoffCreate, PlanContent } from "@inbox-handoff/protocol";
import { TaskStore } from "../src/index.ts";

// Synthetic data only.
export function handoff(overrides: Partial<HandoffCreate> = {}): HandoffCreate {
  const base: HandoffCreate = {
    idempotencyKey: createHash("sha256").update(JSON.stringify(overrides)).digest("hex"),
    scope: "message",
    threadId: "thread-abc",
    threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-abc",
    messages: [{ messageId: "msg-1", subject: "Login broken", from: "Ada <ada@example.test>", date: "2026-10-01T10:00:00Z", bodyText: "Login fails with empty password." }],
    projectId: "proj_demo",
    title: "Fix login",
    instructions: "",
    priority: "normal",
    dueAt: null,
  };
  return { ...base, ...overrides };
}

export const PLAN: PlanContent = {
  objective: "Fix the login bug",
  assumptions: ["Node project"],
  openQuestions: [],
  steps: [{ title: "Edit auth", detail: "Reject empty password" }],
  filesLikelyToChange: ["src/auth.ts"],
  commands: [{ command: "npm test", purpose: "run tests" }],
  tests: ["auth tests"],
  risks: [],
  externalDependencies: [],
};

export function storeWithProject(clock = { t: 1_800_000_000_000 }) {
  const store = TaskStore.open(":memory:", { now: () => clock.t });
  store.upsertProject({ id: "proj_demo", displayName: "Demo" });
  store.setProjectPath("proj_demo", "/work/demo", "pathhash-1");
  return { store, clock };
}

// Drives a fresh task to AwaitingApproval and returns its approval nonce.
export function awaitingApproval(store: TaskStore, h = handoff()) {
  const { task } = store.createTaskFromHandoff(h);
  store.transition(task.id, "ReadyForPlanning", "user_action");
  store.transition(task.id, "Planning", "planner");
  store.addPlan(task.id, PLAN);
  store.transition(task.id, "AwaitingApproval", "planner");
  return { taskId: task.id, ...store.issueApprovalNonce(task.id) };
}
