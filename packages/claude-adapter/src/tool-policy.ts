import type { Verdict } from "@inbox-handoff/task-core";
import { checkGlobPattern, checkInsideRoot } from "./paths.ts";

export type Phase = "planning" | "implementation";

export const PLANNING_TOOLS = ["Read", "Glob", "Grep"] as const;
export const IMPLEMENTATION_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "PowerShell"] as const;

// Tools stripped from the model's context in every phase. Bare-name deny rules
// hold in every permission mode.
export const ALWAYS_DENIED_TOOLS = [
  "WebFetch",
  "WebSearch",
  "Agent",
  "Task",
  "Skill",
  "NotebookEdit",
  "AskUserQuestion",
  "ExitPlanMode",
  "mcp__*",
] as const;

// Operations that need their own, separate authorization (deploy, publish,
// push, send email, ...). Denied here even if a plan lists them.
const SEPARATE_AUTHORIZATION: readonly RegExp[] = [
  /\bgit\s+push\b/i,
  /\b(npm|pnpm|yarn)\s+publish\b/i,
  /\bgh\s+(release|pr\s+merge|repo\s+delete)\b/i,
  /\b(deploy|vercel|netlify|firebase\s+deploy|terraform\s+apply|kubectl)\b/i,
  /\b(sendmail|mail\s+-s|Send-MailMessage)\b/i,
  /\b(curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod)\b/i,
];

export interface PolicyContext {
  phase: Phase;
  realRoot: string;
  approvedCommands: readonly string[];
  // Re-evaluated on every call so that revoking approval takes effect immediately.
  authorize: () => Verdict<string>;
}

export type ToolDecision = { allow: true } | { allow: false; reason: string; escalate: boolean };

const deny = (reason: string, escalate = false): ToolDecision => ({ allow: false, reason, escalate });

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

function checkPathField(ctx: PolicyContext, value: string | undefined, required: boolean): ToolDecision | null {
  if (value === undefined) return required ? deny("missing path") : null;
  const r = checkInsideRoot(ctx.realRoot, value);
  return r.ok ? null : deny(`path rejected: ${r.reason}`);
}

function checkReadTool(ctx: PolicyContext, tool: string, input: Record<string, unknown>): ToolDecision | null {
  switch (tool) {
    case "Read":
      return checkPathField(ctx, str(input, "file_path"), true);
    case "Glob": {
      const p = checkPathField(ctx, str(input, "path"), false);
      if (p) return p;
      const g = checkGlobPattern(str(input, "pattern") ?? "");
      return g.ok ? null : deny(`pattern rejected: ${g.reason}`);
    }
    case "Grep": {
      const p = checkPathField(ctx, str(input, "path"), false);
      if (p) return p;
      const glob = str(input, "glob");
      if (glob !== undefined) {
        const g = checkGlobPattern(glob);
        if (!g.ok) return deny(`glob rejected: ${g.reason}`);
      }
      return null;
    }
    default:
      return deny("not a read tool");
  }
}

export function normalizeCommand(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ");
}

function checkCommand(ctx: PolicyContext, command: string | undefined): ToolDecision | null {
  if (!command) return deny("missing command");
  const norm = normalizeCommand(command);
  if (SEPARATE_AUTHORIZATION.some((re) => re.test(norm))) return deny("operation requires separate authorization", true);
  // Exact match only (after whitespace normalisation): chaining, substitution
  // or redirection can only appear if the user approved that exact string.
  if (!ctx.approvedCommands.map(normalizeCommand).includes(norm)) return deny("command is not in the approved plan", true);
  return null;
}

// Pure decision for one tool call. Fail-closed: unknown tools are denied.
export function evaluateToolCall(ctx: PolicyContext, tool: string, input: Record<string, unknown>): ToolDecision {
  if (ctx.phase === "planning") {
    if (!(PLANNING_TOOLS as readonly string[]).includes(tool)) return deny(`tool ${tool} is not available during planning`);
    return checkReadTool(ctx, tool, input) ?? { allow: true };
  }

  const auth = ctx.authorize();
  if (!auth.ok) return deny(`implementation not authorized: ${auth.reason}`);
  if (!(IMPLEMENTATION_TOOLS as readonly string[]).includes(tool)) return deny(`tool ${tool} is not permitted`, true);

  switch (tool) {
    case "Read":
    case "Glob":
    case "Grep":
      return checkReadTool(ctx, tool, input) ?? { allow: true };
    case "Edit":
    case "Write":
      return checkPathField(ctx, str(input, "file_path"), true) ?? { allow: true };
    case "Bash":
    case "PowerShell":
      return checkCommand(ctx, str(input, "command")) ?? { allow: true };
    default:
      return deny(`tool ${tool} is not permitted`, true);
  }
}
