import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  parseAdvisoryAgentOutput,
  parseAgentOutput,
  type AdvisoryAgentOutputMap,
  type AdvisoryAgentRole,
  type AgentOutputMap,
  type AgentRole
} from "../../agents/src/index.js";

export const evalsPackageName = "@dev-assistant/evals";

export const evalTaskCategories = [
  "bug-fix",
  "feature-addition",
  "refactor",
  "test-generation",
  "review-only",
  "architecture-critique"
] as const;

export type EvalTaskCategory = (typeof evalTaskCategories)[number];

export interface EvalFixtureFile {
  readonly path: string;
  readonly content: string;
}

export interface EvalFixture {
  readonly id: string;
  readonly title: string;
  readonly category: EvalTaskCategory;
  readonly prompt: string;
  readonly files: readonly EvalFixtureFile[];
  readonly expected: {
    readonly maxChangedFiles: number;
    readonly seededBugKeywords?: readonly string[];
    readonly seededBugFile?: string;
    readonly requiredSummaryMentions?: readonly string[];
    readonly forbiddenPaths?: readonly string[];
    readonly shouldBuild: boolean;
    readonly shouldPassTests: boolean;
  };
}

export interface EvalObservedOutcome {
  readonly buildSucceeded: boolean;
  readonly testsPassed: boolean;
  readonly changedFiles: readonly string[];
  readonly reviewerFindings: readonly {
    readonly message: string;
    readonly filePath?: string;
    readonly line?: number;
  }[];
  readonly fileAccesses: readonly string[];
  readonly finalSummary: string;
}

export interface EvalCriterionResult {
  readonly passed: boolean;
  readonly score: number;
  readonly detail: string;
}

export interface EvalScorecard {
  readonly fixtureId: string;
  readonly category: EvalTaskCategory;
  readonly criteria: {
    readonly buildSucceeded: EvalCriterionResult;
    readonly testsPassed: EvalCriterionResult;
    readonly minimalChangedFiles: EvalCriterionResult;
    readonly reviewerCaughtSeededBug: EvalCriterionResult;
    readonly noForbiddenFileAccess: EvalCriterionResult;
    readonly usefulFinalSummary: EvalCriterionResult;
  };
  readonly totalScore: number;
  readonly maxScore: number;
}

export interface ModelEvalResult {
  readonly fixture: EvalFixture;
  readonly outcome: EvalObservedOutcome;
  readonly scorecard: EvalScorecard;
}

export interface RegressionRecord {
  readonly runId: string;
  readonly model: string;
  readonly fixtureId: string;
  readonly category: EvalTaskCategory;
  readonly totalScore: number;
  readonly maxScore: number;
  readonly createdAt: string;
}

export interface RegressionSnapshot {
  readonly model: string;
  readonly latestTotalScore: number;
  readonly previousTotalScore: number | null;
  readonly delta: number | null;
  readonly latestRunId: string | null;
}

export interface GoldenStructuredCase<TRole extends AgentRole | AdvisoryAgentRole> {
  readonly id: string;
  readonly role: TRole;
  readonly raw: unknown;
}

export interface GoldenStructuredResult {
  readonly caseId: string;
  readonly role: AgentRole | AdvisoryAgentRole;
  readonly passed: boolean;
  readonly detail: string;
}

export interface GoldenSuiteReport {
  readonly total: number;
  readonly passed: number;
  readonly results: readonly GoldenStructuredResult[];
}

export interface EvalMatrixRunner {
  run(input: {
    readonly fixture: EvalFixture;
    readonly model: string;
  }): Promise<EvalObservedOutcome>;
}

export interface EvalMatrixReport {
  readonly runId: string;
  readonly createdAt: string;
  readonly fixtures: readonly EvalFixture[];
  readonly models: readonly string[];
  readonly results: readonly {
    readonly model: string;
    readonly evaluations: readonly ModelEvalResult[];
    readonly totalScore: number;
    readonly maxScore: number;
  }[];
}

