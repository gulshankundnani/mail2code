import { CLOSED_STATUSES, TASK_STATUSES, type TaskStatus } from "@inbox-handoff/protocol";
import type { TaskRecord } from "./db/schema.ts";

export type StatusFilter = "all" | "active" | "needs-you" | "done" | TaskStatus;
export type DateField = "updated" | "created";

export interface TaskQuery {
  text: string;
  status: StatusFilter;
  dateField: DateField;
  from: string; // yyyy-mm-dd (local), or ""
  to: string;
}

export const EMPTY_QUERY: TaskQuery = { text: "", status: "all", dateField: "updated", from: "", to: "" };

// Statuses where the next step is the user's.
const NEEDS_YOU: ReadonlySet<TaskStatus> = new Set(["AwaitingApproval", "Blocked"]);

const STATUS_FILTERS = new Set<string>(["all", "active", "needs-you", "done", ...TASK_STATUSES]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalize(s: string): string {
  return s.normalize("NFKC").toLocaleLowerCase();
}

function matchesStatus(status: TaskStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return !CLOSED_STATUSES.has(status);
    case "needs-you":
      return NEEDS_YOU.has(status);
    case "done":
      return CLOSED_STATUSES.has(status);
    default:
      return status === filter;
  }
}

// Local-time day bounds for <input type="date"> values.
function dayStart(d: string): number {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, day).getTime();
}

export function filterTasks(tasks: readonly TaskRecord[], q: TaskQuery): TaskRecord[] {
  const tokens = normalize(q.text).split(/\s+/).filter(Boolean);
  const from = DATE.test(q.from) ? dayStart(q.from) : -Infinity;
  const to = DATE.test(q.to) ? dayStart(q.to) + 24 * 60 * 60 * 1000 - 1 : Infinity;
  return tasks.filter((t) => {
    if (!matchesStatus(t.status, q.status)) return false;
    const when = q.dateField === "created" ? t.createdAt : t.updatedAt;
    if (when < from || when > to) return false;
    if (tokens.length === 0) return true;
    const haystack = normalize([t.title, t.repositoryRef, t.instructions, ...t.sources.flatMap((s) => [s.subject, s.from])].join("\n"));
    return tokens.every((tok) => haystack.includes(tok));
  });
}

// The query lives in the page URL so a filtered view can be reloaded or bookmarked.
export function queryFromParams(p: URLSearchParams): TaskQuery {
  const status = p.get("status") ?? "all";
  const dateField = p.get("date") === "created" ? "created" : "updated";
  return {
    text: (p.get("q") ?? "").slice(0, 200),
    status: (STATUS_FILTERS.has(status) ? status : "all") as StatusFilter,
    dateField,
    from: DATE.test(p.get("from") ?? "") ? p.get("from")! : "",
    to: DATE.test(p.get("to") ?? "") ? p.get("to")! : "",
  };
}

export function queryToParams(q: TaskQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.text) p.set("q", q.text);
  if (q.status !== "all") p.set("status", q.status);
  if (q.dateField !== "updated") p.set("date", q.dateField);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  return p;
}
