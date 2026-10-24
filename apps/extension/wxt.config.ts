import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "dist",
  manifest: {
    name: "Inbox Handoff",
    description: "Turn a Gmail conversation you choose into a task brief for Claude, and track the plan you approve. Nothing is sent unless you paste it.",
    // Least privilege: `storage` only. The Gmail content script needs no host
    // permission, and opening claude.ai in a tab needs none either.
    permissions: ["storage"],
    action: { default_title: "Inbox Handoff tasks" },
  },
});
