// The preview card shown in Gmail after "Send to Claude". It analyses the
// captured emails locally, shows the compact prompt, and offers one click to
// open Claude Code on this computer with that prompt pre-filled.
//
// Security notes:
// - All email-derived text is inserted with textContent, never as HTML.
// - Only real (trusted) clicks act; synthetic clicks from page scripts are ignored.
// - Key events inside the card don't reach Gmail, so typing can't trigger
//   Gmail shortcuts, and Gmail can't read what's typed via its own listeners.
// - The deep link is built by buildClaudeLink, which validates and encodes
//   every parameter; email text can't add parameters.
// - The card never holds the API key; a Claude API summary is requested from
//   the background, which owns the key.
import { analyzeEmails, cleanEmailBody, composePrompt, type ComposedPrompt } from "@mail2code/analysis";
import type { CapturedConversation } from "@mail2code/protocol";
import { buildClaudeLink, CLI_PROMPT_LIMIT, LinkError, type BuiltLink, type Destination } from "../deeplink.ts";
import type { Reply, SummaryInput } from "../messages.ts";
import { environmentOf, type Preferences } from "../preferences.ts";
import { findSecrets, mergeFindings, redactSecrets } from "../secrets.ts";
import { icon, type IconName } from "../icons.ts";
import { applyStyles } from "../shadow-style.ts";
import { buildTaskLite } from "./task-lite.ts";

export const CARD_ATTR = "data-mail2code-card";

export interface CardDeps {
  preferences: Preferences;
  sendMessage(msg: unknown): Promise<Reply | undefined>;
  summarizeOnDevice(text: string): Promise<string | null>;
  copy(text: string): Promise<void>;
  // Expands the conversation again and reopens the card with a fresh capture.
  retry?: () => Promise<void>;
  requireTrustedEvents?: boolean;
}

