import { transaction, type Db } from "./db.ts";

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE install (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        repo_url TEXT,
        git_remote TEXT,
        git_branch TEXT,
        rel_workdir TEXT
      );

      -- Machine-specific: a restored project has no row for the new install
      -- until the user maps it (status 'needs_configuration').
      CREATE TABLE project_paths (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        install_id TEXT NOT NULL,
        path TEXT NOT NULL,
        path_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ok', 'needs_configuration', 'missing')),
        PRIMARY KEY (project_id, install_id)
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        block_reason TEXT,
        priority TEXT NOT NULL,
        due_at TEXT,
        project_id TEXT NOT NULL REFERENCES projects(id),
        instructions TEXT NOT NULL,
        context_summary TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        origin TEXT NOT NULL CHECK (origin IN ('local', 'imported')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_refresh_at INTEGER
      );
      CREATE INDEX tasks_status ON tasks(status);
      CREATE INDEX tasks_project ON tasks(project_id);

      CREATE TABLE task_sources (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        gmail_message_id TEXT NOT NULL,
        gmail_thread_id TEXT NOT NULL,
        thread_url TEXT NOT NULL,
        subject TEXT NOT NULL,
        sender TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (task_id, gmail_message_id)
      );

      -- Email bodies are kept only while needed; retained_until NULL means
      -- "until the task closes", after which the purge job applies the
      -- retention policy.
      CREATE TABLE email_snapshots (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        gmail_message_id TEXT NOT NULL,
        body_text TEXT NOT NULL,
        retained_until INTEGER,
        PRIMARY KEY (task_id, gmail_message_id)
      );

      CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        hash TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (task_id, version)
      );

      CREATE TABLE approval_nonces (
        nonce TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        plan_version INTEGER NOT NULL,
        plan_hash TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        consumed_at INTEGER
      );

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_path_hash TEXT NOT NULL,
        install_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'request_changes')),
        comment TEXT,
        origin TEXT NOT NULL CHECK (origin IN ('local', 'imported')),
        decided_at INTEGER NOT NULL,
        superseded_at INTEGER
      );
      CREATE INDEX approvals_task ON approvals(task_id, decided_at);

      CREATE TABLE executions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        phase TEXT NOT NULL CHECK (phase IN ('planning', 'implementation')),
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        outcome TEXT,
        session_id TEXT
      );

      -- Append-only audit log.
      CREATE TABLE task_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        at INTEGER NOT NULL,
        type TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX task_events_task ON task_events(task_id, seq);
      CREATE TRIGGER task_events_no_update BEFORE UPDATE ON task_events
        BEGIN SELECT RAISE(ABORT, 'task_events is append-only'); END;

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export function currentVersion(db: Db): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number {
  const latest = migrations.at(-1)?.version ?? 0;
  const from = currentVersion(db);
  if (from > latest) throw new Error(`Database schema v${from} is newer than this app supports (v${latest}).`);
  for (const m of migrations) {
    if (m.version <= from) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return currentVersion(db);
}
