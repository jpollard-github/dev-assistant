import { describe, expect, it } from "vitest";

import {
  estimateHostedCostForWorkflow,
  estimateHostedUsageCost,
  resolveHostedModelName,
  resolveRoleRouteTarget
} from "./model-routing.js";

describe("model routing", () => {
  it("keeps summaries and debt local while preferring hosted coding in hybrid mode", () => {
    const config = {
      mode: "hybrid" as const,
      model: { name: "qwen2.5-coder:7b" },
      hosted: {
        providerName: "openai",
        model: "gpt-4.1",
        pricing: {
          currency: "USD",
          inputCostPerMillionTokens: 2,
          outputCostPerMillionTokens: 8
        }
      },
      repositoryPrivacy: "private" as const,
      routing: {}
    };

    expect(resolveRoleRouteTarget(config, "coordinator")).toBe("local");
    expect(resolveRoleRouteTarget(config, "coder")).toBe("hosted");
    expect(resolveRoleRouteTarget(config, "reviewer")).toBe("local");
    expect(resolveRoleRouteTarget(config, "technical-debt")).toBe("local");
    expect(resolveHostedModelName(config)).toBe("gpt-4.1");
  });

  it("routes reviewer to hosted by default for public repositories in hybrid mode", () => {
    const config = {
      mode: "hybrid" as const,
      model: { name: "qwen2.5-coder:7b" },
      hosted: {
        providerName: "openai",
        pricing: {
          currency: "USD",
          inputCostPerMillionTokens: 1,
          outputCostPerMillionTokens: 2
        }
      },
      repositoryPrivacy: "public" as const,
      routing: {}
    };

    expect(resolveRoleRouteTarget(config, "reviewer")).toBe("hosted");
  });

  it("estimates hosted run cost from routed roles", () => {
    const estimate = estimateHostedCostForWorkflow(
      {
        mode: "hybrid",
        model: { name: "qwen2.5-coder:7b" },
        hosted: {
          providerName: "openai",
          pricing: {
            currency: "USD",
            inputCostPerMillionTokens: 1,
            outputCostPerMillionTokens: 3
          }
        },
        repositoryPrivacy: "public",
        routing: {}
      },
      "run"
    );

    expect(estimate.lineItems.some((item) => item.role === "coder")).toBe(true);
    expect(estimate.lineItems.some((item) => item.role === "reviewer")).toBe(true);
    expect(estimate.maximumCost).toBeGreaterThan(0);
  });

  it("estimates actual hosted usage from returned token counts", () => {
    const cost = estimateHostedUsageCost(
      {
        currency: "USD",
        inputCostPerMillionTokens: 2,
        outputCostPerMillionTokens: 6
      },
      {
        inputTokens: 10_000,
        outputTokens: 5_000
      }
    );

    expect(cost).toBeCloseTo(0.05, 5);
  });
});
