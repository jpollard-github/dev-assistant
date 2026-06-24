import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { inspectTaskEventStore } from "@dev-assistant/core";
import {
  DEFAULT_CONFIG_FILE,
  ensureDataDir,
  listCrashReports,
  estimateHostedCostForWorkflow,
  loadAssistantConfig,
  resolveRoleRouteTarget,
  resolvePanicFilePath,
  resolveRepoPath,
  routedAssistantRoles,
  type AssistantConfig
} from "@dev-assistant/shared";

export function buildInitConfigTemplate(cwd: string): AssistantConfig {
  const packageManager = detectPackageManager(cwd);
  const packageJsonPath = resolve(cwd, "package.json");
  const scripts = existsSync(packageJsonPath)
    ? ((JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {})
    : {};
  const defaultTestCommand = resolveScriptCommand(packageManager, "test", scripts);
  const defaultFormatCommand = resolveScriptCommand(packageManager, "format", scripts);
  const allowedShellCommands = [defaultTestCommand, defaultFormatCommand].filter(
    (value): value is string => value !== null
  );

  return {
    repoPath: ".",
    model: {
      provider: "ollama",
      name: "qwen2.5-coder:7b"
    },
    allowedShellCommands,
    formatCommands: defaultFormatCommand ? [defaultFormatCommand] : [],
    testCommands: defaultTestCommand ? [defaultTestCommand] : [],
    approvalPolicy: "on-risky-action",
    dataDir: ".dev-assistant",
    mode: "local-only",
    repositoryPrivacy: "private",
    routing: {},
    crashReporting: {
      enabled: false,
      directory: ".dev-assistant/crash-reports"
    },
    security: {
      allowNetwork: false,
      allowSecretAccess: false,
      allowHostedCodeContext: false,
      redactLogs: true,
      requireProvenanceComments: true,
      panicFile: ".dev-assistant/panic.json",
      processRegistryFile: ".dev-assistant/processes.json"
    }
  };
}

export function buildConfigDoctorReport(cwd: string) {
  const configPath = resolve(cwd, DEFAULT_CONFIG_FILE);
  const configExists = existsSync(configPath);
  const config = loadAssistantConfig(cwd);
  const repoPath = resolveRepoPath(config, cwd);
  const repoExists = existsSync(repoPath);
  const dataDir = ensureDataDir(config, cwd);
  const checks = [
    {
      name: "config-file",
      status: configExists ? "ok" : "warning",
      message: configExists ? `${DEFAULT_CONFIG_FILE} found.` : `${DEFAULT_CONFIG_FILE} not found; defaults will be used.`
    },
    {
      name: "repo-path",
      status: repoExists ? "ok" : "error",
      message: repoExists ? `Resolved repo path exists: ${repoPath}` : `Resolved repo path is missing: ${repoPath}`
    },
    {
      name: "data-dir",
      status: "ok",
      message: `Data directory is available at ${dataDir}`
    },
    {
      name: "panic-mode",
      status: existsSync(resolvePanicFilePath(config, cwd)) ? "warning" : "ok",
      message: existsSync(resolvePanicFilePath(config, cwd))
        ? "Panic mode is enabled. Clear it before running assistant actions."
        : "Panic mode is not active."
    },
    {
      name: "crash-reporting",
      status: config.crashReporting.enabled ? "warning" : "ok",
      message: config.crashReporting.enabled
        ? `Crash reporting is enabled and will write local reports to ${config.crashReporting.directory}.`
        : "Crash reporting is disabled by default."
    },
    {
      name: "test-allowlist",
      status: config.testCommands.every((command) => config.allowedShellCommands.includes(command))
        ? "ok"
        : "warning",
      message: config.testCommands.every((command) => config.allowedShellCommands.includes(command))
        ? "All test commands are allowlisted."
        : "Some test commands are not present in allowedShellCommands."
    },
    {
      name: "format-allowlist",
      status: config.formatCommands.every((command) => config.allowedShellCommands.includes(command))
        ? "ok"
        : "warning",
      message: config.formatCommands.every((command) => config.allowedShellCommands.includes(command))
        ? "All format commands are allowlisted."
        : "Some format commands are not present in allowedShellCommands."
    },
    {
      name: "secret-access",
      status: config.security.allowSecretAccess ? "warning" : "ok",
      message: config.security.allowSecretAccess
        ? "Sensitive repository paths are readable by policy."
        : "Sensitive repository paths are blocked by default."
    },
    {
      name: "hosted-code-context",
      status:
        (config.mode === "hybrid" || config.mode === "hosted") && !config.security.allowHostedCodeContext
          ? "warning"
          : "ok",
      message:
        (config.mode === "hybrid" || config.mode === "hosted") && !config.security.allowHostedCodeContext
          ? "Hosted mode is configured, but sending repository code to hosted models is not opted in."
          : "Hosted code-context policy is aligned with the current mode."
    },
    {
      name: "repository-privacy",
      status:
        config.repositoryPrivacy === "private" &&
        routedAssistantRoles.some((role) => resolveRoleRouteTarget(config, role) !== "local")
          ? "warning"
          : "ok",
      message:
        config.repositoryPrivacy === "private" &&
        routedAssistantRoles.some((role) => resolveRoleRouteTarget(config, role) !== "local")
          ? "Private repository mode is routing some roles to hosted providers. Confirm that off-machine code access is acceptable."
          : `Repository privacy is set to ${config.repositoryPrivacy}.`
    },
    {
      name: "network-policy",
      status:
        config.security.allowNetwork ||
        config.allowedShellCommands.every((command) => !looksNetworkLike(command))
          ? "ok"
          : "warning",
      message:
        config.security.allowNetwork ||
        config.allowedShellCommands.every((command) => !looksNetworkLike(command))
          ? "Shell network policy is aligned with the allowlist."
          : "Some allowlisted shell commands appear network-capable while network access is disabled."
    },
    ...buildProviderChecks(config)
  ];

  const status = checks.some((check) => check.status === "error")
    ? "error"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "ok";

  return {
    status,
    repoPath,
    dataDir,
    checks
  };
}

export function buildRuntimeDoctorReport(cwd: string) {
  const configReport = buildConfigDoctorReport(cwd);
  const config = loadAssistantConfig(cwd);
  const dbPath = resolve(configReport.dataDir, "tasks.sqlite");
  const storeInspection = inspectTaskEventStore(dbPath);
  const crashReports = listCrashReports(config, cwd);

  const checks = [
    ...configReport.checks,
    {
      name: "task-store",
      status: "ok" as const,
      message: `SQLite task store schema v${storeInspection.schemaVersion} is ready at ${dbPath} (${storeInspection.taskCount} tasks, ${storeInspection.eventCount} events).`
    },
    {
      name: "crash-reports",
      status: config.crashReporting.enabled ? "warning" as const : "ok" as const,
      message: config.crashReporting.enabled
        ? `Crash reporting is enabled and ${crashReports.length} local report(s) are stored in ${config.crashReporting.directory}.`
        : "Crash reporting is disabled."
    },
    {
      name: "package-manager",
      status: detectPackageManager(cwd) === "unknown" ? "warning" as const : "ok" as const,
      message:
        detectPackageManager(cwd) === "unknown"
          ? "No supported package manager lockfile detected."
          : `Detected package manager: ${detectPackageManager(cwd)}.`
    }
  ];

  const status = checks.some((check) => check.status === "error")
    ? "error"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "ok";

  return {
    status,
    repoPath: configReport.repoPath,
    dataDir: configReport.dataDir,
    checks,
    taskStore: storeInspection,
    crashReportCount: crashReports.length
  };
}

export function parseDiffFiles(diff: string): string[] {
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

export function detectPackageManager(cwd: string): "pnpm" | "npm" | "yarn" | "bun" | "unknown" {
  if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(resolve(cwd, "package-lock.json"))) {
    return "npm";
  }
  if (existsSync(resolve(cwd, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(resolve(cwd, "bun.lockb")) || existsSync(resolve(cwd, "bun.lock"))) {
    return "bun";
  }

  return "unknown";
}

function resolveScriptCommand(
  packageManager: ReturnType<typeof detectPackageManager>,
  scriptName: string,
  scripts: Record<string, string>
): string | null {
  if (!(scriptName in scripts)) {
    return null;
  }

  switch (packageManager) {
    case "pnpm":
      return `corepack pnpm ${scriptName}`;
    case "npm":
      return `npm run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

function buildProviderChecks(config: AssistantConfig): Array<{ name: string; status: "ok" | "warning" | "error"; message: string }> {
  const checks: Array<{ name: string; status: "ok" | "warning" | "error"; message: string }> = [];

  if (config.model.provider === "ollama") {
    const result = spawnSync("ollama", ["--version"], { encoding: "utf8" });
    if (result.status === 0) {
      checks.push({
        name: "ollama",
        status: "ok",
        message: result.stdout.trim() || result.stderr.trim() || "Ollama is installed."
      });
    } else {
      checks.push({
        name: "ollama",
        status: "warning",
        message: "Ollama was not detected on PATH."
      });
    }
  }

  if ((config.mode === "hybrid" || config.mode === "hosted") && config.hosted) {
    const estimate = estimateHostedCostForWorkflow(config, "run");
    checks.push(
      {
        name: "hosted-provider",
        status:
          config.security.allowNetwork && process.env[config.hosted.apiKeyEnvVar]
            ? "ok"
            : "warning",
        message: process.env[config.hosted.apiKeyEnvVar]
          ? config.security.allowNetwork
            ? `Hosted provider API key env var ${config.hosted.apiKeyEnvVar} is set.`
            : `Hosted provider API key is set, but network access is disabled.`
          : `Hosted provider API key env var ${config.hosted.apiKeyEnvVar} is not set.`
      },
      {
        name: "hosted-routing",
        status: estimate.lineItems.length > 0 ? "ok" : "warning",
        message:
          estimate.lineItems.length > 0
            ? `Hosted routing is active for ${estimate.lineItems.map((item) => item.role).join(", ")}.`
            : "Hosted mode is configured, but no current workflow roles are routed to hosted providers."
      },
      {
        name: "hosted-pricing",
        status: config.hosted.pricing ? "ok" : "warning",
        message: config.hosted.pricing
          ? `Hosted pricing is configured with an estimated run cost range of ${estimate.minimumCost.toFixed(4)}-${estimate.maximumCost.toFixed(4)} ${estimate.currency}.`
          : "Hosted pricing is not configured, so CLI cost estimates will remain at zero."
      }
    );
  }

  return checks;
}

function looksNetworkLike(command: string): boolean {
  return /curl|wget|ssh|scp|https?:\/\/|npm install|pnpm add|yarn add|git pull|git push/i.test(command);
}
