import type { CapturedConversation, Priority } from "@inbox-handoff/protocol";
import { browser } from "wxt/browser";
import { TaskRepo } from "../../src/db/task-repo.ts";
import { buildTaskCreate, type ReviewForm } from "../../src/handoff.ts";
import type { PageMessage, Reply } from "../../src/messages.ts";
import { $, el, errorText, setStatus } from "../../src/ui.ts";

const send = (msg: PageMessage) => browser.runtime.sendMessage(msg) as Promise<Reply>;

const draftId = new URLSearchParams(location.search).get("draft") ?? "";
let draft: CapturedConversation | null = null;
let busy = false;

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
}

async function warnAboutDuplicates(repo: TaskRepo, threadId: string) {
  const existing = (await repo.tasksForThread(threadId)).filter((t) => t.status !== "Cancelled");
  if (existing.length === 0) return;
  const w = $("duplicate-warning");
  w.hidden = false;
  w.textContent = `You already have ${existing.length} task${existing.length === 1 ? "" : "s"} from this conversation. You can still create another one.`;
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
  try {
    const repo = await TaskRepo.open();
    await warnAboutDuplicates(repo, draft.threadId);
    repo.close();
  } catch {
    // The warning is advisory; creating the task reports storage errors itself.
  }
  await refresh();
}

void init();
