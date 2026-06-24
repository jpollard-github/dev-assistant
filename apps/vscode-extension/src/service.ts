import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { AgentOutputMap, AdvisoryAgentOutputMap, CoderOutput } from "@dev-assistant/agents";
import { parseAgentOutput, parseAdvisoryAgentOutput } from "@dev-assistant/agents";
import { SqliteTaskEventStore, TaskCoordinator, type AgentExecutionEnvelope, type ApprovalDecision, type ApprovalRequest, type TaskEvent, type TaskRunResult } from "@dev-assistant/core";
import {
  createAdvisoryAgentToolkit,
  createCapabilityBackedAgentHandlers,
  createFallbackProvider,
  createHostedModelProvider,
  createOllamaProvider
} from "@dev-assistant/llm";
import {
  isPanicModeEnabled,
  createGitMcpServer,
  createMemoryMcpServer,
  createPatchMcpServer,
  createRepoMcpServer,
  createShellMcpServer,
  createShellRunnerFromMcpServer,
  createTestMcpServer
} from "@dev-assistant/mcp-servers";
import {
  ensureDataDir,
  loadAssistantConfig,
  resolvePanicFilePath,
  resolveProcessRegistryPath,
  resolveRepoPath,
  type AssistantConfig
} from "@dev-assistant/shared";

export interface StartTaskOptions {
  readonly title?: string;
  readonly prompt: string;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: TaskEvent) => void | Promise<void>;
  readonly requestApproval: (request: ApprovalRequest) => Promise<ApprovalDecision>;
}

export interface ReviewSummary {
  readonly taskId: string;
  readonly diffFiles: readonly string[];
  readonly review: AgentOutputMap["reviewer"];
}

export interface TestGenerationSummary {
  readonly taskId: string;
  readonly filePath: string;
  readonly output: AdvisoryAgentOutputMap["test-writer"];
}

export interface TechnicalDebtSummary {
  readonly taskId: string;
  readonly output: AdvisoryAgentOutputMap["technical-debt"];
  readonly architecture: AdvisoryAgentOutputMap["architecture-review"];
  readonly review: AgentOutputMap["reviewer"];
  readonly diffFiles: readonly string[];
}

export class LocalWorkspaceService {
  public constructor(private readonly workspacePath: string) {}

  public listTaskHistory(limit = 20): {
    readonly tasks: ReturnType<SqliteTaskEventStore["listTasks"]>;
    readonly eventsByTaskId: Record<string, readonly TaskEvent[]>;
  } {
    const store = this.createStore();
    try {
      const tasks = store.listTasks(limit);
      const eventsByTaskId = Object.fromEntries(
        tasks.map((task) => [task.id, store.listEvents(task.id)])
      );

      return { tasks, eventsByTaskId };
    } finally {
      store.close();
    }
  }

