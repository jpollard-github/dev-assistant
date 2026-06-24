import type {
  AgentOutputMap,
  AgentRole,
  JsonSchema
} from "@dev-assistant/agents";
import {
  agentOutputJsonSchemas,
  coordinatorOutputSchema,
  coderOutputSchema,
  reviewerOutputSchema,
  testRunnerOutputSchema
} from "@dev-assistant/agents";
import type {
  AgentExecutionEnvelope,
  AgentHandlers,
  AgentInvocationMap,
  ModelTokenUsage
} from "@dev-assistant/core";

export const llmPackageName = "@dev-assistant/llm";

export interface ModelCapabilityMetadata {
  readonly contextWindow: number;
  readonly toolUseSupport: "none" | "limited" | "native";
  readonly structuredOutputReliability: "low" | "medium" | "high";
  readonly recommendedRoles: readonly AgentRole[];
}

export interface GenerationOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly temperature?: number;
}

export interface TextGenerationRequest extends GenerationOptions {
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface StructuredGenerationRequest<TOutput> extends GenerationOptions {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly schema: JsonSchema;
  readonly validator: (value: unknown) => TOutput;
}

export interface TextGenerationResult {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly durationMs: number;
  readonly finishReason?: string;
  readonly usage?: ModelTokenUsage;
}

export interface StructuredGenerationResult<TOutput> extends TextGenerationResult {
  readonly object: TOutput;
}

export interface LocalModelProvider {
  readonly provider: string;
  readonly model: string;
  readonly capabilities: ModelCapabilityMetadata;
  generateText(request: TextGenerationRequest): Promise<TextGenerationResult>;
  generateStructured<TOutput>(
    request: StructuredGenerationRequest<TOutput>
  ): Promise<StructuredGenerationResult<TOutput>>;
  streamText?: (request: TextGenerationRequest) => AsyncIterable<string>;
}

export interface OllamaProviderOptions {
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly capabilities?: ModelCapabilityMetadata;
}

export interface LocalAgentOptions {
  readonly provider: LocalModelProvider;
  readonly timeouts?: Partial<Record<AgentRole, number>>;
}

export interface HostedModelProviderOptions {
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly providerName?: string;
  readonly timeoutMs?: number;
  readonly capabilities?: ModelCapabilityMetadata;
}

interface OllamaGenerateResponse {
  readonly response: string;
  readonly done_reason?: string;
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
}

interface HostedChatCompletionsResponse {
  readonly choices?: Array<{
    readonly finish_reason?: string;
    readonly message?: {
      readonly content?: string | Array<{ readonly type?: string; readonly text?: string }>;
    };
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

const DEFAULT_GENERATION_TIMEOUT_MS = 20_000;

const DEFAULT_MODEL_CAPABILITIES: ModelCapabilityMetadata = {
  contextWindow: 32_768,
  toolUseSupport: "limited",
  structuredOutputReliability: "medium",
  recommendedRoles: ["coordinator", "coder", "reviewer", "test-runner"]
};

const MODEL_METADATA_OVERRIDES: Array<{
  readonly match: RegExp;
  readonly capabilities: ModelCapabilityMetadata;
}> = [
  {
    match: /qwen2\.5-coder|qwen3-coder/i,
    capabilities: {
      contextWindow: 32_768,
      toolUseSupport: "limited",
      structuredOutputReliability: "high",
      recommendedRoles: ["coder", "reviewer", "coordinator"]
    }
  },
  {
    match: /qwen2\.5:3b|phi|llama3\.2:3b|mistral:7b/i,
    capabilities: {
      contextWindow: 32_768,
      toolUseSupport: "limited",
      structuredOutputReliability: "medium",
      recommendedRoles: ["coordinator", "test-runner"]
    }
  },
  {
    match: /deepseek-coder|codellama/i,
    capabilities: {
      contextWindow: 16_384,
      toolUseSupport: "limited",
      structuredOutputReliability: "medium",
      recommendedRoles: ["coder", "reviewer"]
    }
  }
];

export function resolveModelCapabilities(model: string): ModelCapabilityMetadata {
  for (const entry of MODEL_METADATA_OVERRIDES) {
    if (entry.match.test(model)) {
      return entry.capabilities;
    }
  }

  return DEFAULT_MODEL_CAPABILITIES;
}

export function createOllamaProvider(options: OllamaProviderOptions): LocalModelProvider {
  return {
    provider: "ollama",
    model: options.model,
    capabilities: options.capabilities ?? resolveModelCapabilities(options.model),
    async generateText(request) {
      return runOllamaGenerate(
        withOptionalProperties(
          {
            model: options.model,
            request
          },
          {
            baseUrl: options.baseUrl,
            defaultTimeoutMs: options.timeoutMs
          }
        )
      );
    },
    async generateStructured<TOutput>(request: StructuredGenerationRequest<TOutput>) {
      const response = await runOllamaGenerate(
        withOptionalProperties(
          {
            model: options.model,
            request,
            format: request.schema
          },
          {
            baseUrl: options.baseUrl,
            defaultTimeoutMs: options.timeoutMs
          }
        )
      );

      const parsed = JSON.parse(response.text) as unknown;
      return {
        ...response,
        object: request.validator(parsed)
      };
    }
  };
}

export function createHostedModelProvider(options: HostedModelProviderOptions): LocalModelProvider {
  const providerName = options.providerName ?? "hosted";

  return {
    provider: providerName,
    model: options.model,
    capabilities: options.capabilities ?? DEFAULT_MODEL_CAPABILITIES,
    async generateText(request) {
      return runHostedChatCompletion(
        withOptionalProperties(
          {
            baseUrl: options.baseUrl,
            model: options.model,
            apiKey: options.apiKey,
            providerName,
            request
          },
          {
            defaultTimeoutMs: options.timeoutMs
          }
        )
      );
    },
    async generateStructured<TOutput>(request: StructuredGenerationRequest<TOutput>) {
      const response = await runHostedChatCompletion(
        withOptionalProperties(
          {
            baseUrl: options.baseUrl,
            model: options.model,
            apiKey: options.apiKey,
            providerName,
            request,
            schema: request.schema
          },
          {
            defaultTimeoutMs: options.timeoutMs
          }
        )
      );

      const parsed = JSON.parse(response.text) as unknown;
      return {
        ...response,
        object: request.validator(parsed)
      };
    }
  };
}

export function createFallbackProvider(
  primary: LocalModelProvider,
  fallback: LocalModelProvider
): LocalModelProvider {
  const provider: LocalModelProvider = {
    provider: `${primary.provider}+fallback`,
    model: primary.model,
    capabilities: primary.capabilities,
    async generateText(request) {
      try {
        return await primary.generateText(request);
      } catch {
        return fallback.generateText(request);
      }
    },
    async generateStructured<TOutput>(request: StructuredGenerationRequest<TOutput>) {
      try {
        return await primary.generateStructured(request);
      } catch {
        return fallback.generateStructured(request);
      }
    }
  };

  if (primary.streamText) {
    Object.assign(provider, { streamText: primary.streamText });
  }

  return provider;
}

export function createLocalAgentHandlers(options: LocalAgentOptions): AgentHandlers {
  const { provider, timeouts } = options;

  return {
    async coordinator(input) {
      return generateStructuredAgentOutput({
        provider,
        role: "coordinator",
        schema: agentOutputJsonSchemas.coordinator,
        validator: (value) => coordinatorOutputSchema.parse(value),
        prompt: renderCoordinatorPrompt(input, provider.capabilities),
        ...(timeouts?.coordinator === undefined ? {} : { timeoutMs: timeouts.coordinator })
      });
    },
    async coder(input) {
      return generateStructuredAgentOutput({
        provider,
        role: "coder",
        schema: agentOutputJsonSchemas.coder,
        validator: (value) => coderOutputSchema.parse(value),
        prompt: renderCoderPrompt(input, provider.capabilities),
        ...(timeouts?.coder === undefined ? {} : { timeoutMs: timeouts.coder })
      });
    },
    async reviewer(input) {
      return generateStructuredAgentOutput({
        provider,
        role: "reviewer",
        schema: agentOutputJsonSchemas.reviewer,
        validator: (value) => reviewerOutputSchema.parse(value),
        prompt: renderReviewerPrompt(input, provider.capabilities),
        ...(timeouts?.reviewer === undefined ? {} : { timeoutMs: timeouts.reviewer })
      });
    },
    async "test-runner"(input) {
      if (input.commands.length === 0) {
        return {
          output: {
            summary: "No configured test commands were executed.",
            passed: true,
            commandResults: []
          },
          metadata: {
            promptSnapshot: "SYSTEM:\nDeterministic no-test fallback.\n\nUSER:\nNo commands provided.",
            provider: "deterministic",
            model: "no-test-short-circuit",
            durationMs: 0,
            finishReason: "short-circuit"
          }
        };
      }

      return generateStructuredAgentOutput({
        provider,
        role: "test-runner",
        schema: agentOutputJsonSchemas["test-runner"],
        validator: (value) => testRunnerOutputSchema.parse(value),
        prompt: renderTestRunnerPrompt(input, provider.capabilities),
        ...(timeouts?.["test-runner"] === undefined
          ? {}
          : { timeoutMs: timeouts["test-runner"] })
      });
    }
  };
}

async function generateStructuredAgentOutput<TRole extends AgentRole, TOutput extends AgentOutputMap[TRole]>(
  params: {
    readonly provider: LocalModelProvider;
    readonly role: TRole;
    readonly timeoutMs?: number;
    readonly schema: JsonSchema;
    readonly validator: (value: unknown) => TOutput;
    readonly prompt: {
      readonly systemPrompt: string;
      readonly userPrompt: string;
    };
  }
): Promise<AgentExecutionEnvelope> {
  const result = await params.provider.generateStructured({
    systemPrompt: params.prompt.systemPrompt,
    userPrompt: params.prompt.userPrompt,
    schema: params.schema,
    validator: params.validator,
    ...(params.timeoutMs === undefined ? {} : { timeoutMs: params.timeoutMs })
  });

  const metadata: AgentExecutionEnvelope["metadata"] = {
    promptSnapshot: renderPromptSnapshot(params.prompt.systemPrompt, params.prompt.userPrompt),
    provider: result.provider,
    model: result.model,
    durationMs: result.durationMs
  };

  if (result.usage) {
    Object.assign(metadata, { tokenUsage: result.usage });
  }

  if (result.finishReason) {
    Object.assign(metadata, { finishReason: result.finishReason });
  }

  return {
    output: result.object,
    metadata
  };
}

async function runOllamaGenerate(params: {
  readonly baseUrl?: string;
  readonly defaultTimeoutMs?: number;
  readonly model: string;
  readonly request: TextGenerationRequest;
  readonly format?: JsonSchema;
}): Promise<TextGenerationResult> {
  const startedAt = Date.now();
  const { signal, cleanup } = composeAbortSignal(
    params.request.signal,
    params.request.timeoutMs ?? params.defaultTimeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS
  );

  try {
    const response = await fetch(`${params.baseUrl ?? "http://127.0.0.1:11434"}/api/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        format: params.format,
        options: params.request.temperature === undefined ? undefined : { temperature: params.request.temperature },
        system: params.request.systemPrompt,
        prompt: params.request.userPrompt
      }),
      signal
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    const result: TextGenerationResult = {
      text: payload.response.trim(),
      provider: "ollama",
      model: params.model,
      durationMs: Date.now() - startedAt
    };

    const usage = normalizeOllamaUsage(payload);
    if (payload.done_reason) {
      Object.assign(result, { finishReason: payload.done_reason });
    }
    if (usage) {
      Object.assign(result, { usage });
    }

    return result;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Model request timed out or was cancelled for ${params.model}.`);
    }

    throw error;
  } finally {
    cleanup();
  }
}

async function runHostedChatCompletion(params: {
  readonly baseUrl: string;
  readonly defaultTimeoutMs?: number;
  readonly model: string;
  readonly apiKey: string;
  readonly providerName: string;
  readonly request: TextGenerationRequest;
  readonly schema?: JsonSchema;
}): Promise<TextGenerationResult> {
  const startedAt = Date.now();
  const { signal, cleanup } = composeAbortSignal(
    params.request.signal,
    params.request.timeoutMs ?? params.defaultTimeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS
  );

  try {
    const response = await fetch(`${trimTrailingSlash(params.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: "system", content: params.request.systemPrompt },
          { role: "user", content: params.request.userPrompt }
        ],
        temperature: params.request.temperature ?? 0,
        ...(params.schema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "dev_assistant_output",
                  strict: true,
                  schema: params.schema
                }
              }
            }
          : {})
      }),
      signal
    });

    if (!response.ok) {
      throw new Error(`${params.providerName} request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as HostedChatCompletionsResponse;
    const choice = payload.choices?.[0];
    const content = normalizeHostedContent(choice?.message?.content);
    if (!content) {
      throw new Error(`${params.providerName} returned an empty completion.`);
    }

    const result: TextGenerationResult = {
      text: content,
      provider: params.providerName,
      model: params.model,
      durationMs: Date.now() - startedAt
    };

    if (choice?.finish_reason) {
      Object.assign(result, { finishReason: choice.finish_reason });
    }

    const usage = normalizeHostedUsage(payload);
    if (usage) {
      Object.assign(result, { usage });
    }

    return result;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Hosted model request timed out or was cancelled for ${params.model}.`);
    }

    throw error;
  } finally {
    cleanup();
  }
}

function normalizeOllamaUsage(payload: OllamaGenerateResponse): ModelTokenUsage | undefined {
  if (payload.prompt_eval_count === undefined && payload.eval_count === undefined) {
    return undefined;
  }

  const inputTokens = payload.prompt_eval_count;
  const outputTokens = payload.eval_count;
  const totalTokens =
    (inputTokens ?? 0) + (outputTokens ?? 0) > 0 ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined;

  const usage: ModelTokenUsage = {};

  if (inputTokens !== undefined) {
    Object.assign(usage, { inputTokens });
  }

  if (outputTokens !== undefined) {
    Object.assign(usage, { outputTokens });
  }

  if (totalTokens !== undefined) {
    Object.assign(usage, { totalTokens });
  }

  return usage;
}

function normalizeHostedUsage(payload: HostedChatCompletionsResponse): ModelTokenUsage | undefined {
  const usage = payload.usage;
  if (!usage) {
    return undefined;
  }

  const normalized: ModelTokenUsage = {};

  if (usage.prompt_tokens !== undefined) {
    Object.assign(normalized, { inputTokens: usage.prompt_tokens });
  }

  if (usage.completion_tokens !== undefined) {
    Object.assign(normalized, { outputTokens: usage.completion_tokens });
  }

  if (usage.total_tokens !== undefined) {
    Object.assign(normalized, { totalTokens: usage.total_tokens });
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function composeAbortSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const onAbort = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onAbort);
      }
    }
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
}

function renderPromptSnapshot(systemPrompt: string, userPrompt: string): string {
  return `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`;
}

function normalizeHostedContent(
  content: string | Array<{ readonly type?: string; readonly text?: string }> | undefined
): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? "")
      .join("")
      .trim();
  }

  return "";
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function withOptionalProperties<TBase extends Record<string, unknown>, TOptional extends Record<string, unknown>>(
  base: TBase,
  optional: TOptional
): TBase & Partial<TOptional> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result as TBase & Partial<TOptional>;
}

function renderCoordinatorPrompt(
  input: AgentInvocationMap["coordinator"],
  capabilities: ModelCapabilityMetadata
): {
  readonly systemPrompt: string;
  readonly userPrompt: string;
} {
  return {
    systemPrompt:
      "You are the coordinator for a local-first development assistant. Produce a short deterministic plan for the fixed sequence coordinator -> coder -> reviewer -> test-runner. Reply only with JSON matching the schema.",
    userPrompt: `Task title: ${input.title}

Task prompt:
${input.prompt}

Model capabilities:
${JSON.stringify(capabilities, null, 2)}

Requirements:
- Keep the plan concise.
- Assume implementation will happen in small, reviewable steps.
- Set requiresTests to true unless the task is clearly documentation-only.`
  };
}

function renderCoderPrompt(
  input: AgentInvocationMap["coder"],
  capabilities: ModelCapabilityMetadata
): {
  readonly systemPrompt: string;
  readonly userPrompt: string;
} {
  return {
    systemPrompt:
      "You are the coder agent for a local-first development assistant. Produce a focused patch proposal. If repository context is missing, be explicit and conservative. Reply only with JSON matching the schema.",
    userPrompt: `User task:
${input.prompt}

Coordinator plan:
${JSON.stringify(input.plan, null, 2)}

Model capabilities:
${JSON.stringify(capabilities, null, 2)}

Requirements:
- Keep the proposal small and specific.
- Use files only when you can name likely targets from the task.
- Use commands only when they are directly relevant.
- Diff can be a proposed unified diff snippet or a placeholder patch plan if context is insufficient.`
  };
}

function renderReviewerPrompt(
  input: AgentInvocationMap["reviewer"],
  capabilities: ModelCapabilityMetadata
): {
  readonly systemPrompt: string;
  readonly userPrompt: string;
} {
  return {
    systemPrompt:
      "You are the reviewer agent for a local-first development assistant. Review only the proposed patch and its likely impact. Prioritize correctness and regressions. Reply only with JSON matching the schema.",
    userPrompt: `User task:
${input.prompt}

Coordinator plan:
${JSON.stringify(input.plan, null, 2)}

Patch proposal:
${JSON.stringify(input.proposal, null, 2)}

Patch result:
${JSON.stringify(input.patchResult, null, 2)}

Model capabilities:
${JSON.stringify(capabilities, null, 2)}

Requirements:
- Approve only if the proposal seems consistent with the task.
- Findings should be concrete and concise.
- Include filePath and line when the proposal contains enough detail to support it.`
  };
}

function renderTestRunnerPrompt(
  input: AgentInvocationMap["test-runner"],
  capabilities: ModelCapabilityMetadata
): {
  readonly systemPrompt: string;
  readonly userPrompt: string;
} {
  return {
    systemPrompt:
      "You are the test-runner summarizer for a local-first development assistant. Summarize the configured command results accurately. Reply only with JSON matching the schema.",
    userPrompt: `User task:
${input.prompt}

Observed command results:
${JSON.stringify(input.commands, null, 2)}

Model capabilities:
${JSON.stringify(capabilities, null, 2)}

Requirements:
- Mark passed true only if every command succeeded.
- Summarize failures plainly if any command failed.
- Preserve the observed command results.`
  };
}
