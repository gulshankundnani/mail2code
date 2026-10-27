// Constructable stylesheets are not subject to the page's style-src policy,
// unlike an inline <style>, so our UI stays styled under a strict Gmail CSP.
// Falls back to <style> where adopting a sheet isn't possible (older engines,
// or Firefox content-script wrappers).
export function applyStyles(doc: Document, shadow: ShadowRoot, css: string): void {
  try {
    const Sheet = doc.defaultView?.CSSStyleSheet;
    if (!Sheet) throw new Error("no CSSStyleSheet");
    const sheet = new Sheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = doc.createElement("style");
    style.textContent = css;
    shadow.append(style);
  }
}
