// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOST_ATTR, mountButtonController, type ButtonController } from "../src/button.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "fixtures", "synthetic-gmail");

function loadInto(name: string) {
  const parsed = new DOMParser().parseFromString(readFileSync(join(FIXTURES, name), "utf8"), "text/html");
  document.body.replaceChildren(...Array.from(parsed.body.childNodes).map((n) => document.importNode(n, true)));
}

const hosts = () => document.querySelectorAll(`[${HOST_ATTR}]`);
const buttonOf = (host: Element) => host.shadowRoot!.querySelector("button")!;
let controller: ButtonController | undefined;

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  document.body.replaceChildren();
});

describe("button controller", () => {
  it("adds exactly one accessible button next to the subject", () => {
    loadInto("single-message.html");
    controller = mountButtonController(document, async () => {});
    expect(hosts()).toHaveLength(1);
    const host = hosts()[0]!;
    expect(host.previousElementSibling?.tagName).toBe("H2");
    const button = buttonOf(host);
    expect(button.type).toBe("button");
    expect(button.textContent).toBe("Send to Claude");
    expect(button.getAttribute("aria-label")).toMatch(/nothing is sent until you confirm/);
    expect(host.shadowRoot!.querySelector("[role=status]")?.getAttribute("aria-live")).toBe("polite");
  });

  it("does not duplicate the button on repeated refreshes or DOM churn", async () => {
    loadInto("single-message.html");
    controller = mountButtonController(document, async () => {}, { debounceMs: 5 });
    for (let i = 0; i < 5; i++) {
      document.body.append(document.createElement("div"));
      controller.refresh();
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(hosts()).toHaveLength(1);
  });

  it("shows no button on the inbox list or when the conversation is ambiguous", () => {
    loadInto("inbox.html");
    controller = mountButtonController(document, async () => {});
    expect(hosts()).toHaveLength(0);
    controller.destroy();
    loadInto("two-conversations.html");
    controller = mountButtonController(document, async () => {});
    expect(hosts()).toHaveLength(0);
  });

  it("follows client-side navigation without a reload", async () => {
    loadInto("inbox.html");
    controller = mountButtonController(document, async () => {}, { debounceMs: 5 });
    expect(hosts()).toHaveLength(0);
    const tpl = document.getElementById("conversation") as HTMLTemplateElement;
    document.getElementById("app")!.replaceChildren(tpl.content.cloneNode(true));
    await vi.waitFor(() => expect(hosts()).toHaveLength(1));
    document.getElementById("app")!.replaceChildren();
    await vi.waitFor(() => expect(hosts()).toHaveLength(0));
  });

  it("ignores synthetic (script-generated) clicks", async () => {
    loadInto("single-message.html");
    const onActivate = vi.fn(async () => {});
    controller = mountButtonController(document, onActivate);
    buttonOf(hosts()[0]!).click(); // isTrusted === false
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("disables the button while a capture runs and reports errors", async () => {
    loadInto("single-message.html");
    let release!: () => void;
    controller = mountButtonController(
      document,
      () =>
        new Promise<void>((_, reject) => {
          release = () => reject(new Error("bridge failed"));
        }),
      { requireTrustedEvents: false },
    );
    const host = hosts()[0]!;
    const button = buttonOf(host);
    button.click();
    expect(button.disabled).toBe(true);
    button.click(); // ignored while busy
    release();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    const status = host.shadowRoot!.querySelector("[role=status]") as HTMLElement;
    expect(status.textContent).toBe("bridge failed");
    expect(status.dataset.tone).toBe("error");
  });

  it("removes everything on destroy", () => {
    loadInto("single-message.html");
    controller = mountButtonController(document, async () => {});
    controller.destroy();
    controller = undefined;
    expect(hosts()).toHaveLength(0);
  });
});
