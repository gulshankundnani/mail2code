import { browser } from "wxt/browser";
import { API_MODELS, API_ORIGIN, isApiModel } from "../../src/api-models.ts";
import { TaskRepo } from "../../src/db/task-repo.ts";
import type { Destination } from "../../src/deeplink.ts";
import { onDeviceStatus, prepareOnDevice, summaryLanguage, testOnDevice, type OnDeviceStatus } from "../../src/on-device-ai.ts";
import {
  PERMISSION_MODES,
  SUMMARY_ENGINES,
  loadPreferences,
  modeSettingsSnippet,
  savePreferences,
  type PermissionMode,
  type Preferences,
  type SummaryEngine,
} from "../../src/preferences.ts";
import { $, el, errorText, setStatus } from "../../src/ui.ts";

const ON_DEVICE_TEXT: Record<OnDeviceStatus | "not-ready", string> = {
  unsupported: "On-device AI isn't available in this browser (it needs Chrome 138+ on supported hardware). The built-in analysis is used instead.",
  unavailable:
    "On-device AI isn't available on this computer. Chrome and Edge offer it only on supported hardware, and Edge may need it turned on first. The built-in analysis is used instead.",
  downloadable: "On-device AI can be used after a one-time model download (several GB; needs about 22 GB free disk space). Nothing downloads until you click Prepare.",
  downloading: "The on-device model is downloading…",
  available: "On-device AI is ready on this computer.",
  "not-ready":
    "Chrome has the on-device model but hasn't finished setting up summaries yet. Chrome does this by itself in the background; try again later or after restarting Chrome. The built-in analysis is used meanwhile.",
};

const LANGUAGE_NAMES = { en: "English", de: "German", es: "Spanish", fr: "French", ja: "Japanese" } as const;

// The browser's on-device status is asked once per page, not on every form
// change: each check can make the browser log a warning (Edge logs "service is
// not running" when its model isn't set up). Prepare and Test ask again.
let onDeviceShown: OnDeviceStatus | "not-ready" | null = null;

function showOnDevice(st: OnDeviceStatus | "not-ready") {
  onDeviceShown = st;
  const lang = LANGUAGE_NAMES[summaryLanguage(navigator.language)];
  const edgeHint =
    st === "unavailable" && navigator.userAgent.includes("Edg/")
      ? " In Edge, open edge://on-device-internals: Microsoft says the device performance class must be High or above (the model also needs a GPU with about 5.5 GB of memory and 20 GB of free disk space)."
      : "";
  $("on-device-status").textContent = st === "available" ? `${ON_DEVICE_TEXT[st]} Summaries are written in ${lang}.` : ON_DEVICE_TEXT[st] + edgeHint;
  $("prepare-on-device").hidden = st !== "downloadable";
  $("test-on-device").hidden = st !== "available" && st !== "not-ready";
}

function read(): Preferences {
  return {
    destination: $<HTMLSelectElement>("destination").value as Destination,
    cliFolder: $<HTMLInputElement>("cli-folder").value.trim(),
    sshHost: $<HTMLInputElement>("ssh-host").value.trim(),
    sshPort: $<HTMLInputElement>("ssh-port").value.trim(),
    sshFolder: $<HTMLInputElement>("ssh-folder").value.trim(),
    defaultMode: $<HTMLSelectElement>("default-mode").value as PermissionMode,
    summaryEngine: (document.querySelector<HTMLInputElement>("input[name=engine]:checked")?.value ?? "rules") as SummaryEngine,
    apiModel: isApiModel($<HTMLSelectElement>("api-model").value) ? ($<HTMLSelectElement>("api-model").value as Preferences["apiModel"]) : "claude-opus-5-5",
  };
}

function write(p: Preferences) {
  $<HTMLSelectElement>("destination").value = p.destination;
  $<HTMLInputElement>("cli-folder").value = p.cliFolder;
  $<HTMLInputElement>("ssh-host").value = p.sshHost;
  $<HTMLInputElement>("ssh-port").value = p.sshPort;
  $<HTMLInputElement>("ssh-folder").value = p.sshFolder;
  $<HTMLSelectElement>("default-mode").value = p.defaultMode;
  const engine = document.querySelector<HTMLInputElement>(`input[name=engine][value="${p.summaryEngine}"]`);
  if (engine) engine.checked = true;
  $<HTMLSelectElement>("api-model").value = p.apiModel;
}

