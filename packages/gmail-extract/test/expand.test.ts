// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { expandConversation, extractConversation } from "../src/index.ts";

const URL_ = "https://mail.google.com/mail/u/0/#inbox/FMfcgzSyntheticThread0001";

// A Gmail-like conversation: rows render their text only after mousedown,
// and an "older messages" bar reveals more collapsed rows.
function setup(opts: { withExpandAll?: boolean; ignoreMousedown?: boolean } = {}) {
  document.body.innerHTML = `
    <div role="main">
      ${opts.withExpandAll ? '<div role="button" aria-label="Expand all" id="expand-all"></div>' : ""}
      <h2 class="hP" data-thread-perm-id="thread-f:9">Thread</h2>
      <div role="list" id="list">
        <div role="button" id="older"><span class="adx">1</span> older message</div>
        <div role="listitem" data-message-id="#m2"><span class="gD" email="b@example.test" name="B">B</span></div>
        <div role="listitem" data-message-id="#m3"><span class="gD" email="c@example.test" name="C">C</span><div class="a3s">third</div></div>
      </div>
    </div>`;
  const pressed: string[] = [];
  const addBody = (row: Element) => {
    if (row.querySelector(".a3s")) return;
    setTimeout(() => {
      const d = document.createElement("div");
      d.className = "a3s";
      d.textContent = `text of ${row.getAttribute("data-message-id")}`;
      row.append(d);
    }, 30);
  };
  document.getElementById("list")!.addEventListener("mousedown", (e) => {
    if (opts.ignoreMousedown) return;
    const t = e.target as Element;
    if (t.closest("#older")) {
      pressed.push("older");
      setTimeout(() => {
        const row = document.createElement("div");
        row.setAttribute("role", "listitem");
        row.setAttribute("data-message-id", "#m1");
        row.innerHTML = '<span class="gD" email="a@example.test" name="A">A</span>';
        t.closest("#older")!.replaceWith(row);
      }, 30);
      return;
    }
    const row = t.closest("[role='listitem']");
    if (row) {
      pressed.push(row.getAttribute("data-message-id")!);
      addBody(row);
    }
  });
  document.getElementById("expand-all")?.addEventListener("mousedown", () => {
    pressed.push("expand-all");
    document.querySelectorAll("[role='listitem']").forEach(addBody);
  });
  return pressed;
}

afterEach(() => document.body.replaceChildren());

describe("expandConversation", () => {
  it("reveals older messages, expands collapsed rows, and then everything is captured", async () => {
    setup();
    const before = extractConversation(document, URL_);
    expect(before.ok && before.value.messages.length).toBe(1);
    expect(before.ok && before.value.collapsedCount).toBe(2); // 1 behind the bar + 1 collapsed row

    const result = await expandConversation(document, 3_000);
    expect(result).toMatchObject({ expandedBefore: 1, expandedAfter: 3, collapsedLeft: 0 });

    const after = extractConversation(document, URL_);
    expect(after.ok && after.value.messages.map((m) => m.messageId)).toEqual(["m1", "m2", "m3"]);
    expect(after.ok && after.value.collapsedCount).toBe(0);
  });

  it("uses Gmail's Expand all control when there is no older-messages bar", async () => {
    const pressed = setup({ withExpandAll: true });
    document.getElementById("older")!.remove();
    await expandConversation(document, 3_000);
    expect(pressed).toContain("expand-all");
    const after = extractConversation(document, URL_);
    expect(after.ok && after.value.collapsedCount).toBe(0);
  });

  it("reports what's still collapsed when Gmail doesn't respond, instead of hanging", async () => {
    setup({ ignoreMousedown: true });
    const start = Date.now();
    const result = await expandConversation(document, 1_500);
    expect(Date.now() - start).toBeLessThan(3_000);
    expect(result.collapsedLeft).toBeGreaterThan(0);
  });

  it("does nothing when the conversation is already fully expanded", async () => {
    const pressed = setup();
    document.getElementById("older")!.remove();
    document.querySelector("[data-message-id='#m2']")!.insertAdjacentHTML("beforeend", '<div class="a3s">second</div>');
    const result = await expandConversation(document, 1_000);
    expect(pressed).toEqual([]);
    expect(result).toMatchObject({ expandedBefore: 2, expandedAfter: 2, collapsedLeft: 0 });
  });
});
