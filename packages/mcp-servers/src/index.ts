import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

import type { ShellCommandResult, ShellRunner } from "@dev-assistant/core";
import type { FileOperation } from "@dev-assistant/agents";
import {
  debtStoreSchema,
  debtItemInputSchema,
  containsLikelyDependencyInstallCommand,
  containsLikelyNetworkCommand,
  containsLikelyPackageScriptCommand,
  isLikelyBinaryContent,
  isSensitivePath,
  mapPriorityToSeverity,
  rankDebtSeverity,
  redactString
} from "@dev-assistant/shared";
import { renderDebtItemsAsMarkdown, type DebtItem, type DebtItemInput, type DebtStatus } from "@dev-assistant/shared";

const execFileAsync = promisify(execFile);

export const mcpServersPackageName = "@dev-assistant/mcp-servers";

export type AgentPermissionProfileName =
  | "coordinator"
  | "coder"
  | "reviewer"
  | "test-runner"
  | "test-writer"
  | "architecture-review"
  | "technical-debt";

export interface RepoListFilesOptions {
  readonly directory?: string;
  readonly recursive?: boolean;
}

export interface RepoFileRecord {
  readonly path: string;
  readonly kind: "file" | "directory";
}

export interface RepoFileMetadata {
  readonly path: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly isDirectory: boolean;
  readonly extension: string;
}

export interface RepoSearchResult {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly preview: string;
}

export interface RepoMcpServer {
  listFiles(options?: RepoListFilesOptions): Promise<readonly RepoFileRecord[]>;
  readFile(path: string): Promise<string>;
  search(pattern: string): Promise<readonly RepoSearchResult[]>;
  inspectFileMetadata(path: string): Promise<RepoFileMetadata>;
}

export interface RepoAccessPolicy {
  readonly allowSecretAccess: boolean;
  readonly blockBinaryFiles: boolean;
  readonly maxContextFileBytes: number;
}

export interface GitLogEntry {
  readonly commit: string;
  readonly author: string;
  readonly subject: string;
}

export interface GitMcpServer {
  status(): Promise<string>;
  diff(args?: readonly string[]): Promise<string>;
  log(limit?: number): Promise<readonly GitLogEntry[]>;
  currentBranch(): Promise<string>;
}

export interface ShellExecutionPolicy {
  readonly allowlist: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputChars: number;
  readonly allowNetwork: boolean;
  readonly allowDependencyInstalls: boolean;
  readonly allowPackageScripts: boolean;
}

export interface ShellExecutionResult extends ShellCommandResult {
  readonly truncated: boolean;
}

export interface ShellMcpServer {
  readonly policy: ShellExecutionPolicy;
  run(command: string): Promise<ShellExecutionResult>;
}

export interface ShellSafetyOptions {
  readonly panicFilePath?: string;
  readonly processRegistryPath?: string;
}

export interface PatchApplySummary {
  readonly applied: boolean;
  readonly changedFiles: readonly string[];
  readonly operations: readonly FileOperation[];
  readonly summary: string;
  readonly finalDiff: string;
  readonly fileSnapshots: readonly {
    readonly path: string;
    readonly content: string | null;
  }[];
  readonly formattingCommands: readonly ShellExecutionResult[];
}

export interface PatchMcpServer {
  applyProposal(proposal: {
    readonly summary: string;
    readonly operations: readonly FileOperation[];
    readonly files: readonly { path: string; changeType: "create" | "update" | "delete" }[];
    readonly diff: string;
  }): Promise<PatchApplySummary>;
}

export interface ParsedTestOutput {
  readonly framework: string | null;
  readonly passed: boolean;
  readonly passedCount: number | null;
  readonly failedCount: number | null;
  readonly rawSummary: string;
}

export interface TestRunSummary {
  readonly packageManager: "pnpm" | "npm" | "yarn" | "bun" | "unknown";
  readonly commandResults: readonly ShellExecutionResult[];
  readonly parsedResults: readonly ParsedTestOutput[];
  readonly passed: boolean;
}

export class QuarantinedFileAccessError extends Error {
  public constructor(path: string, reason: string) {
    super(`Access to "${path}" is quarantined from model context: ${reason}`);
  }
}

export class DependencyInstallPolicyError extends Error {
  public constructor(command: string) {
    super(`Dependency installation command "${command}" is blocked by policy.`);
  }
}

export class PackageScriptPolicyError extends Error {
  public constructor(command: string) {
    super(`Package-script command "${command}" is blocked by policy.`);
  }
}

export interface TestMcpServer {
  discoverPackageManager(): Promise<"pnpm" | "npm" | "yarn" | "bun" | "unknown">;
  runConfiguredTestCommands(commands: readonly string[]): Promise<TestRunSummary>;
  parseCommonTestOutput(output: Pick<ShellCommandResult, "stdout" | "stderr" | "exitCode">): ParsedTestOutput;
}

export interface MemoryTaskSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
}

export interface MemoryFailurePattern {
  readonly reason: string;
  readonly count: number;
}

