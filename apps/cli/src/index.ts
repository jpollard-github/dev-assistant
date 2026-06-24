#!/usr/bin/env node

import { loadAssistantConfig, writeLocalCrashReport } from "@dev-assistant/shared";

import { main } from "./cli.js";

main(process.argv.slice(2)).catch((error: unknown) => {
  try {
    const config = loadAssistantConfig(process.cwd());
    const crashReportPath = writeLocalCrashReport(config, {
      command: process.argv.slice(2),
      cwd: process.cwd(),
      error
    });

    if (crashReportPath) {
      console.error(`Crash report written to ${crashReportPath}`);
    }
  } catch {}

  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
