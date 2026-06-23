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
  event_json: string;
}

export interface TaskEventStore {
  append(event: TaskEvent): void;
  getTask(taskId: string): TaskRecord | null;
  listEvents(taskId: string): TaskEvent[];
  close(): void;
}

export class SqliteTaskEventStore implements TaskEventStore {
  private readonly db: DatabaseSync;

  public constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;

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
        event_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
    `);
  }

  public append(event: TaskEvent): void {
    const insertEvent = this.db.prepare(`
      INSERT INTO task_events (id, task_id, event_type, created_at, event_json)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertEvent.run(
      event.id,
      event.taskId,
      event.type,
      event.timestamp,
      JSON.stringify(event)
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

  public listEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .prepare("SELECT event_json FROM task_events WHERE task_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(taskId) as unknown as EventRow[];

    return rows.map((row) => JSON.parse(row.event_json) as TaskEvent);
  }

  public close(): void {
    this.db.close();
  }
}
