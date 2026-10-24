import type { HandoffCreate } from "@inbox-handoff/protocol";
import type { Reply } from "./messages.ts";

export interface ProjectSummary {
  id: string;
  displayName: string;
}

export interface BridgeClient {
  listProjects(): Promise<Reply<ProjectSummary[]>>;
  submitHandoff(h: HandoffCreate): Promise<Reply<{ taskId: string; created: boolean }>>;
}

export const BRIDGE_NOT_CONNECTED = "bridge_not_connected";

// Until the native-messaging bridge exists (Phase 2d) nothing can be sent.
export function createUnavailableBridge(): BridgeClient {
  return {
    listProjects: async () => ({ ok: false, error: BRIDGE_NOT_CONNECTED }),
    submitHandoff: async () => ({ ok: false, error: BRIDGE_NOT_CONNECTED }),
  };
}

// Test double for end-to-end tests. Only bundled in `--mode e2e` builds.
export function createFakeBridge(): BridgeClient & { received: HandoffCreate[] } {
  const received: HandoffCreate[] = [];
  const byKey = new Map<string, string>();
  return {
    received,
    listProjects: async () => ({ ok: true, value: [{ id: "proj_e2e", displayName: "E2E synthetic project" }] }),
    submitHandoff: async (h) => {
      const existing = byKey.get(h.idempotencyKey);
      if (existing) return { ok: true, value: { taskId: existing, created: false } };
      received.push(h);
      const taskId = `fake-task-${received.length}`;
      byKey.set(h.idempotencyKey, taskId);
      return { ok: true, value: { taskId, created: true } };
    },
  };
}
