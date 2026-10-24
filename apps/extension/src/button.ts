import { findConversation } from "@inbox-handoff/gmail-extract";

export const HOST_ATTR = "data-inbox-handoff";

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
  :host { all: initial; display: inline-flex; align-items: center; gap: 8px; margin-left: 12px; vertical-align: middle; font: 500 13px/1.2 system-ui, sans-serif; }
  button { font: inherit; padding: 6px 12px; border-radius: 16px; border: 1px solid #c4c7c5; background: #fff; color: #1f1f1f; cursor: pointer; }
  button:hover { background: #f2f2f2; }
  button:focus-visible { outline: 2px solid #0b57d0; outline-offset: 2px; }
  button[disabled] { opacity: .6; cursor: progress; }
  [role=status] { color: #444746; font-weight: 400; }
  [role=status][data-tone=error] { color: #b3261e; }
  @media (prefers-color-scheme: dark) {
    button { background: #1f1f1f; color: #e3e3e3; border-color: #5f6368; }
    button:hover { background: #2a2a2a; }
    [role=status] { color: #c4c7c5; }
    [role=status][data-tone=error] { color: #f2b8b5; }
  }
`;

// Constructable stylesheets are not subject to the page's style-src policy,
// unlike an inline <style>, so the button stays styled under a strict Gmail
// CSP. Falls back to <style> where adopting a sheet isn't possible (older
// engines, or Firefox content-script wrappers).
function applyStyles(doc: Document, shadow: ShadowRoot): void {
  try {
    const Sheet = doc.defaultView?.CSSStyleSheet;
    if (!Sheet) throw new Error("no CSSStyleSheet");
    const sheet = new Sheet();
    sheet.replaceSync(STYLE);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = doc.createElement("style");
    style.textContent = STYLE;
    shadow.append(style);
  }
}

function createHost(doc: Document, onClick: (e: MouseEvent, status: StatusSink, button: HTMLButtonElement) => void): HTMLElement {
  const host = doc.createElement("span");
  host.setAttribute(HOST_ATTR, "button-host");
  const shadow = host.attachShadow({ mode: "open" });
  applyStyles(doc, shadow);
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = "Send to Claude";
  button.setAttribute("aria-label", "Send this email to Claude. Opens a review page; nothing is sent until you confirm.");
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