export const benchmarkFixtures: readonly EvalFixture[] = [
  {
    id: "bug-fix-off-by-one",
    title: "Fix an off-by-one bug in a utility function",
    category: "bug-fix",
    prompt: "Fix the off-by-one error in sumRange and keep the tests green.",
    files: [
      {
        path: "src/math.ts",
        content: `export function sumRange(start: number, end: number): number {\n  let total = 0;\n  for (let value = start; value < end; value += 1) {\n    total += value;\n  }\n  return total;\n}\n`
      },
      {
        path: "src/math.test.ts",
        content: `import { describe, expect, it } from "vitest";\nimport { sumRange } from "./math";\n\ndescribe("sumRange", () => {\n  it("includes the end value", () => {\n    expect(sumRange(1, 3)).toBe(6);\n  });\n});\n`
      }
    ],
    expected: {
      maxChangedFiles: 2,
      seededBugKeywords: ["off-by-one", "end value", "loop bound"],
      seededBugFile: "src/math.ts",
      requiredSummaryMentions: ["tests", "changed"],
      forbiddenPaths: [".env", ".git/config"],
      shouldBuild: true,
      shouldPassTests: true
    }
  },
  {
    id: "feature-add-cli-flag",
    title: "Add a feature flag to a tiny CLI",
    category: "feature-addition",
    prompt: "Add a --json flag that returns machine-readable output without changing the default human output.",
    files: [
      {
        path: "src/cli.ts",
        content: `export function formatGreeting(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n`
      }
    ],
    expected: {
      maxChangedFiles: 2,
      requiredSummaryMentions: ["json", "output"],
      forbiddenPaths: [".env"],
      shouldBuild: true,
      shouldPassTests: true
    }
  },
  {
    id: "refactor-extract-parser",
    title: "Extract parsing logic from a mixed-responsibility module",
    category: "refactor",
    prompt: "Refactor parseConfig into smaller helpers without changing behavior.",
    files: [
      {
        path: "src/config.ts",
        content: `export function parseConfig(raw: string) {\n  const pairs = raw.split(",");\n  const result: Record<string, string> = {};\n  for (const pair of pairs) {\n    const trimmed = pair.trim();\n    if (!trimmed) continue;\n    const [key, value] = trimmed.split("=");\n    result[key.trim()] = value.trim();\n  }\n  return result;\n}\n`
      }
    ],
    expected: {
      maxChangedFiles: 2,
      requiredSummaryMentions: ["refactor", "behavior"],
      forbiddenPaths: [".env"],
      shouldBuild: true,
      shouldPassTests: true
    }
  },
  {
    id: "test-generation-edge-cases",
    title: "Generate focused tests for edge cases",
    category: "test-generation",
    prompt: "Add focused tests for normalizeTag covering empty input and trimming behavior.",
    files: [
      {
        path: "src/tags.ts",
        content: `export function normalizeTag(input: string): string {\n  return input.trim().toLowerCase().replace(/\\s+/g, "-");\n}\n`
      },
      {
        path: "src/tags.test.ts",
        content: `import { describe, expect, it } from "vitest";\nimport { normalizeTag } from "./tags";\n\ndescribe("normalizeTag", () => {\n  it("normalizes a simple tag", () => {\n    expect(normalizeTag("Hello World")).toBe("hello-world");\n  });\n});\n`
      }
    ],
    expected: {
      maxChangedFiles: 1,
      requiredSummaryMentions: ["tests", "coverage"],
      forbiddenPaths: [".env"],
      shouldBuild: true,
      shouldPassTests: true
    }
  },
  {
    id: "review-seeded-null-check",
    title: "Review-only seeded bug fixture",
    category: "review-only",
    prompt: "Review the diff and identify correctness risks.",
    files: [
      {
        path: "src/session.ts",
        content: `export function getSessionUserName(session?: { user?: { name?: string } }): string {\n  return session!.user!.name!.trim();\n}\n`
      }
    ],
    expected: {
      maxChangedFiles: 0,
      seededBugKeywords: ["null", "undefined", "session", "trim"],
      seededBugFile: "src/session.ts",
      requiredSummaryMentions: ["risk", "review"],
      forbiddenPaths: [".env"],
      shouldBuild: true,
      shouldPassTests: true
    }
  },
  {
    id: "architecture-critique-layering",
    title: "Architecture critique for dependency direction",
    category: "architecture-critique",
    prompt: "Critique the module boundaries and dependency direction in this tiny repo.",
    files: [
      {
        path: "src/ui/page.ts",
        content: `import { saveUser } from "../data/store";\nexport function renderPage() {\n  return saveUser({ id: "1" });\n}\n`
      },
      {
        path: "src/data/store.ts",
        content: `import { renderPage } from "../ui/page";\nexport function saveUser(input: { id: string }) {\n  return renderPage() + input.id;\n}\n`
      }
    ],
    expected: {
      maxChangedFiles: 0,
      seededBugKeywords: ["dependency", "cycle", "boundary", "coupling"],
      requiredSummaryMentions: ["architecture", "boundary"],
      forbiddenPaths: [".env"],
      shouldBuild: true,
      shouldPassTests: true
    }
  }
] as const;

