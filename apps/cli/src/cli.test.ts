import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildConfigDoctorReport,
  buildInitConfigTemplate,
  buildRuntimeDoctorReport,
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
    expect(template.security.allowNetwork).toBe(false);
    expect(template.security.allowHostedCodeContext).toBe(false);
    expect(template.repositoryPrivacy).toBe("private");
    expect(template.routing).toEqual({});
    expect(template.crashReporting.enabled).toBe(false);
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

  it("warns when hosted mode is configured without hosted code-context opt-in", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-assistant-cli-"));
    writeFileSync(
      join(cwd, "dev-assistant.config.json"),
      JSON.stringify(
        {
          repoPath: ".",
          model: { provider: "hosted", name: "gpt-4.1-mini" },
          hosted: { baseUrl: "https://api.openai.com/v1", apiKeyEnvVar: "OPENAI_API_KEY" },
          allowedShellCommands: [],
          formatCommands: [],
          testCommands: [],
          approvalPolicy: "on-risky-action",
          dataDir: ".dev-assistant",
          mode: "hosted",
          security: {
            allowNetwork: false,
            allowSecretAccess: false,
            allowHostedCodeContext: false,
            redactLogs: true,
            requireProvenanceComments: true,
            panicFile: ".dev-assistant/panic.json",
            processRegistryFile: ".dev-assistant/processes.json"
          }
        },
        null,
        2
      )
    );

    const report = buildConfigDoctorReport(cwd);
    expect(report.checks.some((check) => check.name === "hosted-code-context" && check.status === "warning")).toBe(true);
    expect(report.checks.some((check) => check.name === "network-policy" && check.status === "ok")).toBe(true);
  });

  it("warns when a private repository routes work to hosted providers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-assistant-cli-"));
    writeFileSync(
      join(cwd, "dev-assistant.config.json"),
      JSON.stringify(
        {
          repoPath: ".",
          model: { provider: "ollama", name: "qwen2.5-coder:7b" },
          hosted: {
            providerName: "openai",
            baseUrl: "https://api.openai.com/v1",
            apiKeyEnvVar: "OPENAI_API_KEY",
            model: "gpt-4.1-mini",
            pricing: {
              currency: "USD",
              inputCostPerMillionTokens: 1,
              outputCostPerMillionTokens: 2
            }
          },
          allowedShellCommands: [],
          formatCommands: [],
          testCommands: [],
          approvalPolicy: "on-risky-action",
          dataDir: ".dev-assistant",
          mode: "hybrid",
          repositoryPrivacy: "private",
          routing: {
            reviewer: "hosted"
          },
          security: {
            allowNetwork: true,
            allowSecretAccess: false,
            allowHostedCodeContext: true,
            redactLogs: true,
            requireProvenanceComments: true,
            panicFile: ".dev-assistant/panic.json",
            processRegistryFile: ".dev-assistant/processes.json"
          }
        },
        null,
        2
      )
    );

    const report = buildConfigDoctorReport(cwd);
    expect(report.checks.some((check) => check.name === "repository-privacy" && check.status === "warning")).toBe(true);
    expect(report.checks.some((check) => check.name === "hosted-pricing" && check.status === "ok")).toBe(true);
  });

  it("includes the structured debt security defaults in generated init config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-assistant-cli-"));
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "fixture" }, null, 2));

    const template = buildInitConfigTemplate(cwd);
    expect(template.security.requireProvenanceComments).toBe(true);
    expect(template.security.allowSecretAccess).toBe(false);
    expect(template.security.panicFile).toContain(".dev-assistant");
    expect(template.crashReporting.directory).toContain(".dev-assistant/crash-reports");
  });

  it("includes task-store and crash-report checks in runtime doctor output", () => {
    const cwd = mkdtempSync(join(tmpdir(), "dev-assistant-cli-"));
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "fixture" }, null, 2));

    const report = buildRuntimeDoctorReport(cwd);
    expect(report.checks.some((check) => check.name === "task-store" && check.status === "ok")).toBe(true);
    expect(report.checks.some((check) => check.name === "crash-reports" && check.status === "ok")).toBe(true);
  });
});