export interface MemoryMcpServer {
  listTaskHistory(limit?: number): Promise<readonly MemoryTaskSummary[]>;
  readRepositoryFacts(): Promise<Record<string, unknown>>;
  writeRepositoryFacts(facts: Record<string, unknown>): Promise<void>;
  readDebtLog(): Promise<string>;
  listDebtItems(options?: {
    readonly includeResolved?: boolean;
    readonly status?: DebtStatus;
  }): Promise<readonly (DebtItem & { readonly ageDays: number })[]>;
  appendDebtItems(items: readonly {
    title: string;
    priority?: "must-fix" | "should-fix" | "nice-to-have";
    severity?: "high" | "medium" | "low";
    files: readonly string[];
    rationale: string;
    recommendedFix: string;
    taskId: string;
    source?: "manual" | "technical-debt-agent" | "reviewer" | "architecture-review";
    status?: DebtStatus;
  }[]): Promise<void>;
  resolveDebtItem(id: string, note?: string): Promise<DebtItem>;
  deferDebtItem(id: string, note?: string): Promise<DebtItem>;
  exportDebtItems(format?: "json" | "markdown"): Promise<string>;
  listRecurringFailurePatterns(limit?: number): Promise<readonly MemoryFailurePattern[]>;
}

export interface AgentPermissionProfile {
  readonly repo: {
    readonly listFiles: boolean;
    readonly readFiles: boolean;
    readonly search: boolean;
    readonly inspectMetadata: boolean;
  };
  readonly git: {
    readonly status: boolean;
    readonly diff: boolean;
    readonly log: boolean;
    readonly currentBranch: boolean;
  };
  readonly shell: {
    readonly runAllowlisted: boolean;
    readonly requestEscalation: boolean;
  };
  readonly test: {
    readonly discoverPackageManager: boolean;
    readonly runConfiguredCommands: boolean;
    readonly parseOutput: boolean;
  };
  readonly memory: {
    readonly taskHistory: boolean;
    readonly repositoryFacts: boolean;
    readonly debtLog: boolean;
    readonly recurringFailurePatterns: boolean;
  };
}

export const AGENT_PERMISSION_PROFILES: Record<AgentPermissionProfileName, AgentPermissionProfile> = {
  coordinator: {
    repo: { listFiles: true, readFiles: true, search: true, inspectMetadata: true },
    git: { status: true, diff: true, log: true, currentBranch: true },
    shell: { runAllowlisted: false, requestEscalation: true },
    test: { discoverPackageManager: true, runConfiguredCommands: false, parseOutput: true },
    memory: {
      taskHistory: true,
      repositoryFacts: true,
      debtLog: true,
      recurringFailurePatterns: true
    }
  },
  coder: {
    repo: { listFiles: true, readFiles: true, search: true, inspectMetadata: true },
    git: { status: true, diff: true, log: false, currentBranch: true },
    shell: { runAllowlisted: false, requestEscalation: true },
    test: { discoverPackageManager: true, runConfiguredCommands: false, parseOutput: true },
    memory: {
      taskHistory: true,
      repositoryFacts: true,
      debtLog: false,
      recurringFailurePatterns: true
    }
  },
  reviewer: {
    repo: { listFiles: true, readFiles: true, search: true, inspectMetadata: true },
    git: { status: true, diff: true, log: true, currentBranch: true },
    shell: { runAllowlisted: false, requestEscalation: false },
    test: { discoverPackageManager: false, runConfiguredCommands: false, parseOutput: true },
    memory: {
      taskHistory: true,
      repositoryFacts: true,
      debtLog: true,
      recurringFailurePatterns: true
    }
  },
  "test-runner": {
    repo: { listFiles: true, readFiles: true, search: false, inspectMetadata: true },
    git: { status: false, diff: false, log: false, currentBranch: false },
    shell: { runAllowlisted: true, requestEscalation: true },
    test: { discoverPackageManager: true, runConfiguredCommands: true, parseOutput: true },
    memory: {
      taskHistory: true,
      repositoryFacts: false,
      debtLog: false,
      recurringFailurePatterns: true
    }
  },
  "test-writer": {
    repo: { listFiles: true, readFiles: true, search: true, inspectMetadata: true },
    git: { status: true, diff: true, log: false, currentBranch: true },
    shell: { runAllowlisted: false, requestEscalation: true },
    test: { discoverPackageManager: true, runConfiguredCommands: false, parseOutput: true },
    memory: {
      taskHistory: true,
      repositoryFacts: true,
      debtLog: false,
      recurringFailurePatterns: true
    }
  },
  "architecture-review": {
    repo: { listFiles: true, readFiles: true, search: true, inspectMetadata: true },
    git: { status: true, diff: true, log: true, currentBranch: true },
    shell: { runAllowlisted: false, requestEscalation: false },
    test: { discoverPackageManager: false, runConfiguredCommands: false, parseOutput: true },
    memory: {
      taskHistory: true,
      repositoryFacts: true,
      debtLog: true,
      recurringFailurePatterns: true
    }
  },
  "technical-debt": {
    repo: { listFiles: true, readFiles: true, search: true, inspectMetadata: true },
    git: { status: true, diff: true, log: true, currentBranch: true },
    shell: { runAllowlisted: false, requestEscalation: false },
    test: { discoverPackageManager: false, runConfiguredCommands: false, parseOutput: true },
    memory: {
      taskHistory: true,
      repositoryFacts: true,
      debtLog: true,
      recurringFailurePatterns: true
    }
  }
};

