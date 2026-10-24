const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "SVG", "HEAD"]);
// Boundaries that start a new line.
const BLOCK = new Set(["DIV", "LI", "UL", "OL", "TR", "TABLE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "PRE", "HR"]);
// Boundaries that start a new paragraph (blank line).
const PARAGRAPH = new Set(["P", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"]);

function inlineHidden(el: Element): boolean {
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
  const style = (el as HTMLElement).style;
  return !!style && (style.display === "none" || style.visibility === "hidden");
}

// Converts a rendered email body to plain text. Produces text only — never
// HTML — so nothing from the email can execute in the review page. Inline-hidden
// content is dropped so the payload matches what the user can see in Gmail.
export function elementToText(root: Element): string {
  let out = "";
  // Collapse adjacent boundaries: a run of nested blocks yields one break, not many.
  const breakTo = (newlines: 1 | 2) => {
    if (out === "") return;
    const trailing = /\n*$/.exec(out)![0].length;
    if (trailing < newlines) out += "\n".repeat(newlines - trailing);
  };
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? "").replace(/\s+/g, " ");
      // Drop whitespace-only text at line starts (indentation between tags).
      if (text.trim() !== "" || (out !== "" && !out.endsWith("\n"))) out += text;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag) || inlineHidden(el)) return;
    if (tag === "BR") {
      out += "\n";
      return;
    }
    const boundary = PARAGRAPH.has(tag) ? 2 : BLOCK.has(tag) ? 1 : 0;
    if (boundary) breakTo(boundary);
    for (const child of Array.from(el.childNodes)) walk(child);
    if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      const text = (el.textContent ?? "").trim();
      if (/^https?:\/\//i.test(href) && href !== text) out += ` <${href}>`;
    }
    if (boundary) breakTo(boundary);
  };
  walk(root);
  return out
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
