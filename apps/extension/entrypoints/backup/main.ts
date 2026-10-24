import {
  BackupError,
  MAX_BACKUP_BYTES,
  PassphraseError,
  decryptText,
  encryptText,
  parseBackupText,
  previewImport,
  selectImport,
  validateExport,
  type ConflictResolution,
  type ExportFile,
  type ImportPreview,
  type ImportStrategy,
} from "@inbox-handoff/backup";
import { STATUS_LABELS } from "@inbox-handoff/task-core";
import { browser } from "wxt/browser";
import { buildExportFile, toExportData, toImportOperation } from "../../src/backup/mapping.ts";
import type { TaskRecord } from "../../src/db/schema.ts";
import { TaskRepo } from "../../src/db/task-repo.ts";
import { $, el, errorText, setStatus } from "../../src/ui.ts";

let repo: TaskRepo;
let tasks: TaskRecord[] = [];
let pendingEncrypted: Extract<ReturnType<typeof parseBackupText>, { kind: "encrypted" }>["file"] | null = null;
let validated: { file: ExportFile; warnings: string[] } | null = null;
let preview: ImportPreview | null = null;

const KIND_TEXT = { new: "new", identical: "already here (skipped)", conflict: "different version here", "duplicate-key": "same handoff as a task here (skipped)" } as const;

function checked(id: string): boolean {
  return $<HTMLInputElement>(id).checked;
}

// ---- export ------------------------------------------------------------------

