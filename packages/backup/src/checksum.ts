import { canonicalJson } from "@mail2code/protocol";
import { sha256Hex } from "@mail2code/task-core";
import type { ExportData } from "./format.ts";

// Detects accidental corruption only. Anyone who edits the file can also
// recompute this value, so it says nothing about who made the file.
// Authenticity comes from encryption (AES-GCM fails on any change).
export function dataChecksum(data: ExportData): Promise<string> {
  return sha256Hex(canonicalJson({ domain: "mail2code/export/v1", data }));
}
