import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createDraftStore } from "../src/drafts.ts";
import { routeMessage } from "../src/router.ts";
import { classifySender } from "../src/sender.ts";

export default defineBackground(() => {
  const drafts = createDraftStore(browser.storage.session);
  const ownOrigin = browser.runtime.getURL("/");

  // Toolbar button opens the task list. No popup, no background work.
  browser.action.onClicked.addListener(() => void browser.runtime.openOptionsPage());

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
