import type { CapturedConversation, Priority } from "@inbox-handoff/protocol";
import { STATUS_LABELS } from "@inbox-handoff/task-core";
import { browser } from "wxt/browser";
import type { TaskRecord } from "../../src/db/schema.ts";
import { TaskRepo } from "../../src/db/task-repo.ts";
import { buildTaskCreate, type ReviewForm } from "../../src/handoff.ts";
import type { PageMessage, Reply } from "../../src/messages.ts";
import { $, el, errorText, setStatus } from "../../src/ui.ts";

const send = (msg: PageMessage) => browser.runtime.sendMessage(msg) as Promise<Reply>;

const draftId = new URLSearchParams(location.search).get("draft") ?? "";
let draft: CapturedConversation | null = null;
let busy = false;
// Open tasks from the same conversation that can receive a context refresh.
let refreshable: TaskRecord[] = [];

function selectedIds(form: ReviewForm): string[] {
  if (!draft) return [];
  return form.scope === "thread" ? draft.messages.map((m) => m.messageId) : [form.selectedMessageId].filter(Boolean);
}

function renderRefreshTargets() {
  const form = readForm();
  const ids = selectedIds(form);
  const list = $("refresh-tasks");
  const previous = document.querySelector<HTMLInputElement>("input[name=refresh-target]:checked")?.value;
  list.replaceChildren(
    ...refreshable.map((t, i) => {
      const known = new Set(t.sources.map((s) => s.messageId));
      const fresh = ids.filter((id) => !known.has(id)).length;
      const li = el("li");
      const label = el("label");
      const radio = el("input");
      radio.type = "radio";
      radio.name = "refresh-target";
      radio.value = t.id;
      radio.checked = previous ? previous === t.id : i === 0;
      label.append(radio, el("span", `${t.title} — ${STATUS_LABELS[t.status]} — ${fresh === 0 ? "nothing new" : `${fresh} new message${fresh === 1 ? "" : "s"}`}`));
      li.append(label);
      return li;
    }),
  );
  $<HTMLButtonElement>("refresh").disabled = busy || refreshable.length === 0;
}

async function addToExisting() {
  if (!draft || busy) return;
  const target = document.querySelector<HTMLInputElement>("input[name=refresh-target]:checked")?.value;
  if (!target) return setStatus("Choose a task.", "error");
  busy = true;
  $<HTMLButtonElement>("refresh").disabled = true;
  try {
    const repo = await TaskRepo.open();
    const result = await repo.refreshContext(target, draft, selectedIds(readForm()));
    repo.close();
    await send({ kind: "draft.discard", draftId });
    setStatus(
      result.added.length === 0
        ? "That task already has these messages. Nothing was added."
        : `Added ${result.added.length} new message${result.added.length === 1 ? "" : "s"} to the task.${result.blocked ? " Its approval no longer applies: review the plan again before continuing." : ""}`,
      result.blocked ? "error" : "success",
    );
    $("form").hidden = true;
    const link = $<HTMLAnchorElement>("open-task");
    link.href = browser.runtime.getURL(`/task.html?id=${encodeURIComponent(target)}`);
    $("next").hidden = false;
    link.focus();
  } catch (err) {
    busy = false;
    setStatus(`Couldn't add the messages: ${errorText(err)}`, "error");
    renderRefreshTargets();
  }
}

function readForm(): ReviewForm {
  return {
    scope: (document.querySelector<HTMLInputElement>("input[name=scope]:checked")?.value ?? "message") as ReviewForm["scope"],
    selectedMessageId: document.querySelector<HTMLInputElement>("input[name=message]:checked")?.value ?? "",
    repositoryRef: $<HTMLInputElement>("repository").value,
    title: $<HTMLInputElement>("title").value,
    instructions: $<HTMLTextAreaElement>("instructions").value,
    priority: $<HTMLSelectElement>("priority").value as Priority,
    dueDate: $<HTMLInputElement>("due").value,
  };
}

