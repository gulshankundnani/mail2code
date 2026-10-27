import { EXTRACT_ERROR_TEXT, expandConversation, extractConversation } from "@mail2code/gmail-extract";
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { mountButtonController, type StatusSink } from "../src/button.ts";
import { findApproval, openApprovalCard } from "../src/card/approval-card.ts";
import { openCard } from "../src/card/card.ts";
import { gmailAccountOf } from "../src/gmail-compose.ts";
import type { Reply } from "../src/messages.ts";
import { summarizeOnDevice } from "../src/on-device-ai.ts";
import { loadPreferences } from "../src/preferences.ts";

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  runAt: "document_idle",
  allFrames: false,
  main(ctx) {
    // Email content is read here, and only here: after the user's click.
    const captureAndShow = async (status: StatusSink) => {
      // Gmail only renders the text of expanded messages, so open them all first.
      status.set("Opening all messages in this conversation…");
      await expandConversation(document);
      const result = extractConversation(document, location.href);
      if (!result.ok) {
        status.set(EXTRACT_ERROR_TEXT[result.error], "error");
        return;
      }
      const sendMessage = (msg: unknown) => browser.runtime.sendMessage(msg) as Promise<Reply | undefined>;
      const preferences = await loadPreferences(browser.storage.local);
      const sendToClaude = () =>
        openCard(document, result.value, {
          preferences,
          sendMessage,
          summarizeOnDevice,
          copy: (text) => navigator.clipboard.writeText(text),
          retry: () => captureAndShow(status),
        });
      // A Mail2Code approval email gets its own card; everything else the usual one.
      const approval = findApproval(result.value);
      if (approval) openApprovalCard(document, approval, { sendMessage, sendToClaude, account: gmailAccountOf(location.href) });
      else sendToClaude();
      status.set("");
    };
    const controller = mountButtonController(document, captureAndShow);
    ctx.onInvalidated(() => controller.destroy());
  },
});
