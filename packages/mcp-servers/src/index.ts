import { mkdirSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

import type { ShellCommandResult, ShellRunner } from "@dev-assistant/core";

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
}

export interface ShellExecutionResult extends ShellCommandResult {
  readonly truncated: boolean;
}

export interface ShellMcpServer {
  readonly policy: ShellExecutionPolicy;
  run(command: string): Promise<ShellExecutionResult>;
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
  appendDebtItems(items: readonly {
    title: string;
    priority: "must-fix" | "should-fix" | "nice-to-have";
    files: readonly string[];
    rationale: string;
    recommendedFix: string;
    taskId: string;
  }[]): Promise<void>;
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

export function createRepoMcpServer(repoPath: string): RepoMcpServer {
  const root = resolve(repoPath);

  return {
    async listFiles(options = {}) {
      const baseDir = resolve(root, options.directory ?? ".");
      ensurePathInsideRepo(root, baseDir);
      return walkFiles(root, baseDir, options.recursive ?? true);
    },
    async readFile(path) {
      const resolved = resolve(root, path);
      ensurePathInsideRepo(root, resolved);
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
        .map(parseRipgrepLine);
    },
    async inspectFileMetadata(path) {
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
}): ShellMcpServer {
  const policy: ShellExecutionPolicy = {
    allowlist: params.allowlist,
    timeoutMs: params.timeoutMs ?? 30_000,
    maxOutputChars: params.maxOutputChars ?? 8_000
  };

  return {
    policy,
    async run(command) {
      if (!policy.allowlist.includes(command)) {
        throw new ShellCommandApprovalRequiredError(command, policy.allowlist);
      }

      const startedAt = Date.now();
      try {
        const { stdout, stderr } = await execFileAsync("/bin/sh", ["-lc", command], {
          cwd: params.repoPath,
          encoding: "utf8",
          timeout: policy.timeoutMs,
          maxBuffer: 4_000_000
        });
        return toShellExecutionResult(command, 0, stdout, stderr, startedAt, policy.maxOutputChars);
      } catch (error) {
        if (isExecFileError(error)) {
          return toShellExecutionResult(
            command,
            error.code ?? 1,
            error.stdout ?? "",
            error.stderr ?? error.message,
            startedAt,
            policy.maxOutputChars
          );
        }

        throw error;
      }
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

export function createMemoryMcpServer(params: {
  readonly dataDir: string;
  readonly repoPath: string;
}): MemoryMcpServer {
  const dbPath = join(params.dataDir, "tasks.sqlite");
  const factsPath = join(params.dataDir, "repo-facts.json");
  const debtPath = join(params.dataDir, "debt.md");

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
      if (!fileExists(debtPath)) {
        return "";
      }
      return readFile(debtPath, "utf8");
    },
    async appendDebtItems(items) {
      if (items.length === 0) {
        return;
      }

      const existing = fileExists(debtPath) ? await readFile(debtPath, "utf8") : "";
      const additions = items
        .map((item) => {
          const files = item.files.length > 0 ? item.files.join(", ") : "n/a";
          return [
            `## ${item.title}`,
            `- priority: ${item.priority}`,
            `- task: ${item.taskId}`,
            `- files: ${files}`,
            `- rationale: ${item.rationale}`,
            `- recommended fix: ${item.recommendedFix}`
          ].join("\n");
        })
        .join("\n\n");

      const next = existing.trim().length > 0 ? `${existing.trim()}\n\n${additions}\n` : `${additions}\n`;
      mkdirSync(dirname(debtPath), { recursive: true });
      await writeFile(debtPath, next, "utf8");
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

async function walkFiles(root: string, currentDir: string, recursive: boolean): Promise<readonly RepoFileRecord[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const records: RepoFileRecord[] = [];

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const relativePath = normalizeRepoRelative(root, fullPath);
    records.push({
      path: relativePath,
      kind: entry.isDirectory() ? "directory" : "file"
    });

    if (recursive && entry.isDirectory()) {
      records.push(...(await walkFiles(root, fullPath, true)));
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
