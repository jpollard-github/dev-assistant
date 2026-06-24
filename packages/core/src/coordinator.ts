import { randomUUID } from "node:crypto";

import {
  formatSchemaErrors,
  parseAgentOutput,
  type AgentOutputMap,
  type AgentRole,
  type CoderOutput
} from "@dev-assistant/agents";
import { ZodError } from "@dev-assistant/shared";

import { createTaskEventBus, type TaskEvent, type TaskEventBus } from "./event-bus.js";
import type { TaskEventStore } from "./event-store.js";
import type {
  AgentExecutionEnvelope,
  AgentHandlers,
  AgentInvocationMap,
  ApprovalDecision,
  ApprovalDecider,
  ApprovalRequest,
  CoordinatorOptions,
  PatchApplier,
  PatchApplyResult,
  ShellRunner,
  TaskBudget,
  TaskBudgetUsage,
  TaskRecord,
  TaskRequest,
  TaskRunResult,
  TaskStatus
} from "./task-types.js";
import { DEFAULT_TASK_BUDGET, resolveTaskBudget } from "./task-types.js";

const DEFAULT_APPROVAL_DECISION: ApprovalDecision = {
  approved: true,
  approver: "system",
  rationale: "Approval not required by current policy."
};

const DEFAULT_PATCH_APPLIER: PatchApplier = {
  apply(taskId, proposal) {
    return {
      applied: true,
      changedFiles: proposal.files.map((file) => file.path),
      operations: proposal.operations,
      summary:
        proposal.files.length > 0
          ? `Accepted proposed patch for ${proposal.files.length} file(s).`
          : `No-op patch recorded for task ${taskId}.`,
      finalDiff: proposal.diff,
      fileSnapshots: proposal.operations.map((operation) => ({
        path: operation.path,
        content: operation.changeType === "delete" ? null : operation.content ?? null
      })),
      formattingCommands: []
    };
  }
};

const DEFAULT_SHELL_RUNNER: ShellRunner = {
  run(command) {
    return {
      command,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 0
    };
  }
};

export class TaskCoordinator {
  private readonly bus: TaskEventBus;
  private readonly store: TaskEventStore;
  private readonly agents: AgentHandlers;
  private readonly patchApplier: PatchApplier;
  private readonly shellRunner: ShellRunner;
  private readonly approvalDecider: ApprovalDecider | undefined;
  private readonly options: Required<Pick<CoordinatorOptions, "approvalPolicy" | "maxAgentOutputRetries">> & {
    readonly budgetDefaults: TaskBudget;
  };

  public constructor(params: {
    bus?: TaskEventBus;
    store: TaskEventStore;
    agents: AgentHandlers;
    patchApplier?: PatchApplier;
    shellRunner?: ShellRunner;
    approvalDecider?: ApprovalDecider;
    options?: CoordinatorOptions;
  }) {
    this.bus = params.bus ?? createTaskEventBus();
    this.store = params.store;
    this.agents = params.agents;
    this.patchApplier = params.patchApplier ?? DEFAULT_PATCH_APPLIER;
    this.shellRunner = params.shellRunner ?? DEFAULT_SHELL_RUNNER;
    this.approvalDecider = params.approvalDecider;
    this.options = {
      approvalPolicy: params.options?.approvalPolicy ?? "on-risky-action",
      maxAgentOutputRetries: params.options?.maxAgentOutputRetries ?? 2,
      budgetDefaults: resolveTaskBudget(params.options?.budgetDefaults ?? DEFAULT_TASK_BUDGET)
    };
  }

  public get eventBus(): TaskEventBus {
    return this.bus;
  }

