import type { CanUseTool, HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { evaluateToolCall, type PolicyContext, type ToolDecision } from "./tool-policy.ts";

export interface ToolAuditEntry {
  source: "hook" | "canUseTool";
  tool: string;
  input: Record<string, unknown>;
  decision: ToolDecision;
  agentId?: string;
}

// The bridge-owned PreToolUse hook. Registered without a matcher so it sees
// every tool call, including calls made inside subagents. Any exception denies.
export function createPreToolUseHook(ctx: PolicyContext, audit: (e: ToolAuditEntry) => void): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const pre = input as PreToolUseHookInput;
    const toolInput = (pre.tool_input ?? {}) as Record<string, unknown>;
    let decision: ToolDecision;
    try {
      decision = evaluateToolCall(ctx, pre.tool_name, toolInput);
    } catch (err) {
      decision = { allow: false, reason: `policy error: ${(err as Error).message}`, escalate: false };
    }
    audit({ source: "hook", tool: pre.tool_name, input: toolInput, decision, ...(pre.agent_id ? { agentId: pre.agent_id } : {}) });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision.allow ? "allow" : "deny",
        permissionDecisionReason: decision.allow ? "Within approved scope" : `Inbox Handoff policy: ${decision.reason}`,
      },
    };
  };
}

// Anything that reaches canUseTool was not resolved by the hook or rules, so
// it is denied. Interactive escalation goes through the dashboard instead.
export function createDenyAllCanUseTool(audit: (e: ToolAuditEntry) => void): CanUseTool {
  return async (toolName, input) => {
    const decision: ToolDecision = { allow: false, reason: "no interactive approvals inside a run", escalate: true };
    audit({ source: "canUseTool", tool: toolName, input, decision });
    return { behavior: "deny", message: `Inbox Handoff policy: ${decision.reason}` };
  };
}
