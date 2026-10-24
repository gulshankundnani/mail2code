import type { TaskStatus } from "@inbox-handoff/protocol";

// Who or what is asking for a transition. Background causes (recovery, import,
// context refresh) must never be able to move a task toward execution.
export type TransitionCause =
  | "user_action"
  | "user_approval"
  | "planner"
  | "executor"
  | "system_recovery"
  | "context_refresh";

const BACKGROUND: readonly TransitionCause[] = ["system_recovery", "context_refresh"];

type Edges = Partial<Record<TaskStatus, readonly TransitionCause[]>>;

// from -> to -> causes allowed to take that edge. Anything absent is illegal.
const TRANSITIONS: Record<TaskStatus, Edges> = {
  Captured: { ReadyForPlanning: ["user_action"], Cancelled: ["user_action"] },
  ReadyForPlanning: { Planning: ["planner"], Cancelled: ["user_action"] },
  Planning: {
    AwaitingApproval: ["planner"],
    Failed: ["planner", "system_recovery"],
    Blocked: ["planner", "system_recovery"],
    Cancelled: ["user_action"],
  },
  AwaitingApproval: {
    Approved: ["user_approval"],
    Rejected: ["user_approval"],
    ReadyForPlanning: ["user_approval"], // "request changes" triggers a new plan version
    Blocked: ["context_refresh", "system_recovery"],
    Cancelled: ["user_action"],
  },
  Approved: {
    InProgress: ["executor"],
    Blocked: ["executor", "system_recovery", "context_refresh"],
    Cancelled: ["user_action"],
  },
  InProgress: {
    Completed: ["executor"],
    Failed: ["executor", "system_recovery"],
    Blocked: ["executor", "system_recovery", "context_refresh"],
    Cancelled: ["user_action"],
  },
  // Leaving Blocked always goes back through review: a blocked task can never
  // resume execution without a fresh approval.
  Blocked: { AwaitingApproval: ["user_action"], ReadyForPlanning: ["user_action"], Cancelled: ["user_action"] },
  Failed: { ReadyForPlanning: ["user_action"] },
  Rejected: { ReadyForPlanning: ["user_action"] },
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
  const causes = TRANSITIONS[from][to];
  if (!causes?.includes(cause)) return false;
  // Defence in depth against a future edit to the table above.
  if (BACKGROUND.includes(cause) && (to === "Approved" || to === "InProgress")) return false;
  if (to === "Approved" && cause !== "user_approval") return false;
  if (to === "InProgress" && from !== "Approved") return false;
  return true;
}

export function assertTransition(from: TaskStatus, to: TaskStatus, cause: TransitionCause): void {
  if (!canTransition(from, to, cause)) throw new IllegalTransitionError(from, to, cause);
}

export function allowedTargets(from: TaskStatus): TaskStatus[] {
  return Object.keys(TRANSITIONS[from]) as TaskStatus[];
}