  public startTask(options: StartTaskOptions): Promise<TaskRunResult> {
    const context = this.createModelContext();
    const coordinator = new TaskCoordinator({
      store: context.store,
      agents: context.agents,
      patchApplier: {
        apply(taskId, proposal) {
          return context.patchServer.applyProposal(proposal);
        }
      },
      shellRunner: createShellRunnerFromMcpServer(context.shellServer),
      approvalDecider: {
        decide: options.requestApproval
      }
    });

    if (options.onEvent) {
      coordinator.eventBus.subscribe(options.onEvent);
    }

    return coordinator
      .runTask({
        prompt: options.prompt,
        ...(options.title ? { title: options.title } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        config: {
          allowedShellCommands: context.config.allowedShellCommands,
          approvalPolicy: context.config.approvalPolicy,
          formatCommands: context.config.formatCommands,
          testCommands: context.config.testCommands
        }
      })
      .finally(() => {
        context.store.close();
      });
  }

  public async reviewCurrentDiff(): Promise<ReviewSummary> {
    const context = this.createModelContext();

    try {
      const taskId = randomUUID();
      const diff = await createGitMcpServer(context.repoPath).diff();
      const diffFiles = parseDiffFiles(diff);

      if (diff.trim().length === 0) {
        return {
          taskId,
          diffFiles: [],
          review: {
            summary: "No current diff to review.",
            approved: true,
            findings: []
          }
        };
      }

      const raw = await context.agents.reviewer({
        taskId,
        prompt: "Review the current repository diff for correctness and regressions.",
        plan: {
          summary: "Review current diff.",
          steps: [{ id: "review", description: "Review current diff only.", kind: "review" }],
          requiresTests: false
        },
        proposal: {
          summary: "Current repository diff",
          rationale: "Review-only command using the current working tree diff.",
          diff,
          files: diffFiles.map((path) => ({
            path,
            changeType: "update" as const
          })),
          operations: [],
          commands: []
        },
        patchResult: {
          applied: false,
          changedFiles: diffFiles,
          operations: [],
          summary: "Reviewing current git diff without applying changes.",
          finalDiff: diff,
          fileSnapshots: [],
          formattingCommands: []
        }
      });

      return {
        taskId,
        diffFiles,
        review: normalizeAgentOutput("reviewer", raw)
      };
    } finally {
      context.store.close();
    }
  }

  public async generateTestsForFile(filePath: string): Promise<TestGenerationSummary> {
    const context = this.createModelContext();

    try {
      const taskId = randomUUID();
      const relativePath = resolveRelativePath(this.workspacePath, filePath);
      const gitDiff = await context.gitServer.diff(["--", relativePath]);
      const fileContents = await context.repoServer.readFile(relativePath);
      const proposal = buildSingleFileProposal(relativePath, fileContents, gitDiff);

      const raw = await context.advisoryToolkit.testWriter({
        taskId,
        prompt: `Generate focused tests for ${relativePath}.`,
        plan: {
          summary: `Recommend tests for ${relativePath}.`,
          steps: [{ id: "test", description: "Inspect the file and suggest focused coverage.", kind: "test" }],
          requiresTests: true
        },
        proposal
      });

      return {
        taskId,
        filePath: relativePath,
        output: normalizeAdvisoryOutput("test-writer", raw)
      };
    } finally {
      context.store.close();
    }
  }

  public async explainTechnicalDebt(): Promise<TechnicalDebtSummary> {
    const context = this.createModelContext();

    try {
      const taskId = randomUUID();
      const diff = await context.gitServer.diff();
      const diffFiles = parseDiffFiles(diff);
      const filesToInspect =
        diffFiles.length > 0 ? diffFiles : [await pickFallbackFile(context.repoServer)];
      const proposal = await buildRepositoryProposal(context.repoServer, context.gitServer, filesToInspect, diff);

      const reviewRaw = await context.agents.reviewer({
        taskId,
        prompt: "Review the current repository changes and identify likely risks.",
        plan: {
          summary: "Review repository changes for risk signals.",
          steps: [{ id: "review", description: "Inspect changed files for issues.", kind: "review" }],
          requiresTests: false
        },
        proposal,
        patchResult: {
          applied: false,
          changedFiles: proposal.files.map((file) => file.path),
          operations: proposal.operations,
          summary: "Technical debt review uses the current workspace state.",
          finalDiff: proposal.diff,
          fileSnapshots: proposal.operations.map((operation) => ({
            path: operation.path,
            content: operation.changeType === "delete" ? null : operation.content ?? null
          })),
          formattingCommands: []
        }
      });
      const review = normalizeAgentOutput("reviewer", reviewRaw);

      const architectureRaw = await context.advisoryToolkit.architectureReview({
        taskId,
        prompt: "Highlight architecture and maintainability risks in the current changes.",
        plan: {
          summary: "Architecture review for current changes.",
          steps: [{ id: "architecture", description: "Explain maintainability concerns.", kind: "review" }],
          requiresTests: false
        },
        proposal
      });
      const architecture = normalizeAdvisoryOutput("architecture-review", architectureRaw);

      const debtRaw = await context.advisoryToolkit.technicalDebt({
        taskId,
        prompt: "Explain the technical debt in the current workspace changes.",
        proposal,
        reviewer: review,
        architectureReview: architecture
      });

      return {
        taskId,
        output: normalizeAdvisoryOutput("technical-debt", debtRaw),
        architecture,
        review,
        diffFiles
      };
    } finally {
      context.store.close();
    }
  }

  private createStore(): SqliteTaskEventStore {
    const config = loadAssistantConfig(this.workspacePath);
    const dataDir = ensureDataDir(config, this.workspacePath);
    return new SqliteTaskEventStore(join(dataDir, "tasks.sqlite"));
  }

  private createBaseContext() {
    const config = loadAssistantConfig(this.workspacePath);
    const dataDir = ensureDataDir(config, this.workspacePath);
    const repoPath = resolveRepoPath(config, this.workspacePath);
    if (isPanicModeEnabled(resolvePanicFilePath(config, this.workspacePath))) {
      throw new Error("Panic mode is enabled. Clear it from the CLI before starting new assistant actions.");
    }
    const store = new SqliteTaskEventStore(join(dataDir, "tasks.sqlite"));
    const repoServer = createRepoMcpServer(repoPath, {
      allowSecretAccess: config.security.allowSecretAccess
    });
    const gitServer = createGitMcpServer(repoPath);
    const shellServer = createShellMcpServer({
      repoPath,
      allowlist: config.allowedShellCommands,
      allowNetwork: config.security.allowNetwork,
      safety: {
        panicFilePath: resolvePanicFilePath(config, this.workspacePath),
        processRegistryPath: resolveProcessRegistryPath(config, this.workspacePath)
      }
    });
    const testServer = createTestMcpServer({
      repoPath,
      shellServer
    });
    const patchServer = createPatchMcpServer({
      repoPath,
      formatCommands: config.formatCommands,
      shellServer,
      requireProvenanceComments: config.security.requireProvenanceComments
    });
    const memoryServer = createMemoryMcpServer({
      repoPath,
      dataDir
    });

    return {
      config,
      dataDir,
      repoPath,
      store,
      repoServer,
      gitServer,
      shellServer,
      testServer,
      patchServer,
      memoryServer
    };
  }

  private createModelContext() {
    const base = this.createBaseContext();
    const provider = resolveModelProvider(base.config);
    const agents = createCapabilityBackedAgentHandlers({
      provider,
      repoPath: base.repoPath,
      repoServer: base.repoServer,
      gitServer: base.gitServer,
      testServer: base.testServer,
      memoryServer: base.memoryServer,
      timeouts: {
        coordinator: 20_000,
        coder: 45_000,
        reviewer: 30_000,
        "test-runner": 20_000,
        "coordinator-report": 20_000
      },
      advisoryTimeouts: {
        "test-writer": 20_000,
        "architecture-review": 20_000,
        "technical-debt": 20_000
      }
    });
    const advisoryToolkit = createAdvisoryAgentToolkit({
      provider,
      repoPath: base.repoPath,
      repoServer: base.repoServer,
      gitServer: base.gitServer,
      testServer: base.testServer,
      memoryServer: base.memoryServer,
      advisoryTimeouts: {
        "test-writer": 20_000,
        "architecture-review": 20_000,
        "technical-debt": 20_000
      }
    });

    return {
      ...base,
      agents,
      advisoryToolkit
    };
  }
}

function resolveModelProvider(config: AssistantConfig) {
  if (config.model.provider === "ollama") {
    const ollamaProvider = createOllamaProvider({
      model: config.model.name
    });

    if (config.mode === "hybrid" && config.hosted) {
      assertHostedCodeContextAllowed(config);
      return createFallbackProvider(
        ollamaProvider,
        createHostedModelProvider({
          model: config.model.name,
          baseUrl: config.hosted.baseUrl,
          apiKey: requireHostedApiKey(config.hosted.apiKeyEnvVar),
          providerName: "hosted-fallback"
        })
      );
    }

    return ollamaProvider;
  }

  if (config.model.provider === "hosted") {
    assertHostedCodeContextAllowed(config);
    if (!config.hosted) {
      throw new Error("Hosted model provider selected but hosted config is missing.");
    }

    return createHostedModelProvider({
      model: config.model.name,
      baseUrl: config.hosted.baseUrl,
      apiKey: requireHostedApiKey(config.hosted.apiKeyEnvVar)
    });
  }

  throw new Error(`Model provider "${config.model.provider}" is not yet implemented in the extension.`);
}

function assertHostedCodeContextAllowed(config: AssistantConfig): void {
  if (!config.security.allowNetwork) {
    throw new Error("Hosted or hybrid model routing requires security.allowNetwork=true.");
  }

  if (!config.security.allowHostedCodeContext) {
    throw new Error(
      "Hosted or hybrid model routing is blocked until security.allowHostedCodeContext=true explicitly opts in to sending repository code."
    );
  }
}

function requireHostedApiKey(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(`Hosted mode requires the ${envVar} environment variable.`);
  }

