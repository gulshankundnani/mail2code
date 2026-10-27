// Builds links that open Claude Code on this computer with a pre-filled prompt.
// Formats are taken from Anthropic's documentation:
//   Claude app:      claude://code/new?q=…[&ssh_host=…&ssh_port=…&ssh_folder=…]
//                    (code.claude.com/docs/en/desktop — "Open an SSH session from a link")
//   Claude Code CLI: claude-cli://open?q=…[&repo=owner/name | &cwd=/abs/path]
//                    (code.claude.com/docs/en/deep-links)
// Neither app sends the prompt by itself: the user reads it and presses Enter.
// Every parameter is validated here, and values are only ever URL-encoded,
// never concatenated raw, so email content can't add or change parameters.

export type Destination = "desktop" | "desktop-ssh" | "cli";

export interface EnvironmentSettings {
  destination: Destination;
  cliFolder: string; // absolute path; used when the task has no GitHub repository
  sshHost: string; // host or user@host
  sshPort: string; // "" or 1-65535
  sshFolder: string; // /… or ~/…
}

export const CLI_PROMPT_LIMIT = 5_000; // documented maximum for claude-cli:// q

export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkError";
  }
}

// Documented: "can't start with -, and the host part takes only letters,
// digits, ., _, : and -". The optional user part is kept equally strict.
const SSH_HOST = /^(?:[A-Za-z0-9._-]{1,64}@)?[A-Za-z0-9._:-]{1,253}$/;
const SSH_FOLDER = /^(?:~|~\/[^\0]*|\/[^\0]*)$/;
const REPO_SLUG = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const GITHUB_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/;
// Invisible and bidirectional control characters (the CLI rejects these too).
const INVISIBLE = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

export function repoSlugFromRef(ref: string): string | null {
  const t = ref.trim();
  if (REPO_SLUG.test(t) && !t.includes("..")) return t;
  const m = GITHUB_URL.exec(t);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function validateSshHost(host: string): string | null {
  const h = host.trim();
  if (!h || h.startsWith("-") || !SSH_HOST.test(h)) return "SSH host may contain only letters, digits, '.', '_', ':', '-' and an optional 'user@'.";
  return null;
}

export function validateSshPort(port: string): string | null {
  if (port.trim() === "") return null;
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : "SSH port must be a number from 1 to 65535.";
}

export function validateSshFolder(folder: string): string | null {
  const f = folder.trim();
  if (f === "") return null;
  if (!SSH_FOLDER.test(f) || INVISIBLE.test(f) || f.split("/").includes("..")) return "SSH folder must start with / or ~/ and can't contain '..'.";
  return null;
}

// Absolute local path: C:\… or C:/… on Windows, /… elsewhere. No network/UNC
// paths, no '..' segments, no control characters (matching the CLI's rules).
export function validateLocalFolder(folder: string): string | null {
  const f = folder.trim();
  if (f === "") return null;
  if (INVISIBLE.test(f)) return "The folder contains invisible characters.";
  if (/^[\\/]{2}/.test(f)) return "Network (UNC) paths aren't allowed.";
  if (!(/^[A-Za-z]:[\\/]/.test(f) || f.startsWith("/"))) return "Use an absolute folder path, e.g. C:\\Projects\\app or /home/me/app.";
  if (f.split(/[\\/]/).includes("..")) return "The folder can't contain '..'.";
  return null;
}

function query(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

export interface BuiltLink {
  url: string;
  label: string;
  notes: string[]; // shown to the user, e.g. which folder will be used
}

// Removes every invisible/bidirectional control character except newlines and
// tabs, which prompts legitimately contain.
function stripInvisible(text: string): string {
  return text.replace(new RegExp(INVISIBLE.source, "g"), (c) => (c === "\n" || c === "\t" ? c : ""));
}

export function buildClaudeLink(rawPrompt: string, env: EnvironmentSettings, repositoryRef: string): BuiltLink {
  const prompt = stripInvisible(rawPrompt);
  if (prompt.length > CLI_PROMPT_LIMIT) throw new LinkError(`The prompt is longer than ${CLI_PROMPT_LIMIT} characters.`);

  switch (env.destination) {
    case "desktop":
      return {
        url: `claude://code/new?${query({ q: prompt })}`,
        label: "Claude app",
        notes: ["Opens a new session in the Claude app. Choose the project folder there if it isn't already selected."],
      };
    case "desktop-ssh": {
      const problem = validateSshHost(env.sshHost) ?? validateSshPort(env.sshPort) ?? validateSshFolder(env.sshFolder);
      if (problem) throw new LinkError(problem);
      return {
        url: `claude://code/new?${query({ ssh_host: env.sshHost.trim(), ssh_port: env.sshPort.trim(), ssh_folder: env.sshFolder.trim(), q: prompt })}`,
        label: `Claude app over SSH (${env.sshHost.trim()})`,
        notes: ["The Claude app asks you to confirm the SSH connection before it connects."],
      };
    }
    case "cli": {
      const slug = repoSlugFromRef(repositoryRef);
      const folderProblem = validateLocalFolder(env.cliFolder);
      if (folderProblem) throw new LinkError(folderProblem);
      const params: Record<string, string> = slug ? { repo: slug, q: prompt } : { cwd: env.cliFolder.trim(), q: prompt };
      const where = slug ? `your local clone of ${slug} (the one you last used with claude)` : env.cliFolder.trim() || "your home folder";
      return {
        url: `claude-cli://open?${query(params)}`,
        label: "Claude Code (terminal)",
        notes: [`Opens a terminal in ${where}.`, "First time only: run `claude` once and send any prompt, so Windows knows how to open these links."],
      };
    }
  }
}
