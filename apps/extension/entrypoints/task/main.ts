import type { TaskStatus } from "@inbox-handoff/protocol";
import { STATUS_LABELS, allowedTargets, type PlanRecord } from "@inbox-handoff/task-core";
import { browser } from "wxt/browser";
import { buildBrief, handoffDestination } from "../../src/brief.ts";
import type { EventRecord, TaskRecord } from "../../src/db/schema.ts";
import { TaskRepo } from "../../src/db/task-repo.ts";
import { $, el, errorText, formatTime, setStatus } from "../../src/ui.ts";

const taskId = new URLSearchParams(location.search).get("id") ?? "";
let repo: TaskRepo;
let task: TaskRecord | null = null;
let latestPlan: PlanRecord | null = null;
let brief = "";

const BLOCK_REASON_TEXT: Record<string, string> = {
  imported_requires_review: "Restored from a backup: review before continuing.",
  plan_needs_changes: "The plan needs changes.",
  blocked_by_user: "Blocked by you.",
};

function eventText(e: EventRecord): string {
  const d = e.data;
  switch (e.type) {
    case "task.captured":
      return `Captured ${String(d.messageCount)} message(s) from Gmail`;
    case "task.transition":
      return `${STATUS_LABELS[d.from as TaskStatus] ?? String(d.from)} → ${STATUS_LABELS[d.to as TaskStatus] ?? String(d.to)}${d.decision ? ` (${String(d.decision)}, plan v${String(d.planVersion)})` : ""}`;
    case "plan.recorded":
      return `Plan v${String(d.version)} recorded (fingerprint ${String(d.hash).slice(0, 12)}…)`;
    case "note":
      return `Note: ${String(d.text)}`;
    default:
      return e.type;
  }
}

const can = (to: TaskStatus, cause: "user_action" | "user_approval" = "user_action") => !!task && allowedTargets(task.status, cause).includes(to);

async function render() {
  task = await repo.getTask(taskId);
  if (!task) {
    setStatus("This task doesn't exist (it may have been deleted).", "error");
    document.querySelectorAll("section").forEach((s) => (s.hidden = true));
    return;
  }
  latestPlan = await repo.getLatestPlan(taskId);
  const approvals = await repo.getApprovals(taskId);
  brief = buildBrief(task, await repo.getSnapshot(taskId));
  const dest = handoffDestination(task.repositoryRef);

  document.title = `${task.title} – Inbox Handoff`;
  $("title").textContent = task.title;
  $("status-label").textContent = STATUS_LABELS[task.status];
  $("status-label").dataset.status = task.status;
  $("block-reason").textContent = task.status === "Blocked" && task.blockReason ? BLOCK_REASON_TEXT[task.blockReason] ?? "" : "";
  $<HTMLAnchorElement>("source-link").href = task.threadUrl;
  $("source-count").textContent = `${task.sources.length} message${task.sources.length === 1 ? "" : "s"} · ${task.sources[0]?.subject ?? ""}`;
  $("repository").textContent = task.repositoryRef || "—";
  $("priority").textContent = task.priority;
  $("due").textContent = task.dueAt ? task.dueAt.slice(0, 10) : "—";
  $("created").textContent = formatTime(task.createdAt);

  // 1. Handoff
  $("brief").textContent = brief;
  $("open-claude").textContent = `Open ${dest.label}`;
  $("destination-hint").textContent = task.handoff.openedAt
    ? `Opened ${dest.label} at ${formatTime(task.handoff.openedAt)}. The extension can't tell whether you sent the brief.`
    : "";
  $<HTMLButtonElement>("copy-brief").disabled = !(task.status === "ReadyForHandoff" || can("ReadyForHandoff"));
  $<HTMLButtonElement>("open-claude").disabled = !(task.status === "ReadyForHandoff" || task.status === "HandoffOpened");
  $<HTMLButtonElement>("mark-submitted").disabled = task.status !== "HandoffOpened";

  // 2. Plan
  $<HTMLButtonElement>("record-plan").disabled = !["Planning", "AwaitingApproval", "Blocked"].includes(task.status);

  // 3. Approval
  $("no-plan").hidden = !!latestPlan;
  $("current-plan").hidden = !latestPlan;
  if (latestPlan) {
    $("plan-meta").textContent = `Plan version ${latestPlan.version} · recorded ${formatTime(latestPlan.recordedAt)} · fingerprint ${latestPlan.hash.slice(0, 16)}…`;
    $("plan-view").textContent = latestPlan.text;
  }
  const awaiting = task.status === "AwaitingApproval" && !!latestPlan;
  for (const id of ["approve", "request-changes", "reject"]) $<HTMLButtonElement>(id).disabled = !awaiting;
  const current = approvals.filter((a) => a.decision === "approve" && a.supersededAt === null && a.origin === "local" && a.planId === latestPlan?.id).at(-1);
  $("copy-approval").hidden = !current;

  // 4. Progress
  $<HTMLButtonElement>("report-started").disabled = task.status !== "Approved";
  $<HTMLButtonElement>("report-completed").disabled = !can("Completed");
  $<HTMLButtonElement>("report-failed").disabled = !can("Failed");
  $<HTMLButtonElement>("block").disabled = !can("Blocked");
  $<HTMLButtonElement>("unblock").disabled = task.status !== "Blocked";
  $<HTMLButtonElement>("cancel-task").disabled = !can("Cancelled");

  const history = $("history");
  history.replaceChildren(...(await repo.getEvents(taskId)).reverse().map((e) => el("li", `${formatTime(e.at)} — ${eventText(e)}`)));
}

