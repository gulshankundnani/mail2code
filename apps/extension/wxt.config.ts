import { defineConfig } from "wxt";

// Extension pages load only their own bundled scripts and styles. The only
// network destination is the Anthropic API, used solely for the optional,
// off-by-default Claude API summary, and only after the user grants the
// optional host permission below. Not applied in `wxt dev`, whose hot reload
// needs a looser policy.
const API_HOST = "https://api.anthropic.com";
const EXTENSION_PAGES_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  `connect-src ${API_HOST}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// Firefox MV3 requires an add-on ID. A GUID claims no domain or owner. It must
// be confirmed before the first addons.mozilla.org submission, after which it
// can never change.
const FIREFOX_ADDON_ID = "{034066bd-772c-43e5-b155-6a7e030ac512}";

export default defineConfig({
  outDir: "dist",
  zip: {
    artifactTemplate: "mail2code-{{version}}-{{browser}}.zip",
    sourcesTemplate: "mail2code-{{version}}-sources.zip",
  },
  manifest: ({ mode, browser }) => ({
    name: "Mail2Code",
    description: "Turn a Gmail conversation you choose into a task brief for Claude, and track the plan you approve. Nothing is sent unless you paste it.",
    // Least privilege: `storage` only. The Gmail content script needs no host
    // permission, and opening claude.ai in a tab needs none either.
    permissions: ["storage"],
    // Not granted at install. Requested from Settings only if the user turns
    // on Claude API summaries; removed again with "Remove key".
    optional_host_permissions: [`${API_HOST}/*`],
    action: { default_title: "Mail2Code" },
    ...(mode === "production" ? { content_security_policy: { extension_pages: EXTENSION_PAGES_CSP } } : {}),
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: FIREFOX_ADDON_ID,
              // 140 (an ESR) is the first version that understands
              // data_collection_permissions; storage.session and adopted
              // stylesheets are older.
              strict_min_version: "140.0",
              // The extension collects and transmits no data.
              data_collection_permissions: { required: ["none"] },
            },
            gecko_android: { strict_min_version: "142.0" },
          },
        }
      : {}),
  }),
});
