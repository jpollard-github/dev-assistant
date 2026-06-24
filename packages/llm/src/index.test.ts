import { describe, expect, it } from "vitest";

import {
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
      const value = request.validator({
        summary: "Planned task",
        steps: [{ id: "plan", description: "Do the task", kind: "analysis" }],
        requiresTests: true
      });

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
