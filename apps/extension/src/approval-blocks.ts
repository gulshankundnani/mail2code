// Reading and writing approval requests and responses in the forms people
// pass around: a sealed block inside an email, or the plain JSON file.
import {
  APPROVAL_REQUEST_FORMAT,
  APPROVAL_RESPONSE_FORMAT,
  ApprovalRequestSchema,
  ApprovalResponseSchema,
  PROGRESS_UPDATE_FORMAT,
  ProgressUpdateSchema,
  parseApprovalFile,
  seal,
  unseal,
  type ApprovalRequest,
  type ApprovalResponse,
  type ProgressUpdate,
  type TaskStatus,
} from "@mail2code/protocol";

async function jsonOf(kind: "request" | "response" | "update", text: string): Promise<string> {
  return text.includes("-----BEGIN MAIL2CODE") ? unseal(kind, text) : text.trim();
}

export async function readRequest(text: string): Promise<ApprovalRequest> {
  return parseApprovalFile(await jsonOf("request", text), ApprovalRequestSchema, APPROVAL_REQUEST_FORMAT);
}

export async function readResponse(text: string): Promise<ApprovalResponse> {
  return parseApprovalFile(await jsonOf("response", text), ApprovalResponseSchema, APPROVAL_RESPONSE_FORMAT);
}

export async function readUpdate(text: string): Promise<ProgressUpdate> {
  return parseApprovalFile(await jsonOf("update", text), ProgressUpdateSchema, PROGRESS_UPDATE_FORMAT);
}

export const sealRequest = (r: ApprovalRequest) => seal("request", JSON.stringify(r));
export const sealUpdate = (u: ProgressUpdate) => seal("update", JSON.stringify(u));

// Task statuses as an approver reads them (the requester's labels say "you").
export const PROGRESS_LABELS: Record<TaskStatus, string> = {
  Captured: "Captured",
  ReadyForHandoff: "Being prepared",
  HandoffOpened: "Sent to Claude",
  Planning: "Planning",
  AwaitingApproval: "New plan waiting for approval",
  Approved: "Approved, not started yet",
  InProgress: "Implementation started",
  Blocked: "Blocked",
  Completed: "Completed",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
  Failed: "Failed",
};

export const updateSubject = (title: string, status: TaskStatus) => `[Mail2Code] Progress update: ${title} — ${PROGRESS_LABELS[status]}`;
export const sealResponse = (r: ApprovalResponse) => seal("response", JSON.stringify(r));

export const requestSubject = (r: Pick<ApprovalRequest, "task" | "plan">) => `[Mail2Code] Approval request: ${r.task.title} (plan v${r.plan.version})`;

const DECISION_TEXT = { approve: "Approved", request_changes: "Changes requested", reject: "Rejected" } as const;

export function responseSubject(r: Pick<ApprovalRequest, "task" | "plan">, decision: keyof typeof DECISION_TEXT): string {
  return `Re: ${requestSubject(r)} — ${DECISION_TEXT[decision]}`;
}

// Saves text as a file in the user's downloads (extension pages only).
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
