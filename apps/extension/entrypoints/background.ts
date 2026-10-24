import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { TaskRepo } from "../src/db/task-repo.ts";
import { createDraftStore } from "../src/drafts.ts";
import { routeMessage } from "../src/router.ts";
import { classifySender } from "../src/sender.ts";

export default defineBackground(() => {
  const drafts = createDraftStore(browser.storage.session);
  const ownOrigin = browser.runtime.getURL("/");

  // Toolbar button opens the task list. No popup.
  browser.action.onClicked.addListener(() => void browser.runtime.openOptionsPage());

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
    })
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "internal_error" }));
    return true; // keep the channel open for the async reply
  });
});
