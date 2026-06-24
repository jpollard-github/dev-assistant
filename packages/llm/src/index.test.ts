import { describe, expect, it } from "vitest";

import {
  createAdvisoryAgentToolkit,
  createCapabilityBackedAgentHandlers,
  createFallbackProvider,
  createHostedModelProvider,
  createLocalAgentHandlers,
  resolveModelCapabilities,
  type LocalModelProvider,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
  type TextGenerationRequest,
  type TextGenerationResult
} from "./index.js";
import type { GitMcpServer, MemoryMcpServer, RepoMcpServer, TestMcpServer } from "@dev-assistant/mcp-servers";

function createFakeProvider(): LocalModelProvider {
  return {
    provider: "fake-local",
    model: "fake-model",
    capabilities: resolveModelCapabilities("qwen2.5-coder:7b"),
    async generateText(_request: TextGenerationRequest): Promise<TextGenerationResult> {
      return {
        text: "hello",
        provider: "fake-local",
        model: "fake-model",
        durationMs: 12
      };
    },
    async generateStructured<TOutput>(
      request: StructuredGenerationRequest<TOutput>
    ): Promise<StructuredGenerationResult<TOutput>> {
      const candidates: unknown[] = [
        {
          summary: "Planned task",
          steps: [{ id: "plan", description: "Do the task", kind: "analysis" }],
          requiresTests: true
        },
        {
          summary: "Code proposal",
          rationale: "Use the available context",
          diff: "--- a/file.ts\n+++ b/file.ts\n@@\n+change\n",
          files: [{ path: "src/index.ts", changeType: "update" }],
          commands: ["corepack pnpm test"]
        },
        {
          summary: "Review summary",
          approved: true,
          findings: []
        },
        {
          summary: "Tests summary",
          passed: true,
          commandResults: []
        },
        {
          summary: "Coverage summary",
          coverageGaps: ["Missing edge-case coverage"],
          recommendedTests: [
            {
              filePath: "src/index.test.ts",
              testName: "handles edge case",
              rationale: "Protects the changed behavior"
            }
          ]
        },
        {
          summary: "Architecture summary",
          recommendations: [
            {
              severity: "low",
              area: "boundaries",
              message: "Keep the boundary focused",
              filePath: "src/index.ts"
            }
          ]
        },
        {
          summary: "Debt summary",
          items: [
            {
              title: "Track follow-up cleanup",
              priority: "should-fix",
              files: ["src/index.ts"],
              rationale: "There is a small follow-up risk.",
              recommendedFix: "Refactor the touched code path."
            }
          ]
        }
      ];

      let value: TOutput | undefined;
      for (const candidate of candidates) {
        try {
          value = request.validator(candidate);
          break;
        } catch {}
      }

      if (value === undefined) {
        throw new Error("No fake candidate matched validator.");
      }

      return {
        text: JSON.stringify(value),
        object: value,
        provider: "fake-local",
        model: "fake-model",
        durationMs: 12,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        }
      };
    }
  };
}

describe("resolveModelCapabilities", () => {
  it("marks qwen coder models as strong structured-output models", () => {
    const capabilities = resolveModelCapabilities("qwen2.5-coder:7b");

    expect(capabilities.structuredOutputReliability).toBe("high");
    expect(capabilities.recommendedRoles).toContain("coder");
  });
});