export const goldenStructuredCases: readonly GoldenStructuredCase<AgentRole | AdvisoryAgentRole>[] = [
  {
    id: "coordinator-valid",
    role: "coordinator",
    raw: {
      summary: "Plan a small task",
      steps: [{ id: "plan", description: "Inspect the task", kind: "analysis" }],
      requiresTests: true
    }
  },
  {
    id: "reviewer-valid",
    role: "reviewer",
    raw: {
      summary: "Flag a null-safety issue",
      approved: false,
      findings: [
        {
          severity: "high",
          message: "Possible null dereference on session.user.name",
          filePath: "src/session.ts",
          line: 2
        }
      ]
    }
  },
  {
    id: "test-writer-valid",
    role: "test-writer",
    raw: {
      summary: "Recommend two targeted edge-case tests",
      coverageGaps: ["No empty-input coverage"],
      recommendedTests: [
        {
          filePath: "src/tags.test.ts",
          testName: "returns an empty tag for blank input",
          rationale: "Protects the trimming edge case."
        }
      ]
    }
  },
  {
    id: "technical-debt-valid",
    role: "technical-debt",
    raw: {
      summary: "One follow-up debt item",
      items: [
        {
          title: "Break the UI/data dependency cycle",
          priority: "must-fix",
          files: ["src/ui/page.ts", "src/data/store.ts"],
          rationale: "The cycle will make testing and ownership harder.",
          recommendedFix: "Invert the dependency through a service boundary."
        }
      ]
    }
  }
] as const;

export function materializeFixture(
  fixture: EvalFixture,
  repoRoot: string
): { readonly repoRoot: string; readonly filePaths: readonly string[] } {
  const filePaths: string[] = [];

  for (const file of fixture.files) {
    const targetPath = resolve(repoRoot, file.path);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content, "utf8");
    filePaths.push(targetPath);
  }

  return {
    repoRoot,
    filePaths
  };
}

export function scoreEvalOutcome(
  fixture: EvalFixture,
  outcome: EvalObservedOutcome
): EvalScorecard {
  const buildSucceeded = scoreBooleanExpectation(
    fixture.expected.shouldBuild,
    outcome.buildSucceeded,
    "Build status matched the fixture expectation.",
    "Build status did not match the fixture expectation."
  );
  const testsPassed = scoreBooleanExpectation(
    fixture.expected.shouldPassTests,
    outcome.testsPassed,
    "Test result matched the fixture expectation.",
    "Test result did not match the fixture expectation."
  );
  const minimalChangedFiles = scoreMaxChangedFiles(
    fixture.expected.maxChangedFiles,
    outcome.changedFiles.length
  );
  const reviewerCaughtSeededBug = scoreReviewerSeededBug(
    fixture.expected.seededBugKeywords ?? [],
    fixture.expected.seededBugFile,
    outcome.reviewerFindings
  );
  const noForbiddenFileAccess = scoreForbiddenFileAccess(
    fixture.expected.forbiddenPaths ?? [],
    outcome.fileAccesses
  );
  const usefulFinalSummary = scoreUsefulSummary(
    fixture.expected.requiredSummaryMentions ?? [],
    outcome.finalSummary
  );

  const criteria = {
    buildSucceeded,
    testsPassed,
    minimalChangedFiles,
    reviewerCaughtSeededBug,
    noForbiddenFileAccess,
    usefulFinalSummary
  };
  const totalScore = Object.values(criteria).reduce((total, criterion) => total + criterion.score, 0);

  return {
    fixtureId: fixture.id,
    category: fixture.category,
    criteria,
    totalScore,
    maxScore: 6
  };
}

