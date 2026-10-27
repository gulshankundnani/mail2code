import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { API_ORIGIN, isApiModel } from "../src/api-models.ts";
import { readResponse } from "../src/approval-blocks.ts";
import { createApprovalInbox } from "../src/approval-inbox.ts";
import { summarizeWithClaude } from "../src/claude-api.ts";
import { TaskRepo } from "../src/db/task-repo.ts";
import { createDraftStore } from "../src/drafts.ts";
import { loadPreferences } from "../src/preferences.ts";
import { PAGE_PATHS } from "../src/pages.ts";
import { routeMessage } from "../src/router.ts";
import { classifySender } from "../src/sender.ts";

const DESTINATION_URLS = { desktop: "claude://code/new", "desktop-ssh": "claude://code/new (SSH)", cli: "claude-cli://open" } as const;

export default defineBackground(() => {
  const drafts = createDraftStore(browser.storage.session);
  const approvals = createApprovalInbox(browser.storage.session);
  const ownOrigin = browser.runtime.getURL("/");

  // Retention runs on browser start and on install/update only. There is no
  // timer or polling; extension pages also purge when they open.
  const purge = () => {
    void TaskRepo.open()
      .then(async (repo) => {
        await repo.purgeExpired();
        repo.close();
      })
      .catch(() => {
        // Retried next time a page opens; a failure here must not break capture.
      });
  };
  browser.runtime.onStartup.addListener(purge);
  browser.runtime.onInstalled.addListener(purge);

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const kind = classifySender(sender, browser.runtime.id, ownOrigin);
    routeMessage(raw, kind, {
      drafts,
      openReview: async (draftId) => {
        await browser.tabs.create({ url: browser.runtime.getURL(`/review.html?draft=${encodeURIComponent(draftId)}`) });
      },
      summarize: async (input) => {
        const prefs = await loadPreferences(browser.storage.local);
        if (prefs.summaryEngine !== "claude-api" || !isApiModel(prefs.apiModel)) return { ok: true, value: null };
        // Network access to the API exists only after the user granted it.
        if (!(await browser.permissions.contains({ origins: [API_ORIGIN] }))) return { ok: false, error: "Access to api.anthropic.com hasn't been granted. Open Settings to allow it." };
        const repo = await TaskRepo.open();
        const key = await repo.getApiKey();
        repo.close();
        if (!key) return { ok: false, error: "No API key is set. Add one in Settings." };
        const result = await summarizeWithClaude(key, prefs.apiModel, input);
        return result.ok ? { ok: true, value: { summary: result.summary } } : { ok: false, error: result.error };
      },
      approvals,
      openApproval: async (itemId, item) => {
        const inbox = encodeURIComponent(itemId);
        if (item.kind === "request") {
          await browser.tabs.create({ url: browser.runtime.getURL(`/approve.html?inbox=${inbox}`) });
          return { ok: true, value: null };
        }
        // A progress update belongs in the approver's "Approved by me" list.
        if (item.kind === "update") {
          await browser.tabs.create({ url: browser.runtime.getURL(`/options.html?inbox=${inbox}#approved`) });
          return { ok: true, value: null };
        }
        // A response belongs to one of this browser's tasks: open that task.
        try {
          const response = await readResponse(item.block);
          await browser.tabs.create({ url: browser.runtime.getURL(`/task.html?id=${encodeURIComponent(response.payload.taskId)}&inbox=${inbox}`) });
          return { ok: true, value: null };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "This approval response can't be read." };
        }
      },
      openPage: async (page) => {
        await browser.tabs.create({ url: browser.runtime.getURL(PAGE_PATHS[page]) });
      },
      recordTask: async (task, destination) => {
        const repo = await TaskRepo.open();
        try {
          const { task: saved, created } = await repo.createTask(task);
          if (created) {
            await repo.markBriefPrepared(saved.id);
            await repo.markHandoffOpened(saved.id, DESTINATION_URLS[destination]);
          }
          return { ok: true, value: { taskId: saved.id, created } };
        } finally {
          repo.close();
        }
      },
    })
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "internal_error" }));
    return true; // keep the channel open for the async reply
  });
});
