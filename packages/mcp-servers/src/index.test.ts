import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_PERMISSION_PROFILES,
  NetworkAccessDisabledError,
  PanicModeEnabledError,
  SecretAccessDeniedError,
  ShellCommandApprovalRequiredError,
  clearPanicMode,
  createGitMcpServer,
  createMemoryMcpServer,
  createPatchMcpServer,
  createRepoMcpServer,
  createShellMcpServer,
  createTestMcpServer,
  triggerPanicMode
} from "./index.js";

function createFixtureRepo(): { readonly repoPath: string; readonly dataDir: string } {
  const repoPath = mkdtempSync(join(tmpdir(), "dev-assistant-mcp-repo-"));
  const dataDir = join(repoPath, ".dev-assistant");
  mkdirSync(join(repoPath, "src"), { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  writeFileSync(
    join(repoPath, "package.json"),
    JSON.stringify(
      {
        name: "fixture-repo",
        private: true,
        packageManager: "pnpm@10.12.4",
        scripts: {
          test: "node -e \"console.log('Tests 1 passed')\"",
          fail: "node -e \"console.error('Tests 1 failed'); process.exit(1)\""
        }
      },
      null,
      2
    )
  );
  writeFileSync(join(repoPath, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(repoPath, "src", "index.ts"), "export const value = 1;\n");
  writeFileSync(join(repoPath, ".env"), "OPENAI_API_KEY=super-secret\n");
  writeFileSync(join(repoPath, "README.md"), "# Fixture Repo\n");
  writeFileSync(join(dataDir, "debt.md"), "- [ ] follow up on flaky test\n");

  execFileSync("git", ["init"], { cwd: repoPath, encoding: "utf8" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath, encoding: "utf8" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoPath, encoding: "utf8" });
  execFileSync("git", ["checkout", "-b", "main"], { cwd: repoPath, encoding: "utf8" });
  execFileSync("git", ["add", "."], { cwd: repoPath, encoding: "utf8" });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: repoPath, encoding: "utf8" });

  return { repoPath, dataDir };
}

describe("repo MCP server", () => {
  let repoPath = "";

  beforeEach(() => {
    ({ repoPath } = createFixtureRepo());
  });

  it("lists, reads, searches, and inspects repository files", async () => {
    const server = createRepoMcpServer(repoPath);

    const files = await server.listFiles();
    expect(files.some((file) => file.path === "src/index.ts")).toBe(true);

    const content = await server.readFile("src/index.ts");
    expect(content).toContain("value = 1");

    const matches = await server.search("value = 1");
    expect(matches.some((match) => match.path.endsWith("src/index.ts"))).toBe(true);

    const metadata = await server.inspectFileMetadata("src/index.ts");
    expect(metadata.extension).toBe(".ts");
    expect(metadata.isDirectory).toBe(false);
    expect(files.some((file) => file.path === ".env")).toBe(false);
  });

  it("blocks access to sensitive files by default", async () => {
    const server = createRepoMcpServer(repoPath);

    await expect(server.readFile(".env")).rejects.toBeInstanceOf(SecretAccessDeniedError);
  });

  it("allows sensitive file access only when explicitly enabled", async () => {
    const server = createRepoMcpServer(repoPath, {
      allowSecretAccess: true
    });

    await expect(server.readFile(".env")).resolves.toContain("OPENAI_API_KEY");
  });
});

describe("git MCP server", () => {
  let repoPath = "";

  beforeEach(() => {
    ({ repoPath } = createFixtureRepo());
  });

  it("returns git status, diff, log, and current branch", async () => {
    writeFileSync(join(repoPath, "README.md"), "# Fixture Repo\nupdated\n");
    const server = createGitMcpServer(repoPath);

    expect(await server.currentBranch()).toBe("main");
    expect(await server.status()).toContain("README.md");
    expect(await server.diff()).toContain("updated");
    expect((await server.log(1))[0]?.subject).toBe("Initial commit");
  });
});

describe("shell MCP server", () => {
  let repoPath = "";

  beforeEach(() => {
    ({ repoPath } = createFixtureRepo());
  });

  it("runs allowlisted commands with timeout/truncation support", async () => {
    const server = createShellMcpServer({
      repoPath,
      allowlist: ["node -e \"console.log('hello')\""],
      maxOutputChars: 5_000
    });

    const result = await server.run("node -e \"console.log('hello')\"");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.truncated).toBe(false);
  });

  it("rejects non-allowlisted commands with a clear escalation flow", async () => {
    const server = createShellMcpServer({
      repoPath,
      allowlist: []
    });

    await expect(server.run("pwd")).rejects.toBeInstanceOf(ShellCommandApprovalRequiredError);
  });

  it("blocks network-capable commands unless network access is enabled", async () => {
    const server = createShellMcpServer({
      repoPath,
      allowlist: ["curl https://example.com"],
      allowNetwork: false
    });

    await expect(server.run("curl https://example.com")).rejects.toBeInstanceOf(NetworkAccessDisabledError);
  });

  it("supports panic mode and terminates registered subprocesses", async () => {
    const panicFilePath = join(repoPath, ".dev-assistant", "panic.json");
    const processRegistryPath = join(repoPath, ".dev-assistant", "processes.json");
    const server = createShellMcpServer({
      repoPath,
      allowlist: ["node -e \"setTimeout(() => {}, 30000)\""],
      safety: {
        panicFilePath,
        processRegistryPath
      }
    });

    const pending = server.run("node -e \"setTimeout(() => {}, 30000)\"");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    const panic = triggerPanicMode({ panicFilePath, processRegistryPath });
    const result = await pending;

    expect(panic.killedPids.length).toBeGreaterThan(0);
    expect(result.exitCode).not.toBe(0);

    await expect(server.run("node -e \"setTimeout(() => {}, 30000)\"")).rejects.toBeInstanceOf(
      PanicModeEnabledError
    );

    clearPanicMode({ panicFilePath, processRegistryPath });
  });
});

