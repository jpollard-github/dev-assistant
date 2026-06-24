#!/usr/bin/env node
import { join } from "node:path";

import { TaskCoordinator, SqliteTaskEventStore } from "@dev-assistant/core";
import {
  createAdvisoryAgentToolkit,
  createCapabilityBackedAgentHandlers,
  createFallbackProvider,
  createHostedModelProvider,
  createOllamaProvider
} from "@dev-assistant/llm";
import {
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
  resolveRepoPath,
  createLogger
} from "@dev-assistant/shared";

const logger = createLogger("cli");

function printHelp(): void {
  console.log(`dev-assistant

Packaged CLI:
  dev-assistant version
  dev-assistant config
  dev-assistant run "task description" [--approve]
  dev-assistant help

Local development:
  corepack pnpm build
  corepack pnpm dev -- version
  corepack pnpm dev -- config
  corepack pnpm dev -- run "task description" [--approve]
  corepack pnpm dev -- help

The packaged CLI commands work after the CLI package is installed or linked.
The local development commands run this repository's built CLI entrypoint.
`);
}

function printVersion(): void {
  console.log("dev-assistant 0.1.0");
}

function printConfig(): void {
  const config = loadAssistantConfig();
  const dataDir = ensureDataDir(config);
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
  console.log(JSON.stringify(config, null, 2));
}

async function runTask(args: string[]): Promise<void> {
  const approve = args.includes("--approve");
  const taskArgs = args.filter((arg) => arg !== "--approve");
  const prompt = taskArgs.join(" ").trim();

  if (!prompt) {
    throw new Error('Usage: dev-assistant run "task description" [--approve]');
  }

  const config = loadAssistantConfig();
  const dataDir = ensureDataDir(config);
  const store = new SqliteTaskEventStore(join(dataDir, "tasks.sqlite"));
  const repoPath = resolveRepoPath(config);
  const repoServer = createRepoMcpServer(repoPath);
  const gitServer = createGitMcpServer(repoPath);
  const shellServer = createShellMcpServer({
    repoPath,
    allowlist: config.allowedShellCommands
  });
  const testServer = createTestMcpServer({
    repoPath,
    shellServer
  });
  const patchServer = createPatchMcpServer({
    repoPath,
    formatCommands: config.formatCommands,
    shellServer
  });
  const memoryServer = createMemoryMcpServer({
    repoPath,
    dataDir
  });
  const provider = resolveModelProvider(config);
  const agents = createCapabilityBackedAgentHandlers({
    provider,
    repoPath,
    repoServer,
    gitServer,
    testServer,
    memoryServer,
    timeouts: {
      coordinator: 20_000,
      coder: 45_000,
      reviewer: 30_000,
      "test-runner": 20_000
    },
    advisoryTimeouts: {
      "test-writer": 20_000,
      "architecture-review": 20_000,
      "technical-debt": 20_000
    }
  });
  const advisoryToolkit = createAdvisoryAgentToolkit({
    provider,
    repoPath,
    repoServer,
    gitServer,
    testServer,
    memoryServer,
    advisoryTimeouts: {
      "test-writer": 20_000,
      "architecture-review": 20_000,
      "technical-debt": 20_000
    }
  });
  const coordinator = new TaskCoordinator({
    store,
    agents,
    patchApplier: {
      apply(_taskId, proposal) {
        return patchServer.applyProposal(proposal);
      }
    },
    shellRunner: createShellRunnerFromMcpServer(shellServer),
    approvalDecider: {
      decide(request) {
        if (config.approvalPolicy === "never") {
          return {
            approved: true,
            approver: "policy",
            rationale: "Approval policy disabled checkpoints."
          };
        }

        if (approve) {
          return {
            approved: true,
            approver: "cli",
            rationale: `Approved ${request.kind} via --approve.`
          };
        }

        return {
          approved: false,
          approver: "cli",
          rationale: `Re-run with --approve to allow ${request.kind}.`
        };
      }
    }
  });

  coordinator.eventBus.subscribe((event) => {
    logger.info("Task event", {
      taskId: event.taskId,
      type: event.type
    });
  });

  const result = await coordinator.runTask({
    prompt,
    config: {
      allowedShellCommands: config.allowedShellCommands,
      approvalPolicy: config.approvalPolicy,
      formatCommands: config.formatCommands,
      testCommands: config.testCommands
    }
  });

  let advisorySummary:
    | {
        readonly testWriter: Awaited<ReturnType<typeof advisoryToolkit.testWriter>>["output"] | null;
        readonly architectureReview:
          | Awaited<ReturnType<typeof advisoryToolkit.architectureReview>>["output"]
          | null;
        readonly technicalDebt: Awaited<ReturnType<typeof advisoryToolkit.technicalDebt>>["output"] | null;
      }
    | null = null;

  if (result.outputs.coordinator && result.outputs.coder && result.outputs.reviewer) {
    const architectureReview = await advisoryToolkit.architectureReview({
      taskId: result.task.id,
      prompt,
      plan: result.outputs.coordinator,
      proposal: result.outputs.coder
    });

    const testWriter =
      result.outputs.coordinator.requiresTests || result.outputs.coder.files.length > 0
        ? await advisoryToolkit.testWriter({
            taskId: result.task.id,
            prompt,
            plan: result.outputs.coordinator,
            proposal: result.outputs.coder
          })
        : null;

    const technicalDebt = await advisoryToolkit.technicalDebt({
      taskId: result.task.id,
      prompt,
      proposal: result.outputs.coder,
      reviewer: result.outputs.reviewer,
      architectureReview: architectureReview.output
    });

    await memoryServer.appendDebtItems(
      technicalDebt.output.items.map((item) => ({
        ...item,
        taskId: result.task.id
      }))
    );

    advisorySummary = {
      testWriter: testWriter?.output ?? null,
      architectureReview: architectureReview.output,
      technicalDebt: technicalDebt.output
    };
  }

  console.log(
    JSON.stringify(
      {
        task: result.task,
        usage: result.usage,
        approvals: result.approvals,
        outputRoles: Object.keys(result.outputs),
        summary: {
          changedFiles: result.outputs["coordinator-report"]?.changedFiles ?? [],
          reviewerApproved: result.outputs.reviewer?.approved ?? null,
          reviewerFindings: result.outputs.reviewer?.findings ?? [],
          testPassed: result.outputs["test-runner"]?.passed ?? null,
          testCommandResults: result.outputs["test-runner"]?.commandResults ?? [],
          finalReport: result.outputs["coordinator-report"] ?? null
        },
        advisory: advisorySummary
      },
      null,
      2
    )
  );

  store.close();
}

