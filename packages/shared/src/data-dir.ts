import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { AssistantConfig } from "./config.js";

export function resolveDataDir(
  config: Pick<AssistantConfig, "dataDir">,
  cwd = process.cwd()
): string {
  return resolve(cwd, config.dataDir);
}

export function ensureDataDir(
  config: Pick<AssistantConfig, "dataDir">,
  cwd = process.cwd()
): string {
  const dataDir = resolveDataDir(config, cwd);
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}
