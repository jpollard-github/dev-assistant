#!/usr/bin/env node
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
  dev-assistant help

Local development:
  corepack pnpm build
  corepack pnpm dev -- version
  corepack pnpm dev -- config
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