function renderExportOptions() {
  const selected = (document.querySelector<HTMLInputElement>("input[name=which]:checked")?.value ?? "all") === "selected";
  $("task-picker").hidden = !selected;
  $("passphrase-fields").hidden = !checked("encrypt");
  $("plain-email-warning").hidden = !(checked("include-email") && !checked("encrypt"));
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = el("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function doExport() {
  const selected = (document.querySelector<HTMLInputElement>("input[name=which]:checked")?.value ?? "all") === "selected";
  const ids = selected ? new Set(Array.from(document.querySelectorAll<HTMLInputElement>("input[name=pick]:checked"), (i) => i.value)) : undefined;
  if (ids && ids.size === 0) return setStatus("Choose at least one task to export.", "error");
  const includeEmail = checked("include-email");
  const encrypt = checked("encrypt");
  if (includeEmail && !encrypt && !checked("ack-plain")) return setStatus("Confirm that the file will contain readable email text, or turn on encryption.", "error");
  if (encrypt && $<HTMLInputElement>("passphrase").value !== $<HTMLInputElement>("passphrase2").value) return setStatus("The passphrases don't match.", "error");

  const button = $<HTMLButtonElement>("export");
  button.disabled = true;
  try {
    const data = toExportData(await repo.dump(), { includeEmailContent: includeEmail, ...(ids ? { taskIds: ids } : {}) });
    const file = await buildExportFile(data);
    const json = JSON.stringify(file, null, 2);
    const date = file.exportedAt.slice(0, 10);
    if (encrypt) {
      setStatus("Encrypting…");
      const enc = await encryptText(json, $<HTMLInputElement>("passphrase").value);
      download(`inbox-handoff-backup-${date}-encrypted.json`, JSON.stringify(enc));
    } else {
      download(`inbox-handoff-backup-${date}.json`, json);
    }
    $<HTMLInputElement>("passphrase").value = "";
    $<HTMLInputElement>("passphrase2").value = "";
    setStatus(
      `Backup downloaded: ${data.tasks.length} task${data.tasks.length === 1 ? "" : "s"}${file.includesEmailContent ? ", with email text" : ", without email text"}${encrypt ? ", encrypted" : ""}.`,
      "success",
    );
  } catch (err) {
    setStatus(err instanceof PassphraseError ? err.message : `Export failed: ${errorText(err)}`, "error");
  } finally {
    button.disabled = false;
  }
}

// ---- import ------------------------------------------------------------------

function resetImport() {
  pendingEncrypted = null;
  validated = null;
  preview = null;
  $("decrypt-fields").hidden = true;
  $("preview").hidden = true;
  $("report").hidden = true;
}

async function showPreview(raw: Record<string, unknown>) {
  validated = await validateExport(raw);
  const existing = toExportData(await repo.dump(), { includeEmailContent: false });
  preview = previewImport(validated.file, existing);
  const c = preview.counts;
  $("preview-summary").textContent =
    `Exported ${new Date(preview.exportedAt).toLocaleString()} · ${c.total} task(s), ${c.plans} plan version(s), ${c.decisions} decision(s), ${c.events} history entr${c.events === 1 ? "y" : "ies"} · ` +
    (preview.includesEmailContent ? "includes email text" : "no email text");
  $("preview-warnings").replaceChildren(...validated.warnings.map((w) => el("li", w)));
  $("preview-tasks").replaceChildren(
    ...preview.tasks.map((t) => {
      const li = el("li", `${t.title} — ${STATUS_LABELS[t.status]} — `);
      li.append(el("strong", KIND_TEXT[t.kind]));
      li.dataset.kind = t.kind;
      return li;
    }),
  );
  const restore = document.querySelector<HTMLInputElement>("input[name=strategy][value=restore]")!;
  restore.disabled = preview.existingTaskCount > 0;
  const def = preview.existingTaskCount === 0 ? "restore" : "merge";
  document.querySelector<HTMLInputElement>(`input[name=strategy][value=${def}]`)!.checked = true;
  $("replace-count").textContent = String(preview.existingTaskCount);
  $("preview").hidden = false;
  renderEffect();
}

function currentChoice(): { strategy: ImportStrategy; resolution: ConflictResolution } {
  return {
    strategy: (document.querySelector<HTMLInputElement>("input[name=strategy]:checked")?.value ?? "merge") as ImportStrategy,
    resolution: (document.querySelector<HTMLInputElement>("input[name=resolution]:checked")?.value ?? "keep-existing") as ConflictResolution,
  };
}

function renderEffect() {
  if (!preview) return;
  const { strategy, resolution } = currentChoice();
  $("conflict-options").hidden = !(strategy === "merge" && preview.counts.conflict > 0);
  $("replace-confirm").hidden = strategy !== "replace";
  try {
    const sel = selectImport(preview, strategy, resolution);
    const parts = [`add or update ${sel.writeTaskIds.length} task(s)`];
    if (sel.deleteTaskIds.length) parts.push(`replace ${sel.deleteTaskIds.length} existing task(s)`);
    if (sel.replaceAll) parts.push(`first delete all ${preview.existingTaskCount} task(s) here`);
    if (sel.skipped.length) parts.push(`skip ${sel.skipped.length}`);
    $("effect").textContent = `This will ${parts.join(", ")}.`;
    const confirmed = strategy !== "replace" || $<HTMLInputElement>("replace-word").value === "REPLACE";
    const changesSomething = sel.replaceAll || sel.writeTaskIds.length + sel.deleteTaskIds.length > 0;
    $<HTMLButtonElement>("import").disabled = !confirmed || !changesSomething;
  } catch (err) {
    $("effect").textContent = errorText(err);
    $<HTMLButtonElement>("import").disabled = true;
  }
}

async function readFile() {
  resetImport();
  const f = $<HTMLInputElement>("file").files?.[0];
  if (!f) return;
  if (f.size > MAX_BACKUP_BYTES) return setStatus("This file is larger than 50 MB, the maximum for a backup.", "error");
  try {
    const parsed = parseBackupText(await f.text());
    if (parsed.kind === "encrypted") {
      pendingEncrypted = parsed.file;
      $("decrypt-fields").hidden = false;
      $("import-passphrase").focus();
      return setStatus("This backup is encrypted. Enter its passphrase.");
    }
    await showPreview(parsed.raw);
    setStatus("Backup checked. Review it below, then choose how to import it.");
  } catch (err) {
    setStatus(err instanceof BackupError ? err.message : `Couldn't read the file: ${errorText(err)}`, "error");
  }
}

async function decrypt() {
  if (!pendingEncrypted) return;
  const button = $<HTMLButtonElement>("decrypt");
  button.disabled = true;
  try {
    setStatus("Decrypting…");
    // The decrypted text stays in memory only; nothing is written to disk.
    const parsed = parseBackupText(await decryptText(pendingEncrypted, $<HTMLInputElement>("import-passphrase").value));
    $<HTMLInputElement>("import-passphrase").value = "";
    if (parsed.kind !== "plain") throw new BackupError("not_a_backup", "The decrypted content isn't an Inbox Handoff backup.");
    await showPreview(parsed.raw);
    $("decrypt-fields").hidden = true;
    setStatus("Backup decrypted and checked. Review it below, then choose how to import it.");
  } catch (err) {
    setStatus(err instanceof PassphraseError || err instanceof BackupError ? err.message : `Couldn't decrypt: ${errorText(err)}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function doImport() {
  if (!validated || !preview) return;
  const { strategy, resolution } = currentChoice();
  const button = $<HTMLButtonElement>("import");
  button.disabled = true;
  try {
    const sel = selectImport(preview, strategy, resolution);
    const op = toImportOperation(validated.file, sel, Date.now());
    await repo.applyImport(op);
    const blocked = op.tasks.filter((t) => t.blockReason === "imported_requires_review").length;
    $("report-list").replaceChildren(
      el("li", `Imported ${op.tasks.length} task(s)${sel.replaceAll ? " after deleting the previous tasks" : ""}.`),
      ...(blocked ? [el("li", `${blocked} task(s) were approved or in progress and are now blocked for review.`)] : []),
      ...sel.skipped.map((s) => el("li", `Skipped "${s.title}": ${s.reason}.`)),
      ...(sel.applySettings ? [el("li", "Applied the backup's email-retention setting.")] : []),
    );
    $("preview").hidden = true;
    $("report").hidden = false;
    setStatus("Import finished.", "success");
    tasks = await repo.listTasks();
    renderPicker();
  } catch (err) {
    setStatus(`Import failed. Nothing was changed. ${errorText(err)}`, "error");
    button.disabled = false;
  }
}

function renderPicker() {
  $("task-total").textContent = String(tasks.length);
  $("task-picker").replaceChildren(
    ...tasks.map((t) => {
      const li = el("li");
      const label = el("label");
      const box = el("input");
      box.type = "checkbox";
      box.name = "pick";
      box.value = t.id;
      label.append(box, el("span", `${t.title} — ${STATUS_LABELS[t.status]}`));
      li.append(label);
      return li;
    }),
  );
}

async function init() {
  $<HTMLAnchorElement>("all-tasks").href = browser.runtime.getURL("/options.html");
  repo = await TaskRepo.open();
  await repo.purgeExpired();
  tasks = await repo.listTasks();
  renderPicker();
  for (const id of ["include-email", "encrypt"]) $(id).addEventListener("change", renderExportOptions);
  document.querySelectorAll("input[name=which]").forEach((r) => r.addEventListener("change", renderExportOptions));
  $("export").addEventListener("click", () => void doExport());
  $("file").addEventListener("change", () => void readFile());
  $("decrypt").addEventListener("click", () => void decrypt());
  $("preview").addEventListener("change", renderEffect);
  $("replace-word").addEventListener("input", renderEffect);
  $("import").addEventListener("click", () => void doImport());
  renderExportOptions();
}

void init().catch((err) => setStatus(errorText(err), "error"));
