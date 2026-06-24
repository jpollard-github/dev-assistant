import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@dev-assistant/shared": resolve(__dirname, "../shared/src/index.ts"),
      "@dev-assistant/agents": resolve(__dirname, "../agents/src/index.ts"),
      "@dev-assistant/evals": resolve(__dirname, "./src/index.ts")
    }
  }
});
