// Small line icons for the Gmail button and card. Built with createElementNS
// (never innerHTML), and hidden from screen readers: every control that shows
// an icon also has a text label.
const PATHS = {
  // Envelope with code brackets: the Mail2Code mark.
  mail2code: ["M13 13H3.5A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3h13A1.5 1.5 0 0 1 18 4.5V10", "M2.5 4l7.5 5.5L17.5 4", "M16.5 14l-3 3 3 3", "M19.5 14l3 3-3 3"],
  open: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  expand: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
  list: ["M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6h.01", "M4.5 12h.01", "M4.5 18h.01"],
  sliders: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  alert: ["M12 3.5l9 16H3z", "M12 10v4", "M12 17h.01"],
  chevron: ["M9 6l6 6-6 6"],
} as const;

export type IconName = keyof typeof PATHS;

const SVG_NS = "http://www.w3.org/2000/svg";

export function icon(doc: Document, name: IconName, size = 16): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `icon icon-${name}`);
  for (const d of PATHS[name]) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