export class ShellCommandApprovalRequiredError extends Error {
  public constructor(command: string, readonly allowlist: readonly string[]) {
    super(
      `Shell command "${command}" is not allowlisted. Request approval or add it to allowedShellCommands.`
    );
  }
}

export class SecretAccessDeniedError extends Error {
  public constructor(path: string) {
    super(`Access to sensitive path "${path}" is blocked by the current security policy.`);
  }
}

export class NetworkAccessDisabledError extends Error {
  public constructor(command: string) {
    super(`Network access is disabled by policy, so "${command}" cannot run.`);
  }
}

export class PanicModeEnabledError extends Error {
  public constructor() {
    super("Panic mode is enabled. Clear panic mode before running more assistant actions.");
  }
}

export function createRepoMcpServer(
  repoPath: string,
  policy: Partial<RepoAccessPolicy> = {}
): RepoMcpServer {
  const root = resolve(repoPath);
  const accessPolicy: RepoAccessPolicy = {
    allowSecretAccess: policy.allowSecretAccess ?? false,
    blockBinaryFiles: policy.blockBinaryFiles ?? true,
    maxContextFileBytes: policy.maxContextFileBytes ?? 262_144
  };

  return {
    async listFiles(options = {}) {
      const baseDir = resolve(root, options.directory ?? ".");
      ensurePathInsideRepo(root, baseDir);
      return walkFiles(root, baseDir, options.recursive ?? true, accessPolicy);
    },
    async readFile(path) {
      assertRepoPathAllowed(path, accessPolicy);
      const resolved = resolve(root, path);
      ensurePathInsideRepo(root, resolved);
      await assertContextFileAllowed(root, resolved, accessPolicy);
      return readFile(resolved, "utf8");
    },
    async search(pattern) {
      const result = await execFileAsync("rg", ["-n", "--column", "--no-heading", pattern, root], {
        encoding: "utf8",
        maxBuffer: 2_000_000
      }).catch((error: unknown) => {
        if (isExecErrorWithExitCode(error, 1)) {
          return { stdout: "", stderr: "" };
        }
        throw error;
      });

      return result.stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map(parseRipgrepLine)
        .filter((match) => !isSensitivePath(match.path) || accessPolicy.allowSecretAccess)
        .filter((match) => isRepoPathAllowedForContext(root, resolve(root, match.path), accessPolicy));
    },
    async inspectFileMetadata(path) {
      assertRepoPathAllowed(path, accessPolicy);
      const resolved = resolve(root, path);
      ensurePathInsideRepo(root, resolved);
      const info = await stat(resolved);
      return {
        path: normalizeRepoRelative(root, resolved),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        isDirectory: info.isDirectory(),
        extension: info.isDirectory() ? "" : extname(resolved)
      };
    }
  };
}

export function createGitMcpServer(repoPath: string): GitMcpServer {
  const cwd = resolve(repoPath);

  return {
    async status() {
      return runGit(cwd, ["status", "--short"]);
    },
    async diff(args = []) {
      return runGit(cwd, ["diff", ...args]);
    },
    async log(limit = 10) {
      const raw = await runGit(cwd, ["log", `-n${limit}`, "--pretty=format:%H%x09%an%x09%s"]);
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const [commit = "", author = "", subject = ""] = line.split("\t");
          return { commit, author, subject };
        });
    },
    async currentBranch() {
      return (await runGit(cwd, ["branch", "--show-current"])).trim();
    }
  };
}

export function createShellMcpServer(params: {
  readonly repoPath: string;
  readonly allowlist: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputChars?: number;
  readonly allowNetwork?: boolean;
  readonly allowDependencyInstalls?: boolean;
  readonly allowPackageScripts?: boolean;
  readonly safety?: ShellSafetyOptions;
}): ShellMcpServer {
  const policy: ShellExecutionPolicy = {
    allowlist: params.allowlist,
    timeoutMs: params.timeoutMs ?? 30_000,
    maxOutputChars: params.maxOutputChars ?? 8_000,
    allowNetwork: params.allowNetwork ?? false,
    allowDependencyInstalls: params.allowDependencyInstalls ?? false,
    allowPackageScripts: params.allowPackageScripts ?? true
  };

  return {
    policy,
    async run(command) {
      if (params.safety?.panicFilePath && isPanicModeEnabled(params.safety.panicFilePath)) {
        throw new PanicModeEnabledError();
      }

      if (!policy.allowlist.includes(command)) {
        throw new ShellCommandApprovalRequiredError(command, policy.allowlist);
      }

      if (!policy.allowNetwork && containsLikelyNetworkCommand(command)) {
        throw new NetworkAccessDisabledError(command);
      }

      if (!policy.allowDependencyInstalls && containsLikelyDependencyInstallCommand(command)) {
        throw new DependencyInstallPolicyError(command);
      }

      if (!policy.allowPackageScripts && containsLikelyPackageScriptCommand(command)) {
        throw new PackageScriptPolicyError(command);
      }

      const startedAt = Date.now();
      return runSandboxedShellCommand(command, params.repoPath, policy, startedAt, params.safety);
    }
  };
}