  return value;
}

function normalizeAgentOutput<TRole extends keyof AgentOutputMap>(
  role: TRole,
  value: unknown | AgentExecutionEnvelope
): AgentOutputMap[TRole] {
  if (isEnvelope(value)) {
    return parseAgentOutput(role, value.output);
  }

  return parseAgentOutput(role, value);
}

function normalizeAdvisoryOutput<TRole extends keyof AdvisoryAgentOutputMap>(
  role: TRole,
  value: { output: AdvisoryAgentOutputMap[TRole] } | AgentExecutionEnvelope
): AdvisoryAgentOutputMap[TRole] {
  if (isEnvelope(value)) {
    return parseAdvisoryAgentOutput(role, value.output);
  }

  return parseAdvisoryAgentOutput(role, value.output);
}

function isEnvelope(value: unknown): value is AgentExecutionEnvelope {
  return typeof value === "object" && value !== null && "output" in value;
}

function parseDiffFiles(diff: string): string[] {
  return [
    ...new Set(
      diff
        .split("\n")
        .filter((line) => line.startsWith("+++ b/"))
        .map((line) => line.replace("+++ b/", "").trim())
        .filter((line) => line.length > 0 && line !== "/dev/null")
    )
  ];
}

function resolveRelativePath(workspacePath: string, filePath: string): string {
  return filePath.startsWith(workspacePath)
    ? filePath.slice(workspacePath.length).replace(/^\/+/, "")
    : filePath;
}