export const CARD_CSS = `
:host { all: initial; }
.card {
  --bg: #ffffff; --fg: #1f1f1f; --muted: #5f6368; --line: #e3e3e3; --field: #f6f8fc; --field-line: #d3d7de;
  --accent: #b4532f; --accent-hover: #9c4526; --accent-fg: #ffffff; --tonal: #fbeee8;
  --ok: #146c2e; --ok-bg: #e6f4ea; --warn: #8a5300; --warn-bg: #fef4e0; --err: #b3261e; --focus: #0b57d0;
  position: fixed; top: 72px; right: 20px; z-index: 2147483000;
  width: min(460px, calc(100vw - 40px)); max-height: calc(100vh - 96px); max-height: calc(100dvh - 96px);
  display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 20px;
  box-shadow: 0 1px 3px rgba(60,64,67,.15), 0 12px 40px rgba(60,64,67,.22);
  font: 14px/1.45 "Google Sans Text", "Google Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
  animation: pop .18s cubic-bezier(.2,.8,.2,1);
}
@keyframes pop { from { opacity: 0; transform: translateY(-8px) scale(.98); } }
@keyframes rise { from { opacity: .4; transform: translateY(24px); } }
*, *::before, *::after { box-sizing: border-box; }
.head { display: flex; gap: 12px; align-items: flex-start; padding: 16px 12px 12px 18px; border-bottom: 1px solid var(--line); }
.mark { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--tonal); color: var(--accent); }
.titles { flex: 1; min-width: 0; }
h2 { font: 500 17px/1.3 "Google Sans", Roboto, system-ui, sans-serif; margin: 1px 0 2px; }
.sub { color: var(--muted); font-size: 12.5px; margin: 0; }
.body { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 14px 18px 16px; display: grid; gap: 14px; align-content: start; }
.foot { border-top: 1px solid var(--line); padding: 12px 18px 10px; display: grid; gap: 8px; background: var(--bg); }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.label, legend { display: block; font-weight: 500; font-size: 12px; letter-spacing: .01em; color: var(--muted); margin: 0 0 6px; padding: 0; }
.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 14px; background: var(--field); border: 1px solid var(--field-line); }
.seg label { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 1px; min-width: 0; min-height: 44px; padding: 6px 10px; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background .15s, color .15s, box-shadow .15s; }
.seg label .hint { font-size: 11.5px; font-weight: 400; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seg input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.seg label:hover { background: rgba(60,64,67,.06); }
.seg label:has(input:checked) { background: var(--bg); color: var(--accent); box-shadow: 0 1px 2px rgba(60,64,67,.2), 0 1px 3px rgba(60,64,67,.1); }
.seg label:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 1px; }
.chip { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0 0; padding: 7px 10px; border-radius: 10px; font-size: 12.5px; }
.chip.ok { background: var(--ok-bg); color: var(--ok); }
.chip.warn { background: var(--warn-bg); color: var(--warn); }
.chip > span { flex: 1 1 180px; }
.chip .icon { flex: none; }
.chip button { min-height: 30px; padding: 4px 12px; font-size: 12px; border-color: currentColor; color: inherit; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { min-width: 0; }
select, input[type=text], textarea {
  width: 100%; font: inherit; font-size: 13.5px; color: inherit; background: var(--field);
  border: 1px solid var(--field-line); border-radius: 10px; padding: 9px 11px; min-height: 40px;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
select { appearance: none; padding-right: 30px; cursor: pointer; text-overflow: ellipsis;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 17px) 52%, calc(100% - 12px) 52%; background-size: 5px 5px; background-repeat: no-repeat; }
textarea { display: block; resize: vertical; min-height: 64px; }
select:hover, input[type=text]:hover, textarea:hover { border-color: #aeb4bd; }
select:focus, input[type=text]:focus, textarea:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 3px rgba(11,87,208,.18); }
::placeholder { color: #80868b; }
.redact { display: flex; gap: 8px; align-items: center; font-weight: 500; cursor: pointer; }
.redact input { width: 16px; height: 16px; accent-color: var(--accent); margin: 0; }
details.preview { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
details.preview summary { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 12px; cursor: pointer; list-style: none; font-weight: 500; font-size: 13px; user-select: none; }
details.preview summary::-webkit-details-marker { display: none; }
details.preview summary .icon-chevron { flex: none; transition: transform .15s; color: var(--muted); }
details.preview[open] summary .icon-chevron { transform: rotate(90deg); }
details.preview summary .count { margin-left: auto; font-weight: 400; font-size: 12px; color: var(--muted); text-align: right; }
details.preview summary:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--field); border-top: 1px solid var(--line); padding: 10px 12px; max-height: 200px; overflow: auto; font: 12px/1.5 "Roboto Mono", ui-monospace, Consolas, monospace; }
pre:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.meta { color: var(--muted); font-size: 12px; margin: 0; }
.meta:empty, .err:empty, .status:empty { display: none; }
.warn { color: var(--warn); font-size: 12.5px; margin: 0; }
.err { color: var(--err); font-size: 12px; margin: 0; }
.status { color: var(--ok); font-size: 12.5px; font-weight: 500; margin: 0; }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
a.primary, button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: inherit; font-size: 13.5px; font-weight: 500;
  min-height: 40px; padding: 8px 16px; border-radius: 999px; cursor: pointer; text-decoration: none; border: 1px solid transparent;
  transition: background .15s, box-shadow .15s, transform .05s, border-color .15s, color .15s; -webkit-tap-highlight-color: transparent; }
a.primary, button.primary-btn { flex: 1 1 auto; background: var(--accent); color: var(--accent-fg); box-shadow: 0 1px 2px rgba(0,0,0,.15); border-color: transparent; }
a.primary:hover, button.primary-btn:hover { background: var(--accent-hover); box-shadow: 0 2px 8px rgba(0,0,0,.2); }
button.primary-btn[disabled] { opacity: .5; cursor: progress; }
a.primary:active, button:active { transform: scale(.98); }
a.primary[aria-disabled=true] { opacity: .45; pointer-events: none; box-shadow: none; }
button { background: transparent; color: var(--fg); border-color: var(--field-line); }
button:hover { background: rgba(60,64,67,.06); }
.nav { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; }
button.link { min-height: 32px; border: 0; padding: 4px 10px; color: var(--muted); font-size: 12.5px; }
button.link:hover { color: var(--fg); }
.close { flex: none; width: 36px; height: 36px; min-height: 36px; padding: 0; border: 0; border-radius: 50%; color: var(--muted); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (max-width: 600px) {
  .card { top: auto; right: 0; left: 0; bottom: 0; width: 100%; max-height: 90vh; max-height: 90dvh; border-radius: 22px 22px 0 0; border-bottom: 0;
    animation-name: rise; padding-bottom: env(safe-area-inset-bottom); }
  .head { position: relative; padding-top: 22px; }
  .head::before { content: ""; position: absolute; top: 8px; left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: 2px; background: var(--field-line); }
  .body { padding: 12px 16px 14px; }
  .foot { padding: 10px 16px 8px; }
  .grid { grid-template-columns: 1fr; }
  .actions a.primary, .actions button { min-height: 48px; }
  .actions a.primary { font-size: 15px; }
  details.preview summary { flex-wrap: wrap; }
  details.preview summary .count { flex-basis: 100%; text-align: left; margin-left: 24px; }
  select, input[type=text], textarea { font-size: 16px; }
}
@media (max-width: 360px) {
  .seg { grid-template-columns: 1fr; }
}
@media (prefers-color-scheme: dark) {
  .card {
    --bg: #1f1f1f; --fg: #e3e3e3; --muted: #a8abaf; --line: #3c4043; --field: #282a2c; --field-line: #4a4d51;
    --accent: #f0a585; --accent-hover: #f5b89e; --accent-fg: #3b1a0e; --tonal: #4a2a1d;
    --ok: #8fd6a0; --ok-bg: #1d3524; --warn: #f6c26b; --warn-bg: #3d2f12; --err: #f2b8b5; --focus: #a8c7fa;
    box-shadow: 0 12px 40px rgba(0,0,0,.5);
  }
  .seg label:hover, button:hover { background: rgba(255,255,255,.07); }
  select:hover, input[type=text]:hover, textarea:hover { border-color: #6b6f74; }
  select:focus, input[type=text]:focus, textarea:focus { box-shadow: 0 0 0 3px rgba(168,199,250,.25); }
  .seg label:has(input:checked) { background: #3a3c3f; box-shadow: none; }
}
@media (prefers-reduced-motion: reduce) {
  .card { animation: none; }
  * { transition: none !important; }
}`;

