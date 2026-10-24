import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export interface RunSummary {
  init: {
    tools: string[];
    permissionMode: string;
    mcpServers: string[];
    plugins: string[];
    skills: string[];
    apiKeySource: string;
    claudeCodeVersion: string;
    model: string;
  } | null;
  toolUses: { name: string; input: unknown }[];
  result: {
    isError: boolean;
    subtype: string;
    text: string | null;
    structuredOutput: unknown;
    permissionDenials: { tool_name: string; tool_input: Record<string, unknown> }[];
    costUsd: number;
    numTurns: number;
  } | null;
}

export async function runClaude(prompt: string, options: Options, onMessage?: (m: SDKMessage) => void): Promise<RunSummary> {
  const summary: RunSummary = { init: null, toolUses: [], result: null };
  for await (const m of query({ prompt, options })) {
    onMessage?.(m);
    if (m.type === "system" && m.subtype === "init") {
      summary.init = {
        tools: m.tools,
        permissionMode: m.permissionMode,
        mcpServers: m.mcp_servers.map((s) => s.name),
        plugins: m.plugins.map((p) => p.name),
        skills: m.skills,
        apiKeySource: String(m.apiKeySource),
        claudeCodeVersion: m.claude_code_version,
        model: m.model,
      };
    } else if (m.type === "assistant") {
      for (const block of m.message.content) {
        if (block.type === "tool_use") summary.toolUses.push({ name: block.name, input: block.input });
      }
    } else if (m.type === "result") {
      summary.result = {
        isError: m.is_error,
        subtype: m.subtype,
        text: m.subtype === "success" ? m.result : null,
        structuredOutput: m.subtype === "success" ? m.structured_output : undefined,
        permissionDenials: m.permission_denials,
        costUsd: m.total_cost_usd,
        numTurns: m.num_turns,
      };
    }
  }
  return summary;
}