function buildSingleFileProposal(filePath: string, content: string, diff: string): CoderOutput {
  return {
    summary: `Focused current-file proposal for ${filePath}.`,
    rationale: "The extension command scopes advisory output to the currently open file.",
    diff: diff.trim().length > 0 ? diff : `--- a/${filePath}\n+++ b/${filePath}\n`,
    files: [{ path: filePath, changeType: "update" }],
    operations: [{ path: filePath, changeType: "update", content }],
    commands: []
  };
}

async function buildRepositoryProposal(
  repoServer: ReturnType<typeof createRepoMcpServer>,
  gitServer: ReturnType<typeof createGitMcpServer>,
  filePaths: readonly string[],
  diff: string
): Promise<CoderOutput> {
  const files = await Promise.all(
    filePaths.map(async (filePath) => ({
      path: filePath,
      content: await repoServer.readFile(filePath)
    }))
  );

  return {
    summary: "Current repository state proposal.",
    rationale: "The extension synthesizes a proposal from the active diff so advisory agents can explain risks.",
    diff: diff.trim().length > 0 ? diff : await gitServer.diff(["--", ...filePaths]),
    files: files.map((file) => ({
      path: file.path,
      changeType: "update" as const
    })),
    operations: files.map((file) => ({
      path: file.path,
      changeType: "update" as const,
      content: file.content
    })),
    commands: []
  };
}

async function pickFallbackFile(
  repoServer: ReturnType<typeof createRepoMcpServer>
): Promise<string> {
  const files = await repoServer.listFiles({ recursive: true });
  const firstFile = files.find((entry) => entry.kind === "file" && !entry.path.startsWith(".dev-assistant/"));

  if (!firstFile) {
    throw new Error("No repository files were found for technical debt analysis.");
  }

  return firstFile.path;
}
