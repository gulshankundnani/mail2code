import { browser } from "wxt/browser";
import { PAGE_PATHS } from "../../src/pages.ts";

for (const [id, page] of [["open-tasks", "tasks"], ["open-settings", "settings"]] as const) {
  document.getElementById(id)?.addEventListener("click", async () => {
    await browser.tabs.create({ url: browser.runtime.getURL(PAGE_PATHS[page]) });
    window.close();
  });
}