export function createShellRunnerFromMcpServer(server: ShellMcpServer): ShellRunner {
  return {
    run(command) {
      return server.run(command);
    }
  };
}

export function createTestMcpServer(params: {
  readonly repoPath: string;
  readonly shellServer: ShellMcpServer;
}): TestMcpServer {
  const repoPath = resolve(params.repoPath);

  return {
    async discoverPackageManager() {
      if (fileExists(join(repoPath, "pnpm-lock.yaml"))) {
        return "pnpm";
      }
      if (fileExists(join(repoPath, "package-lock.json"))) {
        return "npm";
      }
      if (fileExists(join(repoPath, "yarn.lock"))) {
        return "yarn";
      }
      if (fileExists(join(repoPath, "bun.lockb")) || fileExists(join(repoPath, "bun.lock"))) {
        return "bun";
      }

      const packageJsonPath = join(repoPath, "package.json");
      if (fileExists(packageJsonPath)) {
        const raw = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { packageManager?: string };
        if (raw.packageManager?.startsWith("pnpm")) {
          return "pnpm";
        }
        if (raw.packageManager?.startsWith("npm")) {
          return "npm";
        }
        if (raw.packageManager?.startsWith("yarn")) {
          return "yarn";
        }
        if (raw.packageManager?.startsWith("bun")) {
          return "bun";
        }
      }

      return "unknown";
    },
    async runConfiguredTestCommands(commands) {
      const commandResults: ShellExecutionResult[] = [];
      for (const command of commands) {
        commandResults.push(await params.shellServer.run(command));
      }

      const parsedResults = commandResults.map((result) =>
        this.parseCommonTestOutput({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        })
      );

      return {
        packageManager: await this.discoverPackageManager(),
        commandResults,
        parsedResults,
        passed: commandResults.every((result) => result.exitCode === 0)
      };
    },
    parseCommonTestOutput(output) {
      const combined = `${output.stdout}\n${output.stderr}`.trim();
      const framework = detectTestFramework(combined);
      const summary = parseTestCounts(combined);

      return {
        framework,
        passed: output.exitCode === 0,
        passedCount: summary.passedCount,
        failedCount: summary.failedCount,
        rawSummary: extractSummaryLine(combined)
      };
    }
  };
}

export function createPatchMcpServer(params: {
  readonly repoPath: string;
  readonly formatCommands?: readonly string[];
  readonly shellServer?: ShellMcpServer;
  readonly requireProvenanceComments?: boolean;
  readonly allowedWritePaths?: readonly string[];
  readonly requiredBranch?: string;
}): PatchMcpServer {
  const repoPath = resolve(params.repoPath);

  return {
    async applyProposal(proposal) {
      const operations = proposal.operations.map((operation) => ({
        ...operation,
        path: normalizeRepoRelative(repoPath, resolve(repoPath, operation.path))
      }));
      const declaredFiles = proposal.files.map((file) =>
        normalizeRepoRelative(repoPath, resolve(repoPath, file.path))
      );
      const operationPaths = operations.map((operation) => operation.path);

      if (operations.length === 0) {
        if (declaredFiles.length > 0) {
          throw new Error(
            "Patch proposal declared changed files but did not include structured operations."
          );
        }

        return {
          applied: true,
          changedFiles: [],
          operations: [],
          summary: proposal.summary || "No file changes were proposed.",
          finalDiff: "",
          fileSnapshots: [],
          formattingCommands: []
        };
      }

      validatePatchOperations(
        repoPath,
        operations,
        declaredFiles,
        withOptionalProperties(
          {},
          {
            allowedWritePaths: params.allowedWritePaths,
            requiredBranch: params.requiredBranch
          }
        )
      );

      const summaryParts = [
        `Applying ${operations.length} operation(s) across ${operationPaths.length} file(s).`,
        proposal.summary
      ].filter((part) => part.trim().length > 0);

      for (const operation of operations) {
          const resolvedPath = resolve(repoPath, operation.path);
          ensurePathInsideRepo(repoPath, resolvedPath);

        if (operation.changeType === "create") {
          if (fileExists(resolvedPath)) {
            throw new Error(`Cannot create ${operation.path} because it already exists.`);
          }
          await mkdir(dirname(resolvedPath), { recursive: true });
          await writeFile(
            resolvedPath,
            maybeAddProvenanceComment(
              operation.path,
              operation.content ?? "",
              params.requireProvenanceComments ?? true
            ),
            "utf8"
          );
          continue;
        }

        if (operation.changeType === "update") {
          if (!fileExists(resolvedPath)) {
            throw new Error(`Cannot update ${operation.path} because it does not exist.`);
          }
          await writeFile(
            resolvedPath,
            maybeAddProvenanceComment(
              operation.path,
              operation.content ?? "",
              params.requireProvenanceComments ?? true
            ),
            "utf8"
          );
          continue;
        }

        if (!fileExists(resolvedPath)) {
          throw new Error(`Cannot delete ${operation.path} because it does not exist.`);
        }
        await unlink(resolvedPath);
      }

      const formattingCommands: ShellExecutionResult[] = [];
      for (const command of params.formatCommands ?? []) {
        if (!params.shellServer) {
          throw new Error(`Cannot run format command "${command}" without a shell server.`);
        }
        formattingCommands.push(await params.shellServer.run(command));
      }

      const fileSnapshots = await Promise.all(
        operations.map(async (operation) => {
          if (operation.changeType === "delete") {
            return {
              path: operation.path,
              content: null
            };
          }

          const content = await readFile(resolve(repoPath, operation.path), "utf8");
          return {
            path: operation.path,
            content
          };
        })
      );

      return {
        applied: true,
        changedFiles: operationPaths,
        operations,
        summary: summaryParts.join(" "),
        finalDiff: await runGit(repoPath, ["diff", "--", ...operationPaths]),
        fileSnapshots,
        formattingCommands
      };
    }
  };
}

