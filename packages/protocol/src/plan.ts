import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const PlanCommandSchema = z.object({
  // Exact command line Claude intends to run. Approval covers these strings only.
  command: text(2_000),
  purpose: text(2_000),
});

export const PlanContentSchema = z.object({
  objective: text(5_000),
  assumptions: z.array(text(2_000)).max(50),
  openQuestions: z.array(text(2_000)).max(50),
  steps: z.array(z.object({ title: text(500), detail: text(5_000) })).min(1).max(100),
  filesLikelyToChange: z.array(text(1_000)).max(500),
  commands: z.array(PlanCommandSchema).max(100),
  tests: z.array(text(2_000)).max(100),
  risks: z.array(text(2_000)).max(50),
  externalDependencies: z.array(text(1_000)).max(50),
});
export type PlanContent = z.infer<typeof PlanContentSchema>;
export type PlanCommand = z.infer<typeof PlanCommandSchema>;

// JSON Schema handed to Claude Code's structured-output option. Kept in sync
// with PlanContentSchema by the protocol tests.
export const PLAN_JSON_SCHEMA = z.toJSONSchema(PlanContentSchema, { target: "draft-7" });