function renderMessages(d: CapturedConversation) {
  const list = $("messages");
  list.replaceChildren();
  d.messages.forEach((m, i) => {
    const li = el("li");
    const pick = el("label");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "message";
    radio.value = m.messageId;
    radio.checked = i === d.messages.length - 1; // default: the latest expanded message
    pick.append(radio, el("span", "Use this message"));
    li.append(el("div", `${m.from || "(unknown sender)"} · ${m.date || "(no date)"}`, "meta"), pick, el("pre", m.bodyText || "(empty)"));
    if (m.truncated) li.append(el("p", "This message was too long and has been cut off.", "warn"));
    list.append(li);
  });
}

async function refresh() {
  if (!draft) return;
  const form = readForm();
  document.querySelectorAll<HTMLInputElement>("input[name=message]").forEach((r) => {
    r.disabled = form.scope === "thread";
    r.closest("li")?.classList.toggle("excluded", form.scope === "message" && !r.checked);
  });
  const built = await buildTaskCreate(draft, form);
  $("payload").textContent = built.ok ? JSON.stringify(built.task, null, 2) : `Not ready: ${built.error}`;
  $<HTMLButtonElement>("create").disabled = !built.ok || busy;
  if (refreshable.length > 0) renderRefreshTargets();
}

async function loadExistingTasks(repo: TaskRepo, threadId: string) {
  const existing = (await repo.tasksForThread(threadId)).filter((t) => t.status !== "Cancelled");
  if (existing.length === 0) return;
  const w = $("duplicate-warning");
  w.hidden = false;
  w.textContent = `You already have ${existing.length} task${existing.length === 1 ? "" : "s"} from this conversation. You can add these messages to one of them, or still create another task.`;
  refreshable = existing.filter((t) => t.status !== "Completed").sort((a, b) => b.updatedAt - a.updatedAt);
  $("refresh-section").hidden = refreshable.length === 0;
}

async function create(e: Event) {
  e.preventDefault();
  if (!draft || busy) return;
  const built = await buildTaskCreate(draft, readForm());
  if (!built.ok) return setStatus(built.error, "error");
  busy = true;
  $<HTMLButtonElement>("create").disabled = true;
  try {
    const repo = await TaskRepo.open();
    const { task, created } = await repo.createTask(built.task);
    repo.close();
    await send({ kind: "draft.discard", draftId });
    setStatus(created ? "Task created and saved in this browser. Nothing has been sent." : "This exact task already exists. No duplicate was created.", "success");
    $("form").hidden = true;
    const link = $<HTMLAnchorElement>("open-task");
    link.href = browser.runtime.getURL(`/task.html?id=${encodeURIComponent(task.id)}`);
    $("next").hidden = false;
    link.focus();
  } catch (err) {
    busy = false;
    setStatus(`Couldn't save the task: ${errorText(err)}`, "error");
    await refresh();
  }
}

async function init() {
  if (!draftId) return setStatus("No captured email. Go back to Gmail and click Send to Claude.", "error");
  const reply = (await send({ kind: "draft.get", draftId })) as Reply<CapturedConversation>;
  if (!reply.ok) return setStatus("This capture has expired or was already used. Go back to Gmail and click Send to Claude again.", "error");
  draft = reply.value;
  $("subject").textContent = draft.subject || "(no subject)";
  $<HTMLInputElement>("title").value = draft.subject;
  $("thread-label").textContent = `Whole conversation (${draft.messages.length} expanded message${draft.messages.length === 1 ? "" : "s"})`;
  if (draft.collapsedCount > 0) {
    const note = $("collapsed-note");
    note.hidden = false;
    note.textContent = `${draft.collapsedCount} collapsed message${draft.collapsedCount === 1 ? " is" : "s are"} not included. To include them, expand them in Gmail and click Send to Claude again.`;
  }
  renderMessages(draft);
  $("form").hidden = false;
  $("form").addEventListener("input", () => void refresh());
  $("form").addEventListener("change", () => void refresh());
  $("form").addEventListener("submit", (e) => void create(e));
  $("cancel").addEventListener("click", async () => {
    if (!busy) await send({ kind: "draft.discard", draftId });
    window.close();
  });
  $("refresh").addEventListener("click", () => void addToExisting());
  try {
    const repo = await TaskRepo.open();
    await loadExistingTasks(repo, draft.threadId);
    repo.close();
  } catch {
    // Advisory only; creating or refreshing a task reports storage errors itself.
  }
  await refresh();
}

void init();