function createFakeServers(): {
  repoServer: RepoMcpServer;
  gitServer: GitMcpServer;
  testServer: TestMcpServer;
  memoryServer: MemoryMcpServer;
} {
  const repoServer: RepoMcpServer = {
    async listFiles() {
      return [
        { path: "src/index.ts", kind: "file" },
        { path: "src/index.test.ts", kind: "file" }
      ];
    },
    async readFile(path: string) {
      return `content for ${path}`;
    },
    async search(pattern: string) {
      return [{ path: "src/index.ts", line: 1, column: 1, preview: pattern }];
    },
    async inspectFileMetadata(path: string) {
      return {
        path,
        size: 10,
        modifiedAt: new Date().toISOString(),
        isDirectory: false,
        extension: ".ts"
      };
    }
  };

  const gitServer: GitMcpServer = {
    async status() {
      return " M src/index.ts";
    },
    async diff() {
      return "diff --git a/src/index.ts b/src/index.ts";
    },
    async log() {
      return [{ commit: "abc", author: "Test", subject: "Initial" }];
    },
    async currentBranch() {
      return "main";
    }
  };

  const testServer: TestMcpServer = {
    async discoverPackageManager() {
      return "pnpm";
    },
    async runConfiguredTestCommands() {
      return {
        packageManager: "pnpm",
        commandResults: [],
        parsedResults: [],
        passed: true
      };
    },
    parseCommonTestOutput() {
      return {
        framework: "vitest",
        passed: true,
        passedCount: 1,
        failedCount: 0,
        rawSummary: "Tests 1 passed"
      };
    }
  };

  const memoryServer: MemoryMcpServer = {
    async listTaskHistory() {
      return [];
    },
    async readRepositoryFacts() {
      return { language: "typescript" };
    },
    async writeRepositoryFacts() {},
    async readDebtLog() {
      return "";
    },
    async appendDebtItems() {},
    async listRecurringFailurePatterns() {
      return [{ reason: "Configured tests did not pass.", count: 2 }];
    }
  };

  return { repoServer, gitServer, testServer, memoryServer };
}

describe("createCapabilityBackedAgentHandlers", () => {
  it("uses repository capability context for role prompts", async () => {
    const handlers = createCapabilityBackedAgentHandlers({
      provider: createFakeProvider(),
      repoPath: "/repo",
      ...createFakeServers()
    });

    const coordinator = await handlers.coordinator({
      taskId: "task-ctx-1",
      title: "Fix bug",
      prompt: "Fix src index behavior"
    });
    const coder = await handlers.coder({
      taskId: "task-ctx-1",
      prompt: "Fix src index behavior",
      plan: (coordinator as { output: { summary: string; steps: { id: string; description: string; kind: "analysis" | "edit" | "review" | "test" }[]; requiresTests: boolean } }).output
    });

    const envelope = coder as { metadata?: { promptSnapshot?: string } };
    expect(envelope.metadata?.promptSnapshot).toContain("Candidate files");
    expect(envelope.metadata?.promptSnapshot).toContain("Git status");
  });
});

describe("createAdvisoryAgentToolkit", () => {
  it("produces standalone advisory role outputs", async () => {
    const toolkit = createAdvisoryAgentToolkit({
      provider: createFakeProvider(),
      repoPath: "/repo",
      ...createFakeServers()
    });

    const testWriter = await toolkit.testWriter({
      taskId: "task-adv-1",
      prompt: "Fix behavior",
      plan: {
        summary: "Plan",
        steps: [{ id: "edit", description: "Edit file", kind: "edit" }],
        requiresTests: true
      },
      proposal: {
        summary: "Code proposal",
        rationale: "Risk noted",
        diff: "--- a/src/index.ts\n+++ b/src/index.ts\n",
        files: [{ path: "src/index.ts", changeType: "update" }],
        commands: ["corepack pnpm test"]
      }
    });

    const architectureReview = await toolkit.architectureReview({
      taskId: "task-adv-1",
      prompt: "Fix behavior",
      plan: {
        summary: "Plan",
        steps: [{ id: "edit", description: "Edit file", kind: "edit" }],
        requiresTests: true
      },
      proposal: {
        summary: "Code proposal",
        rationale: "Risk noted",
        diff: "--- a/src/index.ts\n+++ b/src/index.ts\n",
        files: [{ path: "src/index.ts", changeType: "update" }],
        commands: ["corepack pnpm test"]
      }
    });

    const technicalDebt = await toolkit.technicalDebt({
      taskId: "task-adv-1",
      prompt: "Fix behavior",
      proposal: {
        summary: "Code proposal",
        rationale: "Risk noted",
        diff: "--- a/src/index.ts\n+++ b/src/index.ts\n",
        files: [{ path: "src/index.ts", changeType: "update" }],
        commands: ["corepack pnpm test"]
      },
      reviewer: {
        summary: "Review summary",
        approved: true,
        findings: []
      },
      architectureReview: architectureReview.output
    });

    expect(testWriter.output.recommendedTests.length).toBeGreaterThan(0);
    expect(architectureReview.output.recommendations.length).toBeGreaterThan(0);
    expect(technicalDebt.output.items.length).toBeGreaterThan(0);
  });
});

