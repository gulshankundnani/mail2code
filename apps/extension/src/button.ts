import { findConversation } from "@mail2code/gmail-extract";
import { icon } from "./icons.ts";
import { applyStyles } from "./shadow-style.ts";

export const HOST_ATTR = "data-mail2code";

export interface StatusSink {
  set(text: string, tone?: "info" | "error"): void;
}

export interface ButtonControllerOptions {
  // Ignore clicks that scripts synthesise; only real user input may start a capture.
  requireTrustedEvents?: boolean;
  debounceMs?: number;
}

export interface ButtonController {
  refresh(): void;
  destroy(): void;
}

const STYLE = `
  :host { all: initial; display: inline-flex; align-items: center; gap: 8px; margin: 0 14px 0 14px; vertical-align: middle;
    font: 500 13.5px/1 "Google Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
    --accent: #b4532f; --tonal: #fbeee8; --tonal-hover: #f7ddd1; --tonal-fg: #7a3318; --muted: #5f6368; --err: #b3261e; --focus: #0b57d0; }
  button { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; font: inherit;
    border-radius: 999px; border: 1px solid transparent; background: var(--tonal); color: var(--tonal-fg); cursor: pointer; white-space: nowrap;
    box-shadow: 0 1px 2px rgba(60,64,67,.12); transition: background .15s, box-shadow .15s, transform .05s; -webkit-tap-highlight-color: transparent; }
  button:hover { background: var(--tonal-hover); box-shadow: 0 1px 3px rgba(60,64,67,.2), 0 2px 6px rgba(60,64,67,.12); }
  button:active { transform: scale(.97); }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  button[disabled] { cursor: progress; }
  .icon { flex: none; color: var(--accent); transition: transform .3s; }
  button:hover .icon { transform: scale(1.1); }
  .label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .spinner { display: none; flex: none; width: 16px; height: 16px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin .7s linear infinite; }
  button[aria-busy=true] .icon { display: none; }
  button[aria-busy=true] .spinner { display: block; }
  @keyframes spin { to { transform: rotate(360deg); } }
  [role=status] { max-width: 320px; color: var(--muted); font-weight: 400; font-size: 12.5px; line-height: 1.35; }
  [role=status]:empty { display: none; }
  [role=status][data-tone=error] { color: var(--err); }
  @media (max-width: 720px) {
    :host { margin: 0 10px; }
    [role=status] { max-width: 45vw; }
  }
  @media (prefers-color-scheme: dark) {
    :host { --accent: #f0a585; --tonal: #4a2a1d; --tonal-hover: #5a3424; --tonal-fg: #f7cdb9; --muted: #c4c7c5; --err: #f2b8b5; --focus: #a8c7fa; }
    button { box-shadow: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    button, .icon { transition: none; }
    .spinner { animation-duration: 2s; }
  }
`;

function createHost(doc: Document, onClick: (e: MouseEvent, status: StatusSink, button: HTMLButtonElement) => void): HTMLElement {
  const host = doc.createElement("span");
  host.setAttribute(HOST_ATTR, "button-host");
  const shadow = host.attachShadow({ mode: "open" });
  applyStyles(doc, shadow, STYLE);
  const button = doc.createElement("button");
  button.type = "button";
  const spinner = doc.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  const label = doc.createElement("span");
  label.className = "label";
  label.textContent = "Send to Claude";
  button.append(icon(doc, "mail2code", 20), spinner, label);
  button.title = "Send to Claude";
  button.setAttribute("aria-label", "Send this email to Claude. Opens a preview; nothing is sent until you confirm.");
  const status = doc.createElement("span");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const sink: StatusSink = {
    set(text, tone = "info") {
      status.textContent = text;
      status.dataset.tone = tone;
    },
  };
  button.addEventListener("click", (e) => onClick(e, sink, button));
  shadow.append(button, status);
  return host;
}

// Keeps exactly one "Send to Claude" button next to the subject of the open
// conversation, across Gmail's client-side navigation. The observer only checks
// page *structure*; email content is read solely inside `onActivate`, i.e. after
// a user click.
export function mountButtonController(
  doc: Document,
  onActivate: (status: StatusSink) => Promise<void>,
  opts: ButtonControllerOptions = {},
): ButtonController {
  const requireTrusted = opts.requireTrustedEvents ?? true;
  const debounceMs = opts.debounceMs ?? 150;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;

  const handleClick = (e: MouseEvent, status: StatusSink, button: HTMLButtonElement) => {
    if (requireTrusted && !e.isTrusted) return;
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    status.set("Capturing…");
    onActivate(status)
      .catch((err: unknown) => status.set(err instanceof Error ? err.message : "Something went wrong.", "error"))
      .finally(() => {
        busy = false;
        button.disabled = false;
        button.removeAttribute("aria-busy");
      });
  };

  const refresh = () => {
    const hosts = Array.from(doc.querySelectorAll(`[${HOST_ATTR}]`));
    const conv = findConversation(doc);
    if (conv === null || conv === "ambiguous") {
      hosts.forEach((h) => h.remove());
      return;
    }
    if (hosts.length === 1 && hosts[0]!.previousElementSibling === conv.subject) return;
    hosts.forEach((h) => h.remove());
    conv.subject.after(createHost(doc, handleClick));
  };

  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, debounceMs);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, { childList: true, subtree: true });
  const win = doc.defaultView;
  win?.addEventListener("hashchange", schedule);
  win?.addEventListener("popstate", schedule);
  refresh();

  return {
    refresh,
    destroy() {
      observer.disconnect();
      win?.removeEventListener("hashchange", schedule);
      win?.removeEventListener("popstate", schedule);
      if (timer !== undefined) clearTimeout(timer);
      doc.querySelectorAll(`[${HOST_ATTR}]`).forEach((h) => h.remove());
    },
  };
}