export function createMemoryMcpServer(params: {
  readonly dataDir: string;
  readonly repoPath: string;
}): MemoryMcpServer {
  const dbPath = join(params.dataDir, "tasks.sqlite");
  const factsPath = join(params.dataDir, "repo-facts.json");
  const debtPath = join(params.dataDir, "debt.md");
  const debtItemsPath = join(params.dataDir, "debt-items.json");

  return {
    async listTaskHistory(limit = 20) {
      if (!fileExists(dbPath)) {
        return [];
      }

      const db = new DatabaseSync(dbPath);
      try {
        const rows = db
          .prepare("SELECT id, title, status, updated_at FROM tasks ORDER BY updated_at DESC LIMIT ?")
          .all(limit) as Array<{ id: string; title: string; status: string; updated_at: string }>;
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          updatedAt: row.updated_at
        }));
      } finally {
        db.close();
      }
    },
    async readRepositoryFacts() {
      if (!fileExists(factsPath)) {
        return {};
      }
      return JSON.parse(await readFile(factsPath, "utf8")) as Record<string, unknown>;
    },
    async writeRepositoryFacts(facts) {
      mkdirSync(dirname(factsPath), { recursive: true });
      await writeFile(factsPath, JSON.stringify(facts, null, 2), "utf8");
    },
    async readDebtLog() {
      const items = await this.listDebtItems({ includeResolved: true });
      if (items.length > 0) {
        return renderDebtItemsAsMarkdown(items);
      }

      if (!fileExists(debtPath)) {
        return "";
      }
      return readFile(debtPath, "utf8");
    },
    async listDebtItems(options = {}) {
      const store = readDebtStore(debtItemsPath);
      return sortDebtItems(
        store.items
          .filter((item) => (options.includeResolved ? true : item.status !== "resolved"))
          .filter((item) => (options.status ? item.status === options.status : true))
          .map((item) => ({
            ...item,
            ageDays: calculateAgeDays(item.createdAt)
          }))
      );
    },
    async appendDebtItems(items) {
      if (items.length === 0) {
        return;
      }

      const store = readDebtStore(debtItemsPath);

      for (const item of items) {
        const normalized = debtItemInputSchema.parse({
          title: item.title,
          severity: item.severity ?? (item.priority ? mapPriorityToSeverity(item.priority) : "medium"),
          files: [...item.files],
          rationale: item.rationale,
          recommendedFix: item.recommendedFix,
          firstSeenTask: item.taskId,
          source: item.source ?? "manual",
          status: item.status ?? "open"
        });

        const duplicate = findDuplicateDebtItem(store.items, normalized);
        if (duplicate) {
          duplicate.updatedAt = new Date().toISOString();
          if (duplicate.status === "resolved") {
            duplicate.status = "open";
          }
          continue;
        }

        store.items.push({
          id: randomUUID(),
          title: normalized.title,
          severity: normalized.severity,
          files: [...normalized.files],
          rationale: normalized.rationale,
          recommendedFix: normalized.recommendedFix,
          firstSeenTask: normalized.firstSeenTask,
          status: normalized.status,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: normalized.source
        });
      }

      writeDebtStore(debtItemsPath, store);
      mkdirSync(dirname(debtPath), { recursive: true });
      await writeFile(debtPath, renderDebtItemsAsMarkdown(sortDebtItems(withAgeDays(store.items))), "utf8");
    },
    async resolveDebtItem(id, note) {
      const store = readDebtStore(debtItemsPath);
      const item = requireDebtItem(store.items, id);
      item.status = "resolved";
      item.updatedAt = new Date().toISOString();
      item.resolutionNote = note;
      writeDebtStore(debtItemsPath, store);
      await writeFile(debtPath, renderDebtItemsAsMarkdown(sortDebtItems(withAgeDays(store.items))), "utf8");
      return item;
    },
    async deferDebtItem(id, note) {
      const store = readDebtStore(debtItemsPath);
      const item = requireDebtItem(store.items, id);
      item.status = "deferred";
      item.updatedAt = new Date().toISOString();
      item.resolutionNote = note;
      writeDebtStore(debtItemsPath, store);
      await writeFile(debtPath, renderDebtItemsAsMarkdown(sortDebtItems(withAgeDays(store.items))), "utf8");
      return item;
    },
    async exportDebtItems(format = "markdown") {
      const items = sortDebtItems(withAgeDays(readDebtStore(debtItemsPath).items));
      if (format === "json") {
        return JSON.stringify(items, null, 2);
      }
      return renderDebtItemsAsMarkdown(items);
    },
    async listRecurringFailurePatterns(limit = 10) {
      if (!fileExists(dbPath)) {
        return [];
      }

      const db = new DatabaseSync(dbPath);
      try {
        const rows = db
          .prepare(`
            SELECT json_extract(event_json, '$.payload.reason') AS reason, COUNT(*) AS count
            FROM task_events
            WHERE event_type = 'task.blocked'
            GROUP BY reason
            ORDER BY count DESC
            LIMIT ?
          `)
          .all(limit) as Array<{ reason: string | null; count: number }>;
        return rows
          .filter((row) => typeof row.reason === "string" && row.reason.length > 0)
          .map((row) => ({
            reason: row.reason as string,
            count: row.count
          }));
      } finally {
        db.close();
      }
    }
  };
}

