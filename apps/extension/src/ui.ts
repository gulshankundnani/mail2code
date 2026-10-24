// Tiny DOM helpers for the extension pages. Every piece of email- or
// user-derived text goes through textContent; nothing is parsed as HTML.

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id}`);
  return e as T;
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

export function setStatus(text: string, tone: "info" | "error" | "success" = "info", id = "status"): void {
  const s = $(id);
  s.textContent = text;
  s.dataset.tone = tone;
}

export function formatTime(ms: number | null): string {
  return ms === null ? "—" : new Date(ms).toLocaleString();
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
