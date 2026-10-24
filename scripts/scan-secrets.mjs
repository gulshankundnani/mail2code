// Scans tracked files for credentials using the extension's own detector
// (apps/extension/src/secrets.ts). Prints file, line and kind — never the
// value. Synthetic test data lives under fixtures/ and test folders and is
// skipped. Requires Node 24+ (runs the TypeScript detector directly).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findSecrets } from "../apps/extension/src/secrets.ts";

const SKIP = [/^fixtures\//, /(^|\/)tests?\//, /package-lock\.json$/, /\.(png|ico|jpg|gif|zip|woff2?)$/i];

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f && !SKIP.some((re) => re.test(f)));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  text.split("\n").forEach((line, i) => {
    for (const f of findSecrets(line)) hits.push(`${file}:${i + 1}  ${f.label}`);
  });
}

if (hits.length) {
  console.error(`✗ Possible credentials found (values not shown):\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`✓ No credentials found in ${files.length} files`);
