import type { TaskStatus } from "@mail2code/protocol";

// Who is asking for a transition. With the browser handoff the extension cannot
// observe the remote Claude session, so every step past "HandoffOpened" is
// something the *user* reports. `system` covers import and recovery, and may
// only ever block a task.
export type TransitionCause = "user_action" | "user_approval" | "system";

type Edges = Partial<Record<TaskStatus, readonly TransitionCause[]>>;

// from -> to -> causes allowed to take that edge. Anything absent is illegal.
const TRANSITIONS: Record<TaskStatus, Edges> = {
  Captured: { ReadyForHandoff: ["user_action"], Cancelled: ["user_action"] },
  ReadyForHandoff: { HandoffOpened: ["user_action"], Cancelled: ["user_action"] },
  HandoffOpened: { Planning: ["user_action"], ReadyForHandoff: ["user_action"], Cancelled: ["user_action"] },
  Planning: { AwaitingApproval: ["user_action"], Failed: ["user_action"], Blocked: ["user_action", "system"], Cancelled: ["user_action"] },
  AwaitingApproval: {
    Approved: ["user_approval"],
    Rejected: ["user_approval"],
    Planning: ["user_approval"], // "request changes": a revised plan is needed
    Blocked: ["system"],
    Cancelled: ["user_action"],
  },
  Approved: { InProgress: ["user_action"], Blocked: ["user_action", "system"], Cancelled: ["user_action"] },
  InProgress: { Completed: ["user_action"], Failed: ["user_action"], Blocked: ["user_action", "system"], Cancelled: ["user_action"] },
  // Leaving Blocked always goes back through review: never straight to work.
  Blocked: { Planning: ["user_action"], AwaitingApproval: ["user_action"], Cancelled: ["user_action"] },
  Failed: { ReadyForHandoff: ["user_action"] },
  Rejected: { ReadyForHandoff: ["user_action"] },
  Completed: {},
  Cancelled: {},
};

export class IllegalTransitionError extends Error {
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly transitionCause: TransitionCause;
  constructor(from: TaskStatus, to: TaskStatus, cause: TransitionCause) {
    super(`Illegal transition ${from} -> ${to} (cause: ${cause})`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
    this.transitionCause = cause;
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus, cause: TransitionCause): boolean {
  if (!TRANSITIONS[from][to]?.includes(cause)) return false;
  // Defence in depth against a future edit to the table above.
  if (cause === "system" && to !== "Blocked") return false;
  if (to === "Approved" && (cause !== "user_approval" || from !== "AwaitingApproval")) return false;
  if (to === "InProgress" && from !== "Approved") return false;
  return true;
}

export function assertTransition(from: TaskStatus, to: TaskStatus, cause: TransitionCause): void {
  if (!canTransition(from, to, cause)) throw new IllegalTransitionError(from, to, cause);
}

export function allowedTargets(from: TaskStatus, cause: TransitionCause): TaskStatus[] {
  return (Object.keys(TRANSITIONS[from]) as TaskStatus[]).filter((to) => canTransition(from, to, cause));
}

// User-facing wording. States after the handoff are labelled as user-reported,
// because the extension cannot verify them.
export const STATUS_LABELS: Record<TaskStatus, string> = {
  Captured: "Captured",
  ReadyForHandoff: "Brief ready",
  HandoffOpened: "Handoff opened",
  Planning: "Submitted to Claude (reported by you)",
  AwaitingApproval: "Plan recorded, awaiting your approval",
  Approved: "Approved by you",
  InProgress: "Implementation started (reported by you, not verified)",
  Blocked: "Blocked",
  Completed: "Completed (reported by you)",
  Rejected: "Plan rejected",
  Cancelled: "Cancelled",
  Failed: "Failed",
};
