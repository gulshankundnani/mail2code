// Model choices for the optional Claude API summary. Kept separate from the
// API client so the Gmail content script can show settings without loading it.
export const API_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
] as const;
export type ApiModel = (typeof API_MODELS)[number]["id"];
export const DEFAULT_API_MODEL: ApiModel = "claude-opus-5-5";
// The only host the extension may ever contact, and only after the user grants it.
export const API_ORIGIN = "https://api.anthropic.com/*";

export function isApiModel(v: unknown): v is ApiModel {
  return API_MODELS.some((m) => m.id === v);
}
