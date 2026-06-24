import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { TaskEvent } from "./event-bus.js";
import type { TaskBudget, TaskRecord, TaskStatus } from "./task-types.js";

interface TaskRow {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  budget_json: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  task_id?: string;
  event_json: string;
  previous_event_hash?: string | null;
  event_hash?: string | null;
}

interface TableColumnRow {
  name: string;
}

export interface TaskEventStoreInspection {
  readonly schemaVersion: number;
  readonly taskCount: number;
  readonly eventCount: number;
  readonly auditChainIntact: boolean;
}

export interface TaskEventStore {
  append(event: TaskEvent): void;
  getTask(taskId: string): TaskRecord | null;
  listTasks(limit?: number): TaskRecord[];
  listEvents(taskId: string): TaskEvent[];
  close(): void;
}

export class SqliteTaskEventStore implements TaskEventStore {
  private readonly db: DatabaseSync;

  public constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    migrateTaskEventStore(this.db);
  }

  public append(event: TaskEvent): void {
    const previousEventHash = this.getPreviousEventHash(event.taskId);
    const serializedEvent = JSON.stringify(event);
    const eventHash = hashEvent(previousEventHash, serializedEvent);
    const insertEvent = this.db.prepare(`
      INSERT INTO task_events (id, task_id, event_type, created_at, event_json, previous_event_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertEvent.run(
      event.id,
      event.taskId,
      event.type,
      event.timestamp,
      serializedEvent,
      previousEventHash,
      eventHash
    );

    if (event.type === "task.created") {
      const insertTask = this.db.prepare(`
        INSERT INTO tasks (id, title, prompt, status, budget_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insertTask.run(
        event.taskId,
        event.payload.title,
        event.payload.prompt,
        "created",
        JSON.stringify(event.payload.budget),
        event.timestamp,
        event.timestamp
      );
      return;
    }

    if (event.type === "task.status-changed") {
      const updateTask = this.db.prepare(`
        UPDATE tasks
        SET status = ?, updated_at = ?
        WHERE id = ?
      `);

      updateTask.run(event.payload.to, event.timestamp, event.taskId);
    }
  }

  public getTask(taskId: string): TaskRecord | null {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(taskId) as TaskRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      status: row.status,
      budget: JSON.parse(row.budget_json) as TaskBudget,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public listTasks(limit = 50): TaskRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM tasks ORDER BY updated_at DESC, rowid DESC LIMIT ?"
      )
      .all(limit) as unknown as TaskRow[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      status: row.status,
      budget: JSON.parse(row.budget_json) as TaskBudget,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  public listEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .prepare("SELECT event_json FROM task_events WHERE task_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(taskId) as unknown as EventRow[];

    return rows.map((row) => JSON.parse(row.event_json) as TaskEvent);
  }

  public close(): void {
    this.db.close();
  }

  private getPreviousEventHash(taskId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT event_hash FROM task_events WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
      )
      .get(taskId) as { event_hash?: string | null } | undefined;

    return row?.event_hash ?? null;
  }
}

export function inspectTaskEventStore(filename: string): TaskEventStoreInspection {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);

  try {
    migrateTaskEventStore(db);

    const taskCount = Number(
      (db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count
    );
    const eventCount = Number(
      (db.prepare("SELECT COUNT(*) AS count FROM task_events").get() as { count: number }).count
    );

    return {
      schemaVersion: Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version),
      taskCount,
      eventCount,
      auditChainIntact: verifyAuditChain(db)
    };
  } finally {
    db.close();
  }
}

const CURRENT_TASK_STORE_SCHEMA_VERSION = 3;

function migrateTaskEventStore(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL;");

  const currentVersion = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
  );

  ensureBaseTables(db);

  if (!hasColumn(db, "task_events", "event_type")) {
    db.exec("ALTER TABLE task_events ADD COLUMN event_type TEXT;");
    backfillEventTypes(db);
  }

  if (!hasColumn(db, "task_events", "previous_event_hash")) {
    db.exec("ALTER TABLE task_events ADD COLUMN previous_event_hash TEXT;");
  }

  if (!hasColumn(db, "task_events", "event_hash")) {
    db.exec("ALTER TABLE task_events ADD COLUMN event_hash TEXT;");
  }

  backfillAuditHashes(db);

  createIndexes(db);

  if (currentVersion < CURRENT_TASK_STORE_SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${CURRENT_TASK_STORE_SCHEMA_VERSION};`);
  }
}

function ensureBaseTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      budget_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_type TEXT,
      created_at TEXT NOT NULL,
      event_json TEXT NOT NULL,
      previous_event_hash TEXT,
      event_hash TEXT
    );
  `);
}

function createIndexes(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_events_task_id_created_at ON task_events(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_events_event_type ON task_events(event_type);
  `);
}

function hasColumn(db: DatabaseSync, tableName: string, columnName: string): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as unknown as TableColumnRow[];

  return columns.some((column) => column.name === columnName);
}

function backfillEventTypes(db: DatabaseSync): void {
  const rows = db
    .prepare("SELECT id, event_json FROM task_events WHERE event_type IS NULL")
    .all() as Array<{ id: string; event_json: string }>;
  const update = db.prepare("UPDATE task_events SET event_type = ? WHERE id = ?");

  for (const row of rows) {
    let eventType = "unknown";
    try {
      eventType = (JSON.parse(row.event_json) as { type?: string }).type ?? "unknown";
    } catch {}

    update.run(eventType, row.id);
  }
}

function backfillAuditHashes(db: DatabaseSync): void {
  const rows = db
    .prepare(
      "SELECT id, task_id, event_json FROM task_events ORDER BY task_id ASC, created_at ASC, rowid ASC"
    )
    .all() as Array<{ id: string; task_id: string; event_json: string }>;
  const update = db.prepare(
    "UPDATE task_events SET previous_event_hash = ?, event_hash = ? WHERE id = ?"
  );
  const previousHashes = new Map<string, string | null>();

  for (const row of rows) {
    const previousEventHash = previousHashes.get(row.task_id) ?? null;
    const eventHash = hashEvent(previousEventHash, row.event_json);
    update.run(previousEventHash, eventHash, row.id);
    previousHashes.set(row.task_id, eventHash);
  }
}

function verifyAuditChain(db: DatabaseSync): boolean {
  const rows = db
    .prepare(
      "SELECT task_id, event_json, previous_event_hash, event_hash FROM task_events ORDER BY task_id ASC, created_at ASC, rowid ASC"
    )
    .all() as unknown as Array<EventRow & { task_id: string }>;
  const previousHashes = new Map<string, string | null>();

  for (const row of rows) {
    const previousEventHash = previousHashes.get(row.task_id) ?? null;
    const expectedHash = hashEvent(previousEventHash, row.event_json);
    if ((row.previous_event_hash ?? null) !== previousEventHash) {
      return false;
    }
    if ((row.event_hash ?? null) !== expectedHash) {
      return false;
    }
    previousHashes.set(row.task_id, expectedHash);
  }

  return true;
}

function hashEvent(previousEventHash: string | null, eventJson: string): string {
  return createHash("sha256")
    .update(previousEventHash ?? "")
    .update("\n")
    .update(eventJson)
    .digest("hex");
}