const DESTINATION_LABEL: Record<Destination, string> = {
  desktop: "Claude app (this computer)",
  "desktop-ssh": "Claude app over SSH",
  cli: "Claude Code in a terminal",
};

interface State {
  scope: "message" | "thread";
  destination: Destination;
  repositoryRef: string;
  instructions: string;
  redact: boolean;
  summary: string | null;
  summarySource: "on-device" | "claude-api" | null;
  summaryNote: string;
  prompt: ComposedPrompt | null;
  link: BuiltLink | null;
  linkError: string | null;
  opened: boolean;
}

export function openCard(doc: Document, original: CapturedConversation, deps: CardDeps): { close(): void; root: ShadowRoot } {
  doc.querySelectorAll(`[${CARD_ATTR}]`).forEach((n) => n.remove());
  const host = doc.createElement("div");
  host.setAttribute(CARD_ATTR, "");
  const root = host.attachShadow({ mode: "open" });
  applyStyles(doc, root, CARD_CSS);

  const latest = original.messages.at(-1)!;
  const prefs = deps.preferences;
  const s: State = {
    scope: original.messages.length > 1 ? "thread" : "message",
    destination: prefs.destination === "desktop-ssh" && !prefs.sshHost ? "desktop" : prefs.destination,
    repositoryRef: "",
    instructions: "",
    redact: true,
    summary: null,
    summarySource: null,
    summaryNote: "",
    prompt: null,
    link: null,
    linkError: null,
    opened: false,
  };
  const trusted = (e: Event) => deps.requireTrustedEvents === false || e.isTrusted;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
    const e = doc.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };

  const card = el("div", undefined, "card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", "ih-title");
  card.setAttribute("aria-describedby", "ih-sub");

  // Header: mark, title, close
  const head = el("header", undefined, "head");
  const mark = el("span", undefined, "mark");
  mark.append(icon(doc, "mail2code", 20));
  const titles = el("div", undefined, "titles");
  const title = el("h2", "Send to Claude");
  title.id = "ih-title";
  const sub = el("p", "Analysed on this computer. Nothing is sent until Claude opens and you press Enter there.", "sub");
  sub.id = "ih-sub";
  titles.append(title, sub);
  const closeBtn = el("button", undefined, "close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.append(icon(doc, "close", 18));
  head.append(mark, titles, closeBtn);

  // Scope: a two-option segmented control
  const scopeSet = el("fieldset");
  scopeSet.append(el("legend", "Include"));
  const seg = el("div", undefined, "seg");
  const mkRadio = (name: string, value: string, label: string, hint: string, checked: boolean) => {
    const l = el("label");
    const r = el("input");
    r.type = "radio";
    r.name = name;
    r.value = value;
    r.checked = checked;
    l.append(r, el("span", label), el("span", hint, "hint"));
    return l;
  };
  const n = original.messages.length;
  seg.append(
    mkRadio("ih-scope", "message", "Latest message", latest.from || "unknown sender", s.scope === "message"),
    mkRadio("ih-scope", "thread", "Whole conversation", `${n} message${n === 1 ? "" : "s"}`, s.scope === "thread"),
  );
  scopeSet.append(seg);
  if (original.collapsedCount > 0) {
    const warn = el("div", undefined, "chip warn");
    warn.append(icon(doc, "alert"), el("span", `${original.collapsedCount} message(s) are still collapsed in Gmail and aren't included.`));
    if (deps.retry) {
      const again = el("button", "Expand and try again");
      again.type = "button";
      again.id = "ih-retry";
      again.addEventListener("click", (e) => {
        if (!trusted(e)) return;
        host.remove();
        void deps.retry!();
      });
      warn.append(again);
    } else {
      warn.lastElementChild!.append(doc.createTextNode(" Expand them in Gmail, then click Send to Claude again."));
    }
    scopeSet.append(warn);
  } else if (n > 1) {
    const ok = el("div", undefined, "chip ok");
    ok.append(icon(doc, "check"), el("span", `All ${n} messages in this conversation were read.`));
    scopeSet.append(ok);
  }

  const field = (labelText: string, control: HTMLElement, id: string) => {
    const wrap = el("div", undefined, "field");
    const l = el("label", labelText, "label");
    l.htmlFor = id;
    control.id = id;
    wrap.append(l, control);
    return wrap;
  };

  // Destination and repository, side by side on wide screens
  const dest = el("select");
  for (const d of ["desktop", "desktop-ssh", "cli"] as Destination[]) {
    if (d === "desktop-ssh" && !prefs.sshHost) continue;
    const o = el("option", d === "desktop-ssh" ? `${DESTINATION_LABEL[d]} (${prefs.sshHost})` : DESTINATION_LABEL[d]);
    o.value = d;
    o.selected = d === s.destination;
    dest.append(o);
  }
  const repo = el("input");
  repo.type = "text";
  repo.maxLength = 500;
  repo.placeholder = "owner/name or GitHub URL";
  repo.autocomplete = "off";
  repo.spellcheck = false;
  const grid = el("div", undefined, "grid");
  grid.append(field("Open in", dest, "ih-dest"), field("Repository (optional)", repo, "ih-repo"));

  const instr = el("textarea");
  instr.rows = 2;
  instr.maxLength = 1_000;
  instr.placeholder = "e.g. Fix it on a new branch and add a test";
  const instrField = field("Instructions for Claude (optional)", instr, "ih-instr");

  const secretsBox = el("div");
  const findings = mergeFindings([findSecrets(original.subject), ...original.messages.map((m) => findSecrets(m.bodyText))]);
  if (findings.length) {
    const chip = el("div", undefined, "chip warn");
    chip.append(icon(doc, "alert"), el("span", `Possible credentials found (${findings.map((f) => f.label).join(", ")}).`));
    const l = el("label", undefined, "redact");
    const box = el("input");
    box.type = "checkbox";
    box.id = "ih-redact";
    box.checked = true;
    l.append(box, el("span", "Redact them"));
    chip.append(l);
    secretsBox.append(chip);
  }

  // Prompt preview, collapsible
  const preview = el("details", undefined, "preview");
  preview.open = true;
  const summaryEl = el("summary");
  const count = el("span", "", "count");
  summaryEl.append(icon(doc, "chevron"), el("span", "Prompt Claude will receive"), count);
  const pre = el("pre");
  pre.tabIndex = 0;
  pre.setAttribute("aria-label", "Prompt Claude will receive");
  preview.append(summaryEl, pre);
  const summaryNote = el("p", "", "meta");

  const linkNotes = el("p", "", "meta");

  const body = el("div", undefined, "body");
  body.append(scopeSet, grid, instrField, secretsBox, preview, summaryNote, linkNotes);
  if (!secretsBox.childElementCount) secretsBox.remove();

  // Footer: actions stay visible while the body scrolls
  const linkError = el("p", "", "err");
  const status = el("p", "", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const open = el("a", undefined, "primary");
  open.id = "ih-open";
  open.setAttribute("rel", "noopener noreferrer");
  const openLabel = el("span", "Open in Claude");
  open.append(icon(doc, "open"), openLabel);
  const iconButton = (text: string, name: IconName, cls?: string) => {
    const b = el("button", undefined, cls);
    b.type = "button";
    b.append(icon(doc, name), el("span", text));
    return b;
  };
  const copyBtn = iconButton("Copy prompt", "copy");
  const moreBtn = iconButton("More options…", "expand", "link");
  const actions = el("div", undefined, "actions");
  actions.append(open, copyBtn);
  const tasksBtn = iconButton("Task dashboard", "list", "link");
  const settingsBtn = iconButton("Settings", "sliders", "link");
  const nav = el("nav", undefined, "nav");
  nav.setAttribute("aria-label", "Mail2Code");
  nav.append(moreBtn, tasksBtn, settingsBtn);
  const foot = el("footer", undefined, "foot");
  foot.append(actions, linkError, status, nav);

  card.append(head, body, foot);
  root.append(card);
  doc.body.append(host);

  // Work on a redacted copy unless the user opted out.
  const working = (): CapturedConversation =>
    s.redact ? { ...original, subject: redactSecrets(original.subject), messages: original.messages.map((m) => ({ ...m, bodyText: redactSecrets(m.bodyText) })) } : original;
  const selected = (d: CapturedConversation) => (s.scope === "thread" ? d.messages : d.messages.filter((m) => m.messageId === latest.messageId));

  function recompute() {
    const d = working();
    const msgs = selected(d);
    const analysis = analyzeEmails(d.subject, msgs);
    s.prompt = composePrompt(analysis, {
      title: d.subject,
      instructions: s.instructions,
      repositoryRef: s.repositoryRef,
      threadUrl: d.threadUrl,
      summary: s.summary,
      summarySource: s.summarySource,
    });
    try {
      s.link = buildClaudeLink(s.prompt.text, { ...environmentOf(prefs), destination: s.destination }, s.repositoryRef);
      s.linkError = null;
    } catch (err) {
      s.link = null;
      s.linkError = err instanceof LinkError ? err.message : "Couldn't build the link.";
    }
    pre.textContent = s.prompt.text;
    count.textContent = `${s.prompt.text.length.toLocaleString()} / ${CLI_PROMPT_LIMIT.toLocaleString()} chars${s.prompt.truncated ? " · shortened" : ""} · ${analysis.messageCount} message${analysis.messageCount === 1 ? "" : "s"}`;
    summaryNote.textContent = s.summaryNote;
    if (s.link) {
      open.href = s.link.url;
      open.removeAttribute("aria-disabled");
      openLabel.textContent = `Open in ${s.link.label}`;
      linkError.textContent = "";
      linkNotes.textContent = `${s.link.notes.join(" ")} Your browser may ask before opening the app the first time.`;
    } else {
      open.removeAttribute("href");
      open.setAttribute("aria-disabled", "true");
      linkNotes.textContent = "";
      linkError.textContent = `${s.linkError ?? ""} Fix this in the extension's Settings.`;
    }
  }

  async function loadSummary() {
    const engine = prefs.summaryEngine;
    if (engine === "rules") return;
    const msgs = selected(working()).map((m) => ({ from: m.from, date: m.date, text: cleanEmailBody(m.bodyText) }));
    s.summary = null;
    s.summarySource = null;
    s.summaryNote = engine === "on-device" ? "Summarising on this computer…" : "Summarising with the Claude API…";
    recompute();
    if (engine === "on-device") {
      const text = await deps.summarizeOnDevice(msgs.map((m) => `${m.from}: ${m.text}`).join("\n\n"));
      s.summary = text;
      s.summarySource = text ? "on-device" : null;
      s.summaryNote = text ? "Includes an on-device AI summary." : "On-device AI isn't set up in this browser, so the built-in analysis was used (the prompt is complete). To stop this note, choose Built-in analysis in Settings.";
    } else {
      const input: SummaryInput = { subject: working().subject, messages: msgs };
      const reply = (await deps.sendMessage({ kind: "summarize", input })) as Reply<{ summary: string } | null> | undefined;
      if (reply?.ok && reply.value) {
        s.summary = reply.value.summary;
        s.summarySource = "claude-api";
        s.summaryNote = "Includes a Claude API summary.";
      } else {
        s.summaryNote = reply && !reply.ok ? `Claude API summary unavailable: ${reply.error}` : "";
      }
    }
    recompute();
  }

  function close() {
    host.remove();
  }

  // Keep keystrokes inside the card (Gmail shortcuts listen on the document).
  for (const type of ["keydown", "keypress", "keyup"] as const) {
    card.addEventListener(type, (e) => {
      if (type === "keydown" && (e as KeyboardEvent).key === "Escape") close();
      e.stopPropagation();
    });
  }
  closeBtn.addEventListener("click", close);
  scopeSet.addEventListener("change", (e) => {
    s.scope = ((e.target as HTMLInputElement).value as State["scope"]) ?? s.scope;
    void loadSummary();
    recompute();
  });
  dest.addEventListener("change", () => {
    s.destination = dest.value as Destination;
    recompute();
  });
  repo.addEventListener("input", () => {
    s.repositoryRef = repo.value;
    recompute();
  });
  instr.addEventListener("input", () => {
    s.instructions = instr.value;
    recompute();
  });
  root.getElementById("ih-redact")?.addEventListener("change", (e) => {
    s.redact = (e.target as HTMLInputElement).checked;
    void loadSummary();
    recompute();
  });
  open.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!trusted(e) || !s.link) {
      e.preventDefault();
      return;
    }
    // The browser handles the claude:// link (default action). Record the task alongside.
    const d = working();
    void buildTaskLite(d, {
      scope: s.scope,
      messageIds: selected(d).map((m) => m.messageId),
      title: d.subject,
      repositoryRef: s.repositoryRef,
      instructions: s.instructions,
    })
      .then((task) => deps.sendMessage({ kind: "task.record", task, destination: s.destination }))
      .then((reply) => {
        status.textContent = reply?.ok
          ? "Opening Claude… Review the prompt there and press Enter. The task is saved in your task list."
          : "Opening Claude… (The task couldn't be saved in your task list.)";
      });
    s.opened = true;
  });
  copyBtn.addEventListener("click", async (e) => {
    if (!trusted(e) || !s.prompt) return;
    await deps.copy(s.prompt.text);
    status.textContent = "Prompt copied.";
  });
  moreBtn.addEventListener("click", async (e) => {
    if (!trusted(e)) return;
    await deps.sendMessage({ kind: "capture", conversation: original });
    close();
  });

  const openPage = (page: "tasks" | "settings") => async (e: Event) => {
    if (!trusted(e)) return;
    await deps.sendMessage({ kind: "open.page", page });
  };
  tasksBtn.addEventListener("click", openPage("tasks"));
  settingsBtn.addEventListener("click", openPage("settings"));

  recompute();
  void loadSummary();
  open.focus();
  return { close, root };
}
