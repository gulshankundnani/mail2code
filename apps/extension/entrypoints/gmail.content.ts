import { EXTRACT_ERROR_TEXT, extractConversation } from "@inbox-handoff/gmail-extract";
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { mountButtonController } from "../src/button.ts";
import type { Reply } from "../src/messages.ts";

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  runAt: "document_idle",
  allFrames: false,
  main(ctx) {
    const controller = mountButtonController(document, async (status) => {
      // Email content is read here, and only here: after the user's click.
      const result = extractConversation(document, location.href);
      if (!result.ok) {
        status.set(EXTRACT_ERROR_TEXT[result.error], "error");
        return;
      }
      const reply = (await browser.runtime.sendMessage({ kind: "capture", conversation: result.value })) as Reply | undefined;
      if (reply?.ok) status.set("Review opened in a new tab. Nothing has been sent yet.");
      else status.set("Couldn't open the review page. Try again.", "error");
    });
    ctx.onInvalidated(() => controller.destroy());
  },
});
