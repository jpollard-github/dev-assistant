import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import {
  hostedPricingSchema,
  repositoryPrivacySchema,
  roleRoutingSchema
} from "./model-routing.js";
import { securityConfigSchema } from "./security.js";

export const approvalPolicySchema = z.enum(["always", "on-risky-action", "never"]);
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const assistantModeSchema = z.enum(["local-only", "hybrid", "hosted"]);
export type AssistantMode = z.infer<typeof assistantModeSchema>;

export const assistantConfigSchema = z.object({
  repoPath: z.string().min(1).default("."),
  model: z
    .object({
      provider: z.enum(["ollama", "lm-studio", "llama.cpp", "vllm", "hosted"]).default("ollama"),
      name: z.string().min(1).default("qwen2.5-coder:7b")
    })
    .default({ provider: "ollama", name: "qwen2.5-coder:7b" }),
  hosted: z
    .object({
      providerName: z.string().min(1).default("hosted"),
      baseUrl: z.string().min(1),
      apiKeyEnvVar: z.string().min(1).default("OPENAI_API_KEY"),
      model: z.string().min(1).optional(),
      pricing: hostedPricingSchema.optional()
    })
    .optional(),
  allowedShellCommands: z.array(z.string().min(1)).default([]),
  formatCommands: z.array(z.string().min(1)).default([]),
  testCommands: z.array(z.string().min(1)).default([]),
  approvalPolicy: approvalPolicySchema.default("on-risky-action"),
  dataDir: z.string().min(1).default(".dev-assistant"),
  mode: assistantModeSchema.default("local-only"),
  repositoryPrivacy: repositoryPrivacySchema.default("private"),
  routing: roleRoutingSchema,
  security: securityConfigSchema
});

export type AssistantConfig = z.infer<typeof assistantConfigSchema>;

export const DEFAULT_CONFIG_FILE = "dev-assistant.config.json";

export function loadAssistantConfig(cwd = process.cwd()): AssistantConfig {
  const configPath = resolve(cwd, DEFAULT_CONFIG_FILE);

  if (!existsSync(configPath)) {
    return assistantConfigSchema.parse({});
  }

  const rawConfig = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  return assistantConfigSchema.parse(rawConfig);
}

export function resolveRepoPath(config: AssistantConfig, cwd = process.cwd()): string {
  return resolve(cwd, config.repoPath);
}
