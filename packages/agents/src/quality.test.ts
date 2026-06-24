import { describe, expect, it } from "vitest";

import {
  enrichReviewerOutput,
  mergeTestWriterIntoCoderProposal,
  reconcileCoderProposal,
  sanitizeCoderProposal
} from "./quality.js";

describe("mergeTestWriterIntoCoderProposal", () => {
  it("adds focused test operations without replacing implementation operations", () => {
    const merged = mergeTestWriterIntoCoderProposal(
      {
        summary: "Update parser behavior.",
        rationale: "Implementation fix.",
        diff: "--- a/src/parser.ts\n+++ b/src/parser.ts\n",
        files: [{ path: "src/parser.ts", changeType: "update" }],
        operations: [{ path: "src/parser.ts", changeType: "update", content: "export const parser = true;\n" }],
        commands: ["pnpm test"]
      },
      {
        summary: "Add parser coverage.",
        coverageGaps: ["No parser regression test."],
        recommendedTests: [
          {
            filePath: "tests/parser.test.ts",
            testName: "guards the parser regression",
            rationale: "Covers the changed behavior."
          }
        ],
        files: [{ path: "tests/parser.test.ts", changeType: "create" }],
        operations: [
          {
            path: "tests/parser.test.ts",
            changeType: "create",
            content: "it('guards the parser regression', () => {});\n"
          }
        ],
        commands: ["pnpm test tests/parser.test.ts"]
      }
    );

    expect(merged.operations.map((operation) => operation.path)).toEqual(["src/parser.ts", "tests/parser.test.ts"]);
    expect(merged.files.map((file) => file.path)).toEqual(["src/parser.ts", "tests/parser.test.ts"]);
    expect(merged.commands).toContain("pnpm test tests/parser.test.ts");
  });
});

describe("enrichReviewerOutput", () => {
  it("fills missing file and line metadata from a single-file diff", () => {
    const enriched = enrichReviewerOutput(
      {
        summary: "There is a regression.",
        approved: false,
        findings: [{ severity: "high", message: "The comparison is reversed." }]
      },
      [
        "diff --git a/src/index.ts b/src/index.ts",
        "--- a/src/index.ts",
        "+++ b/src/index.ts",
        "@@ -10,2 +10,2 @@",
        "-  return left < right;",
        "+  return left > right;"
      ].join("\n"),
      ["src/index.ts"]
    );

    expect(enriched.findings[0]?.filePath).toBe("src/index.ts");
    expect(enriched.findings[0]?.line).toBe(10);
  });
});

describe("sanitizeCoderProposal", () => {
  it("removes assistant-control file edits when the user did not request them", () => {
    const sanitized = sanitizeCoderProposal(
      {
        summary: "Fix the regression.",
        rationale: "Implementation update.",
        diff: "--- a/src/index.ts\n+++ b/src/index.ts\n",
        files: [
          { path: "src/index.ts", changeType: "update" },
          { path: ".dev-assistant/", changeType: "create" },
          { path: "dev-assistant.config.json", changeType: "update" }
        ],
        operations: [
          { path: "src/index.ts", changeType: "update", content: "export const value = 1;\n" },
          { path: ".dev-assistant/", changeType: "create", content: "state" },
          { path: "dev-assistant.config.json", changeType: "update", content: "{}\n" }
        ],
        commands: ["pnpm test"]
      },
      "Fix the regression in src/index.ts and run tests."
    );

    expect(sanitized.files.map((file) => file.path)).toEqual(["src/index.ts"]);
    expect(sanitized.operations.map((operation) => operation.path)).toEqual(["src/index.ts"]);
  });

  it("keeps assistant-control file edits when the user explicitly requests them", () => {
    const sanitized = sanitizeCoderProposal(
      {
        summary: "Update config.",
        rationale: "Config update.",
        diff: "--- a/dev-assistant.config.json\n+++ b/dev-assistant.config.json\n",
        files: [{ path: "dev-assistant.config.json", changeType: "update" }],
        operations: [{ path: "dev-assistant.config.json", changeType: "update", content: "{}\n" }],
        commands: []
      },
      "Update dev-assistant.config.json to change the test command."
    );

    expect(sanitized.files.map((file) => file.path)).toEqual(["dev-assistant.config.json"]);
    expect(sanitized.operations.map((operation) => operation.path)).toEqual(["dev-assistant.config.json"]);
  });
});

describe("reconcileCoderProposal", () => {
  it("drops declared files that do not have matching operations", () => {
    const reconciled = reconcileCoderProposal({
      summary: "Fix the regression.",
      rationale: "Implementation update.",
      diff: "--- a/src/index.ts\n+++ b/src/index.ts\n",
      files: [
        { path: "src/index.ts", changeType: "update" },
        { path: "tests/index.test.ts", changeType: "create" }
      ],
      operations: [
        {
          path: "tests/index.test.ts",
          changeType: "create",
          content: "it('works', () => {});\n"
        }
      ],
      commands: ["pnpm test"]
    });

    expect(reconciled.files.map((file) => file.path)).toEqual(["tests/index.test.ts"]);
    expect(reconciled.operations.map((operation) => operation.path)).toEqual(["tests/index.test.ts"]);
  });
});