function resolveModelProvider(config: ReturnType<typeof loadAssistantConfig>) {
  if (config.model.provider === "ollama") {
    const ollamaProvider = createOllamaProvider({
      model: config.model.name
    });

    if (config.mode === "hybrid" && config.hosted) {
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
    if (!config.hosted) {
      throw new Error(
        'Hosted provider requires a "hosted" config block with "baseUrl" and "apiKeyEnvVar".'
      );
    }

    return createHostedModelProvider({
      model: config.model.name,
      baseUrl: config.hosted.baseUrl,
      apiKey: requireHostedApiKey(config.hosted.apiKeyEnvVar),
      providerName: "hosted"
    });
  }

  throw new Error(
    `Model provider "${config.model.provider}" is not implemented yet. Phase 2 currently supports ollama and hosted fallback.`
  );
}

function requireHostedApiKey(envVarName: string): string {
  const apiKey = process.env[envVarName];
  if (!apiKey) {
    throw new Error(`Hosted provider API key is missing. Set ${envVarName} in your environment.`);
  }

  return apiKey;
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const command = args[0] ?? "help";

try {
  switch (command) {
    case "version":
    case "--version":
    case "-v":
      printVersion();
      break;
    case "config":
      printConfig();
      break;
    case "run":
      await runTask(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      logger.error("Unknown command", { command });
      printHelp();
      process.exitCode = 1;
  }
} catch (error) {
  logger.error("Command failed", {
    command,
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
}
