import { cleanEmailBody } from "./clean.ts";

export interface AnalysisInputMessage {
  messageId: string;
  from: string;
  date: string;
  bodyText: string;
  attachments?: readonly string[];
}

export interface AnalysisItem {
  text: string;
  from: string; // sender display name
  date: string;
}

export interface EmailAnalysis {
  subject: string;
  messageCount: number;
  participants: string[];
  requests: AnalysisItem[];
  decisions: AnalysisItem[];
  deadlines: AnalysisItem[];
  questions: AnalysisItem[];
  links: string[];
  attachments: string[];
  latest: AnalysisItem | null; // cleaned text of the most recent message
  originalChars: number;
  cleanedChars: number;
}

const LIMITS = { requests: 8, decisions: 5, deadlines: 5, questions: 6, links: 8, attachments: 10, itemChars: 240 };

const REQUEST = /\b(please|pls|kindly|could you|can you|would you|need(s|ed)? to|must|should|have to|has to|make sure|ensure|required?|action items?|to-?do|let'?s|we need|i need|asap)\b/i;
const DECISION = /\b(decided|we agreed|agreed (to|on|that)|decision|going with|we'?ll go with|approved|confirmed|signed off|final answer)\b/i;
const DATE_WORD =
  /\b(today|tonight|tomorrow|eod|eow|end of (the )?(day|week|month|quarter)|next (week|month|monday|tuesday|wednesday|thursday|friday)|(mon|tues|wednes|thurs|fri|satur|sun)day|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(st|nd|rd|th)?|\d{1,2}(st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?|in \d+ (days?|weeks?))\b/i;
const DEADLINE_CUE = /\b(by|before|until|due|deadline|no later than|latest|ship|release|launch)\b/i;
const URL = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

function displayName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from);
  return (m?.[1] ?? from).trim() || "(unknown sender)";
}

function clip(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > LIMITS.itemChars ? `${t.slice(0, LIMITS.itemChars - 1).trimEnd()}…` : t;
}

// Bullet lines stay whole; other text is split into sentences.
function units(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    let prose = "";
    for (const line of lines) {
      if (BULLET.test(line)) {
        if (prose) out.push(...splitSentences(prose));
        prose = "";
        out.push(line.replace(BULLET, "").trim());
      } else {
        prose += ` ${line}`;
      }
    }
    if (prose.trim()) out.push(...splitSentences(prose));
  }
  return out.map((u) => u.trim()).filter((u) => u.length > 2);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim());
}

function pushUnique(list: AnalysisItem[], item: AnalysisItem, max: number) {
  const key = item.text.toLowerCase();
  if (list.length < max && !list.some((x) => x.text.toLowerCase() === key)) list.push(item);
}

// Rule-based analysis: deterministic, local and language-light (best for
// English). It finds candidates; it doesn't understand the email.
export function analyzeEmails(subject: string, messages: readonly AnalysisInputMessage[]): EmailAnalysis {
  const a: EmailAnalysis = {
    subject: subject.trim() || "(no subject)",
    messageCount: messages.length,
    participants: [],
    requests: [],
    decisions: [],
    deadlines: [],
    questions: [],
    links: [],
    attachments: [],
    latest: null,
    originalChars: 0,
    cleanedChars: 0,
  };
  // Newest first, so the most recent version of a requirement wins.
  const ordered = [...messages].reverse();
  for (const m of ordered) {
    const from = displayName(m.from);
    if (!a.participants.includes(from)) a.participants.push(from);
    const cleaned = cleanEmailBody(m.bodyText);
    a.originalChars += m.bodyText.length;
    a.cleanedChars += cleaned.length;
    if (!a.latest && cleaned) a.latest = { text: cleaned, from, date: m.date };
    for (const u of units(cleaned)) {
      const item = { text: clip(u), from, date: m.date };
      if (u.endsWith("?")) pushUnique(a.questions, item, LIMITS.questions);
      else if (DECISION.test(u)) pushUnique(a.decisions, item, LIMITS.decisions);
      else if (REQUEST.test(u)) pushUnique(a.requests, item, LIMITS.requests);
      if (DATE_WORD.test(u) && DEADLINE_CUE.test(u)) pushUnique(a.deadlines, item, LIMITS.deadlines);
    }
    for (const url of cleaned.match(URL) ?? []) {
      const u = url.replace(/[.,;:!?]+$/, "");
      if (!a.links.includes(u) && a.links.length < LIMITS.links) a.links.push(u);
    }
    for (const name of m.attachments ?? []) if (!a.attachments.includes(name) && a.attachments.length < LIMITS.attachments) a.attachments.push(name);
  }
  return a;
}
