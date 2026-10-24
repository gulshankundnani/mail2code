import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "dist",
  manifest: {
    name: "Inbox Handoff",
    description: "Send a Gmail conversation you choose to your own local Claude Code for planning. Nothing is sent until you review and confirm.",
    // Least privilege. The Gmail content script is declared in its entrypoint
    // and needs no host permission. `nativeMessaging` arrives with the bridge (2d).
    permissions: ["storage"],
  },
});
