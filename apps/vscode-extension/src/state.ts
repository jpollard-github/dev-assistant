import type { ApprovalRequest, TaskEvent, TaskRecord, TaskStatus } from "@dev-assistant/core";

export interface ExtensionTaskSummary {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastMessage: string | null;
  readonly changedFiles: readonly string[];
  readonly pendingApproval: ApprovalRequest | null;
  readonly events: readonly TaskEvent[];
}

export interface ExtensionStateSnapshot {
  readonly activeTasks: readonly ExtensionTaskSummary[];
  readonly allTasks: readonly ExtensionTaskSummary[];
}

interface MutableTaskSummary {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  lastMessage: string | null;
  changedFiles: string[];
  pendingApproval: ApprovalRequest | null;
  events: TaskEvent[];
}

export class ExtensionStateStore {
  private readonly tasks = new Map<string, MutableTaskSummary>();

  public hydrate(records: readonly TaskRecord[]): void {
    this.tasks.clear();

    for (const record of records) {
      this.tasks.set(record.id, {
        id: record.id,
        title: record.title,
        prompt: record.prompt,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lastMessage: null,
        changedFiles: [],
        pendingApproval: null,
        events: []
      });
    }
  }

  public upsertTask(record: TaskRecord): void {
    const existing = this.tasks.get(record.id);

    if (existing) {
      existing.title = record.title;
      existing.prompt = record.prompt;
      existing.status = record.status;
      existing.createdAt = record.createdAt;
      existing.updatedAt = record.updatedAt;
      return;
    }

    this.tasks.set(record.id, {
      id: record.id,
      title: record.title,
      prompt: record.prompt,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastMessage: null,
      changedFiles: [],
      pendingApproval: null,
      events: []
    });
  }

  public recordEvent(event: TaskEvent): void {
    const task = this.ensureTask(event.taskId);
    task.events = [...task.events, event];
    task.updatedAt = event.timestamp;

    switch (event.type) {
      case "task.created":
        task.title = event.payload.title;
        task.prompt = event.payload.prompt;
        task.lastMessage = "Task created.";
        break;
      case "task.status-changed":
        task.status = event.payload.to;
        task.lastMessage = event.payload.reason;
        break;
      case "patch.previewed":
        task.changedFiles = [...event.payload.files];
        task.lastMessage = event.payload.summary;
        break;
      case "approval.requested":
        task.pendingApproval = event.payload.request;
        task.lastMessage = event.payload.request.reason;
        break;
      case "approval.resolved":
        task.pendingApproval = null;
        task.lastMessage = event.payload.decision.rationale;
        break;
      case "task.completed":
      case "task.blocked":
      case "task.cancelled":
        task.lastMessage =
          "summary" in event.payload ? event.payload.summary : event.payload.reason;
        break;
      default:
        task.lastMessage = describeEvent(event);
        break;
    }
  }

  public getTask(taskId: string): ExtensionTaskSummary | null {
    const task = this.tasks.get(taskId);
    return task ? freezeTask(task) : null;
  }

  public snapshot(): ExtensionStateSnapshot {
    const allTasks = [...this.tasks.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((task) => freezeTask(task));

    return {
      activeTasks: allTasks.filter((task) => isActiveTask(task.status)),
      allTasks
    };
  }

  private ensureTask(taskId: string): MutableTaskSummary {
    const existing = this.tasks.get(taskId);

    if (existing) {
      return existing;
    }

    const created: MutableTaskSummary = {
      id: taskId,
      title: taskId,
      prompt: "",
      status: "created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessage: null,
      changedFiles: [],
      pendingApproval: null,
      events: []
    };
    this.tasks.set(taskId, created);
    return created;
  }
}

export function isActiveTask(status: TaskStatus): boolean {
  return !["completed", "blocked", "cancelled"].includes(status);
}

export function describeEvent(event: TaskEvent): string {
  switch (event.type) {
    case "task.created":
      return `Created: ${event.payload.title}`;
    case "task.status-changed":
      return `${event.payload.to}: ${event.payload.reason}`;
    case "agent.started":
      return `${event.payload.role} started`;
    case "agent.prompt-snapshot":
      return `${event.payload.role} prompt captured`;
    case "agent.completed":
      return `${event.payload.role} completed`;
    case "agent.output-invalid":
      return `${event.payload.role} returned invalid output`;
    case "patch.previewed":
      return `Patch previewed for ${event.payload.files.length} file(s)`;
    case "approval.requested":
      return `Approval requested for ${event.payload.request.kind}`;
    case "approval.resolved":
      return `${event.payload.request.kind} ${event.payload.decision.approved ? "approved" : "denied"}`;
    case "tool.result":
      return `${event.payload.tool} finished`;
    case "budget.exceeded":
      return `${event.payload.budget} exceeded`;
    case "task.completed":
      return `Completed: ${event.payload.summary}`;
    case "task.blocked":
      return `Blocked: ${event.payload.reason}`;
    case "task.cancelled":
      return `Cancelled: ${event.payload.reason}`;
  }
}

function freezeTask(task: MutableTaskSummary): ExtensionTaskSummary {
  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastMessage: task.lastMessage,
    changedFiles: [...task.changedFiles],
    pendingApproval: task.pendingApproval,
    events: [...task.events]
  };
}
