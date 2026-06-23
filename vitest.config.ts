import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@dev-assistant/shared": resolve("packages/shared/src/index.ts"),
      "@dev-assistant/core": resolve("packages/core/src/index.ts"),
      "@dev-assistant/agents": resolve("packages/agents/src/index.ts"),
      "@dev-assistant/mcp-servers": resolve("packages/mcp-servers/src/index.ts"),
      "@dev-assistant/llm": resolve("packages/llm/src/index.ts"),
      "@dev-assistant/evals": resolve("packages/evals/src/index.ts")
    }
  }
});
