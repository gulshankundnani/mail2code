export type SenderKind = "gmail-content-script" | "extension-page" | "untrusted";

export interface SenderInfo {
  id?: string;
  url?: string;
  tab?: unknown;
  frameId?: number;
}

// Decides who sent a runtime message. Only two senders are trusted, and they
// get different capabilities (see router.ts). In particular a Gmail page —
// whose content an email sender partly controls — can never reach the
// handoff-submit or approval paths.
export function classifySender(sender: SenderInfo, ownId: string, ownOrigin: string): SenderKind {
  if (sender.id !== ownId || !sender.url) return "untrusted";
  // URL.origin is "null" for non-special schemes such as chrome-extension:,
  // so extension pages are matched by exact base-URL prefix instead.
  const base = ownOrigin.endsWith("/") ? ownOrigin : `${ownOrigin}/`;
  if (sender.url.startsWith(base)) return "extension-page";
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    return "untrusted";
  }
  if (url.origin === "https://mail.google.com" && sender.tab && sender.frameId === 0) return "gmail-content-script";
  return "untrusted";
}
