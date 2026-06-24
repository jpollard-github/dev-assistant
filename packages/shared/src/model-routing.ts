import { z } from "zod";

export const repositoryPrivacySchema = z.enum(["private", "internal", "public"]);
export type RepositoryPrivacy = z.infer<typeof repositoryPrivacySchema>;

export const modelRouteTargetSchema = z.enum(["local", "hosted", "hybrid"]);
export type ModelRouteTarget = z.infer<typeof modelRouteTargetSchema>;

export const routedAssistantRoles = [
  "coordinator",
  "coder",
  "reviewer",
  "test-runner",
  "coordinator-report",
  "test-writer",
  "architecture-review",
  "technical-debt"
] as const;

export const routedAssistantRoleSchema = z.enum(routedAssistantRoles);
export type RoutedAssistantRole = z.infer<typeof routedAssistantRoleSchema>;

export const roleRoutingSchema = z
  .object({
    coordinator: modelRouteTargetSchema.optional(),
    coder: modelRouteTargetSchema.optional(),
    reviewer: modelRouteTargetSchema.optional(),
    "test-runner": modelRouteTargetSchema.optional(),
    "coordinator-report": modelRouteTargetSchema.optional(),
    "test-writer": modelRouteTargetSchema.optional(),
    "architecture-review": modelRouteTargetSchema.optional(),
    "technical-debt": modelRouteTargetSchema.optional()
  })
  .default({});

export type RoleRoutingConfig = z.infer<typeof roleRoutingSchema>;

export const hostedPricingSchema = z
  .object({
    currency: z.string().min(1).default("USD"),
    inputCostPerMillionTokens: z.number().nonnegative().default(0),
    outputCostPerMillionTokens: z.number().nonnegative().default(0),
    maxTaskCost: z.number().nonnegative().optional()
  })
  .default({
    currency: "USD",
    inputCostPerMillionTokens: 0,
    outputCostPerMillionTokens: 0
  });

export type HostedPricingConfig = z.infer<typeof hostedPricingSchema>;

const DEFAULT_ROLE_TOKEN_ESTIMATES: Record<
  RoutedAssistantRole,
  {
    readonly inputTokens: number;
    readonly outputTokens: number;
  }
> = {
  coordinator: { inputTokens: 2_000, outputTokens: 700 },
  coder: { inputTokens: 8_000, outputTokens: 3_000 },
  reviewer: { inputTokens: 4_500, outputTokens: 1_500 },
  "test-runner": { inputTokens: 1_000, outputTokens: 400 },
  "coordinator-report": { inputTokens: 1_200, outputTokens: 500 },
  "test-writer": { inputTokens: 3_000, outputTokens: 1_000 },
  "architecture-review": { inputTokens: 3_000, outputTokens: 900 },
  "technical-debt": { inputTokens: 2_000, outputTokens: 700 }
};

export const workflowRoleSets = {
  run: [
    "coordinator",
    "coder",
    "reviewer",
    "test-runner",
    "coordinator-report",
    "test-writer",
    "architecture-review",
    "technical-debt"
  ] as const,
  review: ["reviewer"] as const
} as const;

export type TaskWorkflowKind = keyof typeof workflowRoleSets;

interface ModelRoutingConfigLike {
  readonly mode: "local-only" | "hybrid" | "hosted";
  readonly model: {
    readonly name: string;
  };
  readonly hosted?:
    | {
        readonly providerName?: string | undefined;
        readonly model?: string | undefined;
        readonly pricing?: HostedPricingConfig | undefined;
      }
    | undefined;
  readonly repositoryPrivacy?: RepositoryPrivacy | undefined;
  readonly routing?: Partial<Record<RoutedAssistantRole, ModelRouteTarget | undefined>> | undefined;
}

export interface HostedCostEstimateLineItem {
  readonly role: RoutedAssistantRole;
  readonly route: ModelRouteTarget;
  readonly provider: string;
  readonly model: string;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly minimumCost: number;
  readonly maximumCost: number;
}

export interface HostedCostEstimate {
  readonly currency: string;
  readonly minimumCost: number;
  readonly maximumCost: number;
  readonly lineItems: readonly HostedCostEstimateLineItem[];
}

export interface TokenUsageLike {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export function resolveHostedProviderName(config: ModelRoutingConfigLike): string {
  return config.hosted?.providerName?.trim() || "hosted";
}

export function resolveHostedModelName(config: ModelRoutingConfigLike): string {
  return config.hosted?.model?.trim() || config.model.name;
}

export function resolveRoleRouteTarget(
  config: ModelRoutingConfigLike,
  role: RoutedAssistantRole
): ModelRouteTarget {
  const explicit = config.routing?.[role];
  if (explicit) {
    return explicit;
  }

  if (config.mode === "local-only") {
    return "local";
  }

  if (config.mode === "hosted") {
    return "hosted";
  }

  if (role === "coder") {
    return "hosted";
  }

  if (role === "reviewer") {
    return config.repositoryPrivacy === "public" ? "hosted" : "local";
  }

  return "local";
}

export function getHostedRoles(
  config: ModelRoutingConfigLike,
  roles: readonly RoutedAssistantRole[]
): readonly RoutedAssistantRole[] {
  return roles.filter((role) => resolveRoleRouteTarget(config, role) !== "local");
}

export function estimateHostedCostForWorkflow(
  config: ModelRoutingConfigLike,
  workflow: TaskWorkflowKind
): HostedCostEstimate {
  return estimateHostedCostForRoles(config, workflowRoleSets[workflow]);
}

export function estimateHostedCostForRoles(
  config: ModelRoutingConfigLike,
  roles: readonly RoutedAssistantRole[]
): HostedCostEstimate {
  const pricing = config.hosted?.pricing ?? hostedPricingSchema.parse({});
  const provider = resolveHostedProviderName(config);
  const model = resolveHostedModelName(config);
  const lineItems: HostedCostEstimateLineItem[] = [];
  let minimumCost = 0;
  let maximumCost = 0;

  for (const role of roles) {
    const route = resolveRoleRouteTarget(config, role);
    if (route === "local") {
      continue;
    }

    const estimate = DEFAULT_ROLE_TOKEN_ESTIMATES[role];
    const roleCost = estimateUsageCost(pricing, estimate);
    const item: HostedCostEstimateLineItem = {
      role,
      route,
      provider,
      model,
      estimatedInputTokens: estimate.inputTokens,
      estimatedOutputTokens: estimate.outputTokens,
      minimumCost: route === "hosted" ? roleCost : 0,
      maximumCost: roleCost
    };

    lineItems.push(item);
    minimumCost += item.minimumCost;
    maximumCost += item.maximumCost;
  }

  return {
    currency: pricing.currency,
    minimumCost,
    maximumCost,
    lineItems
  };
}

export function estimateHostedUsageCost(
  pricing: HostedPricingConfig | undefined,
  usage: TokenUsageLike | undefined
): number {
  if (!pricing || !usage) {
    return 0;
  }

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  if (inputTokens === 0 && outputTokens === 0 && usage.totalTokens) {
    const fallbackRate = Math.max(
      pricing.inputCostPerMillionTokens,
      pricing.outputCostPerMillionTokens
    );
    return (usage.totalTokens / 1_000_000) * fallbackRate;
  }

  return estimateUsageCost(pricing, {
    inputTokens,
    outputTokens
  });
}

function estimateUsageCost(
  pricing: HostedPricingConfig,
  usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  }
): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputCostPerMillionTokens +
    (usage.outputTokens / 1_000_000) * pricing.outputCostPerMillionTokens
  );
}