export async function runEvalMatrix(input: {
  readonly fixtures?: readonly EvalFixture[];
  readonly models: readonly string[];
  readonly runner: EvalMatrixRunner;
  readonly storePath?: string;
}): Promise<EvalMatrixReport> {
  const fixtures = input.fixtures ?? benchmarkFixtures;
  const createdAt = new Date().toISOString();
  const runId = `eval-${createdAt}`;
  const results: Array<{
    readonly model: string;
    readonly evaluations: readonly ModelEvalResult[];
    readonly totalScore: number;
    readonly maxScore: number;
  }> = [];
  const regressionStore = input.storePath ? new RegressionStore(input.storePath) : null;

  for (const model of input.models) {
    const evaluations: ModelEvalResult[] = [];

    for (const fixture of fixtures) {
      const outcome = await input.runner.run({
        fixture,
        model
      });
      const scorecard = scoreEvalOutcome(fixture, outcome);
      evaluations.push({
        fixture,
        outcome,
        scorecard
      });

      regressionStore?.append({
        runId,
        model,
        fixtureId: fixture.id,
        category: fixture.category,
        totalScore: scorecard.totalScore,
        maxScore: scorecard.maxScore,
        createdAt
      });
    }

    const totalScore = evaluations.reduce((sum, evaluation) => sum + evaluation.scorecard.totalScore, 0);
    const maxScore = evaluations.reduce((sum, evaluation) => sum + evaluation.scorecard.maxScore, 0);

    results.push({
      model,
      evaluations,
      totalScore,
      maxScore
    });
  }

  return {
    runId,
    createdAt,
    fixtures,
    models: [...input.models],
    results
  };
}

export function runGoldenStructuredOutputSuite(
  cases: readonly GoldenStructuredCase<AgentRole | AdvisoryAgentRole>[] = goldenStructuredCases
): GoldenSuiteReport {
  const results = cases.map((entry) => {
    try {
      if (isPrimaryRole(entry.role)) {
        parseAgentOutput(entry.role, entry.raw);
      } else {
        parseAdvisoryAgentOutput(entry.role, entry.raw);
      }

      return {
        caseId: entry.id,
        role: entry.role,
        passed: true,
        detail: "Structured output matched the schema."
      } satisfies GoldenStructuredResult;
    } catch (error) {
      return {
        caseId: entry.id,
        role: entry.role,
        passed: false,
        detail: error instanceof Error ? error.message : String(error)
      } satisfies GoldenStructuredResult;
    }
  });

  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    results
  };
}

export function summarizeRegressionHistory(
  records: readonly RegressionRecord[],
  model: string
): RegressionSnapshot {
  const modelRecords = records.filter((record) => record.model === model);

  if (modelRecords.length === 0) {
    return {
      model,
      latestTotalScore: 0,
      previousTotalScore: null,
      delta: null,
      latestRunId: null
    };
  }

  const totalsByRun = new Map<string, number>();
  const sortedRunIds: string[] = [];

  for (const record of modelRecords) {
    if (!totalsByRun.has(record.runId)) {
      totalsByRun.set(record.runId, 0);
      sortedRunIds.push(record.runId);
    }
    totalsByRun.set(record.runId, (totalsByRun.get(record.runId) ?? 0) + record.totalScore);
  }

  const latestRunId = sortedRunIds[sortedRunIds.length - 1] ?? null;
  const previousRunId = sortedRunIds[sortedRunIds.length - 2] ?? null;
  const latestTotalScore = latestRunId ? (totalsByRun.get(latestRunId) ?? 0) : 0;
  const previousTotalScore = previousRunId ? (totalsByRun.get(previousRunId) ?? 0) : null;

  return {
    model,
    latestTotalScore,
    previousTotalScore,
    delta: previousTotalScore === null ? null : latestTotalScore - previousTotalScore,
    latestRunId
  };
}

