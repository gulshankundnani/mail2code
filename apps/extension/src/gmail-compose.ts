// Gmail draft links. Opening one shows a pre-filled draft in Gmail; nothing is
// sent until the user presses Send. No permission is needed: it's an ordinary
// link to mail.google.com, opened in a new tab.

// Gmail and browsers handle long links unevenly; past this length the sealed
// block goes to the clipboard instead (D6).
export const MAX_COMPOSE_URL_CHARS = 7_500;

// The Gmail account index ("/mail/u/1/") of a Gmail URL, so the draft opens in
// the same account the task came from. Defaults to the first account.
export function gmailAccountOf(url: string | undefined | null): number {
  const m = /^https:\/\/mail\.google\.com\/mail\/u\/(\d{1,2})\//.exec(url ?? "");
  return m ? Number(m[1]) : 0;
}

export function gmailComposeUrl(d: { account?: number; to?: string; subject: string; body: string }): string {
  const q = new URLSearchParams({ view: "cm", fs: "1" });
  if (d.to) q.set("to", d.to);
  q.set("su", d.subject);
  q.set("body", d.body);
  return `https://mail.google.com/mail/u/${d.account ?? 0}/?${q.toString()}`;
}

// A draft with the full body when it fits in a link; otherwise a draft whose
// body asks the user to paste, plus the text they need to paste.
export function composeOrPaste(d: { account?: number; to?: string; subject: string; intro: string; block: string; pasteHint: string }): {
  url: string;
  paste: string | null;
} {
  const full = gmailComposeUrl({ ...d, body: `${d.intro}\n\n${d.block}\n` });
  if (full.length <= MAX_COMPOSE_URL_CHARS) return { url: full, paste: null };
  return { url: gmailComposeUrl({ ...d, body: `${d.intro}\n\n${d.pasteHint}\n` }), paste: d.block };
}
