import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildConfigDoctorReport,
  buildInitConfigTemplate,
  detectPackageManager,
  parseDiffFiles
} from "./utils.js";

describe("CLI helpers", () => {
  it("detects pnpm and seeds init config commands from package scripts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-assistant-cli-"));
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          scripts: {
            test: "vitest run",
            format: "prettier --write ."
          }
        },
        null,
        2
      )
    );

    expect(detectPackageManager(cwd)).toBe("pnpm");

    const template = buildInitConfigTemplate(cwd);
    expect(template.testCommands).toEqual(["corepack pnpm test"]);
    expect(template.formatCommands).toEqual(["corepack pnpm format"]);
    expect(template.allowedShellCommands).toEqual(["corepack pnpm test", "corepack pnpm format"]);
  });

  it("extracts changed files from unified diff text", () => {
    const files = parseDiffFiles([
      "diff --git a/src/index.ts b/src/index.ts",
      "+++ b/src/index.ts",
      "+++ b/src/other.ts",
      "+++ b/src/index.ts"
    ].join("\n"));

    expect(files).toEqual(["src/index.ts", "src/other.ts"]);
  });

  it("flags non-allowlisted test commands in config doctor output", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-assistant-cli-"));
    writeFileSync(
      join(cwd, "dev-assistant.config.json"),
      JSON.stringify(
        {
          repoPath: ".",
          model: { provider: "ollama", name: "qwen2.5-coder:7b" },
          allowedShellCommands: [],
          formatCommands: [],
          testCommands: ["corepack pnpm test"],
          approvalPolicy: "on-risky-action",
          dataDir: ".dev-assistant",
          mode: "local-only"
        },
        null,
        2
      )
    );

    const report = buildConfigDoctorReport(cwd);
    expect(report.status).toBe("warning");
    expect(report.checks.some((check) => check.name === "test-allowlist" && check.status === "warning")).toBe(true);
  });
});
