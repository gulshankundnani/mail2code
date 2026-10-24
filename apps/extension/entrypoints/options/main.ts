import { STATUS_LABELS } from "@inbox-handoff/task-core";
import { browser } from "wxt/browser";
import { TaskRepo } from "../../src/db/task-repo.ts";
import { INTEGRATIONS } from "../../src/integrations.ts";
import { $, el, errorText, formatTime, setStatus } from "../../src/ui.ts";

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

async function renderTasks() {
  const repo = await TaskRepo.open();
  const tasks = await repo.listTasks();
  repo.close();
  $("empty").hidden = tasks.length > 0;
  $("tasks").replaceChildren(
    ...tasks.map((t) => {
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

renderIntegrations();
void renderTasks().catch((err) => setStatus(`Couldn't load tasks: ${errorText(err)}`, "error"));