async function refreshDynamic(repo: TaskRepo) {
  const p = read();
  $("mode-snippet").textContent = modeSettingsSnippet(p.defaultMode);
  $("on-device-box").hidden = p.summaryEngine !== "on-device";
  $("api-box").hidden = p.summaryEngine !== "claude-api";
  if (p.summaryEngine === "on-device") {
    showOnDevice(onDeviceShown ?? (await onDeviceStatus()));
  }
  if (p.summaryEngine === "claude-api") {
    const hasKey = !!(await repo.getApiKey());
    $("api-key-state").textContent = hasKey ? "A key is saved. Leave the field empty to keep it." : "No key saved yet.";
    const granted = await browser.permissions.contains({ origins: [API_ORIGIN] });
    $("api-permission-state").textContent = granted ? "Access to api.anthropic.com is allowed." : "Access to api.anthropic.com hasn't been allowed yet.";
    $<HTMLButtonElement>("grant-api").hidden = granted;
  }
}

export async function initSettings() {
  const repo = await TaskRepo.open();
  const modeSel = $<HTMLSelectElement>("default-mode");
  for (const m of PERMISSION_MODES) {
    const o = el("option", m.label);
    o.value = m.id;
    modeSel.append(o);
  }
  const engines = $("engines");
  for (const e of SUMMARY_ENGINES) {
    const label = el("label");
    const r = el("input");
    r.type = "radio";
    r.name = "engine";
    r.value = e.id;
    label.append(r, el("span", ` ${e.label}`));
    engines.append(label);
  }
  const modelSel = $<HTMLSelectElement>("api-model");
  for (const m of API_MODELS) {
    const o = el("option", m.label);
    o.value = m.id;
    modelSel.append(o);
  }

  write(await loadPreferences(browser.storage.local));
  await refreshDynamic(repo);
  const form = $<HTMLFormElement>("settings-form");
  form.addEventListener("change", () => void refreshDynamic(repo));
  // Loaded: the form was inert until now, so early clicks couldn't be overwritten by the saved values.
  form.inert = false;

  $("copy-snippet").addEventListener("click", async () => {
    await navigator.clipboard.writeText(modeSettingsSnippet(read().defaultMode));
    setStatus("Settings snippet copied. Paste it into Claude Code's settings.json.", "success", "settings-status");
  });

  $("prepare-on-device").addEventListener("click", async () => {
    $("on-device-status").textContent = "Preparing… this can take a while.";
    const st = await prepareOnDevice((f) => ($("on-device-status").textContent = `Downloading the on-device model… ${Math.round(f * 100)}%`));
    showOnDevice(st);
  });

  $("test-on-device").addEventListener("click", async () => {
    $("on-device-status").textContent = "Checking on-device AI…";
    if (await testOnDevice()) {
      showOnDevice("available");
      setStatus("On-device AI works on this computer.", "success", "settings-status");
    } else {
      const st = await onDeviceStatus();
      showOnDevice(st === "available" ? "not-ready" : st);
    }
  });

  // Must run in a click handler: browsers only show the permission prompt for a user gesture.
  $("grant-api").addEventListener("click", async () => {
    const granted = await browser.permissions.request({ origins: [API_ORIGIN] });
    setStatus(granted ? "Access to api.anthropic.com allowed." : "Access wasn't allowed. Claude API summaries stay off.", granted ? "success" : "error", "settings-status");
    await refreshDynamic(repo);
  });

  $("remove-key").addEventListener("click", async () => {
    await repo.setApiKey(null);
    // Also give back the network access.
    await browser.permissions.remove({ origins: [API_ORIGIN] }).catch(() => false);
    $<HTMLInputElement>("api-key").value = "";
    setStatus("API key removed and access to api.anthropic.com withdrawn.", "success", "settings-status");
    await refreshDynamic(repo);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    document.querySelectorAll(".field-error").forEach((n) => (n.textContent = ""));
    try {
      const p = read();
      const errors = await savePreferences(browser.storage.local, p);
      for (const [field, msg] of Object.entries(errors)) {
        const target = document.getElementById(`err-${field}`);
        if (target) target.textContent = msg ?? "";
      }
      if (Object.keys(errors).length) return setStatus("Some settings need fixing.", "error", "settings-status");
      const key = $<HTMLInputElement>("api-key").value.trim();
      if (key) {
        await repo.setApiKey(key);
        $<HTMLInputElement>("api-key").value = "";
      }
      let note = "";
      if (p.summaryEngine === "claude-api") {
        if (!(await repo.getApiKey())) note = " Add an API key to use Claude API summaries.";
        else if (!(await browser.permissions.contains({ origins: [API_ORIGIN] }))) note = ' Click "Allow access to api.anthropic.com" to finish.';
      }
      setStatus(`Settings saved.${note}`, note ? "info" : "success", "settings-status");
      await refreshDynamic(repo);
    } catch (err) {
      setStatus(`Couldn't save: ${errorText(err)}`, "error", "settings-status");
    }
  });
}
