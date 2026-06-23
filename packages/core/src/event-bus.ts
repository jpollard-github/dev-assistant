import type { AgentRole, AgentOutputMap } from "@dev-assistant/agents";

import type {
  ApprovalDecision,
  ApprovalRequest,
  PatchApplyResult,
  ShellCommandResult,
  TaskBudget,
  TaskStatus
} from "./task-types.js";

export interface BaseTaskEvent<TType extends string, TPayload> {
  readonly id: string;
  readonly taskId: string;
  readonly type: TType;
  readonly timestamp: string;
  readonly payload: TPayload;
}

export type TaskEvent =
  | BaseTaskEvent<
      "task.created",
      {
        readonly title: string;
        readonly prompt: string;
        readonly budget: TaskBudget;
      }
    >
  | BaseTaskEvent<
      "task.status-changed",
      {
        readonly from: TaskStatus | null;
        readonly to: TaskStatus;
        readonly reason: string;
      }
    >
  | BaseTaskEvent<
      "agent.started",
      {
        readonly role: AgentRole;
        readonly attempt: number;
      }
    >
  | BaseTaskEvent<
      "agent.completed",
      {
        readonly role: AgentRole;
        readonly attempt: number;
        readonly output:
          | AgentOutputMap["coordinator"]
          | AgentOutputMap["coder"]
          | AgentOutputMap["reviewer"]
          | AgentOutputMap["test-runner"];
      }
    >
  | BaseTaskEvent<
      "agent.output-invalid",
      {
        readonly role: AgentRole;
        readonly attempt: number;
        readonly issues: readonly string[];
      }
    >
  | BaseTaskEvent<
      "approval.requested",
      {
        readonly request: ApprovalRequest;
      }
    >
  | BaseTaskEvent<
      "approval.resolved",
      {
        readonly request: ApprovalRequest;
        readonly decision: ApprovalDecision;
      }
    >
  | BaseTaskEvent<
      "tool.result",
      {
        readonly tool: "patch-applier" | "shell-runner";
        readonly result: PatchApplyResult | ShellCommandResult;
      }
    >
  | BaseTaskEvent<
      "budget.exceeded",
      {
        readonly budget: keyof TaskBudget;
        readonly limit: number;
        readonly actual: number;
      }
    >
  | BaseTaskEvent<
      "task.completed",
      {
        readonly summary: string;
      }
    >
  | BaseTaskEvent<
      "task.blocked",
      {
        readonly reason: string;
      }
    >;

export type TaskEventHandler = (event: TaskEvent) => void | Promise<void>;

export interface TaskEventBus {
  publish(event: TaskEvent): Promise<void>;
  subscribe(handler: TaskEventHandler): () => void;
}

export function createTaskEventBus(): TaskEventBus {
  const handlers = new Set<TaskEventHandler>();

  return {
    async publish(event) {
      for (const handler of handlers) {
        await handler(event);
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }
  };
}
