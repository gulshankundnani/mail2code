// Validates built extension manifests: MV3, least privilege, strict CSP.
// Run after `npm run -w @inbox-handoff/extension build:all`.
import { existsSync, readFileSync } from "node:fs";

const TARGETS = ["chrome-mv3", "edge-mv3", "firefox-mv3"];
const REQUIRED_CSP = ["script-src 'self'", "connect-src 'none'", "object-src 'none'", "frame-ancestors 'none'"];

const problems = [];
let checked = 0;
for (const target of TARGETS) {
  const path = `apps/extension/dist/${target}/manifest.json`;
  if (!existsSync(path)) continue;
  checked++;
  const m = JSON.parse(readFileSync(path, "utf8"));
  const fail = (msg) => problems.push(`${target}: ${msg}`);
  if (m.manifest_version !== 3) fail(`manifest_version is ${m.manifest_version}, expected 3`);
  if (JSON.stringify(m.permissions) !== JSON.stringify(["storage"])) fail(`permissions are ${JSON.stringify(m.permissions)}, expected ["storage"]`);
  for (const key of ["host_permissions", "optional_permissions", "optional_host_permissions", "web_accessible_resources"]) {
    if (m[key] && m[key].length) fail(`unexpected ${key}: ${JSON.stringify(m[key])}`);
  }
  if (m.externally_connectable) fail("externally_connectable must not be set");
  const matches = (m.content_scripts ?? []).flatMap((c) => c.matches);
  if (JSON.stringify(matches) !== JSON.stringify(["https://mail.google.com/*"])) fail(`content script matches are ${JSON.stringify(matches)}`);
  const csp = m.content_security_policy?.extension_pages ?? "";
  for (const d of REQUIRED_CSP) if (!csp.includes(d)) fail(`CSP lacks "${d}"`);
  if (/unsafe-(eval|inline)|https?:/.test(csp)) fail(`CSP allows unsafe sources: ${csp}`);
  if (target.startsWith("firefox")) {
    const gecko = m.browser_specific_settings?.gecko ?? {};
    if (!gecko.id) fail("Firefox add-on id missing");
    if (JSON.stringify(gecko.data_collection_permissions?.required) !== JSON.stringify(["none"])) fail("data_collection_permissions must be required: [none]");
  }
}

if (checked === 0) {
  console.error("No built manifests found. Build first: npm run -w @inbox-handoff/extension build:all");
  process.exit(1);
}
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${checked} manifest(s) OK: MV3, storage only, Gmail content script only, strict CSP`);