// Runs a user action, then re-renders. Errors are shown, never swallowed.
function action(id: string, fn: () => Promise<string | void>) {
  $(id).addEventListener("click", async () => {
    const button = $<HTMLButtonElement>(id);
    button.disabled = true;
    try {
      const message = await fn();
      if (message) setStatus(message, "success");
    } catch (err) {
      setStatus(errorText(err), "error");
    }
    await render();
  });
}

function decide(decision: "approve" | "reject" | "request_changes") {
  return async () => {
    if (!task || !latestPlan) return;
    // The page sends the version and fingerprint it is displaying; the store
    // refuses the decision if the plan changed in the meantime.
    await repo.decide({ taskId, planVersion: latestPlan.version, planHash: latestPlan.hash, decision, comment: $<HTMLInputElement>("decision-comment").value.trim() || undefined });
    $<HTMLInputElement>("decision-comment").value = "";
    return decision === "approve"
      ? `Plan version ${latestPlan.version} approved and recorded. Claude hasn't been told yet: copy the approval message and send it yourself.`
      : decision === "reject"
        ? "Plan rejected."
        : "Changes requested. Ask Claude for a revised plan, then record it.";
  };
}

async function init() {
  $<HTMLAnchorElement>("all-tasks").href = browser.runtime.getURL("/options.html");
  if (!taskId) return setStatus("No task selected.", "error");
  repo = await TaskRepo.open();

  action("copy-brief", async () => {
    await navigator.clipboard.writeText(brief);
    await repo.markBriefPrepared(taskId);
    return "Brief copied to your clipboard. Nothing has been sent yet.";
  });
  action("open-claude", async () => {
    if (!task) return;
    const dest = handoffDestination(task.repositoryRef);
    if (task.status === "ReadyForHandoff") await repo.markHandoffOpened(taskId, dest.url);
    await browser.tabs.create({ url: dest.url });
    return `Opened ${dest.label}. Paste the brief there and send it, then come back and click "I've sent it to Claude".`;
  });
  action("mark-submitted", async () => {
    await repo.transition(taskId, "Planning", "user_action");
    return "Recorded that you sent the brief. Paste Claude's plan below when it arrives.";
  });
  action("record-plan", async () => {
    const plan = await repo.recordPlan(taskId, { text: $<HTMLTextAreaElement>("plan-text").value, source: "pasted" });
    $<HTMLTextAreaElement>("plan-text").value = "";
    return `Plan version ${plan.version} recorded. Review it below and approve or reject it.`;
  });
  action("approve", decide("approve"));
  action("request-changes", decide("request_changes"));
  action("reject", decide("reject"));
  action("copy-approval", async () => {
    if (!latestPlan) return;
    await navigator.clipboard.writeText(
      `I approve your plan as recorded (version ${latestPlan.version}, fingerprint ${latestPlan.hash.slice(0, 16)}). Implement exactly that plan. ` +
        "Ask me before doing anything outside it, and get my separate permission before sending email, deploying, publishing or deleting data.",
    );
    return "Approval message copied. Paste it into your Claude conversation.";
  });
  action("report-started", async () => {
    await repo.reportStarted(taskId);
    return "Recorded that implementation started (reported by you).";
  });
  action("report-completed", async () => void (await repo.transition(taskId, "Completed", "user_action")));
  action("report-failed", async () => void (await repo.transition(taskId, "Failed", "user_action")));
  action("block", async () => void (await repo.transition(taskId, "Blocked", "user_action", {}, "blocked_by_user")));
  action("unblock", async () => void (await repo.transition(taskId, latestPlan ? "AwaitingApproval" : "Planning", "user_action")));
  action("cancel-task", async () => {
    if (!confirm("Cancel this task? It stays in your history.")) return;
    await repo.transition(taskId, "Cancelled", "user_action");
    return "Task cancelled.";
  });
  action("add-note", async () => {
    await repo.addNote(taskId, $<HTMLInputElement>("note").value);
    $<HTMLInputElement>("note").value = "";
  });

  await render();
}

void init().catch((err) => setStatus(errorText(err), "error"));
