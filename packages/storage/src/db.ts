// node:sqlite is still flagged experimental in Node 24 (prints an
// ExperimentalWarning). It is isolated behind this module so the driver can be
// swapped for better-sqlite3 without touching the store.
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

// BEGIN IMMEDIATE takes the write lock up front so read-check-write sequences
// (approval verification, transitions) cannot interleave with another writer.
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
