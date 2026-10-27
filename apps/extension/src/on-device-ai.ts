// Chrome's built-in, on-device Summarizer API (Chrome 138+, supported
// hardware only). Text never leaves the computer. The model is only used when
// it is already downloaded; downloading (~GBs) happens only when the user
// clicks "Prepare" in Settings. Other browsers report "unsupported".

export type OnDeviceStatus = "unsupported" | "unavailable" | "downloadable" | "downloading" | "available";

interface SummarizerInstance {
  summarize(text: string, options?: { context?: string }): Promise<string>;
  destroy?(): void;
}

interface SummarizerStatic {
  availability(options?: Record<string, unknown>): Promise<string>;
  create(options: Record<string, unknown>): Promise<SummarizerInstance>;
}

// Languages Chrome's Summarizer accepts for output. Chrome asks every request
// to name its output language, and judges output quality and safety for it.
export const SUMMARY_LANGUAGES = ["en", "de", "es", "fr", "ja"] as const;
export type SummaryLanguage = (typeof SUMMARY_LANGUAGES)[number];

// The browser's language when the Summarizer supports it, otherwise English.
export function summaryLanguage(uiLanguage: string | undefined): SummaryLanguage {
  const base = (uiLanguage ?? "").toLowerCase().split("-")[0];
  return (SUMMARY_LANGUAGES as readonly string[]).includes(base!) ? (base as SummaryLanguage) : "en";
}

export function summarizerOptions(uiLanguage: string | undefined = globalThis.navigator?.language): Record<string, unknown> {
  const lang = summaryLanguage(uiLanguage);
  const languages = lang === "en" ? ["en"] : [lang, "en"];
  return {
    type: "key-points",
    format: "plain-text",
    length: "medium",
    sharedContext: "An email thread that a developer wants to turn into a coding task. Focus on requests, requirements, deadlines and open questions.",
    expectedInputLanguages: languages,
    expectedContextLanguages: ["en"],
    outputLanguage: lang,
  };
}
const MAX_INPUT_CHARS = 6_000;

function api(): SummarizerStatic | null {
  const s = (globalThis as { Summarizer?: SummarizerStatic }).Summarizer;
  return s && typeof s.availability === "function" && typeof s.create === "function" ? s : null;
}

export async function onDeviceStatus(): Promise<OnDeviceStatus> {
  const s = api();
  if (!s) return "unsupported";
  try {
    const a = await s.availability(summarizerOptions());
    return a === "available" || a === "downloadable" || a === "downloading" || a === "unavailable" ? a : "unavailable";
  } catch {
    return "unavailable";
  }
}

// Summarises only when the model is already on this computer; otherwise
// returns null so the caller falls back to the rule-based analysis.
export async function summarizeOnDevice(text: string): Promise<string | null> {
  const s = api();
  if (!s || (await onDeviceStatus()) !== "available") return null;
  let instance: SummarizerInstance | null = null;
  try {
    instance = await s.create(summarizerOptions());
    const out = await instance.summarize(text.slice(0, MAX_INPUT_CHARS), { context: "Email thread, newest message first." });
    return out.trim() || null;
  } catch {
    return null;
  } finally {
    instance?.destroy?.();
  }
}

// Called from a click in Settings (user activation is required for the download).
// Returns "not-ready" when Chrome reports the model as available but still
// refuses to start a summarizer (Chrome logs "there was not an execution config
// available for the feature"); Chrome fetches that configuration itself.
export async function prepareOnDevice(onProgress?: (fraction: number) => void): Promise<OnDeviceStatus | "not-ready"> {
  const s = api();
  if (!s) return "unsupported";
  try {
    const instance = await s.create({
      ...summarizerOptions(),
      monitor(m: EventTarget) {
        m.addEventListener("downloadprogress", (e) => onProgress?.((e as unknown as { loaded: number }).loaded));
      },
    });
    instance.destroy?.();
  } catch {
    const status = await onDeviceStatus();
    return status === "available" ? "not-ready" : status;
  }
  return onDeviceStatus();
}

// Checks that a summarizer actually starts, without summarising anything.
// Only call it from a user action: it loads the model into memory.
export async function testOnDevice(): Promise<boolean> {
  const s = api();
  if (!s || (await onDeviceStatus()) !== "available") return false;
  try {
    const instance = await s.create(summarizerOptions());
    instance.destroy?.();
    return true;
  } catch {
    return false;
  }
}
