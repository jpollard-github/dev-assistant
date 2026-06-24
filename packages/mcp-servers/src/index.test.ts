import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_PERMISSION_PROFILES,
  ShellCommandApprovalRequiredError,
  createGitMcpServer,
  createMemoryMcpServer,
  createRepoMcpServer,
  createShellMcpServer,
  createTestMcpServer
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

    expect((await server.listTaskHistory(5))[0]?.title).toBe("Test task");
    expect((await server.readRepositoryFacts()).framework).toBe("typescript");
    expect(await server.readDebtLog()).toContain("flaky test");
    expect((await server.listRecurringFailurePatterns(5))[0]?.reason).toContain("Configured tests");
  });
});

describe("agent permission profiles", () => {
  it("defines profiles for current and planned agent roles", () => {
    expect(AGENT_PERMISSION_PROFILES.coder.repo.search).toBe(true);
    expect(AGENT_PERMISSION_PROFILES["test-runner"].test.runConfiguredCommands).toBe(true);
    expect(AGENT_PERMISSION_PROFILES["technical-debt"].memory.debtLog).toBe(true);
  });
});
