import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createFakeBridge, createUnavailableBridge, type BridgeClient } from "../src/bridge.ts";
import { createDraftStore } from "../src/drafts.ts";
import { routeMessage } from "../src/router.ts";
import { classifySender } from "../src/sender.ts";

export default defineBackground(() => {
  // The fake bridge exists only in `wxt build --mode e2e`; production builds
  // compile this branch away.
  const bridge: BridgeClient = import.meta.env.MODE === "e2e" ? createFakeBridge() : createUnavailableBridge();
  const drafts = createDraftStore(browser.storage.session);
  const ownOrigin = browser.runtime.getURL("/");

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const kind = classifySender(sender, browser.runtime.id, ownOrigin);
    routeMessage(raw, kind, {
      drafts,
      bridge,
      openReview: async (draftId) => {
        await browser.tabs.create({ url: browser.runtime.getURL(`/review.html?draft=${encodeURIComponent(draftId)}`) });
      },
    })
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "internal_error" }));
    return true; // keep the channel open for the async reply
  });
});
