// Honest, static description of what this extension can and cannot reach.
// Nothing here is detected at runtime, because a browser extension cannot
// inspect the user's computer.

export type IntegrationState = "available" | "unknown" | "not_configured";

export interface IntegrationStatus {
  id: "local-claude-code" | "browser-handoff" | "managed-agents";
  name: string;
  state: IntegrationState;
  summary: string;
  detail: string;
}

export const INTEGRATIONS: readonly IntegrationStatus[] = [
  {
    id: "local-claude-code",
    name: "Claude Code on this computer",
    state: "unknown",
    summary: "Unknown — cannot verify from the browser",
    detail:
      "Browser extensions can't run programs or inspect your computer, so this extension can't tell whether Claude Code is installed and can't start it. To use it, paste the copied brief into Claude Code yourself.",
  },
  {
    id: "browser-handoff",
    name: "Browser handoff",
    state: "available",
    summary: "Available",
    detail:
      "Copies a task brief to your clipboard and opens claude.ai. You paste and send it yourself. The extension can't see that conversation, so it can't stop Claude from acting before you approve; it only records your decisions.",
  },
  {
    id: "managed-agents",
    name: "Claude Managed Agents (optional)",
    state: "not_configured",
    summary: "Not available in this version",
    detail:
      "A possible future option that would run tasks in Anthropic's cloud using your own API key, with write and shell tools switched off until you approve. It is not local Claude Code. Not built yet.",
  },
];
