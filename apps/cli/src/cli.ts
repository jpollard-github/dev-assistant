import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  enrichReviewerOutput,
  mergeTestWriterIntoCoderProposal,
  parseAdvisoryAgentOutput,
  parseAgentOutput,
  reconcileCoderProposal,
  sanitizeCoderProposal,
  type AdvisoryAgentOutputMap,
  type AgentOutputMap,
  type CoderOutput
} from "@dev-assistant/agents";
import {
  TaskCoordinator,
  SqliteTaskEventStore,
  type AgentExecutionEnvelope,
  type ModelTokenUsage,
  type TaskEvent
} from "@dev-assistant/core";
import {
  createAdvisoryAgentToolkit,
  createCapabilityBackedAgentHandlers,
  createFallbackProvider,
  createHostedModelProvider,
  createOllamaProvider,
  type LocalModelProvider
} from "@dev-assistant/llm";
import {
  clearPanicMode,
  createGitMcpServer,
  createMemoryMcpServer,
  createPatchMcpServer,
  createRepoMcpServer,
  createShellMcpServer,
  createShellRunnerFromMcpServer,
  createTestMcpServer,
  isPanicModeEnabled,
  triggerPanicMode,
  type MemoryMcpServer
} from "@dev-assistant/mcp-servers";
import {
  DEFAULT_CONFIG_FILE,
  ensureDataDir,
  estimateHostedCostForWorkflow,
  estimateHostedUsageCost,
  scanRepositoryForHostedSecrets,
  loadAssistantConfig,
  writeLocalCrashReport,
  resolveHostedModelName,
  resolveHostedProviderName,
  resolvePanicFilePath,
  resolveProcessRegistryPath,
  resolveRepoPath,
  resolveRoleRouteTarget,
  type HostedCostEstimate,
  type RoutedAssistantRole,
  createLogger,
  type AssistantConfig
} from "@dev-assistant/shared";
import {
  buildConfigDoctorReport,
  buildInitConfigTemplate,
  buildRuntimeDoctorReport,
  detectPackageManager,
  parseDiffFiles
} from "./utils.js";

const logger = createLogger("cli");

interface BaseCommandContext {
  readonly config: AssistantConfig;
  readonly dataDir: string;
  readonly repoPath: string;
  readonly store: SqliteTaskEventStore;
  readonly memoryServer: MemoryMcpServer;
  readonly shellServer: ReturnType<typeof createShellMcpServer>;
  readonly testServer: ReturnType<typeof createTestMcpServer>;
  readonly patchServer: ReturnType<typeof createPatchMcpServer>;
}

interface ModelCommandContext extends BaseCommandContext {
  readonly agents: ReturnType<typeof createCapabilityBackedAgentHandlers>;
  readonly advisoryToolkit: ReturnType<typeof createAdvisoryAgentToolkit>;
}

interface ModelUsageRecord {
  readonly role: RoutedAssistantRole;
  readonly provider: string;
  readonly model: string;
  readonly durationMs: number;
  readonly tokenUsage?: ModelTokenUsage;
  readonly finishReason?: string;
}

interface CommandFlags {
  readonly json: boolean;
}

interface RunFlags extends CommandFlags {
  readonly approve: boolean;
  readonly dryRun: boolean;
}

interface ReviewResult {
  readonly taskId: string;
  readonly diffFiles: readonly string[];
  readonly review: AgentOutputMap["reviewer"];
  readonly costEstimate: HostedCostEstimate;
  readonly modelUsage: ReturnType<typeof summarizeModelUsage>;
}

interface TestResultSummary {
  readonly packageManager: string;
  readonly commandCount: number;
  readonly summary: AgentOutputMap["test-runner"];
}

