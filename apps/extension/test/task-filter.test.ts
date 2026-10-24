import { describe, expect, it } from "vitest";
import type { TaskStatus } from "@inbox-handoff/protocol";
import type { TaskRecord } from "../src/db/schema.ts";
import { EMPTY_QUERY, filterTasks, queryFromParams, queryToParams, type TaskQuery } from "../src/task-filter.ts";

const day = (d: string, h = 12) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00`).getTime();

function task(id: string, status: TaskStatus, over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    title: `Task ${id}`,
    status,
    blockReason: null,
    priority: "normal",
    dueAt: null,
    repositoryRef: "",
    instructions: "",
    scope: "message",
    threadId: "t",
    threadUrl: "https://mail.google.com/mail/u/0/#inbox/t",
    sources: [{ messageId: "m", subject: "Subject", from: "Ada <ada@example.test>", date: "" }],
    idempotencyKey: id.padEnd(64, "0"),
    origin: "local",
    createdAt: day("2026-10-01"),
    updatedAt: day("2026-10-10"),
    lastRefreshAt: null,
    handoff: { preparedAt: null, openedAt: null, destination: null },
    ...over,
  };
}

const tasks = [
  task("a", "Captured", { title: "Fix login bug", repositoryRef: "https://github.com/example/app" }),
  task("b", "AwaitingApproval", { title: "Release checklist", sources: [{ messageId: "m", subject: "Café menu", from: "रवि <ravi@example.test>", date: "" }] }),
  task("c", "Blocked", { updatedAt: day("2026-10-20") }),
  task("d", "Completed", { createdAt: day("2026-09-01"), updatedAt: day("2026-09-02") }),
  task("e", "Cancelled", { instructions: "Use the staging database" }),
];
const q = (over: Partial<TaskQuery>) => filterTasks(tasks, { ...EMPTY_QUERY, ...over }).map((t) => t.id);

describe("filterTasks", () => {
  it("returns everything for the empty query", () => {
    expect(q({})).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("filters by status groups and single statuses", () => {
    expect(q({ status: "active" })).toEqual(["a", "b", "c"]);
    expect(q({ status: "needs-you" })).toEqual(["b", "c"]);
    expect(q({ status: "done" })).toEqual(["d", "e"]);
    expect(q({ status: "Blocked" })).toEqual(["c"]);
  });

  it("searches title, repository, instructions, subject and sender; all words must match", () => {
    expect(q({ text: "login" })).toEqual(["a"]);
    expect(q({ text: "github example" })).toEqual(["a"]);
    expect(q({ text: "STAGING" })).toEqual(["e"]);
    expect(q({ text: "café" })).toEqual(["b"]);
    expect(q({ text: "रवि" })).toEqual(["b"]);
    expect(q({ text: "login staging" })).toEqual([]);
  });

  it("filters by updated or created date, inclusive of whole days", () => {
    expect(q({ from: "2026-10-10", to: "2026-10-10" })).toEqual(["a", "b", "e"]);
    expect(q({ from: "2026-10-15" })).toEqual(["c"]);
    expect(q({ dateField: "created", to: "2026-09-30" })).toEqual(["d"]);
  });

  it("combines filters", () => {
    expect(q({ status: "active", text: "task c" })).toEqual(["c"]);
  });
});

describe("query params", () => {
  it("round-trips and drops invalid values", () => {
    const query: TaskQuery = { text: "login", status: "needs-you", dateField: "created", from: "2026-10-01", to: "2026-10-31" };
    expect(queryFromParams(queryToParams(query))).toEqual(query);
    expect(queryFromParams(new URLSearchParams("status=Hacked&from=yesterday&date=x"))).toEqual(EMPTY_QUERY);
    expect(queryToParams(EMPTY_QUERY).toString()).toBe("");
  });
});
