import { TASK_STATUSES, type RetentionDays } from "@inbox-handoff/protocol";
import { STATUS_LABELS } from "@inbox-handoff/task-core";
import { browser } from "wxt/browser";
import type { TaskRecord } from "../../src/db/schema.ts";
import { TaskRepo } from "../../src/db/task-repo.ts";
import { INTEGRATIONS } from "../../src/integrations.ts";
import { EMPTY_QUERY, filterTasks, queryFromParams, queryToParams, type DateField, type StatusFilter, type TaskQuery } from "../../src/task-filter.ts";
import { $, el, errorText, formatTime, setStatus } from "../../src/ui.ts";

let repo: TaskRepo;
let all: TaskRecord[] = [];

function renderIntegrations() {
  $("integrations").replaceChildren(
    ...INTEGRATIONS.map((i) => {
      const li = el("li");
      li.dataset.integration = i.id;
      li.dataset.state = i.state;
      li.append(el("strong", i.name), el("span", ` — ${i.summary}`, "state"), el("p", i.detail, "hint"));
      return li;
    }),
  );
}

function readQuery(): TaskQuery {
  return {
    text: $<HTMLInputElement>("q").value,
    status: $<HTMLSelectElement>("status-filter").value as StatusFilter,
    dateField: $<HTMLSelectElement>("date-field").value as DateField,
    from: $<HTMLInputElement>("from").value,
    to: $<HTMLInputElement>("to").value,
  };
}

function writeQuery(q: TaskQuery) {
  $<HTMLInputElement>("q").value = q.text;
  $<HTMLSelectElement>("status-filter").value = q.status;
  $<HTMLSelectElement>("date-field").value = q.dateField;
  $<HTMLInputElement>("from").value = q.from;
  $<HTMLInputElement>("to").value = q.to;
}

function renderTasks() {
  const q = readQuery();
  const params = queryToParams(q).toString();
  history.replaceState(null, "", params ? `?${params}` : location.pathname);
  const shown = filterTasks(all, q);
  $("empty").hidden = all.length > 0;
  $("no-match").hidden = all.length === 0 || shown.length > 0;
  $("count").textContent = all.length === 0 ? "" : `Showing ${shown.length} of ${all.length} task${all.length === 1 ? "" : "s"}`;
  $("tasks").replaceChildren(
    ...shown.map((t) => {
      const li = el("li");
      const a = el("a", t.title);
      a.href = browser.runtime.getURL(`/task.html?id=${encodeURIComponent(t.id)}`);
      const badge = el("span", STATUS_LABELS[t.status], "badge");
      badge.dataset.status = t.status;
      li.append(a, " ", badge, el("div", `Updated ${formatTime(t.updatedAt)}${t.repositoryRef ? ` · ${t.repositoryRef}` : ""}`, "meta"));
      return li;
    }),
  );
}

async function initRetention() {
  const select = $<HTMLSelectElement>("retention");
  const days = await repo.getRetentionDays();
  select.value = days === null ? "keep" : String(days);
  select.addEventListener("change", async () => {
    const value: RetentionDays = select.value === "keep" ? null : (Number(select.value) as 7 | 30 | 90);
    try {
      await repo.setRetentionDays(value);
      const purged = await repo.purgeExpired();
      setStatus(
        value === null
          ? "Stored email text will be kept until you delete it."
          : `Stored email text will be deleted ${value} days after a task closes.${purged ? ` Deleted it for ${purged} task${purged === 1 ? "" : "s"} just now.` : ""}`,
        "success",
      );
    } catch (err) {
      setStatus(`Couldn't save the setting: ${errorText(err)}`, "error");
    }
  });
}

async function init() {
  renderIntegrations();
  const statusSelect = $<HTMLSelectElement>("status-filter");
  for (const s of TASK_STATUSES) {
    const o = el("option", STATUS_LABELS[s]);
    o.value = s;
    statusSelect.append(o);
  }
  writeQuery(queryFromParams(new URLSearchParams(location.search)));
  const filters = $<HTMLFormElement>("filters");
  filters.addEventListener("input", renderTasks);
  filters.addEventListener("change", renderTasks);
  filters.addEventListener("submit", (e) => e.preventDefault());
  filters.addEventListener("reset", (e) => {
    e.preventDefault();
    writeQuery(EMPTY_QUERY);
    renderTasks();
  });

  repo = await TaskRepo.open();
  await repo.purgeExpired();
  all = await repo.listTasks();
  renderTasks();
  await initRetention();
}

void init().catch((err) => setStatus(`Couldn't load tasks: ${errorText(err)}`, "error"));
