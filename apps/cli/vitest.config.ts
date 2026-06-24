import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@dev-assistant/agents": resolve(__dirname, "../../packages/agents/src/index.ts"),
      "@dev-assistant/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@dev-assistant/llm": resolve(__dirname, "../../packages/llm/src/index.ts"),
      "@dev-assistant/mcp-servers": resolve(__dirname, "../../packages/mcp-servers/src/index.ts"),
      "@dev-assistant/shared": resolve(__dirname, "../../packages/shared/src/index.ts")
    }
  }
});
