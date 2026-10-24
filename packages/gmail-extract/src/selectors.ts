// Gmail's DOM is undocumented and changes without notice. Every lookup tries
// several strategies in order; all of them live here so a Gmail change is a
// one-file fix. Verified only against fixtures in fixtures/synthetic-gmail/.
export const SELECTORS = {
  subject: ["h2[data-thread-perm-id]", "h2[data-legacy-thread-id]", "h2.hP"],
  message: ["div[data-message-id]", "div[data-legacy-message-id]", "div.adn"],
  sender: ["span.gD[email]", "[email][name]", "span.gD"],
  date: ["span.g3[title]", "span.g3"],
  body: ["div.a3s", "div.ii.gt"],
  olderMessagesCount: ["span.adx"],
  toolbarAnchor: ["div[gh='mtb']", "div.G-atb"],
} as const;

export function queryFirst(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el;
  }
  return null;
}

export function queryAllFirstMatching(root: ParentNode, selectors: readonly string[]): Element[] {
  for (const s of selectors) {
    const els = Array.from(root.querySelectorAll(s));
    if (els.length > 0) return els;
  }
  return [];
}

// Gmail keeps previously viewed conversations in the DOM, hidden. Only inline
// and attribute-level hiding is detectable without layout, which is what the
// fixtures model; anything else surfaces as an "ambiguous" error, not a guess.
export function isHidden(el: Element): boolean {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (cur.hasAttribute("hidden") || cur.getAttribute("aria-hidden") === "true") return true;
    const style = (cur as HTMLElement).style;
    if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  }
  return false;
}
