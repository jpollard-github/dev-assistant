import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { inspectTaskEventStore, SqliteTaskEventStore } from "./event-store.js";

describe("SqliteTaskEventStore migrations", () => {
  it("migrates an older task_events schema and backfills event_type", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "dev-assistant-core-")), "tasks.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      PRAGMA user_version = 0;
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        budget_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      INSERT INTO task_events (id, task_id, created_at, event_json)
      VALUES (
        'evt-1',
        'task-1',
        '2026-06-24T12:00:00.000Z',
        '{"id":"evt-1","taskId":"task-1","type":"task.created","timestamp":"2026-06-24T12:00:00.000Z","payload":{"title":"Task","prompt":"Prompt","budget":{"maxModelCalls":8,"maxShellCommands":4,"maxChangedFiles":6,"maxRuntimeMs":60000}}}'
      );
    `);
    db.close();

    const store = new SqliteTaskEventStore(dbPath);
    store.close();

    const inspection = inspectTaskEventStore(dbPath);
    expect(inspection.schemaVersion).toBe(2);
    expect(inspection.eventCount).toBe(1);

    const verifyDb = new DatabaseSync(dbPath);
    const row = verifyDb
      .prepare("SELECT event_type FROM task_events WHERE id = ?")
      .get("evt-1") as { event_type: string };
    verifyDb.close();

    expect(row.event_type).toBe("task.created");
  });
});