export function triggerPanicMode(options: {
  readonly panicFilePath: string;
  readonly processRegistryPath: string;
}): { readonly killedPids: readonly number[] } {
  const killedPids = killRegisteredProcesses(options.processRegistryPath);
  mkdirSync(dirname(options.panicFilePath), { recursive: true });
  writeFileSync(
    options.panicFilePath,
    JSON.stringify(
      {
        enabledAt: new Date().toISOString(),
        killedPids
      },
      null,
      2
    ).concat("\n"),
    "utf8"
  );
  return { killedPids };
}

export function clearPanicMode(options: {
  readonly panicFilePath: string;
  readonly processRegistryPath: string;
}): void {
  rmSync(options.panicFilePath, { force: true });
  rmSync(options.processRegistryPath, { force: true });
}

export function isPanicModeEnabled(panicFilePath: string): boolean {
  return fileExists(panicFilePath);
}

function validatePatchOperations(
  repoPath: string,
  operations: readonly FileOperation[],
  declaredFiles: readonly string[],
  constraints: {
    readonly allowedWritePaths?: readonly string[];
    readonly requiredBranch?: string;
  }
): void {
  const seenPaths = new Set<string>();

  if (constraints.requiredBranch) {
    const currentBranch = readCurrentBranch(repoPath);
    if (currentBranch !== constraints.requiredBranch) {
      throw new Error(
        `Patch proposal is blocked because the current branch "${currentBranch}" does not match required branch "${constraints.requiredBranch}".`
      );
    }
  }

  for (const operation of operations) {
    const resolvedPath = resolve(repoPath, operation.path);
    ensurePathInsideRepo(repoPath, resolvedPath);
    const normalizedPath = normalizeRepoRelative(repoPath, resolvedPath);

    if (normalizedPath === ".git" || normalizedPath.startsWith(".git/")) {
      throw new Error(`Patch proposal cannot modify reserved git metadata at ${normalizedPath}.`);
    }

    if (seenPaths.has(normalizedPath)) {
      throw new Error(`Patch proposal contains duplicate operations for ${normalizedPath}.`);
    }

    if (
      constraints.allowedWritePaths &&
      constraints.allowedWritePaths.length > 0 &&
      !constraints.allowedWritePaths.some(
        (allowedPath) =>
          normalizedPath === allowedPath ||
          normalizedPath.startsWith(`${allowedPath.replace(/\/+$/, "")}/`)
      )
    ) {
      throw new Error(`Patch proposal cannot modify ${normalizedPath} because it is outside the allowed write scope.`);
    }

    seenPaths.add(normalizedPath);
  }

  for (const declaredFile of declaredFiles) {
    if (!seenPaths.has(declaredFile)) {
      throw new Error(
        `Patch proposal declared ${declaredFile} in files but did not include a matching operation.`
      );
    }
  }
}

function withOptionalProperties<TBase extends object, TOptional extends Record<string, unknown>>(
  base: TBase,
  optional: TOptional
): TBase & Partial<TOptional> {
  const entries = Object.entries(optional).filter(([, value]) => value !== undefined);
  return Object.assign(base, Object.fromEntries(entries)) as TBase & Partial<TOptional>;
}

async function walkFiles(
  root: string,
  currentDir: string,
  recursive: boolean,
  policy: RepoAccessPolicy
): Promise<readonly RepoFileRecord[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const records: RepoFileRecord[] = [];

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const relativePath = normalizeRepoRelative(root, fullPath);
    if (!policy.allowSecretAccess && isSensitivePath(relativePath)) {
      continue;
    }
    if (!entry.isDirectory() && !isRepoPathAllowedForContext(root, fullPath, policy)) {
      continue;
    }
    records.push({
      path: relativePath,
      kind: entry.isDirectory() ? "directory" : "file"
    });

    if (recursive && entry.isDirectory()) {
      records.push(...(await walkFiles(root, fullPath, true, policy)));
    }
  }

  return records.sort((a, b) => a.path.localeCompare(b.path));
}

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 2_000_000
  });
  return stdout.trimEnd();
}

function toShellExecutionResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  startedAt: number,
  maxOutputChars: number
): ShellExecutionResult {
  const truncatedStdout = truncateOutput(stdout, maxOutputChars);
  const truncatedStderr = truncateOutput(stderr, maxOutputChars);

  return {
    command,
    exitCode,
    stdout: truncatedStdout.value,
    stderr: truncatedStderr.value,
    durationMs: Date.now() - startedAt,
    truncated: truncatedStdout.truncated || truncatedStderr.truncated
  };
}

function readCurrentBranch(repoPath: string): string {
  try {
    const head = readFileSync(join(repoPath, ".git", "HEAD"), "utf8").trim();
    if (head.startsWith("ref: refs/heads/")) {
      return head.replace("ref: refs/heads/", "");
    }
    return "HEAD";
  } catch {
    return "HEAD";
  }
}

function truncateOutput(value: string, maxChars: number): { readonly value: string; readonly truncated: boolean } {
  if (value.length <= maxChars) {
    return { value, truncated: false };
  }

  return {
    value: `${value.slice(0, maxChars)}\n...[truncated]`,
    truncated: true
  };
}

function detectTestFramework(output: string): string | null {
  if (/vitest/i.test(output)) {
    return "vitest";
  }
  if (/jest/i.test(output)) {
    return "jest";
  }
  if (/mocha/i.test(output)) {
    return "mocha";
  }
  if (/tap|node:test/i.test(output)) {
    return "node:test";
  }
  return null;
}

function parseTestCounts(output: string): { readonly passedCount: number | null; readonly failedCount: number | null } {
  const passedMatch =
    output.match(/(\d+)\s+passed/i) ?? output.match(/Tests?\s+(\d+)\s+passed/i) ?? null;
  const failedMatch =
    output.match(/(\d+)\s+failed/i) ?? output.match(/Tests?\s+(\d+)\s+failed/i) ?? null;

  return {
    passedCount: passedMatch ? Number(passedMatch[1]) : null,
    failedCount: failedMatch ? Number(failedMatch[1]) : null
  };
}

function extractSummaryLine(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.find((line) => /passed|failed|tests?/i.test(line)) ?? (lines.at(-1) ?? "");
}

function ensurePathInsideRepo(root: string, path: string): void {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`Path ${path} is outside the configured repository.`);
  }
}

function normalizeRepoRelative(root: string, path: string): string {
  const relativePath = relative(root, path);
  return relativePath.length === 0 ? "." : relativePath;
}

function parseRipgrepLine(line: string): RepoSearchResult {
  const [path = "", lineNumber = "0", column = "0", ...previewParts] = line.split(":");
  return {
    path,
    line: Number(lineNumber),
    column: Number(column),
    preview: previewParts.join(":")
  };
}

function fileExists(path: string): boolean {
  return statSyncSafe(path) !== null;
}

function readDebtStore(path: string): { version: 1; items: DebtItem[] } {
  try {
    return debtStoreSchema.parse(JSON.parse(readFileSync(path, "utf8"))) as { version: 1; items: DebtItem[] };
  } catch {
    return {
      version: 1,
      items: []
    };
  }
}

function writeDebtStore(path: string, store: { version: 1; items: DebtItem[] }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2).concat("\n"), "utf8");
}

