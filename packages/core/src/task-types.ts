import type { AgentRole, AgentOutputMap, CoderOutput, FileOperation } from "@dev-assistant/agents";
import type { ApprovalPolicy, AssistantConfig } from "@dev-assistant/shared";

export type TaskStatus =
  | "created"
  | "planned"
  | "assigned"
  | "patch-proposed"
  | "patch-applied"
  | "reviewed"
  | "tested"
  | "completed"
  | "blocked";

export interface TaskBudget {
  readonly maxModelCalls: number;
  readonly maxShellCommands: number;
  readonly maxChangedFiles: number;
  readonly maxRuntimeMs: number;
}

export interface TaskBudgetUsage {
  modelCalls: number;
  shellCommands: number;
  changedFiles: number;
}

export interface TaskRequest {
  readonly title?: string;
  readonly prompt: string;
  readonly budget?: Partial<TaskBudget>;
  readonly config?: Partial<
    Pick<AssistantConfig, "allowedShellCommands" | "approvalPolicy" | "formatCommands" | "testCommands">
  >;
}

export interface ShellCommandResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface ModelTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface AgentExecutionMetadata {
  readonly promptSnapshot?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly durationMs?: number;
  readonly tokenUsage?: ModelTokenUsage;
  readonly finishReason?: string;
}

export interface AgentExecutionEnvelope {
  readonly output: unknown;
  readonly metadata?: AgentExecutionMetadata;
}

export interface PatchApplyResult {
  readonly applied: boolean;
  readonly changedFiles: readonly string[];
  readonly summary: string;
  readonly operations: readonly FileOperation[];
  readonly finalDiff: string;
  readonly fileSnapshots: readonly {
    readonly path: string;
    readonly content: string | null;
  }[];
  readonly formattingCommands: readonly ShellCommandResult[];
}

export interface ApprovalRequest {
  readonly kind: "file-edit" | "shell-command";
  readonly reason: string;
  readonly files?: readonly string[];
  readonly command?: string;
}

export interface ApprovalDecision {
  readonly approved: boolean;
  readonly approver: string;
  readonly rationale: string;
}

export interface AgentInvocationMap {
  readonly coordinator: {
    readonly taskId: string;
    readonly title: string;
    readonly prompt: string;
  };
  readonly coder: {
    readonly taskId: string;
    readonly prompt: string;
    readonly plan: AgentOutputMap["coordinator"];
  };
  readonly reviewer: {
    readonly taskId: string;
    readonly prompt: string;
    readonly plan: AgentOutputMap["coordinator"];
    readonly proposal: CoderOutput;
    readonly patchResult: PatchApplyResult;
  };
  readonly "test-runner": {
    readonly taskId: string;
    readonly prompt: string;
    readonly commands: readonly ShellCommandResult[];
  };
  readonly "coordinator-report": {
    readonly taskId: string;
    readonly prompt: string;
    readonly plan: AgentOutputMap["coordinator"];
    readonly proposal: CoderOutput;
    readonly patchResult: PatchApplyResult;
    readonly reviewer: AgentOutputMap["reviewer"];
    readonly testReport: AgentOutputMap["test-runner"] | null;
    readonly outcome: "completed" | "blocked";
    readonly blockerReason?: string;
  };
}

export type AgentHandler<TRole extends AgentRole> = (
  input: AgentInvocationMap[TRole]
) => Promise<unknown | AgentExecutionEnvelope> | unknown | AgentExecutionEnvelope;

export type AgentHandlers = {
  readonly [TRole in AgentRole]: AgentHandler<TRole>;
};

export interface PatchApplier {
  apply(taskId: string, proposal: CoderOutput): Promise<PatchApplyResult> | PatchApplyResult;
}

export interface ShellRunner {
  run(command: string): Promise<ShellCommandResult> | ShellCommandResult;
}

export interface ApprovalDecider {
  decide(request: ApprovalRequest): Promise<ApprovalDecision> | ApprovalDecision;
}

export interface TaskRecord {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly budget: TaskBudget;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskRunResult {
  readonly task: TaskRecord;
  readonly usage: TaskBudgetUsage;
  readonly outputs: Partial<AgentOutputMap>;
  readonly approvals: readonly ApprovalDecision[];
}

export interface CoordinatorOptions {
  readonly budgetDefaults?: Partial<TaskBudget>;
  readonly approvalPolicy?: ApprovalPolicy;
  readonly maxAgentOutputRetries?: number;
}

export const DEFAULT_TASK_BUDGET: TaskBudget = {
  maxModelCalls: 8,
  maxShellCommands: 4,
  maxChangedFiles: 6,
  maxRuntimeMs: 60_000
};

export function resolveTaskBudget(overrides?: Partial<TaskBudget>): TaskBudget {
  return {
    ...DEFAULT_TASK_BUDGET,
    ...overrides
  };
}