interface HostedRoutingPreflight {
  readonly workflow: "run" | "review";
  readonly hostedRoles: readonly string[];
  readonly requiresPrivateRepoAcknowledgement: boolean;
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = [...argv].filter((arg) => arg !== "--");
  const command = args[0] ?? "help";

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      printVersion();
      return;
    case "config":
      await handleConfig(args.slice(1));
      return;
    case "doctor":
      await handleDoctor(args.slice(1));
      return;
    case "init":
      await handleInit(args.slice(1));
      return;
    case "run":
      await handleRun(args.slice(1));
      return;
    case "review":
      await handleReview(args.slice(1));
      return;
    case "test":
      await handleTest(args.slice(1));
      return;
    case "history":
      await handleHistory(args.slice(1));
      return;
    case "panic":
      await handlePanic(args.slice(1));
      return;
    case "debt":
      await handleDebt(args.slice(1));
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command "${command}". Run "dev-assistant help" for usage.`);
  }
}

function printHelp(): void {
  console.log(`dev-assistant

Commands:
  dev-assistant init [--force] [--json]
  dev-assistant version
  dev-assistant doctor [--json]
  dev-assistant config [--json]
  dev-assistant config doctor [--json]
  dev-assistant run "task description" [--approve] [--dry-run] [--json]
  dev-assistant review [--json]
  dev-assistant test [--json]
  dev-assistant debt list [--json]
  dev-assistant debt add --title "..." [--severity high|medium|low|--priority must-fix|should-fix|nice-to-have] --rationale "..." --fix "..." [--files a,b] [--task-id id] [--json]
  dev-assistant debt resolve <id> [--note "..."] [--json]
  dev-assistant debt defer <id> [--note "..."] [--json]
  dev-assistant debt export [--format json|markdown] [--json]
  dev-assistant history [task-id] [--json]
  dev-assistant panic [--clear] [--json]
  dev-assistant help

Notes:
  --json suppresses CLI progress logs and prints machine-readable output.
  --approve auto-approves risky actions for the current run.
  --dry-run previews a run without applying edits or executing configured tests.
`);
}

function printVersion(): void {
  console.log("dev-assistant 0.1.0");
}

async function handleConfig(args: string[]): Promise<void> {
  if (args[0] === "doctor") {
    await handleConfigDoctor(args.slice(1));
    return;
  }

  const { flags } = parseCommonFlags(args);
  const config = loadAssistantConfig();
  const dataDir = ensureDataDir(config);

  if (!flags.json) {
    logger.info("Loaded assistant config", {
      approvalPolicy: config.approvalPolicy,
      dataDir,
      mode: config.mode,
      modelName: config.model.name,
      modelProvider: config.model.provider,
      repoPath: resolveRepoPath(config),
      testCommandCount: config.testCommands.length,
      allowedShellCommandCount: config.allowedShellCommands.length
    });
  }

  emit(flags, config, JSON.stringify(config, null, 2));
}

async function handleDoctor(args: string[]): Promise<void> {
  const { flags } = parseCommonFlags(args);
  const report = buildRuntimeDoctorReport(process.cwd());
  emit(flags, report, formatDoctorReport(report));
}

async function handleInit(args: string[]): Promise<void> {
  const { flags, rest } = parseCommonFlags(args);
  const force = consumeFlag(rest, "--force").value;
  const configPath = resolve(process.cwd(), DEFAULT_CONFIG_FILE);

  if (existsSync(configPath) && !force) {
    throw new Error(`${DEFAULT_CONFIG_FILE} already exists. Re-run with --force to overwrite it.`);
  }

  const template = buildInitConfigTemplate(process.cwd());
  writeFileSync(configPath, JSON.stringify(template, null, 2).concat("\n"), "utf8");

  emit(
    flags,
    {
      configPath,
      created: true,
      packageManager: detectPackageManager(process.cwd()),
      template
    },
    `Wrote ${DEFAULT_CONFIG_FILE} with local-first defaults.`
  );
}

async function handleRun(args: string[]): Promise<void> {
  const { flags, rest } = parseRunFlags(args);
  const prompt = rest.join(" ").trim();

  if (!prompt) {
    throw new Error('Usage: dev-assistant run "task description" [--approve] [--dry-run] [--json]');
  }

  const preflightConfig = loadAssistantConfig();
  await enforceHostedRoutingPreflight(
    buildHostedRoutingPreflight(preflightConfig, resolveRepoPath(preflightConfig), "run"),
    flags
  );

  const context = createModelCommandContext(flags.json);
  const costEstimate = estimateHostedCostForWorkflow(context.config, "run");
  assertEstimatedCostAllowed(context.config, costEstimate);
  if (!flags.json) {
    logger.info("Hosted cost estimate", {
      workflow: "run",
      range: formatCostEstimateRange(costEstimate),
      hostedRoles: costEstimate.lineItems.map((item) => ({
        role: item.role,
        route: item.route,
        model: item.model
      }))
    });
  }

  try {
    const modelUsageRecords: ModelUsageRecord[] = [];
    const coordinator = new TaskCoordinator({
      store: context.store,
      agents: context.agents,
      patchApplier: {
        apply(_taskId, proposal) {
          return flags.dryRun ? previewPatchResult(proposal) : context.patchServer.applyProposal(proposal);
        }
      },
      shellRunner: createShellRunnerFromMcpServer(context.shellServer),
      approvalDecider: {
        decide: (request) => resolveApproval(request, context.config, flags)
      }
    });

    if (!flags.json) {
      coordinator.eventBus.subscribe((event) => {
        logger.info("Task event", {
          taskId: event.taskId,
          type: event.type
        });
      });
    }

    coordinator.eventBus.subscribe((event) => {
      const record = extractModelUsageRecord(event);
      if (record) {
        modelUsageRecords.push(record);
      }
    });

    const result = await coordinator.runTask({
      prompt,
      config: {
        allowedShellCommands: context.config.allowedShellCommands,
        approvalPolicy: flags.dryRun ? "never" : context.config.approvalPolicy,
        formatCommands: flags.dryRun ? [] : context.config.formatCommands,
        testCommands: flags.dryRun ? [] : context.config.testCommands
      }
    });

    const advisory = await buildAdvisorySummary(context, result, prompt, flags.dryRun, flags);
    if (advisory) {
      modelUsageRecords.push(...advisory.modelUsage);
    }
    const modelUsage = summarizeModelUsage(context.config, modelUsageRecords);
    const payload = {
      task: result.task,
      usage: result.usage,
      costEstimate,
      modelUsage,
      approvals: result.approvals,
      outputRoles: Object.keys(result.outputs),
      dryRun: flags.dryRun,
      summary: {
        changedFiles: result.outputs["coordinator-report"]?.changedFiles ?? [],
        reviewerApproved: result.outputs.reviewer?.approved ?? null,
        reviewerFindings: result.outputs.reviewer?.findings ?? [],
        testPassed: result.outputs["test-runner"]?.passed ?? null,
        testCommandResults: result.outputs["test-runner"]?.commandResults ?? [],
        finalReport: result.outputs["coordinator-report"] ?? null
      },
      advisory: advisory
        ? {
            testWriter: advisory.testWriter,
            architectureReview: advisory.architectureReview,
            technicalDebt: advisory.technicalDebt
          }
        : null
    };

    emit(flags, payload, formatRunSummary(payload));
  } finally {
    context.store.close();
  }
}

async function handleReview(args: string[]): Promise<void> {
  const { flags } = parseCommonFlags(args);
  const preflightConfig = loadAssistantConfig();
  await enforceHostedRoutingPreflight(
    buildHostedRoutingPreflight(preflightConfig, resolveRepoPath(preflightConfig), "review"),
    flags
  );
  const context = createModelCommandContext(flags.json);
  const costEstimate = estimateHostedCostForWorkflow(context.config, "review");
  assertEstimatedCostAllowed(context.config, costEstimate);

  if (!flags.json) {
    logger.info("Hosted cost estimate", {
      workflow: "review",
      range: formatCostEstimateRange(costEstimate),
      hostedRoles: costEstimate.lineItems.map((item) => ({
        role: item.role,
        route: item.route,
        model: item.model
      }))
    });
  }

  try {
    const result = await runReview(context, costEstimate);
    emit(
      flags,
      result,
      formatReviewSummary(result)
    );
  } finally {
    context.store.close();
  }
}

async function handleTest(args: string[]): Promise<void> {
  const { flags } = parseCommonFlags(args);
  const context = createBaseCommandContext(flags.json);

  try {
    const summary = await context.testServer.runConfiguredTestCommands(context.config.testCommands);
    const payload: TestResultSummary = {
      packageManager: summary.packageManager,
      commandCount: summary.commandResults.length,
      summary: {
        summary:
          summary.commandResults.length > 0
            ? `Observed ${summary.commandResults.length} configured test command result(s).`
            : "No configured test commands were executed.",
        passed: summary.passed,
        commandResults: summary.commandResults.map((result) => ({
          command: result.command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr
        }))
      }
    };

    emit(flags, payload, formatTestSummary(payload));
  } finally {
    context.store.close();
  }
}

async function handleHistory(args: string[]): Promise<void> {
  const { flags, rest } = parseCommonFlags(args);
  const context = createBaseCommandContext(flags.json, { enforcePanic: false });
  const taskId = rest[0];

  try {
    if (taskId) {
      const task = context.store.getTask(taskId);
      const events = context.store.listEvents(taskId);
      const payload = { task, events };
      emit(flags, payload, formatHistoryDetail(payload));
      return;
    }

    const tasks = await context.memoryServer.listTaskHistory(20);
    emit(flags, tasks, formatHistoryList(tasks));
  } finally {
    context.store.close();
  }
}

async function handlePanic(args: string[]): Promise<void> {
  const { flags, rest } = parseCommonFlags(args);
  const clear = consumeFlag(rest, "--clear").value;
  const config = loadAssistantConfig();
  const panicFilePath = resolvePanicFilePath(config);
  const processRegistryPath = resolveProcessRegistryPath(config);

  if (clear) {
    clearPanicMode({ panicFilePath, processRegistryPath });
    emit(
      flags,
      { cleared: true, panicFilePath, processRegistryPath },
      "Cleared panic mode and removed the local process registry."
    );
    return;
  }

  const result = triggerPanicMode({ panicFilePath, processRegistryPath });
  emit(
    flags,
    {
      enabled: true,
      panicFilePath,
      processRegistryPath,
      killedPids: result.killedPids
    },
    `Enabled panic mode and terminated ${result.killedPids.length} registered subprocess(es).`
  );
}

async function handleDebt(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "list";

  if (subcommand === "list") {
    const { flags, rest } = parseCommonFlags(args.slice(1));
    const context = createBaseCommandContext(flags.json, { enforcePanic: false });
    const status = optionalOption(rest, "--status");

    try {
      const items = await context.memoryServer.listDebtItems({
        includeResolved: status === "resolved",
        ...(isDebtStatus(status) ? { status } : {})
      });
      emit(
        flags,
        {
          items
        },
        formatDebtList(items)
      );
    } finally {
      context.store.close();
    }
    return;
  }

  if (subcommand === "add") {
    const { flags, rest } = parseCommonFlags(args.slice(1));
    const title = requireOption(rest, "--title");
    const priority = optionalOption(rest, "--priority");
    const severity = optionalOption(rest, "--severity");
    const rationale = requireOption(rest, "--rationale");
    const recommendedFix = requireOption(rest, "--fix");
    const files = optionalOption(rest, "--files")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    const taskId = optionalOption(rest, "--task-id") ?? "manual";
    const context = createBaseCommandContext(flags.json, { enforcePanic: false });

    try {
      if (severity && !isDebtSeverity(severity)) {
        throw new Error(`Invalid severity "${severity}". Use high, medium, or low.`);
      }

      if (!severity && (!priority || !isDebtPriority(priority))) {
        throw new Error(`Provide either --severity high|medium|low or --priority must-fix|should-fix|nice-to-have.`);
      }

      const normalizedSeverity = isDebtSeverity(severity) ? severity : null;
      const normalizedPriority = priority && isDebtPriority(priority) ? priority : null;

      await context.memoryServer.appendDebtItems([
        {
          title,
          ...(normalizedSeverity ? { severity: normalizedSeverity } : { priority: normalizedPriority! }),
          files,
          rationale,
          recommendedFix,
          taskId,
          source: "manual"
        }
      ]);

      emit(
        flags,
        {
          added: true,
          title,
          severity: severity ?? priority ?? "medium",
          taskId,
          files
        },
        `Added debt item "${title}".`
      );
    } finally {
      context.store.close();
    }
    return;
  }

  if (subcommand === "resolve" || subcommand === "defer") {
    const { flags, rest } = parseCommonFlags(args.slice(1));
    const id = rest[0];
    const note = optionalOption(rest, "--note") ?? undefined;
    const context = createBaseCommandContext(flags.json, { enforcePanic: false });

    try {
      if (!id) {
        throw new Error(`Usage: dev-assistant debt ${subcommand} <id> [--note "..."] [--json]`);
      }

      const item =
        subcommand === "resolve"
          ? await context.memoryServer.resolveDebtItem(id, note)
          : await context.memoryServer.deferDebtItem(id, note);

      emit(
        flags,
        item,
        `${subcommand === "resolve" ? "Resolved" : "Deferred"} debt item "${item.title}" (${item.id}).`
      );
    } finally {
      context.store.close();
    }
    return;
  }

  if (subcommand === "export") {
    const { flags, rest } = parseCommonFlags(args.slice(1));
    const format = optionalOption(rest, "--format") ?? "markdown";
    const context = createBaseCommandContext(flags.json, { enforcePanic: false });

    try {
      if (format !== "markdown" && format !== "json") {
        throw new Error(`Invalid export format "${format}". Use markdown or json.`);
      }

      const output = await context.memoryServer.exportDebtItems(format);
      emit(flags, { format, output }, output.trim().length > 0 ? output : "No debt entries recorded yet.");
    } finally {
      context.store.close();
    }
    return;
  }

  throw new Error(`Unknown debt subcommand "${subcommand}". Use "debt list", "debt add", "debt resolve", "debt defer", or "debt export".`);
}

async function handleConfigDoctor(args: string[]): Promise<void> {
  const { flags } = parseCommonFlags(args);
  const report = buildConfigDoctorReport(process.cwd());
  emit(flags, report, formatDoctorReport(report));
}

function createBaseCommandContext(
  jsonMode: boolean,
  options: { readonly enforcePanic?: boolean } = {}
): BaseCommandContext {
  const config = loadAssistantConfig();
  const dataDir = ensureDataDir(config);
  const repoPath = resolveRepoPath(config);
  if (options.enforcePanic ?? true) {
    assertAssistantActionAllowed(config);
  }
  const store = new SqliteTaskEventStore(join(dataDir, "tasks.sqlite"));
  const repoServer = createRepoMcpServer(repoPath, {
    allowSecretAccess: config.security.allowSecretAccess,
    blockBinaryFiles: config.security.blockBinaryFiles,
    maxContextFileBytes: config.security.maxContextFileBytes
  });
  const gitServer = createGitMcpServer(repoPath);
  const shellServer = createShellMcpServer({
    repoPath,
    allowlist: config.allowedShellCommands,
    allowNetwork: config.security.allowNetwork,
    allowDependencyInstalls: config.security.allowDependencyInstalls,
    allowPackageScripts: config.security.allowPackageScripts,
    safety: {
      panicFilePath: resolvePanicFilePath(config),
      processRegistryPath: resolveProcessRegistryPath(config)
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
    requireProvenanceComments: config.security.requireProvenanceComments,
    allowedWritePaths: config.security.allowedWritePaths,
    ...(config.security.requiredGitBranch
      ? { requiredBranch: config.security.requiredGitBranch }
      : {})
  });
  const memoryServer = createMemoryMcpServer({
    repoPath,
    dataDir
  });

  if (!jsonMode) {
    logger.debug("CLI context created", {
      repoPath,
      dataDir,
      mode: config.mode
    });
  }

  return {
    config,
    dataDir,
    repoPath,
    store,
    memoryServer,
    shellServer,
    testServer,
    patchServer
  };
}

function createModelCommandContext(jsonMode: boolean): ModelCommandContext {
  const base = createBaseCommandContext(jsonMode);
  const providerForRole = createProviderResolver(base.config);
  const repoServer = createRepoMcpServer(base.repoPath, {
    allowSecretAccess: base.config.security.allowSecretAccess,
    blockBinaryFiles: base.config.security.blockBinaryFiles,
    maxContextFileBytes: base.config.security.maxContextFileBytes
  });
  const gitServer = createGitMcpServer(base.repoPath);
  const advisoryToolkit = createAdvisoryAgentToolkit({
    providerForRole,
    repoPath: base.repoPath,
    repoServer,
    gitServer,
    testServer: base.testServer,
    memoryServer: base.memoryServer,
    advisoryTimeouts: {
      "test-writer": 20_000,
      "architecture-review": 20_000,
      "technical-debt": 20_000
    }
  });
  const agents = createAugmentedAgentHandlers(base.repoPath, base.config.testCommands, createCapabilityBackedAgentHandlers({
    providerForRole,
    repoPath: base.repoPath,
    repoServer,
    gitServer,
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
  }), advisoryToolkit);
  return {
    ...base,
    agents,
    advisoryToolkit
  };
}

async function runReview(
  context: ModelCommandContext,
  costEstimate: HostedCostEstimate
): Promise<ReviewResult> {
  const taskId = randomUUID();
  const diff = await createGitMcpServer(context.repoPath).diff();
  const diffFiles = parseDiffFiles(diff);

  if (diff.trim().length === 0) {
    return {
      taskId,
      diffFiles: [],
      costEstimate,
      review: {
        summary: "No current diff to review.",
        approved: true,
        findings: []
      },
      modelUsage: summarizeModelUsage(context.config, [])
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
  const modelUsageRecords = [extractUsageRecordFromEnvelope("reviewer", raw as AgentExecutionEnvelope)].filter(
    (record): record is ModelUsageRecord => record !== null
  );

  return {
    taskId,
    diffFiles,
    review: normalizeAgentOutput("reviewer", raw),
    costEstimate,
    modelUsage: summarizeModelUsage(context.config, modelUsageRecords)
  };
}

async function buildAdvisorySummary(
  context: ModelCommandContext,
  result: {
    readonly task: { id: string };
    readonly outputs: Partial<AgentOutputMap>;
  },
  prompt: string,
  dryRun: boolean,
  flags: RunFlags
): Promise<{
  readonly testWriter: Awaited<ReturnType<typeof context.advisoryToolkit.testWriter>>["output"] | null;
  readonly architectureReview:
    | Awaited<ReturnType<typeof context.advisoryToolkit.architectureReview>>["output"]
    | null;
  readonly technicalDebt: Awaited<ReturnType<typeof context.advisoryToolkit.technicalDebt>>["output"] | null;
  readonly modelUsage: readonly ModelUsageRecord[];
} | null> {
  if (!result.outputs.coordinator || !result.outputs.coder || !result.outputs.reviewer) {
    return null;
  }

  const architectureReview = await context.advisoryToolkit.architectureReview({
    taskId: result.task.id,
    prompt,
    plan: result.outputs.coordinator,
    proposal: result.outputs.coder
  });

  const testWriter =
    (result.outputs.coordinator.requiresTests || result.outputs.coder.files.length > 0) &&
    !result.outputs.coder.files.some((file) => isLikelyTestPath(file.path))
      ? await context.advisoryToolkit.testWriter({
          taskId: result.task.id,
          prompt,
          plan: result.outputs.coordinator,
          proposal: result.outputs.coder
        })
      : null;

  const technicalDebt = await context.advisoryToolkit.technicalDebt({
    taskId: result.task.id,
    prompt,
    proposal: result.outputs.coder,
    reviewer: result.outputs.reviewer,
    architectureReview: architectureReview.output
  });

  if (!dryRun) {
    const generatedItems = [
      ...technicalDebt.output.items.map((item) => ({
        title: item.title,
        severity: mapDebtPriorityToSeverity(item.priority),
        files: [...item.files],
        rationale: item.rationale,
        recommendedFix: item.recommendedFix,
        taskId: result.task.id,
        source: "technical-debt-agent" as const
      })),
      ...result.outputs.reviewer.findings.map((finding, index) => ({
        title: `Reviewer finding ${index + 1}: ${truncateSentence(finding.message)}`,
        severity: mapReviewerSeverity(finding.severity),
        files: finding.filePath ? [finding.filePath] : [],
        rationale: finding.message,
        recommendedFix: "Address the reviewer finding and rerun the relevant tests.",
        taskId: result.task.id,
        source: "reviewer" as const
      })),
      ...architectureReview.output.recommendations.map((recommendation, index) => ({
        title: `Architecture recommendation ${index + 1}: ${truncateSentence(recommendation.message)}`,
        severity: mapReviewerSeverity(recommendation.severity),
        files: recommendation.filePath ? [recommendation.filePath] : [],
        rationale: recommendation.message,
        recommendedFix: "Refactor the boundary or dependency direction before the concern spreads further.",
        taskId: result.task.id,
        source: "architecture-review" as const
      }))
    ];

    const approvedItems = await filterNoisyDebtItems(generatedItems, flags);
    await context.memoryServer.appendDebtItems(approvedItems);
  }

  return {
    testWriter: testWriter?.output ?? null,
    architectureReview: architectureReview.output,
    technicalDebt: technicalDebt.output,
    modelUsage: [
      extractUsageRecordFromEnvelope("architecture-review", architectureReview),
      extractUsageRecordFromEnvelope("technical-debt", technicalDebt),
      testWriter ? extractUsageRecordFromEnvelope("test-writer", testWriter) : null
    ].filter((record): record is ModelUsageRecord => record !== null)
  };
}

function previewPatchResult(proposal: CoderOutput) {
  const changedFiles =
    proposal.operations.length > 0
      ? proposal.operations.map((operation) => operation.path)
      : proposal.files.map((file) => file.path);

  return {
    applied: false,
    changedFiles,
    operations: proposal.operations,
    summary: `Dry run only. Previewed ${changedFiles.length} file(s) without applying changes.`,
    finalDiff: proposal.diff,
    fileSnapshots: proposal.operations.map((operation) => ({
      path: operation.path,
      content: operation.changeType === "delete" ? null : operation.content ?? null
    })),
    formattingCommands: []
  };
}

async function resolveApproval(
  request: { readonly kind: string; readonly files?: readonly string[]; readonly command?: string },
  config: AssistantConfig,
  flags: RunFlags
): Promise<{ approved: boolean; approver: string; rationale: string }> {
  if (config.approvalPolicy === "never") {
    return {
      approved: true,
      approver: "policy",
      rationale: "Approval policy disabled checkpoints."
    };
  }

  if (flags.approve) {
    return {
      approved: true,
      approver: "cli",
      rationale: `Approved ${request.kind} via --approve.`
    };
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    return {
      approved: false,
      approver: "cli",
      rationale: `Re-run with --approve or use an interactive terminal to allow ${request.kind}.`
    };
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const target =
      request.kind === "file-edit"
        ? `files: ${(request.files ?? []).join(", ")}`
        : `command: ${request.command ?? "(unknown)"}`;
    const answer = await rl.question(`Approve ${request.kind} for ${target}? [y/N] `);
    const approved = /^y(es)?$/i.test(answer.trim());
    return {
      approved,
      approver: "interactive-cli",
      rationale: approved ? `Approved ${request.kind} interactively.` : `Denied ${request.kind} interactively.`
    };
  } finally {
    rl.close();
  }
}


function createProviderResolver(
  config: AssistantConfig
): (role: RoutedAssistantRole) => LocalModelProvider {
  const localProvider = createLocalProvider(config);
  const cache = new Map<string, LocalModelProvider>([["local", localProvider]]);

  return (role) => {
    const route = resolveRoleRouteTarget(config, role);
    if (route === "local") {
      return localProvider;
    }

    if (config.mode === "local-only") {
      throw new Error(
        `Role "${role}" is routed to ${route}, but local-only mode blocks hosted providers.`
      );
    }

    assertHostedCodeContextAllowed(config);

    if (route === "hosted") {
      const cached = cache.get("hosted");
      if (cached) {
        return cached;
      }

      const hostedProvider = createHostedProvider(config, resolveHostedProviderName(config));
      cache.set("hosted", hostedProvider);
      return hostedProvider;
    }

    const cached = cache.get("hybrid");
    if (cached) {
      return cached;
    }

    const hostedFallback = createHostedProvider(
      config,
      `${resolveHostedProviderName(config)}-fallback`
    );
    const hybridProvider = createFallbackProvider(localProvider, hostedFallback);
    cache.set("hybrid", hybridProvider);
    return hybridProvider;
  };
}

function createLocalProvider(config: AssistantConfig): LocalModelProvider {
  if (config.model.provider !== "ollama" && config.model.provider !== "hosted") {
    throw new Error(
      `Model provider "${config.model.provider}" is not implemented yet. Phase 11 currently supports ollama-backed local routing and hosted routing.`
    );
  }

  return createOllamaProvider({
    model: config.model.name
  });
}

function createHostedProvider(
  config: AssistantConfig,
  providerName: string
): LocalModelProvider {
  if (!config.hosted) {
    throw new Error(
      'Hosted provider requires a "hosted" config block with "baseUrl" and "apiKeyEnvVar".'
    );
  }

  return createHostedModelProvider({
    model: resolveHostedModelName(config),
    baseUrl: config.hosted.baseUrl,
    apiKey: requireHostedApiKey(config.hosted.apiKeyEnvVar),
    providerName
  });
}

function assertAssistantActionAllowed(config: AssistantConfig): void {
  if (isPanicModeEnabled(resolvePanicFilePath(config))) {
    throw new Error("Panic mode is enabled. Run `dev-assistant panic --clear` before starting new assistant actions.");
  }
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

function requireHostedApiKey(envVarName: string): string {
  const apiKey = process.env[envVarName];
  if (!apiKey) {
    throw new Error(`Hosted provider API key is missing. Set ${envVarName} in your environment.`);
  }

  return apiKey;
}

function buildHostedRoutingPreflight(
  config: AssistantConfig,
  repoPath: string,
  workflow: "run" | "review"
): HostedRoutingPreflight {
  const estimate = estimateHostedCostForWorkflow(config, workflow);
  if (estimate.lineItems.length === 0) {
    return {
      workflow,
      hostedRoles: [],
      requiresPrivateRepoAcknowledgement: false
    };
  }

  const findings = scanRepositoryForHostedSecrets(repoPath, {
    maxFileBytes: config.security.maxContextFileBytes,
    maxFindings: 5
  });
  if (findings.length > 0) {
    throw new Error(
      `Hosted routing blocked by preflight secret scan. Findings: ${findings.map((finding) => `${finding.path} (${finding.reason})`).join("; ")}`
    );
  }

  return {
    workflow,
    hostedRoles: estimate.lineItems.map((item) => item.role),
    requiresPrivateRepoAcknowledgement:
      config.repositoryPrivacy === "private" && estimate.lineItems.length > 0
  };
}

async function enforceHostedRoutingPreflight(
  preflight: HostedRoutingPreflight,
  flags: RunFlags | CommandFlags
): Promise<void> {
  if (!preflight.requiresPrivateRepoAcknowledgement) {
    return;
  }

  if ("approve" in flags && flags.approve) {
    return;
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      `Private-repository hosted routing for ${preflight.workflow} requires interactive acknowledgement or --approve. Hosted roles: ${preflight.hostedRoles.join(", ")}.`
    );
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `This ${preflight.workflow} routes private repository context to hosted roles (${preflight.hostedRoles.join(", ")}). Continue? [y/N] `
    );
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new Error("Hosted routing cancelled because private-repository acknowledgement was denied.");
    }
  } finally {
    rl.close();
  }
}

function assertEstimatedCostAllowed(config: AssistantConfig, estimate: HostedCostEstimate): void {
  const maxTaskCost = config.hosted?.pricing?.maxTaskCost;
  if (maxTaskCost !== undefined && estimate.maximumCost > maxTaskCost) {
    throw new Error(
      `Estimated hosted cost ${formatCurrency(estimate.maximumCost, estimate.currency)} exceeds hosted.pricing.maxTaskCost (${formatCurrency(maxTaskCost, estimate.currency)}).`
    );
  }
}

function extractModelUsageRecord(event: TaskEvent): ModelUsageRecord | null {
  if (event.type !== "tool.result" || event.payload.tool !== "llm-provider") {
    return null;
  }

  const result = event.payload.result as {
    readonly role: RoutedAssistantRole;
    readonly provider: string;
    readonly model: string;
    readonly durationMs: number;
    readonly tokenUsage?: ModelTokenUsage;
    readonly finishReason?: string;
  };

  return withOptionalProperties(
    {
      role: result.role,
      provider: result.provider,
      model: result.model,
      durationMs: result.durationMs
    },
    {
      tokenUsage: result.tokenUsage,
      finishReason: result.finishReason
    }
  );
}

function extractUsageRecordFromEnvelope(
  role: RoutedAssistantRole,
  value: AgentExecutionEnvelope | { output: unknown; metadata?: AgentExecutionEnvelope["metadata"] }
): ModelUsageRecord | null {
  if (!("metadata" in value) || !value.metadata?.provider || !value.metadata.model) {
    return null;
  }

  return withOptionalProperties(
    {
      role,
      provider: value.metadata.provider,
      model: value.metadata.model,
      durationMs: value.metadata.durationMs ?? 0
    },
    {
      tokenUsage: value.metadata.tokenUsage,
      finishReason: value.metadata.finishReason
    }
  );
}

function withOptionalProperties<TBase extends object, TOptional extends Record<string, unknown>>(
  base: TBase,
  optional: TOptional
): TBase & Partial<TOptional> {
  return Object.fromEntries(
    [...Object.entries(base), ...Object.entries(optional).filter(([, value]) => value !== undefined)]
  ) as TBase & Partial<TOptional>;
}

function summarizeModelUsage(config: AssistantConfig, records: readonly ModelUsageRecord[]) {
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    hostedCost: 0
  };

  const normalizedRecords = records.map((record) => {
    totals.durationMs += record.durationMs;
    totals.inputTokens += record.tokenUsage?.inputTokens ?? 0;
    totals.outputTokens += record.tokenUsage?.outputTokens ?? 0;
    totals.totalTokens +=
      record.tokenUsage?.totalTokens ??
      (record.tokenUsage?.inputTokens ?? 0) + (record.tokenUsage?.outputTokens ?? 0);

    const route = resolveRoleRouteTarget(config, record.role);
    const billedHosted =
      route !== "local" && record.provider !== "ollama" && record.provider !== "deterministic";
    const estimatedCost = billedHosted
      ? estimateHostedUsageCost(config.hosted?.pricing, record.tokenUsage)
      : 0;
    totals.hostedCost += estimatedCost;

    return {
      ...record,
      route,
      estimatedHostedCost: estimatedCost
    };
  });

  return {
    totalCalls: normalizedRecords.length,
    hostedCalls: normalizedRecords.filter((record) => record.estimatedHostedCost > 0).length,
    totals,
    records: normalizedRecords
  };
}

function formatCostEstimateRange(estimate: HostedCostEstimate): string {
  if (estimate.maximumCost === 0) {
    return formatCurrency(0, estimate.currency);
  }

  if (estimate.minimumCost === estimate.maximumCost) {
    return formatCurrency(estimate.maximumCost, estimate.currency);
  }

  return `${formatCurrency(estimate.minimumCost, estimate.currency)}-${formatCurrency(estimate.maximumCost, estimate.currency)}`;
}

function formatCurrency(value: number, currency: string): string {
  if (currency.toUpperCase() === "USD") {
    return `$${value.toFixed(4)}`;
  }

  return `${value.toFixed(4)} ${currency}`;
}

function formatDebtList(
  items: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly severity: string;
    readonly status: string;
    readonly files: readonly string[];
    readonly ageDays: number;
  }>
): string {
  if (items.length === 0) {
    return "No debt entries recorded yet.";
  }

  return items
    .map(
      (item) =>
        `- ${item.id} [${item.severity}/${item.status}] ${item.title} (${item.ageDays}d old${item.files.length > 0 ? `; ${item.files.join(", ")}` : ""})`
    )
    .join("\n");
}

async function filterNoisyDebtItems<
  T extends {
    readonly title: string;
    readonly severity: "high" | "medium" | "low";
    readonly files: readonly string[];
    readonly source: string;
  }
>(items: readonly T[], flags: RunFlags): Promise<T[]> {
  const kept: T[] = [];

  for (const item of items) {
    if (!isNoisyDebtItem(item)) {
      kept.push(item);
      continue;
    }

    if (flags.approve) {
      kept.push(item);
      continue;
    }

    const approved = await confirmDebtCandidate(item);
    if (approved) {
      kept.push(item);
    }
  }

  return kept;
}

function isNoisyDebtItem(item: {
  readonly severity: "high" | "medium" | "low";
  readonly files: readonly string[];
  readonly title: string;
}): boolean {
  return item.severity === "low" || item.files.length === 0 || item.title.length > 110;
}

async function confirmDebtCandidate(item: {
  readonly title: string;
  readonly severity: string;
  readonly files: readonly string[];
  readonly source: string;
}): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) {
    return false;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `Add low-signal debt candidate from ${item.source}? "${item.title}" [severity=${item.severity}${item.files.length > 0 ? ` files=${item.files.join(",")}` : ""}] [y/N] `
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function mapDebtPriorityToSeverity(priority: "must-fix" | "should-fix" | "nice-to-have"): "high" | "medium" | "low" {
  switch (priority) {
    case "must-fix":
      return "high";
    case "should-fix":
      return "medium";
    case "nice-to-have":
      return "low";
  }
}

function mapReviewerSeverity(severity: "low" | "medium" | "high"): "high" | "medium" | "low" {
  switch (severity) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
  }
}

function truncateSentence(value: string, maxLength = 72): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function normalizeAgentOutput<TRole extends keyof AgentOutputMap>(
  role: TRole,
  value: unknown | AgentExecutionEnvelope
): AgentOutputMap[TRole] {
  if (typeof value === "object" && value !== null && "output" in value) {
    return parseAgentOutput(role, (value as AgentExecutionEnvelope).output);
  }

  return parseAgentOutput(role, value);
}

function normalizeAdvisoryOutput<TRole extends keyof AdvisoryAgentOutputMap>(
  role: TRole,
  value: { output: AdvisoryAgentOutputMap[TRole] } | AgentExecutionEnvelope
): AdvisoryAgentOutputMap[TRole] {
  if (typeof value === "object" && value !== null && "output" in value) {
    return parseAdvisoryAgentOutput(role, (value as AgentExecutionEnvelope).output);
  }

  return parseAdvisoryAgentOutput(role, (value as { output: AdvisoryAgentOutputMap[TRole] }).output);
}

function createAugmentedAgentHandlers(
  repoPath: string,
  testCommands: readonly string[],
  agents: ReturnType<typeof createCapabilityBackedAgentHandlers>,
  advisoryToolkit: ReturnType<typeof createAdvisoryAgentToolkit>
): ReturnType<typeof createCapabilityBackedAgentHandlers> {
  return {
    ...agents,
    async coder(input) {
      const raw = await agents.coder(input);
      const proposal = normalizeCoderProposalPaths(
        repoPath,
        sanitizeCoderProposal(normalizeAgentOutput("coder", raw), input.prompt)
      );

      if (!shouldAugmentProposalWithTests(proposal, testCommands)) {
        return replaceEnvelopeOutput(raw, proposal);
      }

      try {
        const testWriterRaw = await advisoryToolkit.testWriter({
          taskId: input.taskId,
          prompt: input.prompt,
          plan: input.plan,
          proposal
        });

        const merged = mergeTestWriterIntoCoderProposal(
          proposal,
          normalizeAdvisoryOutput("test-writer", testWriterRaw)
        );

        return replaceEnvelopeOutput(raw, normalizeCoderProposalPaths(repoPath, merged));
      } catch {
        return replaceEnvelopeOutput(raw, proposal);
      }
    },
    async reviewer(input) {
      const raw = await agents.reviewer(input);
      const review = normalizeAgentOutput("reviewer", raw);
      const changedPaths =
        input.patchResult.changedFiles.length > 0
          ? input.patchResult.changedFiles.map((path) => toRepoRelativePath(repoPath, path))
          : input.proposal.files.map((file) => file.path);
      const enhanced = enrichReviewerOutput(review, input.patchResult.finalDiff, changedPaths);
      return replaceEnvelopeOutput(raw, enhanced);
    }
  };
}

function shouldAugmentProposalWithTests(
  proposal: CoderOutput,
  testCommands: readonly string[]
): boolean {
  return (
    testCommands.length > 0 &&
    proposal.operations.length > 0 &&
    !proposal.files.some((file) => isLikelyTestPath(file.path))
  );
}

function isLikelyTestPath(path: string): boolean {
  return /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

function replaceEnvelopeOutput<TOutput>(
  value: unknown | AgentExecutionEnvelope,
  output: TOutput
): TOutput | AgentExecutionEnvelope {
  if (typeof value === "object" && value !== null && "output" in value) {
    return {
      ...(value as AgentExecutionEnvelope),
      output
    };
  }

  return output;
}

function normalizeCoderProposalPaths(repoPath: string, proposal: CoderOutput): CoderOutput {
  return reconcileCoderProposal({
    ...proposal,
    files: proposal.files.map((file) => ({
      ...file,
      path: toRepoRelativePath(repoPath, file.path)
    })),
    operations: proposal.operations.map((operation) => ({
      ...operation,
      path: toRepoRelativePath(repoPath, operation.path)
    }))
  });
}

function toRepoRelativePath(repoPath: string, path: string): string {
  return path.startsWith(repoPath) ? path.slice(repoPath.length).replace(/^\/+/, "") : path;
}


function parseCommonFlags(args: string[]): { flags: CommandFlags; rest: string[] } {
  const json = consumeFlag(args, "--json");
  return {
    flags: {
      json: json.value
    },
    rest: json.rest
  };
}

function parseRunFlags(args: string[]): { flags: RunFlags; rest: string[] } {
  const json = consumeFlag(args, "--json");
  const approve = consumeFlag(json.rest, "--approve");
  const dryRun = consumeFlag(approve.rest, "--dry-run");

  return {
    flags: {
      json: json.value,
      approve: approve.value,
      dryRun: dryRun.value
    },
    rest: dryRun.rest
  };
}

function consumeFlag(args: readonly string[], flag: string): { value: boolean; rest: string[] } {
  let found = false;
  const rest = args.filter((arg) => {
    if (!found && arg === flag) {
      found = true;
      return false;
    }
    return true;
  });

  return { value: found, rest };
}

function optionalOption(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }

  const value = args[index + 1];
  return value === undefined ? null : value;
}

function requireOption(args: readonly string[], name: string): string {
  const value = optionalOption(args, name);
  if (!value) {
    throw new Error(`Missing required option ${name}.`);
  }

  return value;
}

function emit(flags: CommandFlags, payload: unknown, human: string): void {
  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(human);
}

function formatRunSummary(payload: {
  readonly task: { id: string; status: string };
  readonly dryRun: boolean;
  readonly costEstimate: HostedCostEstimate;
  readonly modelUsage: ReturnType<typeof summarizeModelUsage>;
  readonly summary: {
    readonly changedFiles: readonly string[];
    readonly reviewerApproved: boolean | null;
    readonly testPassed: boolean | null;
    readonly finalReport: AgentOutputMap["coordinator-report"] | null;
  };
}): string {
  const changedFiles =
    payload.summary.changedFiles.length > 0
      ? payload.summary.changedFiles.map((file) => `- ${file}`).join("\n")
      : "- none";

  return [
    `Task ${payload.task.id} finished with status: ${payload.task.status}${payload.dryRun ? " (dry run)" : ""}`,
    `Hosted cost estimate: ${formatCostEstimateRange(payload.costEstimate)}`,
    `Hosted cost observed: ${formatCurrency(payload.modelUsage.totals.hostedCost, payload.costEstimate.currency)}`,
    `Reviewer approved: ${payload.summary.reviewerApproved === null ? "n/a" : payload.summary.reviewerApproved ? "yes" : "no"}`,
    `Tests passed: ${payload.summary.testPassed === null ? "not run" : payload.summary.testPassed ? "yes" : "no"}`,
    "Changed files:",
    changedFiles,
    payload.summary.finalReport ? `Final report: ${payload.summary.finalReport.summary}` : ""
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function formatReviewSummary(result: ReviewResult): string {
  const findings =
    result.review.findings.length > 0
      ? result.review.findings
          .map((finding) => `- [${finding.severity}] ${finding.message}`)
          .join("\n")
      : "- none";

  return [
    `Review task ${result.taskId}`,
    `Files reviewed: ${result.diffFiles.length > 0 ? result.diffFiles.join(", ") : "none"}`,
    `Hosted cost estimate: ${formatCostEstimateRange(result.costEstimate)}`,
    `Hosted cost observed: ${formatCurrency(result.modelUsage.totals.hostedCost, result.costEstimate.currency)}`,
    `Approved: ${result.review.approved ? "yes" : "no"}`,
    `Summary: ${result.review.summary}`,
    "Findings:",
    findings
  ].join("\n");
}

function formatTestSummary(result: TestResultSummary): string {
  return [
    `Package manager: ${result.packageManager}`,
    `Commands executed: ${result.commandCount}`,
    `Passed: ${result.summary.passed ? "yes" : "no"}`,
    `Summary: ${result.summary.summary}`
  ].join("\n");
}

function formatHistoryList(tasks: readonly { id: string; title: string; status: string; updatedAt: string }[]): string {
  if (tasks.length === 0) {
    return "No task history recorded yet.";
  }

  return tasks
    .map((task) => `${task.id} | ${task.status} | ${task.updatedAt} | ${task.title}`)
    .join("\n");
}

function formatHistoryDetail(payload: {
  readonly task: unknown;
  readonly events: readonly { type: string; timestamp: string }[];
}): string {
  if (!payload.task) {
    return "Task not found.";
  }

  return [
    "Task detail:",
    JSON.stringify(payload.task, null, 2),
    "Events:",
    payload.events.map((event) => `- ${event.timestamp} ${event.type}`).join("\n")
  ].join("\n");
}

function formatDoctorReport(report: {
  readonly status: string;
  readonly repoPath: string;
  readonly dataDir: string;
  readonly checks: readonly { name: string; status: string; message: string }[];
}): string {
  return [
    `Doctor status: ${report.status}`,
    `Repo path: ${report.repoPath}`,
    `Data dir: ${report.dataDir}`,
    "Checks:",
    report.checks.map((check) => `- [${check.status}] ${check.name}: ${check.message}`).join("\n")
  ].join("\n");
}

function isDebtPriority(value: string): value is "must-fix" | "should-fix" | "nice-to-have" {
  return value === "must-fix" || value === "should-fix" || value === "nice-to-have";
}

function isDebtSeverity(value: string | null): value is "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low";
}

function isDebtStatus(value: string | null): value is "open" | "deferred" | "resolved" {
  return value === "open" || value === "deferred" || value === "resolved";
}
