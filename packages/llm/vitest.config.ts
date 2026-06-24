import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@dev-assistant/agents": fileURLToPath(new URL("../agents/src/index.ts", import.meta.url)),
      "@dev-assistant/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@dev-assistant/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url))
    }
  }
});
