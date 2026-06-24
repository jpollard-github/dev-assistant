import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  benchmarkFixtures,
  materializeFixture,
  RegressionStore,
  runEvalMatrix,
  runGoldenStructuredOutputSuite,
  scoreEvalOutcome,
  summarizeRegressionHistory
} from "./index.js";

describe("benchmarkFixtures", () => {
  it("covers every planned Phase 8 task category", () => {
    expect(new Set(benchmarkFixtures.map((fixture) => fixture.category))).toEqual(
      new Set([
        "bug-fix",
        "feature-addition",
        "refactor",
        "test-generation",
        "review-only",
        "architecture-critique"
      ])
    );
  });

  it("materializes a fixture into a local repo directory", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "dev-assistant-evals-"));
    const fixture = benchmarkFixtures[0];
    if (!fixture) {
      throw new Error("Expected at least one benchmark fixture.");
    }
    const result = materializeFixture(fixture, repoRoot);

    expect(result.filePaths.length).toBeGreaterThan(0);
    expect(result.repoRoot).toBe(repoRoot);
  });
});

describe("scoreEvalOutcome", () => {
  it("scores all checklist dimensions for a strong outcome", () => {
    const fixture = benchmarkFixtures[0];
    if (!fixture) {
      throw new Error("Expected bug-fix fixture.");
    }
    const scorecard = scoreEvalOutcome(fixture, {
      buildSucceeded: true,
      testsPassed: true,
      changedFiles: ["src/math.ts", "src/math.test.ts"],
      reviewerFindings: [
        {
          message: "Off-by-one loop bound skips the end value.",
          filePath: "src/math.ts",
          line: 3
        }
      ],
      fileAccesses: ["src/math.ts", "src/math.test.ts"],
      finalSummary: "Changed two files and ran tests successfully."
    });

    expect(scorecard.totalScore).toBe(6);
    expect(scorecard.criteria.reviewerCaughtSeededBug.passed).toBe(true);
    expect(scorecard.criteria.usefulFinalSummary.passed).toBe(true);
  });

  it("flags forbidden file access and weak summaries", () => {
    const fixture = benchmarkFixtures[1];
    if (!fixture) {
      throw new Error("Expected feature-addition fixture.");
    }
    const scorecard = scoreEvalOutcome(fixture, {
      buildSucceeded: true,
      testsPassed: true,
      changedFiles: ["src/cli.ts"],
      reviewerFindings: [],
      fileAccesses: ["src/cli.ts", ".env"],
      finalSummary: "Done."
    });

    expect(scorecard.criteria.noForbiddenFileAccess.passed).toBe(false);
    expect(scorecard.criteria.usefulFinalSummary.passed).toBe(false);
    expect(scorecard.totalScore).toBeLessThan(6);
  });
});

describe("runEvalMatrix", () => {
  it("runs fixtures across multiple model labels and records scores", async () => {
    const storePath = join(
      mkdtempSync(join(tmpdir(), "dev-assistant-eval-store-")),
      "regressions.json"
    );
    const report = await runEvalMatrix({
      models: ["qwen2.5-coder:7b", "qwen2.5:3b"],
      fixtures: benchmarkFixtures.slice(0, 2),
      storePath,
      runner: {
        async run({ fixture, model }) {
          return {
            buildSucceeded: true,
            testsPassed: true,
            changedFiles: fixture.category === "feature-addition" ? ["src/cli.ts"] : ["src/math.ts"],
            reviewerFindings:
              fixture.category === "bug-fix"
                ? [
                    {
                      message: `Model ${model} spotted the off-by-one bug.`,
                      filePath: "src/math.ts",
                      line: 3
                    }
                  ]
                : [],
            fileAccesses: fixture.files.map((file) => file.path),
            finalSummary: "Changed files and kept JSON output behavior covered by tests."
          };
        }
      }
    });

    expect(report.results).toHaveLength(2);
    expect(report.results[0]?.evaluations).toHaveLength(2);

    const store = new RegressionStore(storePath);
    const records = store.load();
    expect(records).toHaveLength(4);

    const snapshot = summarizeRegressionHistory(records, "qwen2.5-coder:7b");
    expect(snapshot.latestTotalScore).toBeGreaterThan(0);
    expect(snapshot.latestRunId).not.toBeNull();
  });
});

describe("runGoldenStructuredOutputSuite", () => {
  it("validates the bundled structured output golden cases", () => {
    const report = runGoldenStructuredOutputSuite();

    expect(report.passed).toBe(report.total);
  });
});
