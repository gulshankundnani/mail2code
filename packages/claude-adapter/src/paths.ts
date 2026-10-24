import { realpathSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "@inbox-handoff/task-core";

export type PathCheck = { ok: true; resolved: string } | { ok: false; reason: string };

// Rejects UNC shares, \\?\ and \\.\ device paths: reading them can trigger
// network authentication and they bypass normal path semantics.
function isNetworkOrDevicePath(p: string): boolean {
  return /^[\\/]{2}/.test(p);
}

// Realpath of the deepest existing ancestor, with the missing tail re-appended.
// This lets us check files that are about to be created, while still resolving
// any symlink/junction in the part of the path that already exists.
function realpathAllowMissing(p: string): string {
  const missing: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(realpathSync.native(cur), ...missing.reverse());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(cur);
      if (parent === cur) throw err;
      missing.push(path.basename(cur));
      cur = parent;
    }
  }
}

export function resolveProjectRoot(root: string): string {
  if (isNetworkOrDevicePath(root)) throw new Error("Network and device paths cannot be project roots");
  return realpathSync.native(path.resolve(root));
}

// Hash identifying *where* a project lives on this machine. Re-pointing a
// project at another directory changes it and so invalidates approvals.
export function projectPathHash(realRoot: string): string {
  const norm = process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
  return sha256Hex(`inbox-handoff/project-path/v1:${norm}`);
}

export function checkInsideRoot(realRoot: string, candidate: string): PathCheck {
  if (typeof candidate !== "string" || candidate.length === 0) return { ok: false, reason: "empty path" };
  if (candidate.includes("\0")) return { ok: false, reason: "NUL in path" };
  if (isNetworkOrDevicePath(candidate)) return { ok: false, reason: "network or device path" };
  let resolved: string;
  try {
    resolved = realpathAllowMissing(path.resolve(realRoot, candidate));
  } catch {
    return { ok: false, reason: "path could not be resolved" };
  }
  const rel = path.relative(realRoot, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return { ok: true, resolved };
  return { ok: false, reason: "outside project root" };
}

// Glob patterns are not paths, but a pattern like "../../**" or "C:/**" still
// reaches outside the root.
export function checkGlobPattern(pattern: string): PathCheck {
  if (typeof pattern !== "string") return { ok: false, reason: "invalid pattern" };
  if (path.isAbsolute(pattern) || /^[A-Za-z]:/.test(pattern) || isNetworkOrDevicePath(pattern)) return { ok: false, reason: "absolute pattern" };
  if (pattern.split(/[\\/]/).includes("..")) return { ok: false, reason: "parent traversal in pattern" };
  return { ok: true, resolved: pattern };
}
