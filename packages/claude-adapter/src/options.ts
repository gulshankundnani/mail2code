import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { PLAN_JSON_SCHEMA } from "@inbox-handoff/protocol";
import { createDenyAllCanUseTool, createPreToolUseHook, type ToolAuditEntry } from "./hook.ts";
import { ALWAYS_DENIED_TOOLS, IMPLEMENTATION_TOOLS, PLANNING_TOOLS, type PolicyContext } from "./tool-policy.ts";

export interface RunConfig {
  claudeExecutable: string;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  abortController?: AbortController;
}

// Settings shared by both phases: isolate the session from user/project
// settings files (which could add allow rules, hooks, or bypass mode), MCP
// servers and plugins, and never persist the session to disk.
function isolatedBase(cfg: RunConfig, ctx: PolicyContext, audit: (e: ToolAuditEntry) => void): Options {
  return {
    cwd: ctx.realRoot,
    pathToClaudeCodeExecutable: cfg.claudeExecutable,
    settingSources: [],
    mcpServers: {},
    strictMcpConfig: true,
    plugins: [],
    persistSession: false,
    canUseTool: createDenyAllCanUseTool(audit),
    hooks: { PreToolUse: [{ hooks: [createPreToolUseHook(ctx, audit)] }] },
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "inbox-handoff/0.0.0" },
    ...(cfg.model ? { model: cfg.model } : {}),
    ...(cfg.maxTurns ? { maxTurns: cfg.maxTurns } : {}),
    ...(cfg.maxBudgetUsd ? { maxBudgetUsd: cfg.maxBudgetUsd } : {}),
    ...(cfg.abortController ? { abortController: cfg.abortController } : {}),
  };
}

export function planningOptions(cfg: RunConfig, ctx: PolicyContext, audit: (e: ToolAuditEntry) => void): Options {
  if (ctx.phase !== "planning") throw new Error("planningOptions needs a planning policy context");
  return {
    ...isolatedBase(cfg, ctx, audit),
    tools: [...PLANNING_TOOLS],
    disallowedTools: [...ALWAYS_DENIED_TOOLS, "Bash", "PowerShell", "Edit", "Write"],
    // dontAsk: anything not pre-approved is denied without prompting.
    permissionMode: "dontAsk",
    outputFormat: { type: "json_schema", schema: PLAN_JSON_SCHEMA as Record<string, unknown> },
  };
}

export function implementationOptions(cfg: RunConfig, ctx: PolicyContext, audit: (e: ToolAuditEntry) => void): Options {
  if (ctx.phase !== "implementation") throw new Error("implementationOptions needs an implementation policy context");
  return {
    ...isolatedBase(cfg, ctx, audit),
    tools: [...IMPLEMENTATION_TOOLS],
    disallowedTools: [...ALWAYS_DENIED_TOOLS],
    // Always explicit: an omitted mode can start the session in 'auto'.
    permissionMode: "default",
  };
}
