// Reduces an email body to the part the sender actually wrote: drops quoted
// earlier messages, signatures and legal disclaimers. Forwarded content is
// kept, because a forwarded email is usually the task itself.

// Lines that start a quoted earlier message. Everything from here down is cut.
const QUOTE_START: readonly RegExp[] = [
  /^On .{3,300}wrote:\s*$/, // Gmail / Apple Mail: "On Tue, Oct 1, 2026 at 10:00 AM Ada <ada@x> wrote:"
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i, // Outlook (older)
  /^_{5,}\s*$/, // Outlook separator line
  /^From:\s.+$/, // Outlook header block (checked with the next line, see below)
  /^Le .{3,300}a écrit\s*:\s*$/, // French
  /^Am .{3,300}schrieb .{1,200}:\s*$/, // German
  /^El .{3,300}escribió:\s*$/, // Spanish
];

const SIGNATURE_START: readonly RegExp[] = [
  /^--\s*$/, // RFC 3676 signature delimiter
  /^(Sent from my|Get Outlook for|Sent from Outlook|Sent via )/i,
];

const DISCLAIMER = /(confidential|privileged|intended (solely )?for the (use of the )?(named )?(addressee|recipient))/i;
const DISCLAIMER_CONFIRM = /(intended recipient|disclos|notify the sender|delete (this|the) (e-?mail|message)|unauthori[sz]ed)/i;

export function cleanEmailBody(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^-{3,}\s*Forwarded message\s*-{3,}/i.test(line)) {
      kept.push(line);
      continue;
    }
    const isOutlookHeader = /^From:\s/.test(line) && /^(Sent|Date):\s/i.test((lines[i + 1] ?? "").trim());
    const isQuote = QUOTE_START.some((re) => re !== QUOTE_START[3] && re.test(line)) || isOutlookHeader;
    if (isQuote || SIGNATURE_START.some((re) => re.test(line))) break;
    if (line.startsWith(">")) continue;
    kept.push(line);
  }
  // Drop disclaimer paragraphs.
  const paragraphs = kept.join("\n").split(/\n{2,}/);
  const body2 = paragraphs.filter((p) => !(DISCLAIMER.test(p) && DISCLAIMER_CONFIRM.test(p))).join("\n\n");
  return body2.replace(/\n{3,}/g, "\n\n").trim();
}
