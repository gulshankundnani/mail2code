// Non-secret preferences, kept in storage.local so the Gmail content script
// can read them (destination, folders, summary engine). The API key is NOT
// here: it lives in the extension's IndexedDB, which content scripts can't
// read (see TaskRepo.getApiKey). Validated by hand (no zod) so the content
// script stays small.
import { DEFAULT_API_MODEL, isApiModel, type ApiModel } from "./api-models.ts";
import { validateLocalFolder, validateSshFolder, validateSshHost, validateSshPort, type Destination, type EnvironmentSettings } from "./deeplink.ts";

export const PERMISSION_MODES = [
  { id: "plan", label: "Plan mode — Claude reads and plans; no edits until you approve (recommended)" },
  { id: "default", label: "Default — Claude asks before each edit or command" },
  { id: "acceptEdits", label: "Accept edits — file edits without asking; commands still ask" },
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number]["id"];

export const SUMMARY_ENGINES = [
  { id: "rules", label: "Built-in analysis only (local)" },
  { id: "on-device", label: "Built-in analysis + on-device AI summary (Chrome; local)" },
  { id: "claude-api", label: "Built-in analysis + Claude API summary (sends email text to Anthropic)" },
] as const;
export type SummaryEngine = (typeof SUMMARY_ENGINES)[number]["id"];

const DESTINATIONS: readonly Destination[] = ["desktop", "desktop-ssh", "cli"];

export interface Preferences {
  destination: Destination;
  cliFolder: string;
  sshHost: string;
  sshPort: string;
  sshFolder: string;
  defaultMode: PermissionMode;
  summaryEngine: SummaryEngine;
  apiModel: ApiModel;
}

export const DEFAULT_PREFERENCES: Preferences = {
  destination: "desktop",
  cliFolder: "",
  sshHost: "",
  sshPort: "",
  sshFolder: "",
  defaultMode: "plan",
  summaryEngine: "rules",
  apiModel: DEFAULT_API_MODEL,
};

const KEY = "preferences";

interface KV {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const str = (v: unknown, max: number, fallback: string) => (typeof v === "string" && v.length <= max ? v : fallback);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

// Anything malformed falls back to the default for that field.
export function parsePreferences(raw: unknown): Preferences {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFERENCES;
  return {
    destination: oneOf(r.destination, DESTINATIONS, d.destination),
    cliFolder: str(r.cliFolder, 1_000, d.cliFolder),
    sshHost: str(r.sshHost, 300, d.sshHost),
    sshPort: str(r.sshPort, 5, d.sshPort),
    sshFolder: str(r.sshFolder, 1_000, d.sshFolder),
    defaultMode: oneOf(r.defaultMode, PERMISSION_MODES.map((m) => m.id), d.defaultMode),
    summaryEngine: oneOf(r.summaryEngine, SUMMARY_ENGINES.map((m) => m.id), d.summaryEngine),
    apiModel: isApiModel(r.apiModel) ? r.apiModel : d.apiModel,
  };
}

export async function loadPreferences(kv: KV): Promise<Preferences> {
  return parsePreferences((await kv.get(KEY))[KEY]);
}

// Returns field errors instead of saving anything invalid.
export function validatePreferences(p: Preferences): Partial<Record<keyof Preferences, string>> {
  const errors: Partial<Record<keyof Preferences, string>> = {};
  const folder = validateLocalFolder(p.cliFolder);
  if (folder) errors.cliFolder = folder;
  if (p.destination === "desktop-ssh" || p.sshHost.trim()) {
    const host = validateSshHost(p.sshHost);
    if (host) errors.sshHost = host;
  }
  const port = validateSshPort(p.sshPort);
  if (port) errors.sshPort = port;
  const sshFolder = validateSshFolder(p.sshFolder);
  if (sshFolder) errors.sshFolder = sshFolder;
  return errors;
}

export async function savePreferences(kv: KV, p: Preferences): Promise<Partial<Record<keyof Preferences, string>>> {
  const clean = parsePreferences(p);
  const errors = validatePreferences(clean);
  if (Object.keys(errors).length === 0) await kv.set({ [KEY]: clean });
  return errors;
}

export function environmentOf(p: Preferences): EnvironmentSettings {
  return { destination: p.destination, cliFolder: p.cliFolder, sshHost: p.sshHost, sshPort: p.sshPort, sshFolder: p.sshFolder };
}

// Claude Code reads permissions.defaultMode from its settings file; links
// can't set a mode, so the user adds this once.
export function modeSettingsSnippet(mode: PermissionMode): string {
  return JSON.stringify({ permissions: { defaultMode: mode } }, null, 2);
}