  public async runTask(request: TaskRequest): Promise<TaskRunResult> {
    const taskId = randomUUID();
    const title = request.title ?? request.prompt.slice(0, 80);
    const startedAt = Date.now();
    const budget = resolveTaskBudget({
      ...this.options.budgetDefaults,
      ...request.budget
    });
    const usage: TaskBudgetUsage = {
      modelCalls: 0,
      shellCommands: 0,
      changedFiles: 0
    };
    const approvals: ApprovalDecision[] = [];
    const outputs: Partial<AgentOutputMap> = {};
    const config = {
      approvalPolicy: request.config?.approvalPolicy ?? this.options.approvalPolicy,
      allowedShellCommands: request.config?.allowedShellCommands ?? [],
      formatCommands: request.config?.formatCommands ?? [],
      testCommands: request.config?.testCommands ?? []
    };

    await this.recordEvent({
      taskId,
      type: "task.created",
      payload: {
        title,
        prompt: request.prompt,
        budget
      }
    });

    let currentStatus: TaskStatus | null = null;
    currentStatus = await this.transition(taskId, currentStatus, "created", "Task accepted for orchestration.");

    try {
      const plan = await this.invokeAgent(
        "coordinator",
        {
          taskId,
          title,
          prompt: request.prompt
        },
        usage,
        budget,
        startedAt
      );
      outputs.coordinator = plan;
      currentStatus = await this.transition(
        taskId,
        currentStatus,
        "planned",
        "Coordinator produced a deterministic task plan."
      );

      currentStatus = await this.transition(
        taskId,
        currentStatus,
        "assigned",
        "Coder assigned to produce the initial patch proposal."
      );

      const proposal = await this.invokeAgent(
        "coder",
        {
          taskId,
          prompt: request.prompt,
          plan
        },
        usage,
        budget,
        startedAt
      );
      outputs.coder = proposal;
      currentStatus = await this.transition(
        taskId,
        currentStatus,
        "patch-proposed",
        "Coder proposed a patch candidate."
      );

      await this.enforceBudget(taskId, budget, "maxChangedFiles", proposal.files.length, startedAt, usage);

      if (this.requiresFileEditApproval(proposal, config.approvalPolicy)) {
        const decision = await this.requestApproval(taskId, {
          kind: "file-edit",
          reason: "Patch proposal wants to modify repository files.",
          files: proposal.files.map((file) => file.path)
        });
        approvals.push(decision);

        if (!decision.approved) {
          throw new BlockedTaskError(`File edit approval denied: ${decision.rationale}`);
        }
      }

      await this.recordEvent({
        taskId,
        type: "patch.previewed",
        payload: {
          summary: proposal.summary,
          files:
            proposal.files.length > 0
              ? proposal.files.map((file) => file.path)
              : proposal.operations.map((operation) => operation.path)
        }
      });

      const patchResult = await this.patchApplier.apply(taskId, proposal);
      usage.changedFiles += patchResult.changedFiles.length;
      await this.enforceBudget(
        taskId,
        budget,
        "maxChangedFiles",
        usage.changedFiles,
        startedAt,
        usage
      );
      await this.recordToolResult(taskId, "patch-applier", patchResult);
      currentStatus = await this.transition(
        taskId,
        currentStatus,
        "patch-applied",
        "Patch application step completed."
      );

      const review = await this.invokeAgent(
        "reviewer",
        {
          taskId,
          prompt: request.prompt,
          plan,
          proposal,
          patchResult
        },
        usage,
        budget,
        startedAt
      );
      outputs.reviewer = review;
      currentStatus = await this.transition(
        taskId,
        currentStatus,
        "reviewed",
        "Reviewer inspected the applied diff."
      );

      let blockerReason: string | undefined;
      let testReport: AgentOutputMap["test-runner"] | null = null;

      if (!review.approved) {
        blockerReason = "Reviewer rejected the patch proposal.";
      } else {
        const shellResults: Awaited<ReturnType<ShellRunner["run"]>>[] = [];
        for (const command of config.testCommands) {
          await this.enforceBudget(
            taskId,
            budget,
            "maxShellCommands",
            usage.shellCommands + 1,
            startedAt,
            usage
          );

          if (this.requiresShellApproval(command, config.allowedShellCommands, config.approvalPolicy)) {
            const decision = await this.requestApproval(taskId, {
              kind: "shell-command",
              reason: "Shell command is not in the configured allowlist.",
              command
            });
            approvals.push(decision);

            if (!decision.approved) {
              throw new BlockedTaskError(`Shell command approval denied: ${decision.rationale}`);
            }
          }

          const result = await this.shellRunner.run(command);
          usage.shellCommands += 1;
          shellResults.push(result);
          await this.recordToolResult(taskId, "shell-runner", result);
        }

        testReport = await this.invokeAgent(
          "test-runner",
          {
            taskId,
            prompt: request.prompt,
            commands: shellResults
          },
          usage,
          budget,
          startedAt
        );
        outputs["test-runner"] = testReport;
        currentStatus = await this.transition(
          taskId,
          currentStatus,
          "tested",
          "Test runner summarized the execution results."
        );

        if (!testReport.passed) {
          blockerReason = "Configured tests did not pass.";
        }
      }

      const finalReport = await this.invokeAgent(
        "coordinator-report",
        {
          taskId,
          prompt: request.prompt,
          plan,
          proposal,
          patchResult,
          reviewer: review,
          testReport,
          outcome: blockerReason ? "blocked" : "completed",
          ...(blockerReason === undefined ? {} : { blockerReason })
        },
        usage,
        budget,
        startedAt
      );
      outputs["coordinator-report"] = finalReport;

      if (blockerReason) {
        throw new BlockedTaskError(blockerReason);
      }

      currentStatus = await this.transition(
        taskId,
        currentStatus,
        "completed",
        "Task completed successfully."
      );
      await this.recordEvent({
        taskId,
        type: "task.completed",
        payload: {
          summary: finalReport.summary
        }
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      currentStatus = await this.transition(taskId, currentStatus, "blocked", reason);
      await this.recordEvent({
        taskId,
        type: "task.blocked",
        payload: { reason }
      });
    }

    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} was not persisted.`);
    }

    return {
      task,
      usage,
      outputs,
      approvals
    };
  }

  private async invokeAgent<TRole extends AgentRole>(
    role: TRole,
    input: Parameters<AgentHandlers[TRole]>[0],
    usage: TaskBudgetUsage,
    budget: TaskBudget,
    startedAt: number
  ): Promise<AgentOutputMap[TRole]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.maxAgentOutputRetries + 1; attempt += 1) {
      await this.enforceBudget(
        input.taskId,
        budget,
        "maxModelCalls",
        usage.modelCalls + 1,
        startedAt,
        usage
      );
      usage.modelCalls += 1;

      await this.recordEvent({
        taskId: input.taskId,
        type: "agent.started",
        payload: { role, attempt }
      });

      const handler = this.agents[role] as (
        input: AgentInvocationMap[TRole]
      ) => Promise<unknown | AgentExecutionEnvelope> | unknown | AgentExecutionEnvelope;
      const rawResult = await handler(input as AgentInvocationMap[TRole]);
      const { output: rawOutput, metadata } = this.normalizeAgentResult(rawResult);

      await this.recordEvent({
        taskId: input.taskId,
        type: "agent.prompt-snapshot",
        payload: {
          role,
          attempt,
          snapshot: metadata?.promptSnapshot ?? JSON.stringify(input, null, 2)
        }
      });

      if (metadata?.provider && metadata.model && typeof metadata.durationMs === "number") {
        const llmResult: {
          readonly role: AgentRole;
          readonly provider: string;
          readonly model: string;
          readonly durationMs: number;
          readonly tokenUsage?: {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly totalTokens?: number;
          };
          readonly finishReason?: string;
        } = {
          role,
          provider: metadata.provider,
          model: metadata.model,
          durationMs: metadata.durationMs
        };

        if (metadata.tokenUsage) {
          Object.assign(llmResult, { tokenUsage: metadata.tokenUsage });
        }

        if (metadata.finishReason) {
          Object.assign(llmResult, { finishReason: metadata.finishReason });
        }

        await this.recordToolResult(input.taskId, "llm-provider", llmResult);
      }

      try {
        const parsed = parseAgentOutput(role, rawOutput);
        await this.recordEvent({
          taskId: input.taskId,
          type: "agent.completed",
          payload: {
            role,
            attempt,
            output: parsed
          }
        });
        return parsed;
      } catch (error) {
        if (error instanceof ZodError) {
          lastError = error;
          await this.recordEvent({
            taskId: input.taskId,
            type: "agent.output-invalid",
            payload: {
              role,
              attempt,
              issues: formatSchemaErrors(error)
            }
          });
          continue;
        }

        throw error;
      }
    }

    throw new BlockedTaskError(
      `Agent ${role} exceeded invalid-output retry limit: ${lastError instanceof ZodError ? formatSchemaErrors(lastError).join("; ") : "unknown validation error"}`
    );
  }

  private async transition(
    taskId: string,
    from: TaskStatus | null,
    to: TaskStatus,
    reason: string
  ): Promise<TaskStatus> {
    await this.recordEvent({
      taskId,
      type: "task.status-changed",
      payload: { from, to, reason }
    });
    return to;
  }

  private async requestApproval(taskId: string, request: ApprovalRequest): Promise<ApprovalDecision> {
    await this.recordEvent({
      taskId,
      type: "approval.requested",
      payload: { request }
    });

    const decision = this.approvalDecider
      ? await this.approvalDecider.decide(request)
      : DEFAULT_APPROVAL_DECISION;

    await this.recordEvent({
      taskId,
      type: "approval.resolved",
      payload: {
        request,
        decision
      }
    });

    return decision;
  }

  private async recordToolResult(
    taskId: string,
    tool: "patch-applier" | "shell-runner" | "llm-provider",
    result:
      | PatchApplyResult
      | Awaited<ReturnType<ShellRunner["run"]>>
      | {
          readonly role: AgentRole;
          readonly provider: string;
          readonly model: string;
          readonly durationMs: number;
          readonly tokenUsage?: {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly totalTokens?: number;
          };
          readonly finishReason?: string;
        }
  ): Promise<void> {
    await this.recordEvent({
      taskId,
      type: "tool.result",
      payload: { tool, result }
    });
  }

  private async enforceBudget(
    taskId: string,
    budget: TaskBudget,
    budgetKey: keyof TaskBudget,
    actual: number,
    startedAt: number,
    usage: TaskBudgetUsage
  ): Promise<void> {
    const limit = budget[budgetKey];

    if (budgetKey === "maxRuntimeMs") {
      const elapsed = Date.now() - startedAt;
      if (elapsed > limit) {
        await this.recordBudgetExceeded(taskId, budgetKey, limit, elapsed);
        throw new BlockedTaskError(`Runtime budget exceeded (${elapsed}ms > ${limit}ms).`);
      }
      return;
    }

    if (actual > limit) {
      await this.recordBudgetExceeded(taskId, budgetKey, limit, actual);
      throw new BlockedTaskError(`Budget ${budgetKey} exceeded (${actual} > ${limit}).`);
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed > budget.maxRuntimeMs) {
      await this.recordBudgetExceeded(taskId, "maxRuntimeMs", budget.maxRuntimeMs, elapsed);
      throw new BlockedTaskError(
        `Runtime budget exceeded (${elapsed}ms > ${budget.maxRuntimeMs}ms).`
      );
    }

    if (usage.modelCalls > budget.maxModelCalls) {
      await this.recordBudgetExceeded(
        taskId,
        "maxModelCalls",
        budget.maxModelCalls,
        usage.modelCalls
      );
      throw new BlockedTaskError(
        `Budget maxModelCalls exceeded (${usage.modelCalls} > ${budget.maxModelCalls}).`
      );
    }
  }

  private async recordBudgetExceeded(
    taskId: string,
    budgetKey: keyof TaskBudget,
    limit: number,
    actual: number
  ): Promise<void> {
    await this.recordEvent({
      taskId,
      type: "budget.exceeded",
      payload: {
        budget: budgetKey,
        limit,
        actual
      }
    });
  }

  private requiresFileEditApproval(
    proposal: CoderOutput,
    approvalPolicy: CoordinatorOptions["approvalPolicy"]
  ): boolean {
    if (approvalPolicy === "never") {
      return false;
    }

    if (approvalPolicy === "always") {
      return true;
    }

    return proposal.files.length > 0 || proposal.operations.length > 0;
  }

  private requiresShellApproval(
    command: string,
    allowlist: readonly string[],
    approvalPolicy: CoordinatorOptions["approvalPolicy"]
  ): boolean {
    if (approvalPolicy === "never") {
      return false;
    }

    if (approvalPolicy === "always") {
      return true;
    }

    return !allowlist.includes(command);
  }

  private async recordEvent(eventInput: Omit<TaskEvent, "id" | "timestamp">): Promise<void> {
    const event: TaskEvent = {
      ...eventInput,
      id: randomUUID(),
      timestamp: new Date().toISOString()
    } as TaskEvent;
    this.store.append(event);
    await this.bus.publish(event);
  }

  private normalizeAgentResult(value: unknown | AgentExecutionEnvelope): {
    readonly output: unknown;
    readonly metadata?: AgentExecutionEnvelope["metadata"];
  } {
    if (this.isAgentExecutionEnvelope(value)) {
      return {
        output: value.output,
        metadata: value.metadata
      };
    }

    return { output: value };
  }

  private isAgentExecutionEnvelope(value: unknown): value is AgentExecutionEnvelope {
    if (typeof value !== "object" || value === null || !("output" in value)) {
      return false;
    }

    return true;
  }
}

export function createDemoAgentHandlers(): AgentHandlers {
  return {
    coordinator(input) {
      return {
        summary: `Plan task "${input.title}" in a deterministic four-step flow.`,
        steps: [
          { id: "analyze", description: "Interpret the user request.", kind: "analysis" },
          { id: "edit", description: "Prepare a focused implementation patch.", kind: "edit" },
          { id: "review", description: "Review the patch for regressions.", kind: "review" },
          { id: "test", description: "Summarize test execution results.", kind: "test" }
        ],
        requiresTests: true
      };
    },
    coder(input) {
      return {
        summary: `Prepared a placeholder patch proposal for: ${input.prompt}`,
        rationale:
          "Phase 1 uses injected agent contracts so the coordinator can validate and persist outputs before Phase 2 adds real model backends.",
        diff: `--- /dev/null\n+++ /dev/null\n@@\n+# Planned work for task: ${input.prompt}\n`,
        files: [],
        operations: [],
        commands: []
      };
    },
    reviewer() {
      return {
        summary: "Reviewer approved the placeholder patch flow.",
        approved: true,
        findings: []
      };
    },
    "test-runner"(input) {
      const passed = input.commands.every((command) => command.exitCode === 0);
      return {
        summary:
          input.commands.length > 0
            ? `Observed ${input.commands.length} test command result(s).`
            : "No configured test commands were executed.",
        passed,
        commandResults: input.commands.map((command) => ({
          command: command.command,
          exitCode: command.exitCode,
          stdout: command.stdout,
          stderr: command.stderr
        }))
      };
    },
    "coordinator-report"(input) {
      return {
        summary:
          input.outcome === "completed"
            ? `Completed task with ${input.patchResult.changedFiles.length} changed file(s).`
            : `Task blocked after patch review/testing: ${input.blockerReason ?? "unknown blocker"}.`,
        outcome: input.outcome,
        changedFiles: [...input.patchResult.changedFiles],
        testsPassed: input.testReport?.passed ?? null,
        followUps:
          input.outcome === "completed"
            ? []
            : [input.blockerReason ?? "Investigate the blocker before retrying."]
      };
    }
  };
}

class BlockedTaskError extends Error {}