export class RegressionStore {
  public constructor(private readonly filename: string) {}

  public load(): RegressionRecord[] {
    try {
      return JSON.parse(readFileSync(this.filename, "utf8")) as RegressionRecord[];
    } catch {
      return [];
    }
  }

  public append(record: RegressionRecord): void {
    mkdirSync(dirname(this.filename), { recursive: true });
    const records = this.load();
    records.push(record);
    writeFileSync(this.filename, JSON.stringify(records, null, 2).concat("\n"), "utf8");
  }
}

function scoreBooleanExpectation(
  expected: boolean,
  actual: boolean,
  passDetail: string,
  failDetail: string
): EvalCriterionResult {
  const passed = expected === actual;

  return {
    passed,
    score: passed ? 1 : 0,
    detail: passed ? passDetail : failDetail
  };
}

function scoreMaxChangedFiles(maxChangedFiles: number, actualChangedFiles: number): EvalCriterionResult {
  const passed = actualChangedFiles <= maxChangedFiles;

  return {
    passed,
    score: passed ? 1 : 0,
    detail: passed
      ? `Changed files stayed within the fixture budget (${actualChangedFiles}/${maxChangedFiles}).`
      : `Changed files exceeded the fixture budget (${actualChangedFiles}/${maxChangedFiles}).`
  };
}

function scoreReviewerSeededBug(
  keywords: readonly string[],
  expectedFile: string | undefined,
  findings: readonly {
    readonly message: string;
    readonly filePath?: string;
    readonly line?: number;
  }[]
): EvalCriterionResult {
  if (keywords.length === 0) {
    return {
      passed: true,
      score: 1,
      detail: "Fixture does not require a seeded-bug catch."
    };
  }

  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const passed = findings.some((finding) => {
    const haystack = `${finding.message} ${finding.filePath ?? ""}`.toLowerCase();
    const keywordMatch = normalizedKeywords.some((keyword) => haystack.includes(keyword));
    const fileMatch = expectedFile ? finding.filePath === expectedFile : true;
    return keywordMatch && fileMatch;
  });

  return {
    passed,
    score: passed ? 1 : 0,
    detail: passed
      ? "Reviewer findings matched the seeded bug expectation."
      : "Reviewer did not clearly catch the seeded bug."
  };
}

function scoreForbiddenFileAccess(
  forbiddenPaths: readonly string[],
  fileAccesses: readonly string[]
): EvalCriterionResult {
  const violations = fileAccesses.filter((file) =>
    forbiddenPaths.some((forbiddenPath) => file === forbiddenPath || file.startsWith(`${forbiddenPath}/`))
  );

  return {
    passed: violations.length === 0,
    score: violations.length === 0 ? 1 : 0,
    detail:
      violations.length === 0
        ? "No forbidden file access was observed."
        : `Forbidden file access observed: ${violations.join(", ")}`
  };
}

function scoreUsefulSummary(
  requiredMentions: readonly string[],
  summary: string
): EvalCriterionResult {
  const loweredSummary = summary.toLowerCase();
  const missing = requiredMentions.filter((mention) => !loweredSummary.includes(mention.toLowerCase()));

  return {
    passed: missing.length === 0,
    score: missing.length === 0 ? 1 : 0,
    detail:
      missing.length === 0
        ? "Final summary mentioned the expected outcome details."
        : `Final summary is missing: ${missing.join(", ")}`
  };
}

function isPrimaryRole(role: AgentRole | AdvisoryAgentRole): role is AgentRole {
  return role === "coordinator" ||
    role === "coder" ||
    role === "reviewer" ||
    role === "test-runner" ||
    role === "coordinator-report";
}
