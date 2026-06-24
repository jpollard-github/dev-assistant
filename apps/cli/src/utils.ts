import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { DEFAULT_CONFIG_FILE, ensureDataDir, loadAssistantConfig, resolveRepoPath, type AssistantConfig } from "@dev-assistant/shared";

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
    mode: "local-only"
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
  if (config.model.provider === "ollama") {
    const result = spawnSync("ollama", ["--version"], { encoding: "utf8" });
    if (result.status === 0) {
      return [
        {
          name: "ollama",
          status: "ok",
          message: result.stdout.trim() || result.stderr.trim() || "Ollama is installed."
        }
      ];
    }

    return [
      {
        name: "ollama",
        status: "warning",
        message: "Ollama was not detected on PATH."
      }
    ];
  }

  if ((config.mode === "hybrid" || config.mode === "hosted") && config.hosted) {
    return [
      {
        name: "hosted-provider",
        status: process.env[config.hosted.apiKeyEnvVar] ? "ok" : "warning",
        message: process.env[config.hosted.apiKeyEnvVar]
          ? `Hosted provider API key env var ${config.hosted.apiKeyEnvVar} is set.`
          : `Hosted provider API key env var ${config.hosted.apiKeyEnvVar} is not set.`
      }
    ];
  }

  return [];
}
