// Makes Gmail render every message of the open conversation before capture.
// Gmail only puts the text of expanded messages in the page; collapsed ones
// (and those behind the "N older messages" bar) appear as one-line headers
// until clicked. Runs only as part of the user's click on "Send to Claude".
import { findConversation } from "./extract.ts";
import { SELECTORS, isHidden, queryAllFirstMatching } from "./selectors.ts";

export interface ExpandResult {
  expandedBefore: number;
  expandedAfter: number;
  collapsedLeft: number;
}

// Gmail's handlers often listen for mousedown/mouseup rather than click, so
// send the whole sequence a real click produces.
function press(el: Element): void {
  const view = el.ownerDocument.defaultView ?? undefined;
  const opts = { bubbles: true, cancelable: true, composed: true, view, button: 0 };
  const Pointer = view?.PointerEvent ?? view?.MouseEvent;
  if (Pointer) el.dispatchEvent(new Pointer("pointerdown", opts));
  el.dispatchEvent(new (view?.MouseEvent ?? MouseEvent)("mousedown", opts));
  if (Pointer) el.dispatchEvent(new Pointer("pointerup", opts));
  el.dispatchEvent(new (view?.MouseEvent ?? MouseEvent)("mouseup", opts));
  el.dispatchEvent(new (view?.MouseEvent ?? MouseEvent)("click", opts));
}

function counts(doc: Document): { expanded: number; collapsed: Element[]; olderBar: Element | null; expandAll: Element | null } {
  const conv = findConversation(doc);
  if (!conv || conv === "ambiguous") return { expanded: 0, collapsed: [], olderBar: null, expandAll: null };
  const rows = queryAllFirstMatching(conv.root, SELECTORS.messageRow).filter((r) => !isHidden(r));
  const hasBody = (r: Element) => SELECTORS.body.some((s) => r.querySelector(s));
  // Ignore rows nested inside another row (some selectors match both levels).
  const top = rows.filter((r) => !rows.some((o) => o !== r && o.contains(r)));
  const older = conv.root.querySelector(SELECTORS.olderMessagesCount.join(","));
  const expandAll = SELECTORS.expandAll.map((s) => doc.querySelector(s)).find((e): e is Element => !!e && !isHidden(e)) ?? null;
  return {
    expanded: top.filter(hasBody).length,
    collapsed: top.filter((r) => !hasBody(r)),
    olderBar: older && !isHidden(older) ? (older.closest("[role='button']") ?? older.parentElement ?? older) : null,
    expandAll,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Waits until the number of rendered messages stops changing.
async function settle(doc: Document, deadline: number): Promise<void> {
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(150);
    const c = counts(doc);
    const signature = c.expanded * 1000 + c.collapsed.length;
    if (signature !== last) {
      last = signature;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 500) {
      return;
    }
  }
}

export async function expandConversation(doc: Document, timeoutMs = 6_000): Promise<ExpandResult> {
  const deadline = Date.now() + timeoutMs;
  const before = counts(doc);
  // Up to three rounds: the older-messages bar first reveals collapsed rows,
  // which then need expanding themselves.
  for (let round = 0; round < 3 && Date.now() < deadline; round++) {
    const c = counts(doc);
    if (!c.olderBar && c.collapsed.length === 0) break;
    if (c.olderBar) press(c.olderBar);
    else if (c.expandAll) press(c.expandAll);
    else for (const row of c.collapsed) press(row);
    await settle(doc, deadline);
  }
  const after = counts(doc);
  return { expandedBefore: before.expanded, expandedAfter: after.expanded, collapsedLeft: after.collapsed.length + (after.olderBar ? 1 : 0) };
}