function requireDebtItem(items: DebtItem[], id: string): DebtItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Debt item "${id}" was not found.`);
  }
  return item;
}

function findDuplicateDebtItem(items: DebtItem[], candidate: DebtItemInput): DebtItem | null {
  const normalizedTitle = normalizeDebtText(candidate.title);
  const normalizedFiles = candidate.files.map((file) => file.toLowerCase()).sort().join("|");

  return (
    items.find((item) => {
      const sameTitle = normalizeDebtText(item.title) === normalizedTitle;
      const sameFiles = item.files.map((file) => file.toLowerCase()).sort().join("|") === normalizedFiles;
      const sameRationale = normalizeDebtText(item.rationale) === normalizeDebtText(candidate.rationale);
      return sameTitle || (normalizedFiles.length > 0 && sameFiles && sameRationale);
    }) ?? null
  );
}

function normalizeDebtText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function calculateAgeDays(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  const diffMs = Math.max(Date.now() - created, 0);
  return Math.floor(diffMs / 86_400_000);
}

function withAgeDays(items: readonly DebtItem[]): Array<DebtItem & { readonly ageDays: number }> {
  return items.map((item) => ({
    ...item,
    ageDays: calculateAgeDays(item.createdAt)
  }));
}

function sortDebtItems<T extends { severity: "high" | "medium" | "low"; ageDays: number; status: string; title: string }>(
  items: readonly T[]
): T[] {
  return [...items].sort((left, right) => {
    const statusRank = debtStatusRank(left.status) - debtStatusRank(right.status);
    if (statusRank !== 0) {
      return statusRank;
    }
    const severityRank = rankDebtSeverity(right.severity) - rankDebtSeverity(left.severity);
    if (severityRank !== 0) {
      return severityRank;
    }
    const ageRank = right.ageDays - left.ageDays;
    if (ageRank !== 0) {
      return ageRank;
    }
    return left.title.localeCompare(right.title);
  });
}

function debtStatusRank(status: string): number {
  switch (status) {
    case "open":
      return 0;
    case "deferred":
      return 1;
    case "resolved":
      return 2;
    default:
      return 3;
  }
}

function assertRepoPathAllowed(path: string, policy: RepoAccessPolicy): void {
  if (!policy.allowSecretAccess && isSensitivePath(path)) {
    throw new SecretAccessDeniedError(path);
  }
}

async function assertContextFileAllowed(
  root: string,
  path: string,
  policy: RepoAccessPolicy
): Promise<void> {
  const info = await stat(path);
  if (info.size > policy.maxContextFileBytes) {
    throw new QuarantinedFileAccessError(
      normalizeRepoRelative(root, path),
      `file exceeds ${policy.maxContextFileBytes} bytes`
    );
  }

  if (!policy.blockBinaryFiles) {
    return;
  }

  const content = await readFile(path);
  if (isLikelyBinaryContent(content)) {
    throw new QuarantinedFileAccessError(normalizeRepoRelative(root, path), "binary content detected");
  }
}

function isRepoPathAllowedForContext(
  root: string,
  path: string,
  policy: RepoAccessPolicy
): boolean {
  try {
    const info = statSync(path);
    if (info.size > policy.maxContextFileBytes) {
      return false;
    }

    if (!policy.blockBinaryFiles) {
      return true;
    }

    return !isLikelyBinaryContent(readFileSync(path));
  } catch {
    return false;
  }
}

async function runSandboxedShellCommand(
  command: string,
  repoPath: string,
  policy: ShellExecutionPolicy,
  startedAt: number,
  safety: ShellSafetyOptions | undefined
): Promise<ShellExecutionResult> {
  const child = spawn("/bin/sh", ["-lc", command], {
    cwd: repoPath,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: process.env.LANG ?? "C.UTF-8",
      LC_ALL: process.env.LC_ALL ?? "C.UTF-8"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  registerProcess(child, safety?.processRegistryPath);

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutChunks.push(chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
  });

  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, policy.timeoutMs);

  const exitCode = await new Promise<number>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolvePromise(code ?? 1);
    });
  }).finally(() => {
    unregisterProcess(child.pid, safety?.processRegistryPath);
  });

  return toShellExecutionResult(
    command,
    exitCode,
    redactString(stdoutChunks.join("")),
    redactString(stderrChunks.join("")),
    startedAt,
    policy.maxOutputChars
  );
}

function registerProcess(child: ChildProcess, processRegistryPath: string | undefined): void {
  if (!processRegistryPath || child.pid === undefined) {
    return;
  }

  const current = readProcessRegistry(processRegistryPath);
  if (!current.includes(child.pid)) {
    current.push(child.pid);
  }
  mkdirSync(dirname(processRegistryPath), { recursive: true });
  writeFileSync(processRegistryPath, JSON.stringify(current, null, 2).concat("\n"), "utf8");
}

function unregisterProcess(pid: number | undefined, processRegistryPath: string | undefined): void {
  if (!processRegistryPath || pid === undefined) {
    return;
  }

  const next = readProcessRegistry(processRegistryPath).filter((entry) => entry !== pid);
  mkdirSync(dirname(processRegistryPath), { recursive: true });
  writeFileSync(processRegistryPath, JSON.stringify(next, null, 2).concat("\n"), "utf8");
}

function readProcessRegistry(processRegistryPath: string): number[] {
  try {
    return JSON.parse(readFileSync(processRegistryPath, "utf8")) as number[];
  } catch {
    return [];
  }
}

function killRegisteredProcesses(processRegistryPath: string): number[] {
  const pids = readProcessRegistry(processRegistryPath);
  const killed: number[] = [];

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      killed.push(pid);
    } catch {}
  }

  rmSync(processRegistryPath, { force: true });
  return killed;
}

function maybeAddProvenanceComment(path: string, content: string, enabled: boolean): string {
  if (!enabled || content.length === 0 || content.includes("Generated by Dev Assistant")) {
    return content;
  }

  const comment = provenanceCommentForPath(path);
  if (!comment) {
    return content;
  }

  if (content.startsWith("#!")) {
    const firstNewline = content.indexOf("\n");
    if (firstNewline === -1) {
      return `${content}\n${comment}\n`;
    }
    return `${content.slice(0, firstNewline + 1)}${comment}\n${content.slice(firstNewline + 1)}`;
  }

  return `${comment}\n${content}`;
}

function provenanceCommentForPath(path: string): string | null {
  const extension = extname(path).toLowerCase();

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".java", ".kt", ".go", ".rs", ".swift", ".css", ".scss", ".less", ".sql"].includes(extension)) {
    return "// Generated by Dev Assistant. Review before merging.";
  }

  if ([".py", ".sh", ".rb", ".pl", ".yaml", ".yml", ".toml", ".ini", ".conf"].includes(extension)) {
    return "# Generated by Dev Assistant. Review before merging.";
  }

  if ([".html", ".xml", ".svg"].includes(extension)) {
    return "<!-- Generated by Dev Assistant. Review before merging. -->";
  }

  return null;
}

function statSyncSafe(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function isExecFileError(
  error: unknown
): error is Error & { code?: number; stdout?: string; stderr?: string } {
  return error instanceof Error;
}

function isExecErrorWithExitCode(error: unknown, exitCode: number): boolean {
  return isExecFileError(error) && error.code === exitCode;
}