describe("test MCP server", () => {
  let repoPath = "";

  beforeEach(() => {
    ({ repoPath } = createFixtureRepo());
  });

  it("discovers the package manager, runs configured tests, and parses common output", async () => {
    const shellServer = createShellMcpServer({
      repoPath,
      allowlist: ["node -e \"console.log('Tests 1 passed')\""]
    });
    const server = createTestMcpServer({
      repoPath,
      shellServer
    });

    expect(await server.discoverPackageManager()).toBe("pnpm");

    const summary = await server.runConfiguredTestCommands([
      "node -e \"console.log('Tests 1 passed')\""
    ]);
    expect(summary.passed).toBe(true);
    expect(summary.parsedResults[0]?.passedCount).toBe(1);

    const parsed = server.parseCommonTestOutput({
      stdout: "Tests 2 passed",
      stderr: "",
      exitCode: 0
    });
    expect(parsed.passed).toBe(true);
    expect(parsed.passedCount).toBe(2);
  });
});

describe("memory MCP server", () => {
  let repoPath = "";
  let dataDir = "";

  beforeEach(() => {
    ({ repoPath, dataDir } = createFixtureRepo());
  });

  it("reads task history, repository facts, debt log, and recurring failures", async () => {
    const dbPath = join(dataDir, "tasks.sqlite");
    const db = new (await import("node:sqlite")).DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        budget_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO tasks (id, title, prompt, status, budget_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("task-1", "Test task", "prompt", "blocked", "{}", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    db.prepare(
      "INSERT INTO task_events (id, task_id, event_type, created_at, event_json) VALUES (?, ?, ?, ?, ?)"
    ).run(
      "event-1",
      "task-1",
      "task.blocked",
      "2026-01-01T00:00:00.000Z",
      JSON.stringify({
        id: "event-1",
        taskId: "task-1",
        type: "task.blocked",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: {
          reason: "Configured tests did not pass."
        }
      })
    );
    db.close();

    const server = createMemoryMcpServer({ dataDir, repoPath });
    await server.writeRepositoryFacts({ framework: "typescript" });
    await server.appendDebtItems([
      {
        title: "Fix flaky test",
        severity: "medium",
        files: ["src/index.ts"],
        rationale: "The current fixture has a follow-up note.",
        recommendedFix: "Stabilize the flaky assertion.",
        taskId: "task-1",
        source: "manual"
      }
    ]);
    await server.appendDebtItems([
      {
        title: "Fix flaky test",
        severity: "medium",
        files: ["src/index.ts"],
        rationale: "The current fixture has a follow-up note.",
        recommendedFix: "Stabilize the flaky assertion.",
        taskId: "task-1",
        source: "reviewer"
      }
    ]);

    const listed = await server.listDebtItems();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("open");
    expect(listed[0]?.ageDays).toBeGreaterThanOrEqual(0);

    const deferred = await server.deferDebtItem(listed[0]!.id, "Waiting for broader cleanup");
    expect(deferred.status).toBe("deferred");

    const resolved = await server.resolveDebtItem(listed[0]!.id, "Handled in follow-up");
    expect(resolved.status).toBe("resolved");

    expect((await server.listTaskHistory(5))[0]?.title).toBe("Test task");
    expect((await server.readRepositoryFacts()).framework).toBe("typescript");
    expect(await server.readDebtLog()).toContain("Fix flaky test");
    expect(await server.exportDebtItems("json")).toContain("\"title\": \"Fix flaky test\"");
    expect((await server.listRecurringFailurePatterns(5))[0]?.reason).toContain("Configured tests");
  });
});

describe("patch MCP server", () => {
  let repoPath = "";

  beforeEach(() => {
    ({ repoPath } = createFixtureRepo());
  });

  it("validates, applies, formats, and re-reads structured file operations", async () => {
    const shellServer = createShellMcpServer({
      repoPath,
      allowlist: ["node -e \"console.log('formatted')\""]
    });
    const server = createPatchMcpServer({
      repoPath,
      shellServer,
      formatCommands: ["node -e \"console.log('formatted')\""]
    });

    const result = await server.applyProposal({
      summary: "Update the fixture source file",
      diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@\n-export const value = 1;\n+export const value = 2;\n",
      files: [{ path: "src/index.ts", changeType: "update" }],
      operations: [
        {
          path: "src/index.ts",
          changeType: "update",
          content: "export const value = 2;\n"
        }
      ]
    });

    expect(result.applied).toBe(true);
    expect(result.changedFiles).toEqual(["src/index.ts"]);
    expect(result.finalDiff).toContain("value = 2");
    expect(result.fileSnapshots[0]?.content).toContain("Generated by Dev Assistant");
    expect(result.fileSnapshots[0]?.content).toContain("value = 2");
    expect(result.formattingCommands[0]?.stdout).toContain("formatted");
  });

  it("rejects operations that escape the configured repository", async () => {
    const server = createPatchMcpServer({ repoPath });

    await expect(
      server.applyProposal({
        summary: "Try to edit outside the repo",
        diff: "",
        files: [{ path: "../outside.ts", changeType: "update" }],
        operations: [
          {
            path: "../outside.ts",
            changeType: "update",
            content: "nope\n"
          }
        ]
      })
    ).rejects.toThrow(/outside the configured repository/i);
  });

  it("rejects attempts to modify git metadata inside the repository", async () => {
    const server = createPatchMcpServer({ repoPath });

    await expect(
      server.applyProposal({
        summary: "Try to edit git metadata",
        diff: "",
        files: [{ path: ".git/COMMIT_EDITMSG", changeType: "update" }],
        operations: [
          {
            path: ".git/COMMIT_EDITMSG",
            changeType: "update",
            content: "bad idea\n"
          }
        ]
      })
    ).rejects.toThrow(/reserved git metadata/i);
  });
});

describe("agent permission profiles", () => {
  it("defines profiles for current and planned agent roles", () => {
    expect(AGENT_PERMISSION_PROFILES.coder.repo.search).toBe(true);
    expect(AGENT_PERMISSION_PROFILES["test-runner"].test.runConfiguredCommands).toBe(true);
    expect(AGENT_PERMISSION_PROFILES["technical-debt"].memory.debtLog).toBe(true);
  });
});
