import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  checkInsideRoot,
  createDenyAllCanUseTool,
  createPreToolUseHook,
  evaluateToolCall,
  projectPathHash,
  resolveProjectRoot,
  type PolicyContext,
  type ToolAuditEntry,
} from "../src/index.ts";

let base: string;
let root: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "ih-policy-"));
  root = join(base, "project with spaces – ünïcode");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(base, "outside"));
  writeFileSync(join(base, "outside", "secret.txt"), "SECRET");
  writeFileSync(join(root, "src", "app.js"), "");
  // Junctions need no elevation on Windows; plain symlinks elsewhere.
  symlinkSync(join(base, "outside"), join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  root = resolveProjectRoot(root);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

const ok = () => ({ ok: true }) as const;
const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  phase: "implementation",
  realRoot: root,
  approvedCommands: ["npm test", "node --version"],
  authorize: ok,
  ...over,
});

describe("checkInsideRoot", () => {
  it("accepts files inside the root, including ones not yet created", () => {
    expect(checkInsideRoot(root, "src/app.js").ok).toBe(true);
    expect(checkInsideRoot(root, join(root, "src", "new", "file.ts")).ok).toBe(true);
  });

  it("rejects traversal, absolute escapes, symlink/junction escapes and UNC paths", () => {
    expect(checkInsideRoot(root, "../outside/secret.txt").ok).toBe(false);
    expect(checkInsideRoot(root, join(base, "outside", "secret.txt")).ok).toBe(false);
    expect(checkInsideRoot(root, "escape/secret.txt").ok).toBe(false);
    expect(checkInsideRoot(root, "escape/new-file.txt").ok).toBe(false);
    expect(checkInsideRoot(root, "\\\\attacker.test\\share\\x").ok).toBe(false);
    expect(checkInsideRoot(root, "//attacker.test/share/x").ok).toBe(false);
  });

  it("changes the path hash when the root changes", () => {
    expect(projectPathHash(root)).not.toBe(projectPathHash(join(root, "src")));
  });
});

describe("planning policy", () => {
  const p = () => ctx({ phase: "planning", authorize: () => ({ ok: false, reason: "never consulted" }) });

  it("allows read-only tools inside the project", () => {
    expect(evaluateToolCall(p(), "Read", { file_path: join(root, "src", "app.js") })).toEqual({ allow: true });
    expect(evaluateToolCall(p(), "Glob", { pattern: "**/*.js" })).toEqual({ allow: true });
    expect(evaluateToolCall(p(), "Grep", { pattern: "x", path: "src" })).toEqual({ allow: true });
  });

  it("denies every write, shell and network tool", () => {
    for (const t of ["Write", "Edit", "Bash", "PowerShell", "WebFetch", "Agent", "mcp__x__y", "NotebookEdit"])
      expect(evaluateToolCall(p(), t, { file_path: "src/a.js", command: "node --version" }).allow).toBe(false);
  });

  it("denies reads outside the project", () => {
    expect(evaluateToolCall(p(), "Read", { file_path: "../outside/secret.txt" }).allow).toBe(false);
    expect(evaluateToolCall(p(), "Glob", { pattern: "../**/*" }).allow).toBe(false);
    expect(evaluateToolCall(p(), "Glob", { pattern: "C:/**" }).allow).toBe(false);
    expect(evaluateToolCall(p(), "Grep", { pattern: "x", path: "escape" }).allow).toBe(false);
  });
});

describe("implementation policy", () => {
  it("denies everything when not authorized, re-checking on every call", () => {
    let authorized = true;
    const c = ctx({ authorize: () => (authorized ? { ok: true } : { ok: false, reason: "approval_superseded" }) });
    expect(evaluateToolCall(c, "Write", { file_path: "src/a.js" }).allow).toBe(true);
    authorized = false;
    expect(evaluateToolCall(c, "Write", { file_path: "src/a.js" })).toMatchObject({ allow: false, reason: /approval_superseded/ });
    expect(evaluateToolCall(c, "Read", { file_path: "src/app.js" }).allow).toBe(false);
  });

  it("allows only exactly-approved commands", () => {
    expect(evaluateToolCall(ctx(), "Bash", { command: "npm  test" }).allow).toBe(true);
    expect(evaluateToolCall(ctx(), "Bash", { command: "npm test && rm -rf ." }).allow).toBe(false);
    expect(evaluateToolCall(ctx(), "Bash", { command: "npm test; echo pwned" }).allow).toBe(false);
    expect(evaluateToolCall(ctx(), "PowerShell", { command: "Remove-Item -Recurse ." }).allow).toBe(false);
  });

  it("denies push/publish/deploy/network commands even if the plan approved them", () => {
    const c = ctx({ approvedCommands: ["git push origin main", "npm publish", "curl https://x.test"] });
    for (const command of c.approvedCommands) expect(evaluateToolCall(c, "Bash", { command })).toMatchObject({ allow: false, escalate: true });
  });

  it("confines writes to the project", () => {
    expect(evaluateToolCall(ctx(), "Write", { file_path: "../outside/x.txt" }).allow).toBe(false);
    expect(evaluateToolCall(ctx(), "Edit", { file_path: "escape/secret.txt" }).allow).toBe(false);
  });

  it("denies unknown tools", () => {
    expect(evaluateToolCall(ctx(), "SomeFutureTool", {}).allow).toBe(false);
  });
});

describe("hook and canUseTool wiring", () => {
  const input = (tool_name: string, tool_input: Record<string, unknown>) =>
    ({ hook_event_name: "PreToolUse", tool_name, tool_input, session_id: "s", cwd: root, transcript_path: "", tool_use_id: "t" }) as unknown as PreToolUseHookInput;
  const signal = new AbortController().signal;

  it("returns deny with a reason and records the decision", async () => {
    const log: ToolAuditEntry[] = [];
    const hook = createPreToolUseHook(ctx({ phase: "planning" }), (e) => log.push(e));
    const out = await hook(input("Write", { file_path: "x" }), "t", { signal });
    expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(log[0]).toMatchObject({ source: "hook", tool: "Write", decision: { allow: false } });
  });

  it("fails closed if the policy throws", async () => {
    const hook = createPreToolUseHook(
      ctx({
        authorize: () => {
          throw new Error("db locked");
        },
      }),
      () => {},
    );
    const out = await hook(input("Write", { file_path: "src/a.js" }), "t", { signal });
    expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("canUseTool denies everything", async () => {
    const r = await createDenyAllCanUseTool(() => {})("Write", {}, { signal, toolUseID: "t" } as never);
    expect(r?.behavior).toBe("deny");
  });
});