describe("createLocalAgentHandlers", () => {
  it("returns structured outputs wrapped with prompt snapshots and metadata", async () => {
    const handlers = createLocalAgentHandlers({
      provider: createFakeProvider()
    });

    const result = await handlers.coordinator({
      taskId: "task-1",
      title: "Fix bug",
      prompt: "Fix a small bug"
    });

    expect(typeof result).toBe("object");
    expect(typeof result === "object" && result !== null && "output" in result).toBe(true);

    const envelope = result as { output: { summary: string }; metadata?: { promptSnapshot?: string } };
    expect(envelope.output.summary).toBe("Planned task");
    expect(envelope.metadata?.promptSnapshot).toContain("SYSTEM:");
    expect(envelope.metadata?.promptSnapshot).toContain("USER:");
  });

  it("short-circuits the test runner when no commands were executed", async () => {
    const handlers = createLocalAgentHandlers({
      provider: createFakeProvider()
    });

    const result = await handlers["test-runner"]({
      taskId: "task-2",
      prompt: "Summarize tests",
      commands: []
    });

    const envelope = result as {
      output: { passed: boolean; summary: string; commandResults: unknown[] };
      metadata?: { provider?: string };
    };
    expect(envelope.output.passed).toBe(true);
    expect(envelope.output.commandResults).toEqual([]);
    expect(envelope.metadata?.provider).toBe("deterministic");
  });
});

describe("createFallbackProvider", () => {
  it("uses the fallback provider when the primary provider throws", async () => {
    const primary: LocalModelProvider = {
      ...createFakeProvider(),
      provider: "primary",
      async generateStructured() {
        throw new Error("primary failed");
      }
    };

    const fallback = {
      ...createFakeProvider(),
      provider: "fallback",
      model: "fallback-model",
      async generateStructured<TOutput>(
        request: StructuredGenerationRequest<TOutput>
      ): Promise<StructuredGenerationResult<TOutput>> {
        const value = request.validator({ ok: true });

        return {
          text: JSON.stringify(value),
          object: value,
          provider: "fallback",
          model: "fallback-model",
          durationMs: 5
        };
      }
    };

    const provider = createFallbackProvider(primary, fallback);
    const result = await provider.generateStructured({
      systemPrompt: "system",
      userPrompt: "user",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object"
      },
      validator: (value) => value as { ok: true }
    });

    expect(result.provider).toBe("fallback");
  });
});

describe("createHostedModelProvider", () => {
  it("parses a hosted structured response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({ ok: true })
              }
            }
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            total_tokens: 18
          }
        }),
        { status: 200 }
      )) as typeof fetch;

    try {
      const provider = createHostedModelProvider({
        model: "hosted-model",
        baseUrl: "https://example.com/v1",
        apiKey: "secret"
      });

      const result = await provider.generateStructured({
        systemPrompt: "system",
        userPrompt: "user",
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object"
        },
        validator: (value) => value as { ok: boolean }
      });

      expect(result.provider).toBe("hosted");
      expect(result.object.ok).toBe(true);
      expect(result.usage?.totalTokens).toBe(18);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
