import type { CapturedConversation, Priority } from "@inbox-handoff/protocol";
import { browser } from "wxt/browser";
import { BRIDGE_NOT_CONNECTED, type ProjectSummary } from "../../src/bridge.ts";
import { buildHandoff, type ReviewForm } from "../../src/handoff.ts";
import type { PageMessage, Reply } from "../../src/messages.ts";

// All email-derived text is inserted with textContent. Never innerHTML.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = (msg: PageMessage) => browser.runtime.sendMessage(msg) as Promise<Reply>;

function setStatus(text: string, tone: "info" | "error" | "success" = "info") {
  const el = $("status");
  el.textContent = text;
  el.dataset.tone = tone;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

const draftId = new URLSearchParams(location.search).get("draft") ?? "";
let draft: CapturedConversation | null = null;
let projectsAvailable = false;
let submitting = false;

function readForm(): ReviewForm {
  const scope = (document.querySelector<HTMLInputElement>("input[name=scope]:checked")?.value ?? "message") as ReviewForm["scope"];
  const selected = document.querySelector<HTMLInputElement>("input[name=message]:checked")?.value ?? "";
  return {
    scope,
    selectedMessageId: selected,
    projectId: $<HTMLSelectElement>("project").value,
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
    li.dataset.messageId = m.messageId;
    const pick = el("label");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "message";
    radio.value = m.messageId;
    radio.checked = i === d.messages.length - 1; // default: the latest expanded message
    pick.append(radio, el("span", "Send this message"));
    li.append(el("div", `${m.from || "(unknown sender)"} · ${m.date || "(no date)"}`, "meta"), pick, el("pre", m.bodyText || "(empty)"));
    if (m.truncated) li.append(el("p", "This message was too long and has been cut off.", "warn"));
    list.append(li);
  });
}

async function refresh() {
  if (!draft) return;
  const form = readForm();
  const messageRadios = document.querySelectorAll<HTMLInputElement>("input[name=message]");
  messageRadios.forEach((r) => {
    r.disabled = form.scope === "thread";
    r.closest("li")?.classList.toggle("excluded", form.scope === "message" && !r.checked);
  });
  const built = await buildHandoff(draft, form);
  const payload = $("payload");
  const sendBtn = $<HTMLButtonElement>("send");
  if (built.ok) {
    payload.textContent = JSON.stringify(built.handoff, null, 2);
    sendBtn.disabled = !projectsAvailable || submitting;
  } else {
    payload.textContent = `Not ready: ${built.error}`;
    sendBtn.disabled = true;
  }
}

async function loadProjects() {
  const select = $<HTMLSelectElement>("project");
  const note = $("project-note");
  const reply = (await send({ kind: "projects.list" })) as Reply<ProjectSummary[]>;
  select.replaceChildren();
  if (!reply.ok) {
    select.append(el("option", "No projects available"));
    select.value = "";
    note.textContent =
      reply.error === BRIDGE_NOT_CONNECTED
        ? "The Inbox Handoff desktop bridge isn't connected, so nothing can be sent yet. You can still review exactly what would be sent."
        : "Couldn't load projects from the desktop bridge.";
    return;
  }
  select.append(el("option", "Choose a project…"));
  (select.firstChild as HTMLOptionElement).value = "";
  for (const p of reply.value) {
    const o = el("option", p.displayName);
    o.value = p.id;
    select.append(o);
  }
  select.disabled = false;
  projectsAvailable = true;
  note.textContent = reply.value.length === 0 ? "No projects are configured in the desktop bridge yet." : "";
}

async function submit(e: Event) {
  e.preventDefault();
  if (!draft || submitting) return;
  const built = await buildHandoff(draft, readForm());
  if (!built.ok) {
    setStatus(built.error, "error");
    return;
  }
  submitting = true;
  $<HTMLButtonElement>("send").disabled = true;
  setStatus("Sending to the desktop bridge…");
  const reply = (await send({ kind: "handoff.submit", draftId, handoff: built.handoff })) as Reply<{ taskId: string; created: boolean }>;
  if (reply.ok) {
    setStatus(
      reply.value.created
        ? `Task created (${reply.value.taskId}). Planning won't start until you start it, and nothing is changed until you approve a plan.`
        : `This exact handoff was already sent (task ${reply.value.taskId}). No duplicate was created.`,
      "success",
    );
    $("form").querySelectorAll("input, select, textarea, button#send").forEach((x) => ((x as HTMLInputElement).disabled = true));
    $("cancel").textContent = "Close";
  } else {
    submitting = false;
    setStatus(reply.error === BRIDGE_NOT_CONNECTED ? "The desktop bridge isn't connected." : `Couldn't send: ${reply.error}`, "error");
    await refresh();
  }
}

async function init() {
  if (!draftId) {
    setStatus("No captured email. Go back to Gmail and click Send to Claude.", "error");
    return;
  }
  const reply = (await send({ kind: "draft.get", draftId })) as Reply<CapturedConversation>;
  if (!reply.ok) {
    setStatus("This capture has expired or was already used. Go back to Gmail and click Send to Claude again.", "error");
    return;
  }
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
  $("form").addEventListener("submit", (e) => void submit(e));
  $("cancel").addEventListener("click", async () => {
    if (!submitting) await send({ kind: "draft.discard", draftId });
    window.close();
  });
  await loadProjects();
  await refresh();
}

void init();
