import { z } from "zod";
import { LIMITS } from "./limits.ts";

// What the brief asks Claude to cover before any implementation.
export const PLAN_SECTIONS = [
  "Objective",
  "Assumptions",
  "Unanswered questions",
  "Proposed steps",
  "Files or components expected to change",
  "Commands and tools you would run",
  "Tests",
  "Risks",
  "External dependencies",
] as const;

// A plan as recorded in the extension. With the browser handoff the user
// pastes it in; the extension cannot observe the remote session itself.
export const RecordedPlanInputSchema = z.object({
  text: z.string().trim().min(1).max(LIMITS.maxPlanChars),
  source: z.enum(["pasted"]),
});
export type RecordedPlanInput = z.infer<typeof RecordedPlanInputSchema>;
